-- =========================================================
-- Neo Admin — 0165 Cartão de crédito: compra parcelada com a NF lançada pelo valor CHEIO → desdobrar no Consistem
-- Especificação: docs/modulos/financeiro-cartao.md (seção 5, regras 61 a 64).
--
-- Caso real (Unicred PF 10/2026, 14/10/2026): a linha "MP*TERABYTESHOP Parc. 1/6" (R$ 499,13) não casou porque a NF estava no
-- Consistem pelo total; a linha ficou "a lançar" e foi lançada pelo painel em 6 títulos que DUPLICARAM a compra.
-- Decisões do Alan: a conciliação detecta a linha "1/N" cujo título tem ≈ N × parcela e o painel DESDOBRA pela API:
--   1) PUT lancamentoContasPagar/{id} no título original: valor da parcela 1, documento <NF>/1 e complemento PARC 1/N;
--   2) só com a alteração conferida, cria as parcelas 2 a N (crt_lancamentos_erp tipo 'desdobramento', mesmo envio das compras),
--      copiadas do original, nos vencimentos das faturas seguintes; a última leva o arredondamento (soma = total da NF).
-- Também: registrar que um título lançado pelo painel foi EXCLUÍDO no Consistem (duplicidade), sem apagar a prova.
-- =========================================================

-- 1) Chave (interruptor rápido; começa ligada por decisão do Alan) ------------------------------------------------------
insert into configuracoes (chave, valor, descricao) values
  ('financeiro.cartao.desdobrar_no_erp', 'true',
   'Cartão de crédito: botão "Desdobrar no Consistem" da compra parcelada cuja NF foi lançada pelo total (altera o título e cria as parcelas). Desligado = o painel só aponta.')
on conflict (chave) do nothing;

create function crt_desdobrar_ligado() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select valor from configuracoes where chave = 'financeiro.cartao.desdobrar_no_erp'), 'false'::jsonb) = 'true'::jsonb
$$;

-- 2) Desdobramentos (prova) ------------------------------------------------------------------------------------------------
create type crt_situacao_desdobramento as enum ('reservado', 'enviando', 'alterado', 'erro');

create table crt_desdobramentos (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references crt_faturas(id),
  ciclo_id uuid not null references crt_ciclos(id),
  linha_id uuid not null references crt_fatura_linhas(id),
  cod_lancamento text not null check (cod_lancamento ~ '^\d{1,12}$'),     -- título original (NF lançada pelo total)
  num_documento text,
  fornecedor text,
  parcelas int not null check (parcelas between 2 and 48),
  valor_original numeric(14,2) not null check (valor_original > 0),
  valor_parcela numeric(14,2) not null check (valor_parcela > 0),
  alteracao jsonb not null,                                                -- corpo do PUT no título original
  antes jsonb not null,                                                    -- detalhe lido pelo painel na reserva
  depois jsonb,                                                            -- detalhe depois do PUT (conferência)
  resposta jsonb,
  erro text,
  lote uuid not null,                                                      -- mesmo lote das parcelas 2..N
  situacao crt_situacao_desdobramento not null default 'reservado',
  tentativas int not null default 0,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  concluido_em timestamptz,
  resolvido_por uuid references perfis(id),                                -- "já está alterado no Consistem" conferido à mão
  motivo_resolucao text
);
comment on table crt_desdobramentos is 'Desdobramento no Consistem da compra parcelada lançada pelo total (cartão): título original, alteração, antes/depois e quem. Nunca apagados.';
create unique index uq_crt_desdobramentos_linha_ativa on crt_desdobramentos (linha_id) where situacao in ('reservado', 'enviando', 'alterado');
create unique index uq_crt_desdobramentos_titulo_ativo on crt_desdobramentos (cod_lancamento) where situacao in ('reservado', 'enviando', 'alterado');
create index idx_crt_desdobramentos_ciclo on crt_desdobramentos (ciclo_id);

