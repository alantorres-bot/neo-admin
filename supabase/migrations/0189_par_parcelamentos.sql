-- =========================================================
-- Neo Admin — 0189 Financeiro > Gestão de Parcelamentos (Fase 2). Especificação: docs/modulos/financeiro-parcelamentos.md
-- O Consistem é a fonte oficial: o módulo só LÊ o Contas a Pagar (lançamentos tipo P e, depois da guia lançada, o mesmo
-- código como C). Nada é escrito no ERP.
--   par_lancamentos   espelho dos lançamentos do ERP que interessam (chave: empresa + cod_lancamento) e a classificação de cada um
--   par_regras        regras de classificação (critérios combináveis, prioridade, exceção) — editadas na tela, sem código
--   par_parcelamentos a obrigação principal (id estável; chave_erp = fornecedor + número do documento sem o "-MM/AA")
--   par_parcelas      UMA linha por parcela da obrigação: o dashboard e os relatórios somam só esta tabela (nada em dobro)
-- Um lançamento do ERP liga-se a no máximo uma parcela e vice-versa (parcela_id único). Parcela manual que depois aparece no ERP
-- só é juntada ao lançamento por uma pessoa (par_vincular_lancamento).
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('financeiro.parcelamentos', 'financeiro', 'Gestão de Parcelamentos', true)
on conflict (codigo) do nothing;

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.parcelamentos.sincronizar_agendado', 'false',
   'Gestão de Parcelamentos: ler o Contas a Pagar do Consistem a cada 2 horas (dias úteis). Ligar depois da primeira atualização manual conferida.')
on conflict (chave) do nothing;

create function par_exigir(p_nivel nivel_acesso) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_modulo('financeiro.parcelamentos', p_nivel) then
    raise exception 'Somente % do Financeiro (ou acima) faz isto.', p_nivel;
  end if;
end $$;

-- 1) Naturezas (tabela, não enum: natureza nova entra sem mudar código) ------------------------------------------------------
create table par_naturezas (
  codigo text primary key check (codigo ~ '^[a-z_]{2,30}$'),
  nome text not null,
  ordem int not null default 0,
  ativa boolean not null default true
);
insert into par_naturezas (codigo, nome, ordem) values
  ('federal', 'Federal', 1), ('estadual', 'Estadual', 2), ('municipal', 'Municipal', 3), ('neo_servico', 'Neo Serviço', 4), ('outros', 'Outros', 9);

-- 2) Regras de classificação --------------------------------------------------------------------------------------------------
-- Casa quando TODOS os critérios preenchidos batem (nulo = não importa). Conta de fluxo é o PAR grupo/conta do Consistem
-- (ex.: 20/17); conta 17 sozinha não identifica nada. Exceção que casa vence: o lançamento fica "ignorado" (não é parcelamento).
create table par_regras (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 3 and 120),
  empresa_id uuid references empresas(id),
  tipos text[] check (tipos is null or (cardinality(tipos) > 0 and tipos <@ array['P', 'C'])),
  fornecedores text[] check (fornecedores is null or cardinality(fornecedores) > 0),
  grupo int check (grupo > 0),
  conta int check (conta > 0),
  complemento_contem text check (complemento_contem is null or length(btrim(complemento_contem)) between 2 and 80),
  natureza text references par_naturezas(codigo),
  excecao boolean not null default false,
  prioridade int not null default 100 check (prioridade between 1 and 999),
  ativa boolean not null default true,
  observacoes text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint par_regras_conta_par check ((grupo is null) = (conta is null)),
  constraint par_regras_natureza check (excecao or natureza is not null),
  -- regra só por tipo/empresa pegaria todo P do ERP (telefone, INSS…): exige fornecedor, conta de fluxo ou texto do histórico
  constraint par_regras_criterio check (fornecedores is not null or grupo is not null or complemento_contem is not null)
);
comment on table par_regras is 'Regras de classificação dos lançamentos do Contas a Pagar como parcelamento. Não se apagam: desativam-se.';

-- Regras iniciais (análise de 11/11/2026, planilhas PARCELAMENTOS NOVEMBRO e ALUTEC). Empresa = Neo Formas (código 1 no ERP).
-- O 336 só com 20/18: P do 336 em 27/6 é projeção de INSS/IRRF, não parcelamento. O 917 (Alutec) não exige conta de fluxo.
insert into par_regras (nome, empresa_id, tipos, fornecedores, grupo, conta, natureza, prioridade, observacoes) values
  ('PGE/MT e SEFAZ/MT — Parc. Imp. Estaduais (20/17)', (select id from empresas where codigo_erp = '1'), array['P', 'C'], array['986', '475'], 20, 17, 'estadual', 10,
   'Fornecedores 986 (PGE/MT) e 475 (SEFAZ/MT) na conta de fluxo 20/17.'),
  ('Ministério da Fazenda — Parc. Imp. Federais (20/18)', (select id from empresas where codigo_erp = '1'), array['P', 'C'], array['336'], 20, 18, 'federal', 10,
   'Fornecedor 336 só na conta 20/18 (em 27/6 é INSS/IRRF).'),
  ('Parcelamentos ALUTEC — fornecedor 917', (select id from empresas where codigo_erp = '1'), array['P', 'C'], array['917'], null, null, 'federal', 20,
   'Fornecedor 917 (Ministério da Fazenda – Parcelamentos ALUTEC), sem exigir conta de fluxo (hoje lançados em 11/6).');

-- 3) Parcelamentos ------------------------------------------------------------------------------------------------------------
create table par_parcelamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  descricao text not null check (length(btrim(descricao)) between 3 and 200),
  natureza text not null references par_naturezas(codigo),
  origem text not null check (origem in ('CONTAS_PAGAR', 'MANUAL')),
  devedor text check (length(devedor) <= 120),
  credor text check (length(credor) <= 120),
  cod_fornecedor text check (cod_fornecedor ~ '^\d{1,10}$'),
  grupo int,
  conta int,
  numero text check (length(numero) <= 60),
  processo text check (length(processo) <= 60),
  cda text check (length(cda) <= 60),
  inscricao text check (length(inscricao) <= 60),
  referencia_debito text check (length(referencia_debito) <= 200),
  data_adesao date,
  valor_original numeric(14,2) check (valor_original >= 0),
  qtd_parcelas int check (qtd_parcelas between 1 and 999),
  dia_vencimento int check (dia_vencimento between 1 and 31),
  situacao text not null default 'ativo' check (situacao in ('ativo', 'suspenso', 'rescindido', 'encerrado', 'cancelado')),
  responsavel_id uuid references perfis(id),
  observacoes text,
  chave_erp text check (chave_erp ~ '^\d{1,10}:.+$'),     -- <fornecedor>:<documento sem "-MM/AA">: as parcelas do ERP entram sozinhas
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table par_parcelamentos is 'Obrigação parcelada (cadastro principal). Nunca apagada: muda de situação.';
create unique index uq_par_parcelamentos_chave on par_parcelamentos (empresa_id, chave_erp) where chave_erp is not null;

