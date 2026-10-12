-- =========================================================
-- Neo Admin — 0134 Cartão de crédito, Fase 2: ciclo mensal por cartão (situação, fechamento, histórico)
-- Especificação: docs/modulos/financeiro-cartao.md (seção 5, regras 13 a 19).
--
-- Ciclo = empresa + cartão + competência (mês do vencimento nominal). Situações:
--   aguardando_fatura → em_conciliacao → fechada → paga
-- - O ciclo nasce no dia seguinte ao fechamento do cartão (crt_gerar_ciclos, diário pelo pg_cron e também ao abrir a tela),
--   com a pendência "Importar fatura <CARTÃO> MM/AAAA".
-- - Importar a fatura leva o ciclo a em_conciliacao; cancelar a fatura o devolve a aguardando_fatura.
-- - A tela grava a apuração (itens a lançar, diferença, resíduo, título provisório) e mantém as pendências "Conciliar fatura"
--   (enquanto houver algo) e "Fechar a fatura" (para o gestor, quando tudo zerou).
-- - Fechar: só gestor, só com zero a lançar e resíduo zero; grava crt_fechamentos (cópia do resultado = prova).
-- - Reabrir: só gestor, com motivo.
-- - Paga: automático. No fechamento o financeiro lança um título PROVISÓRIO contra o banco e o exclui depois do pagamento;
--   quando a sincronização do contas a pagar marca baixado_em nesse título, o ciclo vira paga.
-- - Agendamentos: crt-gerar-ciclos-diario (07:00 Cuiabá) e cap-sincronizar-consistem-diario (07:30 Cuiabá, que até aqui só
--   rodava pelo botão "Atualizar do Consistem").
-- Pendências: só criadas, concluídas ou canceladas (nunca editadas), porque o núcleo só deixa o gestor alterar os dados delas.
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.cartao.ciclos_a_partir_de', '"2026-10-01"',
   'Primeira competência (mês do vencimento) em que o módulo Cartão de crédito cria os ciclos mensais sozinho. Meses anteriores não são criados.')
on conflict (chave) do nothing;

-- 1) Calendário ------------------------------------------------------------
-- Dia `dia` do mês (1–12) de `ano`, limitado ao último dia do mês (dia 31 em fevereiro vira 28/29). Mês fora de 1–12 rola o ano.
create or replace function crt_dia(p_ano int, p_mes int, p_dia int) returns date
language sql immutable as $$
  with b as (select (make_date(p_ano, 1, 1) + make_interval(months => p_mes - 1))::date as ini)
  select (ini + (least(p_dia, extract(day from (ini + interval '1 month - 1 day'))::int) - 1))::date from b
$$;

-- Vencimento nominal e fechamento de uma competência (mesma regra de faturaDaCompra em lib/modulos/financeiro/cartao/cartoes.ts):
-- vencimento = dia de vencimento no mês da competência; fechamento = o último dia de fechamento ANTES do vencimento.
create or replace function crt_calendario(p_dia_fechamento int, p_dia_vencimento int, p_competencia date,
                                          out vencimento date, out fechamento date)
language plpgsql immutable as $$
declare
  a int := extract(year from p_competencia)::int;
  m int := extract(month from p_competencia)::int;
begin
  vencimento := crt_dia(a, m, p_dia_vencimento);
  fechamento := crt_dia(a, m, p_dia_fechamento);
  if fechamento >= vencimento then
    fechamento := crt_dia(a, m - 1, p_dia_fechamento);
  end if;
end $$;

-- Competência de um vencimento efetivo (que o emissor pode deslocar para o dia útil): o mês cujo vencimento nominal fica mais perto.
create or replace function crt_competencia_do_vencimento(p_dia_vencimento int, p_vencimento date) returns date
language sql immutable as $$
  select c from (
    select (date_trunc('month', p_vencimento) + make_interval(months => d))::date as c
      from generate_series(-1, 1) as d
  ) x
  order by abs(crt_dia(extract(year from c)::int, extract(month from c)::int, p_dia_vencimento) - p_vencimento), c
  limit 1
$$;