create function fn_crt_desdobramento_regras() returns trigger language plpgsql as $$
begin
  if (new.fatura_id, new.ciclo_id, new.linha_id, new.cod_lancamento, new.parcelas, new.valor_original, new.valor_parcela, new.alteracao, new.antes,
      new.lote, new.criado_por, new.criado_em)
     is distinct from (old.fatura_id, old.ciclo_id, old.linha_id, old.cod_lancamento, old.parcelas, old.valor_original, old.valor_parcela, old.alteracao,
      old.antes, old.lote, old.criado_por, old.criado_em) then
    raise exception 'O desdobramento enviado ao Consistem é imutável.';
  end if;
  if old.situacao = 'alterado' then
    raise exception 'O título deste desdobramento já foi alterado no Consistem.';
  end if;
  if new.situacao <> old.situacao and not (
       (old.situacao = 'reservado' and new.situacao in ('enviando', 'erro')) or
       (old.situacao = 'enviando' and new.situacao in ('alterado', 'erro')) or
       (old.situacao = 'erro' and new.situacao = 'alterado' and new.resolvido_por is not null)) then
    raise exception 'Mudança de situação inválida: % → %.', old.situacao, new.situacao;
  end if;
  return new;
end $$;
create trigger trg_crt_desdobramentos_regras before update on crt_desdobramentos for each row execute function fn_crt_desdobramento_regras();
create trigger trg_crt_desdobramentos_sem_delete before delete on crt_desdobramentos for each row execute function fn_bloquear_delete();
create trigger trg_aud_crt_desdobramentos after insert or update on crt_desdobramentos for each row execute function fn_auditoria();

alter table crt_desdobramentos enable row level security;
create policy crt_desdobramentos_ler on crt_desdobramentos for select to authenticated using (tem_acesso_area('financeiro'));

-- 3) Parcelas 2..N em crt_lancamentos_erp (tipo 'desdobramento') e exclusão no ERP registrada --------------------------------
alter table crt_lancamentos_erp
  add column desdobramento_id uuid references crt_desdobramentos(id),
  add column excluido_no_erp_em timestamptz,
  add column excluido_no_erp_por uuid references perfis(id),
  add column motivo_exclusao_erp text;
alter table crt_lancamentos_erp drop constraint crt_lancamentos_erp_tipo_check;
alter table crt_lancamentos_erp add constraint crt_lancamentos_erp_tipo_check check (tipo in ('encargos', 'compra', 'agrupado', 'provisorio', 'desdobramento'));
alter table crt_lancamentos_erp drop constraint crt_lancamentos_erp_compra_ck;
alter table crt_lancamentos_erp add constraint crt_lancamentos_erp_compra_ck check (
  tipo = 'encargos'
  or (tipo = 'compra' and linha_origem is not null and parcela is not null and parcelas is not null and parcela <= parcelas and vencimento is not null)
  or (tipo = 'agrupado' and linha_origem is null and cardinality(linhas) >= 2 and vencimento is not null)
  or (tipo = 'provisorio' and linha_origem is null and cardinality(linhas) = 0 and vencimento is not null)
  or (tipo = 'desdobramento' and linha_origem is not null and desdobramento_id is not null and cardinality(linhas) = 0
      and parcela between 2 and parcelas and vencimento is not null));
alter table crt_lancamentos_erp add constraint crt_lancamentos_erp_exclusao_ck
  check (excluido_no_erp_em is null or (situacao = 'lancado' and excluido_no_erp_por is not null and length(trim(motivo_exclusao_erp)) >= 10));

-- Título excluído no Consistem deixa de contar como lançamento ativo.
drop index uq_crt_lancamentos_erp_parcela_ativa;
create unique index uq_crt_lancamentos_erp_parcela_ativa on crt_lancamentos_erp (linha_origem, parcela)
  where tipo = 'compra' and situacao in ('reservado', 'enviando', 'lancado') and excluido_no_erp_em is null;
create unique index uq_crt_lancamentos_erp_desdobramento_ativo on crt_lancamentos_erp (linha_origem, parcela)
  where tipo = 'desdobramento' and situacao in ('reservado', 'enviando', 'lancado') and excluido_no_erp_em is null;