-- 4) Parcelas -----------------------------------------------------------------------------------------------------------------
create table par_parcelas (
  id uuid primary key default gen_random_uuid(),
  parcelamento_id uuid not null references par_parcelamentos(id),
  competencia text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  numero int check (numero between 1 and 999),
  origem text not null check (origem in ('CONTAS_PAGAR', 'MANUAL')),
  vencimento date,                          -- só da parcela MANUAL; a do ERP vem do lançamento
  valor numeric(14,2) check (valor >= 0),   -- idem
  situacao_guia text not null default 'nao_solicitada' check (situacao_guia in
    ('nao_solicitada', 'pendente_emissao', 'em_emissao', 'emitida', 'necessita_atualizacao', 'indisponivel', 'cancelada')),
  responsavel_id uuid references perfis(id),
  observacoes text,
  cancelada_em timestamptz,
  motivo_cancelamento text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint par_parcelas_manual check (origem <> 'MANUAL' or (vencimento is not null and valor is not null)),
  constraint par_parcelas_cancelada check ((cancelada_em is null) = (motivo_cancelamento is null))
);
comment on table par_parcelas is 'Uma linha por parcela de um parcelamento. Painel e relatórios somam esta tabela, não os lançamentos.';
create unique index uq_par_parcelas_competencia on par_parcelas (parcelamento_id, competencia) where cancelada_em is null;

-- 5) Lançamentos do Consistem -------------------------------------------------------------------------------------------------
create table par_lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  cod_lancamento text not null check (cod_lancamento ~ '^\d{1,12}$'),
  tipo_lancamento text not null check (tipo_lancamento ~ '^[A-Z]$'),
  cod_fornecedor text not null,
  nome_fornecedor text,
  num_documento text not null,
  cod_historico text,
  complemento text,
  data_emissao date,
  data_vencimento date,
  valor_documento numeric(14,2) not null,
  valor_atualizado numeric(14,2),          -- saldo em aberto (lista dos P; no C, calculado pelo pagamento do detalhe)
  valor_provisionado numeric(14,2),        -- último valor visto enquanto era P (projeção)
  grupo int,
  conta int,
  data_pagamento date,                     -- só quando o ERP informa (em 11/11/2026 o detalhe vinha vazio mesmo nos C pagos)
  valor_pago numeric(14,2),
  valor_juros numeric(14,2),
  valor_multa numeric(14,2),
  cod_barras text,
  -- Baixa confirmada pelo Consistem (nunca por guia ou comprovante): C com saldo 0 na lista ou valor pago >= valor do documento
  -- (o resto do saldo é juro que o ERP não baixa). Guarda QUANDO a leitura viu a baixa; volta a nulo se o ERP reabrir.
  quitado_em timestamptz,
  detalhado_em timestamptz,                -- leu o detalhe (grupo/conta, pagamento)
  virou_c_em timestamptz,                  -- deixou de ser projeção: a guia foi lançada no Consistem (mesmo código)
  sumiu_em timestamptz,                    -- o ERP respondeu "Lançamento não cadastrado" (excluído); nunca apagamos
  chave_erp text,
  competencia text,
  -- sem_regra = nenhuma regra casou: fica disponível para análise (não é "não é parcelamento"); ignorado = exceção que casou.
  classificacao text not null default 'aguardando_detalhe' check (classificacao in
    ('aguardando_detalhe', 'pendente', 'classificado', 'sem_regra', 'ignorado', 'manual_parcelamento', 'manual_ignorado')),
  natureza text references par_naturezas(codigo),
  regra_id uuid references par_regras(id),
  motivo text,
  classificado_por uuid references perfis(id),
  classificado_em timestamptz,
  parcela_id uuid unique references par_parcelas(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, cod_lancamento)
);
comment on table par_lancamentos is 'Espelho dos lançamentos do Contas a Pagar do Consistem (tipo P e o mesmo código depois de virar C) e a classificação de cada um.';
create index idx_par_lancamentos_classificacao on par_lancamentos (classificacao);
create index idx_par_lancamentos_chave on par_lancamentos (empresa_id, chave_erp);

-- 6) Rodadas de sincronização ---------------------------------------------------------------------------------------------------
create table par_sincronizacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  agendada boolean not null default false,
  usuario_id uuid references perfis(id),
  situacao text not null default 'em_andamento' check (situacao in ('em_andamento', 'ok', 'erro')),
  resumo jsonb,
  erro text,
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['par_regras', 'par_parcelamentos', 'par_parcelas', 'par_lancamentos'] loop
    execute format('create trigger trg_%1$s_atualizado before update on %1$s for each row execute function fn_atualizado_em()', t);
    execute format('create trigger trg_%1$s_sem_delete before delete on %1$s for each row execute function fn_bloquear_delete()', t);
    execute format('create trigger trg_aud_%1$s after insert or update on %1$s for each row execute function fn_auditoria()', t);
  end loop;
end $$;
create trigger trg_par_sincronizacoes_sem_delete before delete on par_sincronizacoes for each row execute function fn_bloquear_delete();

alter table par_naturezas enable row level security;
alter table par_regras enable row level security;
alter table par_parcelamentos enable row level security;
alter table par_parcelas enable row level security;
alter table par_lancamentos enable row level security;
alter table par_sincronizacoes enable row level security;
create policy par_naturezas_ler on par_naturezas for select to authenticated using (tem_acesso_modulo('financeiro.parcelamentos'));
create policy par_regras_ler on par_regras for select to authenticated using (tem_acesso_modulo('financeiro.parcelamentos'));
create policy par_parcelamentos_ler on par_parcelamentos for select to authenticated using (tem_acesso_modulo('financeiro.parcelamentos'));
create policy par_parcelas_ler on par_parcelas for select to authenticated using (tem_acesso_modulo('financeiro.parcelamentos'));
create policy par_lancamentos_ler on par_lancamentos for select to authenticated using (tem_acesso_modulo('financeiro.parcelamentos'));
create policy par_sincronizacoes_ler on par_sincronizacoes for select to authenticated using (tem_acesso_modulo('financeiro.parcelamentos'));
-- Nenhuma política de escrita: tudo passa pelas funções abaixo.

-- 7) Chave e competência a partir do documento ("8003-11/26" → chave "986:8003", competência "2026-11") --------------------
create function par_competencia(p_documento text) returns text
language sql immutable as $$
  select case when p_documento ~ '-(0[1-9]|1[0-2])/\d{2}$'
    then '20' || substring(p_documento from '/(\d{2})$') || '-' || substring(p_documento from '-(\d{2})/\d{2}$') end