-- 2) Ciclos ------------------------------------------------------------------
create type crt_situacao_ciclo as enum ('aguardando_fatura', 'em_conciliacao', 'fechada', 'paga');

create table crt_ciclos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  cartao text not null references crt_cartoes(codigo),
  competencia date not null check (extract(day from competencia) = 1),   -- 1º dia do mês do vencimento nominal
  fechamento date not null,
  vencimento_nominal date not null,
  situacao crt_situacao_ciclo not null default 'aguardando_fatura',
  fatura_id uuid references crt_faturas(id),                              -- fatura importada vigente
  -- apuração mais recente (gravada pela tela a cada cálculo)
  apurado_em timestamptz,
  itens_a_lancar int,
  diferenca numeric(14,2),
  residuo numeric(14,2),
  provisorio_cod_lancamento text,                                         -- título provisório da fatura no Consistem
  fechada_por uuid references perfis(id),
  fechada_em timestamptz,
  paga_em date,
  paga_por_cod_lancamento text,
  criado_em timestamptz not null default now(),
  unique (empresa_id, cartao, competencia)
);
comment on table crt_ciclos is 'Ciclo mensal de um cartão (empresa + cartão + mês do vencimento): aguardando fatura → em conciliação → fechada → paga.';
create index idx_crt_ciclos_competencia on crt_ciclos (competencia desc, cartao);
create index idx_crt_ciclos_provisorio on crt_ciclos (empresa_id, provisorio_cod_lancamento) where situacao = 'fechada';

create trigger trg_crt_ciclos_sem_delete before delete on crt_ciclos for each row execute function fn_bloquear_delete();
-- Auditoria só das mudanças de situação (a apuração muda a cada visita à tela e não é prova).
create trigger trg_aud_crt_ciclos_ins after insert on crt_ciclos for each row execute function fn_auditoria();
create trigger trg_aud_crt_ciclos_upd after update of situacao, fatura_id, fechada_em, paga_em on crt_ciclos for each row execute function fn_auditoria();

alter table crt_faturas add column ciclo_id uuid references crt_ciclos(id);
create index idx_crt_faturas_ciclo on crt_faturas (ciclo_id);
-- A fatura continua imutável; só o vínculo com o ciclo (ciclo_id) pode ser preenchido pelas funções do módulo.
create or replace function fn_crt_fatura_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.status := 'importada'; new.importado_por := auth.uid(); new.importado_em := now();
      new.cancelado_por := null; new.cancelado_em := null; new.motivo_cancelamento := null;
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'status' - 'cancelado_por' - 'cancelado_em' - 'motivo_cancelamento' - 'observacao' - 'ciclo_id')
     <> (to_jsonb(old) - 'status' - 'cancelado_por' - 'cancelado_em' - 'motivo_cancelamento' - 'observacao' - 'ciclo_id') then
    raise exception 'A fatura importada é imutável: cancele-a (com motivo) e importe de novo.';
  end if;
  if old.status = 'cancelada' then
    raise exception 'A fatura já está cancelada e não pode mais ser alterada.';
  end if;
  if new.status = 'cancelada' then
    if coalesce(trim(new.motivo_cancelamento), '') = '' then
      raise exception 'Informe o motivo do cancelamento.';
    end if;
    if auth.uid() is not null then
      if not tem_acesso_area('financeiro', 'gestor') and old.importado_por is distinct from auth.uid() then
        raise exception 'Só gestor do Financeiro cancela a fatura (ou quem a importou).';
      end if;
      new.cancelado_por := auth.uid();
    end if;
    new.cancelado_em := now();
  else
    new.cancelado_por := old.cancelado_por; new.cancelado_em := old.cancelado_em; new.motivo_cancelamento := old.motivo_cancelamento;
  end if;
  return new;
end $$;

-- A view usa f.*: recriar para enxergar ciclo_id.
drop view crt_vw_faturas;
create view crt_vw_faturas with (security_invoker = true) as
select f.*, e.nome_curto as empresa_nome, c.nome as cartao_nome, c.banco as cartao_banco, pi.nome as importado_por_nome, pc.nome as cancelado_por_nome
  from crt_faturas f
  join empresas e on e.id = f.empresa_id
  join crt_cartoes c on c.codigo = f.cartao
  left join perfis pi on pi.id = f.importado_por
  left join perfis pc on pc.id = f.cancelado_por;