create or replace function fn_crt_lancamento_erp_regras() returns trigger language plpgsql as $$
begin
  -- Registro da exclusão no Consistem: só os três campos, uma vez, num título lançado.
  if old.excluido_no_erp_em is null and new.excluido_no_erp_em is not null then
    if old.situacao <> 'lancado' or (to_jsonb(new) - 'excluido_no_erp_em' - 'excluido_no_erp_por' - 'motivo_exclusao_erp')
                                    <> (to_jsonb(old) - 'excluido_no_erp_em' - 'excluido_no_erp_por' - 'motivo_exclusao_erp') then
      raise exception 'A exclusão no Consistem só se registra num título lançado, sem mudar mais nada.';
    end if;
    return new;
  end if;
  if (new.excluido_no_erp_em, new.excluido_no_erp_por, new.motivo_exclusao_erp) is distinct from (old.excluido_no_erp_em, old.excluido_no_erp_por, old.motivo_exclusao_erp) then
    raise exception 'A exclusão no Consistem já foi registrada.';
  end if;
  if (new.fatura_id, new.ciclo_id, new.linhas, new.valor, new.complemento, new.payload, new.criado_por, new.criado_em,
      new.tipo, new.lote, new.linha_origem, new.parcela, new.parcelas, new.vencimento, new.desdobramento_id)
     is distinct from (old.fatura_id, old.ciclo_id, old.linhas, old.valor, old.complemento, old.payload, old.criado_por, old.criado_em,
      old.tipo, old.lote, old.linha_origem, old.parcela, old.parcelas, old.vencimento, old.desdobramento_id) then
    raise exception 'O lançamento enviado ao Consistem é imutável.';
  end if;
  if new.situacao <> old.situacao and not (
       (old.situacao = 'reservado' and new.situacao in ('enviando', 'erro')) or
       (old.situacao = 'enviando' and new.situacao in ('lancado', 'erro'))) then
    raise exception 'Mudança de situação inválida: % → %.', old.situacao, new.situacao;
  end if;
  if old.situacao in ('lancado', 'erro') then
    raise exception 'Este lançamento já foi concluído (%).', old.situacao;
  end if;
  if new.situacao = 'lancado' and coalesce(trim(new.cod_lancamento_erp), '') = '' then
    raise exception 'Lançado exige o código do lançamento no Consistem.';
  end if;
  return new;
end $$;

drop view crt_vw_lancamentos_erp;
create view crt_vw_lancamentos_erp with (security_invoker = true) as
select l.*, pc.nome as criado_por_nome, pr.nome as resolvido_por_nome, fl.descricao as linha_descricao, pe.nome as excluido_no_erp_por_nome
  from crt_lancamentos_erp l
  left join perfis pc on pc.id = l.criado_por
  left join perfis pr on pr.id = l.resolvido_por
  left join perfis pe on pe.id = l.excluido_no_erp_por
  left join crt_fatura_linhas fl on fl.id = l.linha_origem;

create or replace function crt_linhas_em_lancamento(p_linhas uuid[]) returns text
language sql stable security definer set search_path = public as $$
  select fl.descricao
    from crt_lancamentos_erp l join crt_fatura_linhas fl on fl.id = any(l.linhas) or fl.id = l.linha_origem
   where l.situacao in ('reservado', 'enviando', 'lancado') and l.excluido_no_erp_em is null and fl.id = any(p_linhas)
   limit 1
$$;
revoke all on function crt_linhas_em_lancamento(uuid[]) from public, anon, authenticated;

-- Registrar que o título lançado pelo painel foi EXCLUÍDO no Consistem (gestor; qualquer situação do mês).
create function crt_registrar_exclusao_erp(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_lancamentos_erp;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'gestor') then
    raise exception 'Somente gestor do Financeiro (ou acima) registra a exclusão de um título no Consistem.';
  end if;
  if coalesce(length(trim(p_motivo)), 0) < 10 then
    raise exception 'Informe o motivo da exclusão (ex.: duplicava a NF 3615152).';
  end if;
  select * into v from crt_lancamentos_erp where id = p_id for update;
  if v.id is null or v.situacao <> 'lancado' then
    raise exception 'Só um título lançado no Consistem pode ter a exclusão registrada.';
  end if;
  if v.excluido_no_erp_em is not null then
    raise exception 'A exclusão deste título já foi registrada.';
  end if;
  update crt_lancamentos_erp set excluido_no_erp_em = now(), excluido_no_erp_por = auth.uid(), motivo_exclusao_erp = left(trim(p_motivo), 500)
   where id = p_id;
end $$;
revoke all on function crt_registrar_exclusao_erp(uuid, text) from public, anon;
grant execute on function crt_registrar_exclusao_erp(uuid, text) to authenticated;