$$;
create function par_chave(p_fornecedor text, p_documento text) returns text
language sql immutable as $$
  select case when p_documento ~ '^.+-(0[1-9]|1[0-2])/\d{2}$' and p_fornecedor ~ '^\d{1,10}$'
    then p_fornecedor || ':' || btrim(regexp_replace(p_documento, '-\d{2}/\d{2}$', '')) end
$$;

-- 8) Classificação e associação (internas) -------------------------------------------------------------------------------------
create function par_regra_casa_base(r par_regras, l par_lancamentos) returns boolean
language sql stable as $$
  select r.ativa
    and (r.empresa_id is null or r.empresa_id = l.empresa_id)
    and (r.tipos is null or l.tipo_lancamento = any (r.tipos))
    and (r.fornecedores is null or l.cod_fornecedor = any (r.fornecedores))
    and (r.complemento_contem is null or position(upper(btrim(r.complemento_contem)) in upper(coalesce(l.complemento, ''))) > 0)
$$;

create function par_classificar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l par_lancamentos;
  v_excecao par_regras;
  v_topo int;
  v_naturezas text[];
  v_nomes text;
  v_regra uuid;
  v_novo text; v_natureza text; v_motivo text;
begin
  select * into l from par_lancamentos where id = p_id for update;
  if not found or l.classificacao in ('manual_parcelamento', 'manual_ignorado') then return; end if;

  -- Regra com conta de fluxo e lançamento ainda sem o detalhe: espera o detalhe (a lista do ERP não traz grupo/conta).
  if l.detalhado_em is null and exists (select 1 from par_regras r where par_regra_casa_base(r, l) and r.grupo is not null) then
    v_novo := 'aguardando_detalhe'; v_motivo := 'Falta ler a conta de fluxo no Consistem.';
  else
    select r.* into v_excecao from par_regras r
      where par_regra_casa_base(r, l) and r.excecao and (r.grupo is null or (r.grupo = l.grupo and r.conta = l.conta))
      order by r.prioridade, r.nome limit 1;
    if v_excecao.id is not null then
      v_novo := 'ignorado'; v_regra := v_excecao.id; v_motivo := 'Exceção: ' || v_excecao.nome;
    else
      select min(r.prioridade) into v_topo from par_regras r
        where par_regra_casa_base(r, l) and not r.excecao and (r.grupo is null or (r.grupo = l.grupo and r.conta = l.conta));
      if v_topo is null then
        v_novo := 'sem_regra'; v_motivo := 'Nenhuma regra casa.';
      else
        select array_agg(distinct r.natureza), string_agg(r.nome, '; ' order by r.nome), (array_agg(r.id order by r.nome))[1]
          into v_naturezas, v_nomes, v_regra
          from par_regras r
          where par_regra_casa_base(r, l) and not r.excecao and r.prioridade = v_topo and (r.grupo is null or (r.grupo = l.grupo and r.conta = l.conta));
        if cardinality(v_naturezas) > 1 then
          v_novo := 'pendente'; v_regra := null; v_motivo := 'Regras em conflito: ' || v_nomes;
        else
          v_novo := 'classificado'; v_natureza := v_naturezas[1]; v_motivo := null;
        end if;
      end if;
    end if;
  end if;

  -- Já virou parcela e a regra mudou: não desfaz sozinho, vai para conferência.
  if l.parcela_id is not null and v_novo <> 'classificado' then
    v_novo := 'pendente'; v_natureza := l.natureza; v_regra := l.regra_id;
    v_motivo := 'Já está numa parcela, mas as regras não o classificam mais. Confira.';
  end if;

  -- Só grava se a classificação mudou (a sincronização roda a cada 2 h: nada de auditoria repetida).
  if (l.classificacao, l.natureza, l.regra_id) is distinct from (v_novo, v_natureza, v_regra) then
    update par_lancamentos set classificacao = v_novo, natureza = v_natureza, regra_id = v_regra, motivo = v_motivo,
      classificado_por = null, classificado_em = now() where id = p_id;
  end if;
end $$;

-- Liga o lançamento classificado à parcela do parcelamento de mesma chave (cria a parcela da competência).
-- Sem parcelamento com a chave: fica como sugestão. Já existe parcela na competência: pendente (uma pessoa decide).
create function par_associar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l par_lancamentos;
  v_parc uuid;
  v_parcela uuid;
  v_motivo text;
begin
  select * into l from par_lancamentos where id = p_id for update;
  if not found or l.parcela_id is not null or l.sumiu_em is not null or l.classificacao not in ('classificado', 'manual_parcelamento')
     or l.chave_erp is null or l.competencia is null then return; end if;
  select id into v_parc from par_parcelamentos
    where empresa_id = l.empresa_id and chave_erp = l.chave_erp and situacao <> 'cancelado';
  if v_parc is null then return; end if;
  -- Fica classificado e sem parcela (aparece em "sem parcelamento associado"); a pessoa vincula ou corrige. Caso real
  -- (336 9982-08/26 e 09/26): o P foi EXCLUÍDO no Consistem e a guia lançada como C novo, de outro código, com o mesmo documento.
  select pa.id into v_parcela from par_parcelas pa where pa.parcelamento_id = v_parc and pa.competencia = l.competencia and pa.cancelada_em is null;
  if v_parcela is not null then
    v_motivo := coalesce(
      (select 'Pode substituir o lançamento ' || x.cod_lancamento || ', que saiu do Consistem: confira e vincule.'
         from par_lancamentos x where x.parcela_id = v_parcela and x.sumiu_em is not null),
      'O parcelamento já tem parcela em ' || l.competencia || ': confira e vincule à mão.');
    update par_lancamentos set motivo = v_motivo where id = p_id and motivo is distinct from v_motivo;
    return;
  end if;
  insert into par_parcelas (parcelamento_id, competencia, origem, criado_por) values (v_parc, l.competencia, 'CONTAS_PAGAR', null)
    returning id into v_parcela;
  update par_lancamentos set parcela_id = v_parcela where id = p_id;
end $$;

create function par_processar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform par_classificar(p_id);
  perform par_associar(p_id);
end $$;