-- 3) Fechamentos (prova) -----------------------------------------------------
create table crt_fechamentos (
  id uuid primary key default gen_random_uuid(),
  ciclo_id uuid not null references crt_ciclos(id),
  versao int not null,
  fatura_id uuid not null references crt_faturas(id),
  resultado jsonb not null,                       -- ResultadoConciliacao inteiro no momento do fechamento
  total_fatura numeric(14,2) not null,
  total_titulos numeric(14,2) not null,
  provisorio_cod_lancamento text,
  fechado_por uuid references perfis(id) default auth.uid(),
  fechado_em timestamptz not null default now(),
  reaberto_por uuid references perfis(id),
  reaberto_em timestamptz,
  motivo_reabertura text,
  unique (ciclo_id, versao)
);
comment on table crt_fechamentos is 'Fechamentos do ciclo do cartão: cópia imutável do resultado da conciliação. Só a reabertura (uma vez, com motivo) é anotada.';

create function fn_crt_fechamento_regras() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'reaberto_por' - 'reaberto_em' - 'motivo_reabertura') <> (to_jsonb(old) - 'reaberto_por' - 'reaberto_em' - 'motivo_reabertura') then
    raise exception 'O fechamento é imutável; só a reabertura é anotada.';
  end if;
  if old.reaberto_em is not null then
    raise exception 'Este fechamento já foi reaberto.';
  end if;
  if new.reaberto_em is not null and coalesce(trim(new.motivo_reabertura), '') = '' then
    raise exception 'Informe o motivo da reabertura.';
  end if;
  return new;
end $$;
create trigger trg_crt_fechamentos_regras before update on crt_fechamentos for each row execute function fn_crt_fechamento_regras();
create trigger trg_crt_fechamentos_sem_delete before delete on crt_fechamentos for each row execute function fn_bloquear_delete();
create trigger trg_aud_crt_fechamentos after insert or update on crt_fechamentos for each row execute function fn_auditoria();

-- RLS: leitura por área; escrita só pelas funções abaixo (security definer, com a checagem de nível dentro).
alter table crt_ciclos enable row level security;
alter table crt_fechamentos enable row level security;
create policy crt_ciclos_ler on crt_ciclos for select to authenticated using (tem_acesso_area('financeiro'));
create policy crt_fechamentos_ler on crt_fechamentos for select to authenticated using (tem_acesso_area('financeiro'));

create view crt_vw_ciclos with (security_invoker = true) as
select c.*, e.nome_curto as empresa_nome, k.nome as cartao_nome, k.banco as cartao_banco,
       f.total_informado as total_fatura, f.arquivo_nome as fatura_arquivo, f.importado_em as fatura_importada_em,
       pf.nome as fechada_por_nome
  from crt_ciclos c
  join empresas e on e.id = c.empresa_id
  join crt_cartoes k on k.codigo = c.cartao
  left join crt_faturas f on f.id = c.fatura_id
  left join perfis pf on pf.id = c.fechada_por;

-- 4) Pendências do ciclo (auxiliares internas) --------------------------------
create function crt_rotulo_ciclo(p_ciclo crt_ciclos) returns text language sql stable as $$
  select (select nome from crt_cartoes where codigo = p_ciclo.cartao) || ' ' || to_char(p_ciclo.competencia, 'MM/YYYY')
$$;