-- 4) Pendência "Desdobrar no Consistem" (aberta enquanto houver alteração ou parcela com erro sem substituta) --------------
create function crt_sincronizar_pendencia_desdobramentos(p_ciclo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo crt_ciclos;
  v_alteracoes int;
  v_parcelas int;
begin
  if auth.uid() is not null and not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima).';
  end if;
  select * into v_ciclo from crt_ciclos where id = p_ciclo;
  if v_ciclo.id is null then return; end if;
  select count(distinct d.linha_id) into v_alteracoes
    from crt_desdobramentos d
   where d.ciclo_id = p_ciclo and d.situacao = 'erro'
     and not exists (select 1 from crt_desdobramentos x where x.linha_id = d.linha_id and x.situacao in ('reservado', 'enviando', 'alterado'));
  select count(*) into v_parcelas
    from (select distinct l.linha_origem, l.parcela from crt_lancamentos_erp l
           where l.ciclo_id = p_ciclo and l.tipo = 'desdobramento' and l.situacao = 'erro'
             and exists (select 1 from crt_desdobramentos d where d.id = l.desdobramento_id and d.situacao = 'alterado')
             and not exists (select 1 from crt_lancamentos_erp a where a.tipo = 'desdobramento' and a.linha_origem = l.linha_origem and a.parcela = l.parcela
                                and a.situacao in ('reservado', 'enviando', 'lancado') and a.excluido_no_erp_em is null)) p;
  if v_alteracoes + v_parcelas = 0 then
    perform crt_encerrar_pendencias(p_ciclo, 'Desdobrar no Consistem', 'concluida');
  else
    perform crt_abrir_pendencia(v_ciclo, 'Desdobrar no Consistem a compra parcelada da fatura ' || crt_rotulo_ciclo(v_ciclo),
      case when v_alteracoes > 0 then v_alteracoes || case when v_alteracoes = 1 then ' compra lançada pelo total não foi desdobrada' else ' compras lançadas pelo total não foram desdobradas' end
           else '' end
      || case when v_alteracoes > 0 and v_parcelas > 0 then '; ' else '' end
      || case when v_parcelas > 0 then v_parcelas || case when v_parcelas = 1 then ' parcela do desdobramento não foi criada' else ' parcelas do desdobramento não foram criadas' end
           else '' end
      || ' no Consistem. Abra a fatura e use "Desdobrar no Consistem" ou "Reenviar o que faltou".',
      greatest(v_ciclo.vencimento_nominal, (now() at time zone 'America/Cuiaba')::date));
  end if;
end $$;
revoke all on function crt_sincronizar_pendencia_desdobramentos(uuid) from public, anon;
grant execute on function crt_sincronizar_pendencia_desdobramentos(uuid) to authenticated, service_role;