create function par_processar_todos(p_empresa uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int := 0;
begin
  for v_id in select id from par_lancamentos where (p_empresa is null or empresa_id = p_empresa)
      and classificacao not in ('manual_parcelamento', 'manual_ignorado') order by cod_lancamento loop
    perform par_processar(v_id); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function par_classificar(uuid), par_associar(uuid), par_processar(uuid), par_processar_todos(uuid) from public, anon, authenticated;

-- 9) Sincronização (só service role: Edge Function fin-parcelamentos-sincronizar) ---------------------------------------------
-- Uma leitura por empresa de cada vez (botão + agendamento juntos). Rodada presa há mais de 10 min não segura a próxima.
create function par_iniciar_sincronizacao(p_empresa uuid, p_agendada boolean, p_usuario uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('par_sincronizacao:' || p_empresa::text));
  if exists (select 1 from par_sincronizacoes where empresa_id = p_empresa and situacao = 'em_andamento' and iniciada_em > now() - interval '10 minutes') then
    raise exception 'Já há uma leitura do Consistem em andamento para esta empresa. Aguarde terminar.';
  end if;
  update par_sincronizacoes set situacao = 'erro', erro = 'Interrompida (sem conclusão em 10 minutos).', concluida_em = now()
    where empresa_id = p_empresa and situacao = 'em_andamento';
  insert into par_sincronizacoes (empresa_id, agendada, usuario_id) values (p_empresa, p_agendada, p_usuario) returning id into v_id;
  return v_id;
end $$;

-- Baixa confirmada pelo ERP: só C (P é projeção); saldo 0 na lista ou principal pago (valor pago >= valor do documento).
create function par_quitado(p_tipo text, p_saldo numeric, p_pago numeric, p_documento numeric) returns boolean
language sql immutable as $$
  select p_tipo is distinct from 'P' and (p_saldo = 0 or coalesce(p_pago, 0) >= p_documento)
$$;

create function par_concluir_sincronizacao(p_id uuid, p_erro text, p_resumo jsonb) returns void
language sql security definer set search_path = public as $$
  update par_sincronizacoes set situacao = case when p_erro is null then 'ok' else 'erro' end, erro = left(p_erro, 1000),
    resumo = p_resumo, concluida_em = now() where id = p_id and situacao = 'em_andamento'
$$;

-- Lista do ERP já normalizada pela Edge Function (valores em centavos; só tipos P e C): todos os P (filtro dinâmico) mais TODOS
-- os lançamentos dos fornecedores das regras (`p_fornecedores`, filtro por fornecedor). Idempotente: só grava o que mudou.
-- Devolve os códigos que deviam ter vindo (P, ou de fornecedor listado) e não vieram: a função lê o detalhe deles
-- (virou outro tipo, ou foi excluído no Consistem).
create function par_registrar_lista(p_empresa uuid, p_lancamentos jsonb, p_fornecedores text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e jsonb;
  l par_lancamentos;
  v_id uuid;
  v_novos int := 0; v_alterados int := 0; v_iguais int := 0; v_quitados int := 0;
  v_codigos text[];
  v_fora text[];
  v_tipo text; v_valor numeric(14,2); v_saldo numeric(14,2); v_quitado_em timestamptz;
begin
  if jsonb_typeof(p_lancamentos) <> 'array' then raise exception 'Lista inválida.'; end if;
  for e in select * from jsonb_array_elements(p_lancamentos) loop
    if coalesce(e->>'codLancamento', '') !~ '^\d{1,12}$' then raise exception 'Código de lançamento inválido.'; end if;
    v_tipo := e->>'tipo';
    if v_tipo not in ('P', 'C') then raise exception 'Tipo de lançamento fora do módulo (%).', v_tipo; end if;
    v_valor := (e->>'valorDocumentoCentavos')::bigint / 100.0;
    v_saldo := (e->>'saldoCentavos')::bigint / 100.0;
    select * into l from par_lancamentos where empresa_id = p_empresa and cod_lancamento = e->>'codLancamento';
    if not found then
      insert into par_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, cod_historico, complemento,
        data_emissao, data_vencimento, valor_documento, valor_atualizado, valor_provisionado, quitado_em, chave_erp, competencia)
      values (p_empresa, e->>'codLancamento', v_tipo, e->>'codFornecedor', e->>'numDocumento', nullif(e->>'codHistorico', ''),
        nullif(e->>'complemento', ''), (e->>'emissao')::date, (e->>'vencimento')::date, v_valor, v_saldo,
        case when v_tipo = 'P' then v_valor end, case when par_quitado(v_tipo, v_saldo, null, v_valor) then now() end,
        par_chave(e->>'codFornecedor', e->>'numDocumento'), par_competencia(e->>'numDocumento'))
      returning id into v_id;
      perform par_processar(v_id);
      v_novos := v_novos + 1;
    elsif (l.tipo_lancamento, l.cod_fornecedor, l.num_documento, l.complemento, l.data_vencimento, l.valor_documento, l.valor_atualizado, l.sumiu_em is null)
          is distinct from (v_tipo, e->>'codFornecedor', e->>'numDocumento', nullif(e->>'complemento', ''), (e->>'vencimento')::date, v_valor, v_saldo, true) then
      v_quitado_em := case when par_quitado(v_tipo, v_saldo, l.valor_pago, v_valor) then coalesce(l.quitado_em, now()) end;
      if l.quitado_em is null and v_quitado_em is not null then v_quitados := v_quitados + 1; end if;
      update par_lancamentos set tipo_lancamento = v_tipo, cod_fornecedor = e->>'codFornecedor', num_documento = e->>'numDocumento',
        complemento = nullif(e->>'complemento', ''), data_vencimento = (e->>'vencimento')::date, valor_documento = v_valor, valor_atualizado = v_saldo,
        valor_provisionado = case when v_tipo = 'P' then v_valor else valor_provisionado end, quitado_em = v_quitado_em, sumiu_em = null,
        virou_c_em = case when l.tipo_lancamento = 'P' and v_tipo <> 'P' then now() else virou_c_em end,
        chave_erp = par_chave(e->>'codFornecedor', e->>'numDocumento'), competencia = par_competencia(e->>'numDocumento')
        where id = l.id;
      perform par_processar(l.id);
      v_alterados := v_alterados + 1;
    else
      v_iguais := v_iguais + 1;
    end if;
  end loop;
  select array_agg(x->>'codLancamento') into v_codigos from jsonb_array_elements(p_lancamentos) x;
  select coalesce(array_agg(cod_lancamento order by cod_lancamento), '{}') into v_fora from par_lancamentos
    where empresa_id = p_empresa and sumiu_em is null and cod_lancamento <> all (coalesce(v_codigos, '{}'))
      and (tipo_lancamento = 'P' or cod_fornecedor = any (coalesce(p_fornecedores, '{}')));
  return jsonb_build_object('novos', v_novos, 'alterados', v_alterados, 'iguais', v_iguais, 'quitados', v_quitados, 'foraDaLista', to_jsonb(v_fora));
end $$;