-- Abre a pendência do ciclo se ainda não houver uma aberta com o mesmo título.
create function crt_abrir_pendencia(p_ciclo crt_ciclos, p_titulo text, p_descricao text, p_prazo date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
begin
  insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
  select 'financeiro.cartao', p_ciclo.empresa_id, p_titulo, p_descricao, p_prazo,
         case when p_prazo <= v_hoje + 3 then 'alta'::criticidade else 'normal'::criticidade end,
         'crt_ciclos', p_ciclo.id, '/financeiro/cartao/ciclo/' || p_ciclo.id
   where not exists (select 1 from pendencias where modulo = 'financeiro.cartao' and referencia_tabela = 'crt_ciclos'
                       and referencia_id = p_ciclo.id and titulo = p_titulo and status in ('aberta', 'em_andamento'));
end $$;

-- Encerra (concluída ou cancelada) as pendências abertas do ciclo cujo título começa com o prefixo.
create function crt_encerrar_pendencias(p_ciclo uuid, p_prefixo text, p_status status_pendencia) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pendencias set status = p_status
   where modulo = 'financeiro.cartao' and referencia_tabela = 'crt_ciclos' and referencia_id = p_ciclo
     and titulo like p_prefixo || '%' and status in ('aberta', 'em_andamento');
end $$;
revoke all on function crt_abrir_pendencia(crt_ciclos, text, text, date) from public, anon, authenticated;
revoke all on function crt_encerrar_pendencias(uuid, text, status_pendencia) from public, anon, authenticated;

-- 5) Gerar os ciclos que já fecharam ------------------------------------------
create function crt_gerar_ciclos() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_inicio date;
  v_comp date;
  v_cal record;
  v_ciclo crt_ciclos;
  v_criados int := 0;
  k record;
  e record;