-- 5) Reservar o desdobramento (painel; operador) -----------------------------------------------------------------------------
-- p_titulo: { "num_documento": "...", "fornecedor": "..." } (para a tela). p_antes: detalhe do título lido do Consistem.
-- p_alteracao: { valorDocumento, codDocumento, complementoHistorico }. p_parcelas: [{ parcela: 2.., vencimento, payload }] em ordem.
create function crt_reservar_desdobramento(p_fatura uuid, p_linha uuid, p_cod text, p_titulo jsonb, p_antes jsonb, p_alteracao jsonb, p_parcelas jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fatura crt_faturas;
  v_situacao crt_situacao_ciclo;
  v_linha crt_fatura_linhas;
  v_n int;
  v_original numeric;
  v_soma numeric;
  v_conflito text;
  v_lote uuid := gen_random_uuid();
  v_id uuid;
  v_item jsonb;
  v_k int := 2;
  v_valor numeric;
  v_comp text;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) desdobra títulos no Consistem.';
  end if;
  if not crt_desdobrar_ligado() then
    raise exception 'O desdobramento no Consistem está desligado (Configurações: financeiro.cartao.desdobrar_no_erp).';
  end if;
  if not crt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (Configurações: financeiro.cartao.lancar_no_erp).';
  end if;
  v_fatura := crt_fatura_editavel(p_fatura);
  select situacao into v_situacao from crt_ciclos where id = v_fatura.ciclo_id;
  if v_fatura.ciclo_id is null or v_situacao is distinct from 'em_conciliacao' then
    raise exception 'Só se desdobra compra de fatura de um mês em conciliação.';
  end if;
  select * into v_linha from crt_fatura_linhas where id = p_linha and fatura_id = p_fatura and not descartada;
  if v_linha.id is null then
    raise exception 'A linha não é desta fatura (ou é linha descartada).';
  end if;
  v_n := v_linha.parcela_total;
  if v_linha.parcela_num is distinct from 1 or coalesce(v_n, 1) < 2 or v_n > 48 or v_linha.valor <= 0 then
    raise exception 'Só se desdobra a partir da linha da parcela 1 de uma compra parcelada.';
  end if;
  select l.descricao into v_conflito
    from crt_decisoes d join crt_fatura_linhas l on l.id = any(d.linhas)
   where d.fatura_id = p_fatura and d.desfeito_em is null and d.tipo in ('justificar', 'casar', 'compensar') and l.id = p_linha limit 1;
  if v_conflito is not null then
    raise exception 'A linha % já tem decisão (justificar, casar ou compensar): desfaça-a antes de desdobrar.', v_conflito;
  end if;
  v_conflito := crt_linhas_em_lancamento(array[p_linha]);
  if v_conflito is not null then
    raise exception 'A linha % já foi lançada no Consistem pelo painel.', v_conflito;
  end if;
  if exists (select 1 from crt_desdobramentos where (linha_id = p_linha or cod_lancamento = trim(p_cod)) and situacao in ('reservado', 'enviando', 'alterado')) then
    raise exception 'Esta compra (ou este título) já tem desdobramento no Consistem: confira na lista.';
  end if;
  if trim(coalesce(p_cod, '')) !~ '^\d{1,12}$' or trim(p_antes ->> 'codLancamento') is distinct from trim(p_cod) then
    raise exception 'O detalhe lido não é do título %.', p_cod;
  end if;
  v_original := round((p_antes ->> 'valorDocumento')::numeric, 2);
  if v_original is null or abs(v_original - v_n * v_linha.valor) > (v_n + 5) / 100.0 then
    raise exception 'O título (R$ %) não é a compra inteira (% × R$ %).', translate(to_char(v_original, 'FM999,999,990.00'), ',.', '.,'), v_n,
      translate(to_char(v_linha.valor, 'FM999,999,990.00'), ',.', '.,');
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p_alteracao) k) is distinct from array['codDocumento', 'complementoHistorico', 'valorDocumento'] then
    raise exception 'A alteração do título leva só o valor, o documento e o complemento.';
  end if;
  v_comp := p_alteracao ->> 'complementoHistorico';
  if (p_alteracao ->> 'valorDocumento')::numeric is distinct from v_linha.valor or coalesce(length(v_comp), 0) = 0 or length(v_comp) > 70
     or coalesce(length(trim(p_alteracao ->> 'codDocumento')), 0) = 0 or length(p_alteracao ->> 'codDocumento') > 30 then
    raise exception 'A alteração do título original é inválida (valor da parcela 1, documento e complemento).';
  end if;
  if jsonb_typeof(p_parcelas) <> 'array' or jsonb_array_length(p_parcelas) <> v_n - 1 then
    raise exception 'Informe as parcelas 2 a %.', v_n;
  end if;
  v_soma := v_linha.valor;
  for v_item in select value from jsonb_array_elements(p_parcelas) loop
    v_valor := (v_item -> 'payload' ->> 'valorDocumento')::numeric;
    v_comp := v_item -> 'payload' ->> 'complementoHistorico';
    if (v_item ->> 'parcela')::int is distinct from v_k then
      raise exception 'As parcelas precisam vir em ordem, a partir da 2.';
    end if;
    if v_valor is null or v_valor <= 0 or (v_k < v_n and v_valor <> v_linha.valor) then
      raise exception 'Valor inválido na parcela % (cada parcela tem o valor da linha da fatura; a última fecha o total).', v_k;
    end if;
    if v_item -> 'payload' ->> 'dataVencimento' is distinct from v_item ->> 'vencimento' or (v_item ->> 'vencimento') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Vencimento inválido na parcela %.', v_k;
    end if;
    if coalesce(length(v_comp), 0) = 0 or length(v_comp) > 70 or coalesce(length(trim(v_item -> 'payload' ->> 'codDocumento')), 0) = 0 then
      raise exception 'Complemento ou documento inválido na parcela %.', v_k;
    end if;
    if (v_item -> 'payload' ->> 'codFornecedor') is distinct from trim(p_antes ->> 'codFornecedor') then
      raise exception 'A parcela % não tem o fornecedor do título original.', v_k;
    end if;
    v_soma := v_soma + v_valor;
    v_k := v_k + 1;
  end loop;
  if v_soma <> v_original then
    raise exception 'A soma das parcelas (R$ %) não é o total do título (R$ %).', translate(to_char(v_soma, 'FM999,999,990.00'), ',.', '.,'), translate(to_char(v_original, 'FM999,999,990.00'), ',.', '.,');
  end if;

  insert into crt_desdobramentos (fatura_id, ciclo_id, linha_id, cod_lancamento, num_documento, fornecedor, parcelas, valor_original, valor_parcela, alteracao, antes, lote)
  values (p_fatura, v_fatura.ciclo_id, p_linha, trim(p_cod), left(p_titulo ->> 'num_documento', 60), left(p_titulo ->> 'fornecedor', 120), v_n, v_original,
          v_linha.valor, p_alteracao, p_antes, v_lote)
  returning id into v_id;
  for v_item in select value from jsonb_array_elements(p_parcelas) loop
    insert into crt_lancamentos_erp (fatura_id, ciclo_id, linhas, valor, complemento, payload, tipo, lote, linha_origem, parcela, parcelas, vencimento, desdobramento_id)
    values (p_fatura, v_fatura.ciclo_id, '{}', (v_item -> 'payload' ->> 'valorDocumento')::numeric, v_item -> 'payload' ->> 'complementoHistorico', v_item -> 'payload',
            'desdobramento', v_lote, p_linha, (v_item ->> 'parcela')::int, v_n, (v_item ->> 'vencimento')::date, v_id);
  end loop;
  return v_lote;