-- Quem precisa do detalhe, em ordem: (1) os que deviam estar na lista e não vieram; (2) TODOS os que nunca foram detalhados
-- (a conta de fluxo só vem no detalhe: assim todo lançamento, mesmo sem regra, fica com a conta à vista para análise);
-- (3) os C de parcelamento ainda não quitados com saldo (o valor pago, para o caso do resíduo de juros). Limite por rodada.
create function par_para_detalhar(p_empresa uuid, p_fora text[], p_limite int) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(cod_lancamento), '{}') from (
    select cod_lancamento from par_lancamentos
    where empresa_id = p_empresa and sumiu_em is null and (
      cod_lancamento = any (coalesce(p_fora, '{}'))
      or detalhado_em is null
      or (tipo_lancamento <> 'P' and quitado_em is null and (classificacao in ('classificado', 'manual_parcelamento', 'pendente') or parcela_id is not null)))
    order by case when cod_lancamento = any (coalesce(p_fora, '{}')) then 0 when classificacao = 'aguardando_detalhe' then 1
                  when detalhado_em is null then 2 else 3 end,
      cod_lancamento::bigint
    limit greatest(p_limite, 0)
  ) x
$$;

-- Detalhe de cada lançamento (GET lancamentoContasPagar/{id}). encontrado=false: o ERP respondeu "Lançamento não cadastrado"
-- (excluído): marca sumiu_em, não apaga. O saldo continua sendo o da lista (o detalhe não traz); a baixa usa o valor pago.
-- Só grava quando algo mudou (a mesma leitura de novo não gera auditoria).
create function par_registrar_detalhes(p_empresa uuid, p_detalhes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e jsonb;
  l par_lancamentos;
  n par_lancamentos;
  v_lidos int := 0; v_alterados int := 0; v_viraram_c int := 0; v_sumiram int := 0; v_quitados int := 0;
  v_pago numeric(14,2);
begin
  if jsonb_typeof(p_detalhes) <> 'array' then raise exception 'Lista inválida.'; end if;
  for e in select * from jsonb_array_elements(p_detalhes) loop
    select * into l from par_lancamentos where empresa_id = p_empresa and cod_lancamento = e->>'codLancamento' for update;
    if not found then continue; end if;
    v_lidos := v_lidos + 1;
    if not coalesce((e->>'encontrado')::boolean, false) then
      if l.sumiu_em is null then
        update par_lancamentos set sumiu_em = now() where id = l.id;
        v_sumiram := v_sumiram + 1;
      end if;
      continue;
    end if;
    n := l;
    n.tipo_lancamento := coalesce(nullif(e->>'tipo', ''), l.tipo_lancamento);
    n.grupo := nullif(e->>'grupo', '')::int;
    n.conta := nullif(e->>'conta', '')::int;
    n.num_documento := coalesce(nullif(e->>'numDocumento', ''), l.num_documento);
    n.complemento := coalesce(nullif(e->>'complemento', ''), l.complemento);
    n.data_vencimento := coalesce(nullif(e->>'vencimento', '')::date, l.data_vencimento);
    n.valor_documento := coalesce((e->>'valorDocumentoCentavos')::bigint / 100.0, l.valor_documento);
    v_pago := (e->>'valorPagoCentavos')::bigint / 100.0;
    n.valor_pago := case when v_pago > 0 then v_pago end;
    n.data_pagamento := nullif(e->>'dataPagamento', '')::date;
    n.valor_juros := nullif((e->>'valorJurosCentavos')::bigint, 0) / 100.0;
    n.valor_multa := nullif((e->>'valorMultaCentavos')::bigint, 0) / 100.0;
    n.cod_barras := nullif(e->>'codBarras', '');
    n.valor_provisionado := case when n.tipo_lancamento = 'P' then n.valor_documento else l.valor_provisionado end;
    n.quitado_em := case when par_quitado(n.tipo_lancamento, l.valor_atualizado, n.valor_pago, n.valor_documento) then coalesce(l.quitado_em, now()) end;
    n.virou_c_em := case when l.tipo_lancamento = 'P' and n.tipo_lancamento <> 'P' then now() else l.virou_c_em end;
    n.chave_erp := par_chave(l.cod_fornecedor, n.num_documento);
    n.competencia := par_competencia(n.num_documento);
    n.sumiu_em := null;
    if l.detalhado_em is null or
       (l.tipo_lancamento, l.grupo, l.conta, l.num_documento, l.complemento, l.data_vencimento, l.valor_documento, l.valor_pago, l.data_pagamento,
        l.valor_juros, l.valor_multa, l.cod_barras, l.quitado_em is null, l.sumiu_em is null)
       is distinct from
       (n.tipo_lancamento, n.grupo, n.conta, n.num_documento, n.complemento, n.data_vencimento, n.valor_documento, n.valor_pago, n.data_pagamento,
        n.valor_juros, n.valor_multa, n.cod_barras, n.quitado_em is null, true) then
      update par_lancamentos set tipo_lancamento = n.tipo_lancamento, grupo = n.grupo, conta = n.conta, num_documento = n.num_documento,
        complemento = n.complemento, data_vencimento = n.data_vencimento, valor_documento = n.valor_documento, valor_provisionado = n.valor_provisionado,
        valor_pago = n.valor_pago, data_pagamento = n.data_pagamento, valor_juros = n.valor_juros, valor_multa = n.valor_multa, cod_barras = n.cod_barras,
        quitado_em = n.quitado_em, virou_c_em = n.virou_c_em, chave_erp = n.chave_erp, competencia = n.competencia, sumiu_em = null, detalhado_em = now()
      where id = l.id;
      v_alterados := v_alterados + 1;
      if l.tipo_lancamento = 'P' and n.tipo_lancamento <> 'P' then v_viraram_c := v_viraram_c + 1; end if;
      if l.quitado_em is null and n.quitado_em is not null then v_quitados := v_quitados + 1; end if;
      perform par_processar(l.id);
    end if;
  end loop;
  return jsonb_build_object('lidos', v_lidos, 'alterados', v_alterados, 'viraramC', v_viraram_c, 'sumiram', v_sumiram, 'quitados', v_quitados);
end $$;

-- Fornecedores sem nome (a lista do ERP só traz o código). Devolve os códigos que faltam; grava os nomes lidos.
create function par_fornecedores_sem_nome(p_empresa uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct cod_fornecedor), '{}') from par_lancamentos where empresa_id = p_empresa and nome_fornecedor is null
$$;
create function par_registrar_fornecedores(p_empresa uuid, p_nomes jsonb) returns void
language sql security definer set search_path = public as $$
  update par_lancamentos l set nome_fornecedor = left(n.value #>> '{}', 120)
  from jsonb_each(p_nomes) n
  where l.empresa_id = p_empresa and l.cod_fornecedor = n.key and l.nome_fornecedor is null and length(n.value #>> '{}') > 0
$$;

revoke all on function par_iniciar_sincronizacao(uuid, boolean, uuid), par_concluir_sincronizacao(uuid, text, jsonb),
  par_registrar_lista(uuid, jsonb, text[]), par_para_detalhar(uuid, text[], int), par_registrar_detalhes(uuid, jsonb),
  par_fornecedores_sem_nome(uuid), par_registrar_fornecedores(uuid, jsonb) from public, anon, authenticated;
grant execute on function par_iniciar_sincronizacao(uuid, boolean, uuid), par_concluir_sincronizacao(uuid, text, jsonb),
  par_registrar_lista(uuid, jsonb, text[]), par_para_detalhar(uuid, text[], int), par_registrar_detalhes(uuid, jsonb),
  par_fornecedores_sem_nome(uuid), par_registrar_fornecedores(uuid, jsonb) to service_role;

-- 10) Ações das pessoas -----------------------------------------------------------------------------------------------------
-- Classificação manual (operador): natureza = é parcelamento; nula = não é parcelamento. Depois disso a regra não muda mais.
create function par_classificar_manual(p_id uuid, p_natureza text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare l par_lancamentos;
begin
  perform par_exigir('operador');
  select * into l from par_lancamentos where id = p_id for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo.'; end if;
  if p_natureza is null and l.parcela_id is not null then raise exception 'O lançamento está numa parcela: desvincule antes.'; end if;
  if p_natureza is not null and not exists (select 1 from par_naturezas where codigo = p_natureza and ativa) then raise exception 'Natureza inválida.'; end if;
  update par_lancamentos set classificacao = case when p_natureza is null then 'manual_ignorado' else 'manual_parcelamento' end,
    natureza = p_natureza, regra_id = null, motivo = btrim(p_motivo), classificado_por = auth.uid(), classificado_em = now() where id = p_id;
  perform par_associar(p_id);
end $$;

-- Volta o lançamento para as regras (desfaz a classificação manual).
create function par_devolver_as_regras(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform par_exigir('operador');
  update par_lancamentos set classificacao = 'aguardando_detalhe', classificado_por = null where id = p_id
    and classificacao in ('manual_parcelamento', 'manual_ignorado');
  if not found then raise exception 'Só classificação manual volta para as regras.'; end if;
  perform par_processar(p_id);
end $$;

-- Regras (gestor). Salvar reclassifica tudo o que não é manual.
create function par_salvar_regra(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_forn text[];
begin
  perform par_exigir('gestor');
  select array_agg(btrim(x)) into v_forn from jsonb_array_elements_text(case when jsonb_typeof(p->'fornecedores') = 'array' then p->'fornecedores' else '[]' end) x where btrim(x) <> '';
  if exists (select 1 from unnest(coalesce(v_forn, '{}')) f where f !~ '^\d{1,10}$') then raise exception 'Código de fornecedor inválido.'; end if;
  if p_id is null then
    insert into par_regras (nome, empresa_id, tipos, fornecedores, grupo, conta, complemento_contem, natureza, excecao, prioridade, ativa, observacoes)
    values (btrim(p->>'nome'), nullif(p->>'empresaId', '')::uuid,
      (select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'tipos') = 'array' then p->'tipos' else '[]' end) x), v_forn,
      nullif(p->>'grupo', '')::int, nullif(p->>'conta', '')::int, nullif(btrim(p->>'complementoContem'), ''),
      nullif(p->>'natureza', ''), coalesce((p->>'excecao')::boolean, false), coalesce(nullif(p->>'prioridade', '')::int, 100),
      coalesce((p->>'ativa')::boolean, true), nullif(btrim(p->>'observacoes'), ''))
    returning id into v_id;
  else
    update par_regras set nome = btrim(p->>'nome'), empresa_id = nullif(p->>'empresaId', '')::uuid,
      tipos = (select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'tipos') = 'array' then p->'tipos' else '[]' end) x), fornecedores = v_forn,
      grupo = nullif(p->>'grupo', '')::int, conta = nullif(p->>'conta', '')::int, complemento_contem = nullif(btrim(p->>'complementoContem'), ''),
      natureza = nullif(p->>'natureza', ''), excecao = coalesce((p->>'excecao')::boolean, false),
      prioridade = coalesce(nullif(p->>'prioridade', '')::int, 100), ativa = coalesce((p->>'ativa')::boolean, true),
      observacoes = nullif(btrim(p->>'observacoes'), '')
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Regra não encontrada.'; end if;
  end if;
  perform par_processar_todos(null);
  return v_id;