begin
  if auth.uid() is not null and not tem_acesso_area('financeiro') then
    raise exception 'Sem acesso ao Financeiro.';
  end if;
  select coalesce(nullif(valor #>> '{}', '')::date, date '2026-10-01') into v_inicio
    from configuracoes where chave = 'financeiro.cartao.ciclos_a_partir_de';
  v_inicio := date_trunc('month', coalesce(v_inicio, date '2026-10-01'))::date;

  for e in select id from empresas where ativa and codigo_erp is not null loop
    for k in select * from crt_cartoes where ativo loop
      v_comp := v_inicio;
      while v_comp <= date_trunc('month', v_hoje + 40)::date loop
        select * into v_cal from crt_calendario(k.dia_fechamento, k.dia_vencimento, v_comp);
        if v_cal.fechamento < v_hoje then
          insert into crt_ciclos (empresa_id, cartao, competencia, fechamento, vencimento_nominal)
          values (e.id, k.codigo, v_comp, v_cal.fechamento, v_cal.vencimento)
          on conflict (empresa_id, cartao, competencia) do nothing
          returning * into v_ciclo;
          if found then
            v_criados := v_criados + 1;
            perform crt_abrir_pendencia(v_ciclo, 'Importar fatura ' || crt_rotulo_ciclo(v_ciclo),
              'O cartão ' || k.nome || ' fechou em ' || to_char(v_cal.fechamento, 'DD/MM/YYYY') || ' e vence em ' || to_char(v_cal.vencimento, 'DD/MM/YYYY')
              || '. Baixe a fatura (PDF) do emissor e importe em Financeiro > Cartão de crédito para conciliar com o contas a pagar.',
              v_cal.vencimento);
          end if;
        end if;
        v_comp := (v_comp + interval '1 month')::date;
      end loop;
    end loop;
  end loop;
  return v_criados;
end $$;
revoke all on function crt_gerar_ciclos() from public, anon;
grant execute on function crt_gerar_ciclos() to authenticated;

-- Ciclo de uma fatura (cria se não existir; usado na importação sem ciclo informado e no backfill).
create function crt_ciclo_para(p_empresa uuid, p_cartao text, p_vencimento date) returns crt_ciclos
language plpgsql security definer set search_path = public as $$
declare
  k crt_cartoes;
  v_comp date;
  v_cal record;
  v_ciclo crt_ciclos;
begin
  select * into k from crt_cartoes where codigo = p_cartao;
  v_comp := crt_competencia_do_vencimento(k.dia_vencimento, p_vencimento);
  select * into v_cal from crt_calendario(k.dia_fechamento, k.dia_vencimento, v_comp);
  insert into crt_ciclos (empresa_id, cartao, competencia, fechamento, vencimento_nominal)
  values (p_empresa, p_cartao, v_comp, v_cal.fechamento, v_cal.vencimento)
  on conflict (empresa_id, cartao, competencia) do nothing;
  select * into v_ciclo from crt_ciclos where empresa_id = p_empresa and cartao = p_cartao and competencia = v_comp;
  return v_ciclo;
end $$;
revoke all on function crt_ciclo_para(uuid, text, date) from public, anon, authenticated;

-- 6) Importar e cancelar a fatura agora movem o ciclo ---------------------------
drop function crt_importar_fatura(uuid, text, date, numeric, text, text, jsonb, text);
create function crt_importar_fatura(p_empresa uuid, p_cartao text, p_vencimento date, p_total numeric, p_leitor text, p_arquivo text, p_linhas jsonb,
                                    p_observacao text default null, p_ciclo uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n int;
  v_descartadas int;
  v_soma numeric(14,2);
  v_existente uuid;
  v_ciclo crt_ciclos;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode importar a fatura.';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and ativa) then
    raise exception 'Empresa inválida.';
  end if;
  if not exists (select 1 from crt_cartoes where codigo = p_cartao and ativo) then
    raise exception 'Cartão % não existe ou está inativo.', p_cartao;
  end if;
  if p_vencimento is null then
    raise exception 'Informe o vencimento efetivo da fatura.';
  end if;
  if p_total is null or p_total < 0 then
    raise exception 'Informe o total da fatura conforme o documento do emissor.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'A fatura não tem linhas de transação.';
  end if;
  if jsonb_array_length(p_linhas) > 2000 then
    raise exception 'A fatura tem linhas demais (limite 2000).';
  end if;

  if p_ciclo is null then
    v_ciclo := crt_ciclo_para(p_empresa, p_cartao, p_vencimento);
  else
    select * into v_ciclo from crt_ciclos where id = p_ciclo;
    if v_ciclo.id is null then
      raise exception 'Mês do cartão não encontrado.';
    end if;
    if v_ciclo.empresa_id <> p_empresa or v_ciclo.cartao <> p_cartao then
      raise exception 'A fatura não é deste mês/cartão.';
    end if;
  end if;
  if v_ciclo.situacao in ('fechada', 'paga') then
    raise exception 'A fatura % já está %: reabra o mês antes de importar outra.', crt_rotulo_ciclo(v_ciclo), v_ciclo.situacao;
  end if;

  select id into v_existente from crt_faturas where empresa_id = p_empresa and cartao = p_cartao and vencimento = p_vencimento and status = 'importada';
  if v_existente is not null or v_ciclo.fatura_id is not null then
    raise exception 'A fatura % já foi importada. Cancele-a (com motivo) antes de importar outra.', crt_rotulo_ciclo(v_ciclo);
  end if;

  select count(*), count(*) filter (where coalesce((l->>'descartada')::boolean, false)),
         coalesce(sum((l->>'valor')::numeric) filter (where not coalesce((l->>'descartada')::boolean, false)), 0)
    into v_n, v_descartadas, v_soma
    from jsonb_array_elements(p_linhas) l;
  if v_soma <> round(p_total, 2) then
    raise exception 'A soma das linhas lidas (R$ %) não bate com o total informado (R$ %): a leitura está incompleta ou o total está errado.',
      to_char(v_soma, 'FM999G999G990D00'), to_char(round(p_total, 2), 'FM999G999G990D00');
  end if;

  insert into crt_faturas (empresa_id, cartao, vencimento, total_informado, soma_linhas, linhas_lidas, linhas_descartadas, leitor, arquivo_nome, observacao, ciclo_id)
  values (p_empresa, p_cartao, p_vencimento, round(p_total, 2), v_soma, v_n, v_descartadas, coalesce(p_leitor, 'generico'), p_arquivo, nullif(trim(p_observacao), ''), v_ciclo.id)
  returning id into v_id;

  insert into crt_fatura_linhas (fatura_id, ordem, pagina, data_compra, descricao, valor, parcela_num, parcela_total, descartada, motivo_descarte, texto_origem)
  select v_id, coalesce((l->>'ordem')::int, n::int), (l->>'pagina')::int, nullif(l->>'data_compra', '')::date,
         coalesce(nullif(trim(l->>'descricao'), ''), '(sem descrição)'), round((l->>'valor')::numeric, 2),
         (l->>'parcela_num')::int, (l->>'parcela_total')::int, coalesce((l->>'descartada')::boolean, false), l->>'motivo_descarte', l->>'texto_origem'
    from jsonb_array_elements(p_linhas) with ordinality as t(l, n);

  update crt_ciclos set fatura_id = v_id, situacao = 'em_conciliacao', apurado_em = null, itens_a_lancar = null, diferenca = null, residuo = null
   where id = v_ciclo.id;
  perform crt_encerrar_pendencias(v_ciclo.id, 'Importar fatura', 'concluida');
  return v_id;
end $$;
revoke all on function crt_importar_fatura(uuid, text, date, numeric, text, text, jsonb, text, uuid) from public, anon;
grant execute on function crt_importar_fatura(uuid, text, date, numeric, text, text, jsonb, text, uuid) to authenticated;

create or replace function crt_cancelar_fatura(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
  v_ciclo crt_ciclos;
  v_fatura crt_faturas;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode cancelar a fatura.';
  end if;
  select * into v_fatura from crt_faturas where id = p_id;
  if v_fatura.ciclo_id is not null then
    select * into v_ciclo from crt_ciclos where id = v_fatura.ciclo_id;
    if v_ciclo.situacao in ('fechada', 'paga') then
      raise exception 'A fatura % está %: reabra o mês antes de cancelar a fatura.', crt_rotulo_ciclo(v_ciclo), v_ciclo.situacao;
    end if;
  end if;
  update crt_faturas set status = 'cancelada', motivo_cancelamento = nullif(trim(p_motivo), '') where id = p_id and status = 'importada';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Fatura não encontrada ou já cancelada (ou você não tem acesso a ela).';
  end if;
  if v_ciclo.id is not null and v_ciclo.fatura_id = p_id then
    update crt_ciclos set fatura_id = null, situacao = 'aguardando_fatura', apurado_em = null, itens_a_lancar = null, diferenca = null,
                          residuo = null, provisorio_cod_lancamento = null
     where id = v_ciclo.id;
    perform crt_encerrar_pendencias(v_ciclo.id, 'Conciliar fatura', 'cancelada');
    perform crt_encerrar_pendencias(v_ciclo.id, 'Fechar a fatura', 'cancelada');
    perform crt_abrir_pendencia(v_ciclo, 'Importar fatura ' || crt_rotulo_ciclo(v_ciclo),
      'A fatura importada foi cancelada (' || coalesce(nullif(trim(p_motivo), ''), 'sem motivo') || '). Importe a fatura de novo para conciliar.',
      v_ciclo.vencimento_nominal);
  end if;
end $$;

-- 7) Apuração (gravada pela tela) e pendências de conciliar/fechar ---------------
create function crt_registrar_apuracao(p_ciclo uuid, p_itens int, p_diferenca numeric, p_residuo numeric, p_provisorio text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo crt_ciclos;
  v_pendente boolean := coalesce(p_itens, 0) > 0 or coalesce(p_residuo, 0) <> 0;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro') then
    raise exception 'Sem acesso ao Financeiro.';
  end if;
  select * into v_ciclo from crt_ciclos where id = p_ciclo;
  if v_ciclo.id is null or v_ciclo.situacao <> 'em_conciliacao' then
    return;   -- só o ciclo em conciliação é apurado (fechado mostra o resultado congelado)
  end if;
  update crt_ciclos set apurado_em = now(), itens_a_lancar = p_itens, diferenca = round(p_diferenca, 2), residuo = round(p_residuo, 2),
                        provisorio_cod_lancamento = nullif(trim(p_provisorio), '')
   where id = p_ciclo;
  if v_pendente then
    perform crt_encerrar_pendencias(p_ciclo, 'Fechar a fatura', 'cancelada');
    perform crt_abrir_pendencia(v_ciclo, 'Conciliar fatura ' || crt_rotulo_ciclo(v_ciclo),
      'A conciliação da fatura tem ' || coalesce(p_itens, 0) || ' item(ns) a lançar no Consistem e diferença não justificada de R$ '
      || to_char(coalesce(p_residuo, 0), 'FM999G999G990D00') || ' (na última apuração). Lance o que falta, corrija as divergências e confira de novo a tela da fatura.',
      v_ciclo.vencimento_nominal);
  else
    perform crt_encerrar_pendencias(p_ciclo, 'Conciliar fatura', 'concluida');
    perform crt_abrir_pendencia(v_ciclo, 'Fechar a fatura ' || crt_rotulo_ciclo(v_ciclo),
      'A conciliação zerou: nada a lançar e diferença não justificada R$ 0,00. O gestor do Financeiro confere e fecha o mês do cartão.',
      v_ciclo.vencimento_nominal);
  end if;
end $$;
revoke all on function crt_registrar_apuracao(uuid, int, numeric, numeric, text) from public, anon;
grant execute on function crt_registrar_apuracao(uuid, int, numeric, numeric, text) to authenticated;

-- 8) Fechar e reabrir ------------------------------------------------------------
create function crt_fechar_ciclo(p_ciclo uuid, p_resultado jsonb, p_itens int, p_residuo numeric, p_total_fatura numeric, p_total_titulos numeric,
                                 p_provisorio text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo crt_ciclos;
  v_id uuid;
  v_versao int;
  v_baixado date;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'gestor') then
    raise exception 'Somente gestor do Financeiro (ou acima) pode fechar o mês do cartão.';
  end if;
  select * into v_ciclo from crt_ciclos where id = p_ciclo for update;
  if v_ciclo.id is null then
    raise exception 'Mês do cartão não encontrado.';
  end if;
  if v_ciclo.situacao <> 'em_conciliacao' or v_ciclo.fatura_id is null then
    raise exception 'Só um mês em conciliação, com fatura importada, pode ser fechado (situação atual: %).', v_ciclo.situacao;
  end if;
  if coalesce(p_itens, 1) <> 0 then
    raise exception 'Ainda há % item(ns) da fatura sem título no Consistem: lance-os antes de fechar.', p_itens;
  end if;
  if coalesce(p_residuo, 1) <> 0 then
    raise exception 'A diferença não justificada é R$ %: precisa ser zero para fechar.', to_char(p_residuo, 'FM999G999G990D00');
  end if;
  if p_resultado is null or jsonb_typeof(p_resultado) <> 'object' then
    raise exception 'Resultado da conciliação ausente.';
  end if;

  select coalesce(max(versao), 0) + 1 into v_versao from crt_fechamentos where ciclo_id = p_ciclo;
  insert into crt_fechamentos (ciclo_id, versao, fatura_id, resultado, total_fatura, total_titulos, provisorio_cod_lancamento, fechado_por)
  values (p_ciclo, v_versao, v_ciclo.fatura_id, p_resultado, round(p_total_fatura, 2), round(p_total_titulos, 2), nullif(trim(p_provisorio), ''), auth.uid())
  returning id into v_id;

  update crt_ciclos set situacao = 'fechada', fechada_por = auth.uid(), fechada_em = now(), itens_a_lancar = 0, residuo = 0,
                        provisorio_cod_lancamento = nullif(trim(p_provisorio), '')
   where id = p_ciclo;
  perform crt_encerrar_pendencias(p_ciclo, 'Conciliar fatura', 'concluida');
  perform crt_encerrar_pendencias(p_ciclo, 'Fechar a fatura', 'concluida');

  -- O provisório já saiu do Consistem (fatura paga antes do fechamento): já fica paga.
  select baixado_em into v_baixado from cap_lancamentos
   where empresa_id = v_ciclo.empresa_id and cod_lancamento = nullif(trim(p_provisorio), '') and baixado_em is not null;
  if v_baixado is not null then
    update crt_ciclos set situacao = 'paga', paga_em = v_baixado, paga_por_cod_lancamento = trim(p_provisorio) where id = p_ciclo;
  end if;
  return v_id;
end $$;
revoke all on function crt_fechar_ciclo(uuid, jsonb, int, numeric, numeric, numeric, text) from public, anon;
grant execute on function crt_fechar_ciclo(uuid, jsonb, int, numeric, numeric, numeric, text) to authenticated;

create function crt_reabrir_ciclo(p_ciclo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo crt_ciclos;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'gestor') then
    raise exception 'Somente gestor do Financeiro (ou acima) pode reabrir o mês do cartão.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da reabertura.';
  end if;
  select * into v_ciclo from crt_ciclos where id = p_ciclo for update;
  if v_ciclo.id is null or v_ciclo.situacao <> 'fechada' then
    raise exception 'Só um mês fechado (e ainda não pago) pode ser reaberto.';
  end if;
  update crt_fechamentos set reaberto_por = auth.uid(), reaberto_em = now(), motivo_reabertura = trim(p_motivo)
   where ciclo_id = p_ciclo and reaberto_em is null;
  update crt_ciclos set situacao = 'em_conciliacao', fechada_por = null, fechada_em = null, apurado_em = null where id = p_ciclo;
  perform crt_abrir_pendencia(v_ciclo, 'Conciliar fatura ' || crt_rotulo_ciclo(v_ciclo),
    'O mês foi reaberto (' || trim(p_motivo) || '). Confira a conciliação e feche de novo.', v_ciclo.vencimento_nominal);
end $$;
revoke all on function crt_reabrir_ciclo(uuid, text) from public, anon;
grant execute on function crt_reabrir_ciclo(uuid, text) to authenticated;

-- 9) Paga automática: o título provisório da fatura saiu do Consistem -------------
create function fn_crt_provisorio_baixado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.baixado_em is not null and old.baixado_em is null then
    update crt_ciclos set situacao = 'paga', paga_em = new.baixado_em, paga_por_cod_lancamento = new.cod_lancamento
     where empresa_id = new.empresa_id and provisorio_cod_lancamento = new.cod_lancamento and situacao = 'fechada';
  end if;
  return new;
end $$;
create trigger trg_crt_provisorio_baixado after update of baixado_em on cap_lancamentos
  for each row execute function fn_crt_provisorio_baixado();

-- 10) Backfill: fatura já importada ganha o seu ciclo (em conciliação) ------------
do $$
declare
  f record;
  v_ciclo crt_ciclos;