end $$;
revoke all on function crt_reservar_desdobramento(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function crt_reservar_desdobramento(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- 6) Envio (Edge Function crt-desdobrar-no-consistem, service role) ----------------------------------------------------------
create function crt_iniciar_desdobramento(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update crt_desdobramentos set situacao = 'enviando', tentativas = tentativas + 1, enviado_em = now() where id = p_id and situacao = 'reservado';
  if not found then raise exception 'O desdobramento não está reservado.'; end if;
end $$;

-- Conclui a alteração do título original. Erro: as parcelas reservadas do lote não são enviadas.
create function crt_concluir_desdobramento(p_id uuid, p_alterado boolean, p_depois jsonb, p_resposta jsonb, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_desdobramentos;
begin
  update crt_desdobramentos
     set situacao = case when p_alterado then 'alterado'::crt_situacao_desdobramento else 'erro'::crt_situacao_desdobramento end,
         depois = p_depois, resposta = p_resposta, concluido_em = now(),
         erro = case when p_alterado then null else coalesce(nullif(trim(p_erro), ''), 'Erro não informado.') end
   where id = p_id and situacao = 'enviando'
  returning * into v;
  if v.id is null then raise exception 'O desdobramento não está em envio.'; end if;
  if not p_alterado then
    update crt_lancamentos_erp set situacao = 'erro', erro = 'Não enviada: o título original não foi alterado no Consistem.', concluido_em = now()
     where desdobramento_id = p_id and situacao = 'reservado';
  end if;
  perform crt_sincronizar_pendencia_desdobramentos(v.ciclo_id);
end $$;

revoke all on function crt_iniciar_desdobramento(uuid) from public, anon, authenticated;
revoke all on function crt_concluir_desdobramento(uuid, boolean, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function crt_iniciar_desdobramento(uuid) to service_role;
grant execute on function crt_concluir_desdobramento(uuid, boolean, jsonb, jsonb, text) to service_role;

-- Painel (operador): a função não respondeu e o desdobramento ficou reservado → erro (nada foi enviado).
create function crt_falha_desdobramento(p_lote uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_desdobramentos;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima).';
  end if;
  update crt_desdobramentos set situacao = 'erro', erro = left(coalesce(nullif(trim(p_motivo), ''), 'Envio não concluído.'), 500), concluido_em = now()
   where lote = p_lote and situacao = 'reservado'
  returning * into v;
  if v.id is null then return; end if;
  update crt_lancamentos_erp set situacao = 'erro', erro = 'Não enviada: o título original não foi alterado no Consistem.', concluido_em = now()
   where desdobramento_id = v.id and situacao = 'reservado';
  perform crt_sincronizar_pendencia_desdobramentos(v.ciclo_id);
end $$;
revoke all on function crt_falha_desdobramento(uuid, text) from public, anon;
grant execute on function crt_falha_desdobramento(uuid, text) to authenticated;

-- Resolver à mão (operador): conferido no Consistem que o título JÁ está alterado (resposta incerta) → as parcelas podem ir.
create function crt_resolver_desdobramento(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_desdobramentos;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) resolve desdobramentos.';
  end if;
  if coalesce(length(trim(p_motivo)), 0) < 3 then
    raise exception 'Informe o que foi conferido no Consistem.';
  end if;
  select * into v from crt_desdobramentos where id = p_id for update;
  if v.id is null or v.situacao <> 'erro' then
    raise exception 'Só um desdobramento com erro pode ser resolvido à mão.';
  end if;
  perform crt_fatura_editavel(v.fatura_id);
  if exists (select 1 from crt_desdobramentos where linha_id = v.linha_id and situacao in ('reservado', 'enviando', 'alterado')) then
    raise exception 'Esta compra já tem outro desdobramento em andamento.';
  end if;
  update crt_desdobramentos set situacao = 'alterado', resolvido_por = auth.uid(), motivo_resolucao = left(trim(p_motivo), 300) where id = p_id;
  perform crt_sincronizar_pendencia_desdobramentos(v.ciclo_id);
end $$;
revoke all on function crt_resolver_desdobramento(uuid, text) from public, anon;
grant execute on function crt_resolver_desdobramento(uuid, text) to authenticated;

-- 7) Envio das parcelas: só depois do título original alterado ----------------------------------------------------------------
create or replace function crt_iniciar_envio_erp(p_id uuid) returns crt_lancamentos_erp
language plpgsql security definer set search_path = public as $$
declare
  v crt_lancamentos_erp;
begin
  if exists (select 1 from crt_lancamentos_erp l where l.id = p_id and l.tipo = 'desdobramento'
               and not exists (select 1 from crt_desdobramentos d where d.id = l.desdobramento_id and d.situacao = 'alterado')) then
    raise exception 'O título original ainda não foi alterado no Consistem: as parcelas do desdobramento não são enviadas.';
  end if;
  update crt_lancamentos_erp set situacao = 'enviando', enviado_em = now() where id = p_id and situacao = 'reservado' returning * into v;
  if v.id is null then
    raise exception 'Lançamento não encontrado ou já enviado.';
  end if;
  return v;
end $$;
revoke all on function crt_iniciar_envio_erp(uuid) from public, anon, authenticated;
grant execute on function crt_iniciar_envio_erp(uuid) to service_role;

-- Reenviar o que faltou: compras e parcelas de desdobramento (estas só com o título original alterado).
create or replace function crt_reenviar_lancamentos(p_lote uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_novo uuid := gen_random_uuid();
  v_fatura uuid;
  v_tipo text;
  v_n int;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) reenvia lançamentos.';
  end if;
  if not crt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (Configurações: financeiro.cartao.lancar_no_erp).';
  end if;
  select fatura_id, tipo into v_fatura, v_tipo from crt_lancamentos_erp where lote = p_lote and tipo in ('compra', 'desdobramento') limit 1;
  if v_fatura is null then
    raise exception 'Lote de compra não encontrado.';
  end if;
  perform crt_fatura_editavel(v_fatura);
  if v_tipo = 'desdobramento' and exists (select 1 from crt_lancamentos_erp l where l.lote = p_lote
       and not exists (select 1 from crt_desdobramentos d where d.id = l.desdobramento_id and d.situacao = 'alterado')) then
    raise exception 'O título original ainda não foi alterado no Consistem: use "Desdobrar no Consistem" de novo.';
  end if;
  insert into crt_lancamentos_erp (fatura_id, ciclo_id, linhas, valor, complemento, payload, tipo, lote, linha_origem, parcela, parcelas, vencimento, desdobramento_id)
  select l.fatura_id, l.ciclo_id, l.linhas, l.valor, l.complemento, l.payload, l.tipo, v_novo, l.linha_origem, l.parcela, l.parcelas, l.vencimento, l.desdobramento_id
    from crt_lancamentos_erp l
   where l.lote = p_lote and l.situacao = 'erro'
     and not exists (select 1 from crt_lancamentos_erp a where a.tipo = l.tipo and a.linha_origem = l.linha_origem and a.parcela = l.parcela
                                                          and a.situacao in ('reservado', 'enviando', 'lancado') and a.excluido_no_erp_em is null);
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nada a reenviar neste lote.';
  end if;
  return v_novo;
end $$;
revoke all on function crt_reenviar_lancamentos(uuid) from public, anon;
grant execute on function crt_reenviar_lancamentos(uuid) to authenticated;