end $$;

-- Reaplica as regras a tudo (operador): útil depois de cadastrar um parcelamento à mão.
create function par_reprocessar() returns int
language plpgsql security definer set search_path = public as $$
begin
  perform par_exigir('operador');
  return par_processar_todos(null);
end $$;

-- Parcelamentos (gestor). Com chave_erp (sugestão da tela de classificação), as parcelas do ERP entram na hora.
create function par_salvar_parcelamento(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_chave text := nullif(btrim(p->>'chaveErp'), ''); v_lanc uuid;
begin
  perform par_exigir('gestor');
  if p_id is null then
    insert into par_parcelamentos (empresa_id, descricao, natureza, origem, devedor, credor, cod_fornecedor, grupo, conta, numero, processo, cda,
      inscricao, referencia_debito, data_adesao, valor_original, qtd_parcelas, dia_vencimento, situacao, responsavel_id, observacoes, chave_erp)
    values ((p->>'empresaId')::uuid, btrim(p->>'descricao'), p->>'natureza', case when v_chave is null then 'MANUAL' else 'CONTAS_PAGAR' end,
      nullif(btrim(p->>'devedor'), ''), nullif(btrim(p->>'credor'), ''), nullif(btrim(p->>'codFornecedor'), ''),
      nullif(p->>'grupo', '')::int, nullif(p->>'conta', '')::int, nullif(btrim(p->>'numero'), ''), nullif(btrim(p->>'processo'), ''),
      nullif(btrim(p->>'cda'), ''), nullif(btrim(p->>'inscricao'), ''), nullif(btrim(p->>'referenciaDebito'), ''), nullif(p->>'dataAdesao', '')::date,
      nullif(p->>'valorOriginal', '')::numeric, nullif(p->>'qtdParcelas', '')::int, nullif(p->>'diaVencimento', '')::int,
      coalesce(nullif(p->>'situacao', ''), 'ativo'), nullif(p->>'responsavelId', '')::uuid, nullif(btrim(p->>'observacoes'), ''), v_chave)
    returning id into v_id;
  else
    update par_parcelamentos set descricao = btrim(p->>'descricao'), natureza = p->>'natureza',
      devedor = nullif(btrim(p->>'devedor'), ''), credor = nullif(btrim(p->>'credor'), ''), numero = nullif(btrim(p->>'numero'), ''),
      processo = nullif(btrim(p->>'processo'), ''), cda = nullif(btrim(p->>'cda'), ''), inscricao = nullif(btrim(p->>'inscricao'), ''),
      referencia_debito = nullif(btrim(p->>'referenciaDebito'), ''), data_adesao = nullif(p->>'dataAdesao', '')::date,
      valor_original = nullif(p->>'valorOriginal', '')::numeric, qtd_parcelas = nullif(p->>'qtdParcelas', '')::int,
      dia_vencimento = nullif(p->>'diaVencimento', '')::int, situacao = coalesce(nullif(p->>'situacao', ''), situacao),
      responsavel_id = nullif(p->>'responsavelId', '')::uuid, observacoes = nullif(btrim(p->>'observacoes'), '')
    where id = p_id returning id, chave_erp into v_id, v_chave;
    if v_id is null then raise exception 'Parcelamento não encontrado.'; end if;
  end if;
  if v_chave is not null then
    for v_lanc in select l.id from par_lancamentos l join par_parcelamentos pp on pp.id = v_id
        where l.empresa_id = pp.empresa_id and l.chave_erp = v_chave and l.parcela_id is null order by l.competencia loop
      perform par_associar(v_lanc);
    end loop;
  end if;
  return v_id;
end $$;

-- Parcela manual (gestor): obrigação que não está no ERP.
create function par_adicionar_parcela(p_parcelamento uuid, p_competencia text, p_vencimento date, p_valor numeric, p_numero int, p_observacoes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform par_exigir('gestor');
  if not exists (select 1 from par_parcelamentos where id = p_parcelamento and situacao <> 'cancelado') then raise exception 'Parcelamento não encontrado.'; end if;
  if exists (select 1 from par_parcelas where parcelamento_id = p_parcelamento and competencia = p_competencia and cancelada_em is null) then
    raise exception 'Já existe parcela em %.', p_competencia;
  end if;
  insert into par_parcelas (parcelamento_id, competencia, numero, origem, vencimento, valor, observacoes)
  values (p_parcelamento, p_competencia, p_numero, 'MANUAL', p_vencimento, p_valor, nullif(btrim(p_observacoes), '')) returning id into v_id;
  return v_id;
end $$;

-- Vínculo manual (operador): o lançamento do ERP entra no parcelamento. Se já existe parcela na competência SEM lançamento
-- (ex.: cadastrada à mão), é a mesma obrigação: junta-se a ela (nunca duas). Parcela cujo lançamento SAIU do Consistem
-- (excluído e relançado como C novo): o novo substitui o antigo, que fica no histórico sem parcela. Parcela com lançamento
-- vivo: recusa.
create function par_vincular_lancamento(p_lancamento uuid, p_parcelamento uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l par_lancamentos; v_parcela uuid; v_empresa uuid; v_antigo par_lancamentos;
begin
  perform par_exigir('operador');
  select * into l from par_lancamentos where id = p_lancamento for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if l.parcela_id is not null then raise exception 'O lançamento já está numa parcela.'; end if;
  if l.competencia is null then raise exception 'O documento % não tem a competência (-MM/AA).', l.num_documento; end if;
  select empresa_id into v_empresa from par_parcelamentos where id = p_parcelamento and situacao <> 'cancelado';
  if v_empresa is null then raise exception 'Parcelamento não encontrado.'; end if;
  if v_empresa <> l.empresa_id then raise exception 'O lançamento é de outra empresa.'; end if;
  select pa.id into v_parcela from par_parcelas pa where pa.parcelamento_id = p_parcelamento and pa.competencia = l.competencia and pa.cancelada_em is null;
  select * into v_antigo from par_lancamentos where parcela_id = v_parcela for update;
  if v_antigo.id is not null and v_antigo.sumiu_em is null then
    raise exception 'A parcela % deste parcelamento já tem lançamento do Consistem.', l.competencia;
  end if;
  if v_antigo.id is not null then
    update par_lancamentos set parcela_id = null, motivo = 'Saiu do Consistem; substituído pelo lançamento ' || l.cod_lancamento || '.'
      where id = v_antigo.id;
  end if;
  if v_parcela is null then
    insert into par_parcelas (parcelamento_id, competencia, origem) values (p_parcelamento, l.competencia, 'CONTAS_PAGAR') returning id into v_parcela;
  end if;
  update par_lancamentos set parcela_id = v_parcela,
    classificacao = case when classificacao in ('classificado', 'manual_parcelamento') then classificacao else 'manual_parcelamento' end,
    natureza = coalesce(natureza, (select natureza from par_parcelamentos where id = p_parcelamento)),
    motivo = case when classificacao in ('classificado', 'manual_parcelamento') then motivo else 'Vinculado à mão.' end,
    classificado_por = auth.uid(), classificado_em = now()
  where id = p_lancamento;
end $$;

-- Juntar uma sugestão inteira (todos os lançamentos sem parcela de uma chave) a um parcelamento existente (operador).
-- Caso real: PGFN Oeste 15043689 com documento "3689" em nov–dez/2026 e "0689" a partir de jan/2027.
create function par_vincular_chave(p_empresa uuid, p_chave text, p_parcelamento uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int := 0;
begin
  perform par_exigir('operador');
  for v_id in select id from par_lancamentos where empresa_id = p_empresa and chave_erp = p_chave and parcela_id is null
      and classificacao in ('classificado', 'manual_parcelamento', 'pendente') order by competencia loop
    perform par_vincular_lancamento(v_id, p_parcelamento); n := n + 1;
  end loop;
  if n = 0 then raise exception 'Nenhum lançamento sem parcela nesta chave.'; end if;
  return n;
end $$;

-- Desvincular (operador): a parcela que era só desse lançamento é cancelada (fica no histórico); a manual volta a ficar sozinha.
create function par_desvincular_lancamento(p_lancamento uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare l par_lancamentos; v_origem text;
begin
  perform par_exigir('operador');
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo.'; end if;
  select * into l from par_lancamentos where id = p_lancamento for update;
  if not found or l.parcela_id is null then raise exception 'O lançamento não está em parcela.'; end if;
  update par_lancamentos set parcela_id = null, classificacao = 'pendente', motivo = 'Desvinculado: ' || btrim(p_motivo),
    classificado_por = auth.uid(), classificado_em = now() where id = p_lancamento;
  select origem into v_origem from par_parcelas where id = l.parcela_id;
  if v_origem = 'CONTAS_PAGAR' then
    update par_parcelas set cancelada_em = now(), motivo_cancelamento = 'Lançamento desvinculado: ' || btrim(p_motivo) where id = l.parcela_id;
  end if;
end $$;

revoke all on function par_classificar_manual(uuid, text, text), par_devolver_as_regras(uuid), par_salvar_regra(uuid, jsonb), par_reprocessar(),
  par_salvar_parcelamento(uuid, jsonb), par_adicionar_parcela(uuid, text, date, numeric, int, text), par_vincular_lancamento(uuid, uuid), par_vincular_chave(uuid, text, uuid),
  par_desvincular_lancamento(uuid, text) from public, anon;
grant execute on function par_classificar_manual(uuid, text, text), par_devolver_as_regras(uuid), par_salvar_regra(uuid, jsonb), par_reprocessar(),
  par_salvar_parcelamento(uuid, jsonb), par_adicionar_parcela(uuid, text, date, numeric, int, text), par_vincular_lancamento(uuid, uuid), par_vincular_chave(uuid, text, uuid),
  par_desvincular_lancamento(uuid, text) to authenticated;

-- 11) Views das telas (security_invoker: valem as políticas de leitura) ----------------------------------------------------
create view par_vw_lancamentos with (security_invoker = true) as
select l.*, e.nome_curto as empresa_nome, r.nome as regra_nome, n.nome as natureza_nome,
  pa.parcelamento_id, pp.descricao as parcelamento_descricao
from par_lancamentos l
join empresas e on e.id = l.empresa_id
left join par_regras r on r.id = l.regra_id
left join par_naturezas n on n.codigo = l.natureza
left join par_parcelas pa on pa.id = l.parcela_id
left join par_parcelamentos pp on pp.id = pa.parcelamento_id;

-- Parcelas com os valores do ERP quando há lançamento (senão os da parcela manual).
create view par_vw_parcelas with (security_invoker = true) as
select pa.id, pa.parcelamento_id, pa.competencia, pa.numero, pa.origem, pa.situacao_guia, pa.responsavel_id, pa.observacoes,
  pa.cancelada_em, pa.motivo_cancelamento,
  pp.descricao as parcelamento_descricao, pp.empresa_id, e.nome_curto as empresa_nome, pp.natureza, n.nome as natureza_nome,
  coalesce(l.cod_fornecedor, pp.cod_fornecedor) as cod_fornecedor, coalesce(l.nome_fornecedor, pp.credor) as fornecedor_nome,
  coalesce(l.grupo, pp.grupo) as grupo, coalesce(l.conta, pp.conta) as conta,
  l.id as lancamento_id, l.cod_lancamento, l.tipo_lancamento, l.num_documento, l.complemento, l.data_emissao,
  coalesce(l.data_vencimento, pa.vencimento) as vencimento,
  coalesce(l.valor_provisionado, l.valor_documento, pa.valor) as valor_provisionado,
  coalesce(l.valor_documento, pa.valor) as valor_atualizado,
  l.valor_atualizado as saldo_erp, l.valor_pago, l.data_pagamento, l.quitado_em, l.cod_barras, l.sumiu_em,
  -- em aberto: 0 se quitado no ERP; P = valor projetado; C = saldo da lista do ERP; manual = valor informado
  case when l.quitado_em is not null then 0 when l.id is null then pa.valor when l.tipo_lancamento = 'P' then l.valor_documento
       else coalesce(l.valor_atualizado, l.valor_documento) end as valor_em_aberto
from par_parcelas pa
join par_parcelamentos pp on pp.id = pa.parcelamento_id
join empresas e on e.id = pp.empresa_id
join par_naturezas n on n.codigo = pp.natureza
left join par_lancamentos l on l.parcela_id = pa.id;

create view par_vw_parcelamentos with (security_invoker = true) as
select pp.*, e.nome_curto as empresa_nome, n.nome as natureza_nome, pr.nome as responsavel_nome,
  coalesce(s.parcelas, 0) as parcelas_registradas, coalesce(s.pagas, 0) as parcelas_pagas,
  coalesce(s.valor_pago, 0) as total_pago, coalesce(s.em_aberto, 0) as total_em_aberto, s.proximo_vencimento
from par_parcelamentos pp
join empresas e on e.id = pp.empresa_id
join par_naturezas n on n.codigo = pp.natureza
left join perfis pr on pr.id = pp.responsavel_id
left join lateral (
  select count(*) as parcelas,
    count(*) filter (where v.quitado_em is not null) as pagas,
    sum(coalesce(v.valor_pago, 0)) as valor_pago,
    sum(v.valor_em_aberto) as em_aberto,
    min(v.vencimento) filter (where v.quitado_em is null) as proximo_vencimento
  from par_vw_parcelas v where v.parcelamento_id = pp.id and v.cancelada_em is null
) s on true;

-- Sugestões: lançamentos classificados, sem parcela, agrupados pela chave que ainda não tem parcelamento.
create view par_vw_sugestoes with (security_invoker = true) as
select l.empresa_id, e.nome_curto as empresa_nome, l.chave_erp, l.cod_fornecedor, max(l.nome_fornecedor) as nome_fornecedor,
  max(l.natureza) as natureza, count(distinct l.natureza) as naturezas, max(l.grupo) as grupo, max(l.conta) as conta,
  count(*) as lancamentos, min(l.competencia) as primeira_competencia, max(l.competencia) as ultima_competencia,
  sum(l.valor_documento) as valor_total, (array_agg(l.complemento order by l.competencia))[1] as complemento_exemplo
from par_lancamentos l
join empresas e on e.id = l.empresa_id
where l.classificacao in ('classificado', 'manual_parcelamento') and l.parcela_id is null and l.chave_erp is not null
  and not exists (select 1 from par_parcelamentos pp where pp.empresa_id = l.empresa_id and pp.chave_erp = l.chave_erp and pp.situacao <> 'cancelado')
group by l.empresa_id, e.nome_curto, l.chave_erp, l.cod_fornecedor;

-- 12) Agendamento (pg_cron + pg_net; mesmo Vault das outras sincronizações). Só chama com a chave ligada. ---------------------
create function par_chamar_sincronizacao() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_segredo text; v_requisicao bigint;
begin
  if coalesce((select valor from configuracoes where chave = 'financeiro.parcelamentos.sincronizar_agendado'), 'false'::jsonb) <> 'true'::jsonb then
    return null;
  end if;
  select replace(decrypted_secret, 'rec-sincronizar-consistem', 'fin-parcelamentos-sincronizar') into v_url from vault.decrypted_secrets where name = 'rec_sincronizar_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'rec_sincronizar_segredo';
  if v_url is null or v_segredo is null then
    raise warning 'Sincronização dos parcelamentos sem configuração: faltam rec_sincronizar_url e/ou rec_sincronizar_segredo no Vault.';
    return null;
  end if;
  select net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sincronizacao-segredo', v_segredo),
    body := '{"acao":"sincronizar"}'::jsonb, timeout_milliseconds := 150000) into v_requisicao;
  return v_requisicao;
end $$;
revoke all on function par_chamar_sincronizacao() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Dias úteis, 07:50–17:50 de Cuiabá (UTC-4), a cada 2 horas.
    perform cron.schedule('fin-parcelamentos-sincronizar-2h', '50 11-21/2 * * 1-5', 'select public.par_chamar_sincronizacao()');
  end if;
end $$;