begin
  for f in select * from crt_faturas where status = 'importada' and ciclo_id is null loop
    v_ciclo := crt_ciclo_para(f.empresa_id, f.cartao, f.vencimento);
    update crt_faturas set ciclo_id = v_ciclo.id where id = f.id;
    update crt_ciclos set fatura_id = f.id, situacao = 'em_conciliacao' where id = v_ciclo.id and fatura_id is null;
  end loop;
end $$;

-- 11) Agendamentos (só onde há pg_cron/pg_net: Supabase) -------------------------
-- Sincronização diária do contas a pagar (para a "paga" aparecer sozinha). Mesmo segredo do agendamento de Recebíveis
-- (SINCRONIZACAO_SEGREDO vale para todas as Edge Functions do projeto); a URL é a do Vault com o nome da função trocado.
create or replace function cap_chamar_sincronizacao() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_segredo text;
  v_requisicao bigint;
begin
  select replace(decrypted_secret, 'rec-sincronizar-consistem', 'cap-sincronizar-consistem') into v_url from vault.decrypted_secrets where name = 'rec_sincronizar_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'rec_sincronizar_segredo';
  if v_url is null or v_segredo is null then
    raise warning 'Sincronização do contas a pagar sem configuração: faltam rec_sincronizar_url e/ou rec_sincronizar_segredo no Vault.';
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sincronizacao-segredo', v_segredo),
    body := '{"acao":"sincronizar"}'::jsonb,
    timeout_milliseconds := 150000
  ) into v_requisicao;
  return v_requisicao;
end $$;
revoke all on function cap_chamar_sincronizacao() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('crt-gerar-ciclos-diario', '0 11 * * *', 'select public.crt_gerar_ciclos()');
    perform cron.schedule('cap-sincronizar-consistem-diario', '30 11 * * *', 'select public.cap_chamar_sincronizacao()');
  end if;
end $$;
