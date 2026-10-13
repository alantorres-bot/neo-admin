-- =========================================================
-- Neo Admin — 0138 Cartão de crédito: lançar no Consistem as COMPRAS sem título (com sugestão pelo estabelecimento)
-- Especificação: docs/modulos/financeiro-cartao.md (seção 5, regras 37 a 43).
--
-- Amplia a 0137 (encargos) para toda linha da fatura sem título. Decisões do Alan (13/10/2026):
--   - o sistema sugere o fornecedor e os códigos pelo estabelecimento (dicionário crt_estabelecimentos); cada estabelecimento
--     terá um fornecedor próprio no Consistem; sem sugestão, o operador escolhe e pode mandar lembrar;
--   - compra parcelada sem título: lança TODAS as parcelas restantes (uma por mês, nos vencimentos seguintes do cartão);
--   - o operador pode mudar todos os códigos no diálogo; a mesma chave libera encargos e compras.
-- Um "lote" agrupa os títulos de um clique (as parcelas de uma compra); a Edge Function crt-lancar-no-consistem envia em ordem,
-- um de cada vez, e para no primeiro que não voltar lançado (os seguintes ficam "erro: envio interrompido" e podem ser
-- reenviados). A decisão "casar" liga a linha só ao título da parcela DESTA fatura; as parcelas futuras casam sozinhas.
-- =========================================================

-- 1) Chave geral única (encargos e compras) ------------------------------------------------------------------------------
update configuracoes
   set chave = 'financeiro.cartao.lancar_no_erp',
       descricao = 'Cartão de crédito: mostra os botões que lançam no Consistem (encargos do mês e compras sem título). Desligado = o painel só calcula e mostra os títulos.'
 where chave = 'financeiro.cartao.lancar_encargos_no_erp';
insert into configuracoes (chave, valor, descricao) values
  ('financeiro.cartao.lancar_no_erp', 'false',
   'Cartão de crédito: mostra os botões que lançam no Consistem (encargos do mês e compras sem título). Desligado = o painel só calcula e mostra os títulos.')
on conflict (chave) do nothing;

create or replace function crt_lancar_no_erp_ligado() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select valor from configuracoes where chave = 'financeiro.cartao.lancar_no_erp'), 'false'::jsonb) = 'true'::jsonb
$$;

-- 2) Códigos: padrões de compra por cartão e sugestão por estabelecimento ----------------------------------------------------
create function crt_codigos_validos(j jsonb, p_obrigatorias text[], p_permitidas text[]) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object'
     and not exists (select 1 from jsonb_object_keys(j) k where k <> all(p_permitidas))
     and not exists (select 1 from unnest(p_obrigatorias) k where not (j ? k))
     and coalesce((select bool_and(coalesce(jsonb_typeof(j -> k) = 'number' and (j ->> k)::numeric > 0
                                             and (j ->> k)::numeric = trunc((j ->> k)::numeric), false))
                     from jsonb_object_keys(j) k), true)
$$;

alter table crt_cartoes add column lancamento_compras jsonb
  constraint crt_cartoes_lancamento_compras_ck check (lancamento_compras is null or crt_codigos_validos(lancamento_compras,
    array['codPortador', 'categoriaDoc', 'codHistorico', 'contaContabilCredito'],
    array['codPortador', 'categoriaDoc', 'codHistorico', 'contaContabilCredito']));
comment on column crt_cartoes.lancamento_compras is 'Padrões do cartão para o título de compra no Consistem: codPortador, categoriaDoc, codHistorico, contaContabilCredito. O estabelecimento e o operador podem trocar.';

alter table crt_estabelecimentos add column lancamento_erp jsonb
  constraint crt_estabelecimentos_lancamento_erp_ck check (lancamento_erp is null or crt_codigos_validos(lancamento_erp, '{}',
    array['codFornecedor', 'codHistorico', 'codPortador', 'categoriaDoc', 'grupoContaFluxoCaixa', 'contaFluxoCaixa', 'contaContabilDebito', 'contaContabilCredito']));
comment on column crt_estabelecimentos.lancamento_erp is 'Sugestão para lançar no Consistem a compra deste estabelecimento (fornecedor, histórico, categoria, fluxo, contas contábeis). Campos opcionais; o que faltar vem do cartão ou o operador escolhe.';

-- 3) Lançamentos: tipo, lote e parcelas --------------------------------------------------------------------------------------
alter table crt_lancamentos_erp
  add column tipo text not null default 'encargos' check (tipo in ('encargos', 'compra')),
  add column lote uuid not null default gen_random_uuid(),
  add column linha_origem uuid references crt_fatura_linhas(id),
  add column parcela int check (parcela >= 1),
  add column parcelas int check (parcelas >= 1),
  add column vencimento date;
alter table crt_lancamentos_erp add constraint crt_lancamentos_erp_compra_ck
  check (tipo = 'encargos' or (linha_origem is not null and parcela is not null and parcelas is not null and parcela <= parcelas and vencimento is not null));
create index idx_crt_lancamentos_erp_lote on crt_lancamentos_erp (lote);

drop index uq_crt_lancamentos_erp_ciclo_ativo;
create unique index uq_crt_lancamentos_erp_ciclo_ativo on crt_lancamentos_erp (ciclo_id)
  where tipo = 'encargos' and situacao in ('reservado', 'enviando', 'lancado');
create unique index uq_crt_lancamentos_erp_parcela_ativa on crt_lancamentos_erp (linha_origem, parcela)
  where tipo = 'compra' and situacao in ('reservado', 'enviando', 'lancado');

create or replace function fn_crt_lancamento_erp_regras() returns trigger language plpgsql as $$
begin
  if (new.fatura_id, new.ciclo_id, new.linhas, new.valor, new.complemento, new.payload, new.criado_por, new.criado_em,
      new.tipo, new.lote, new.linha_origem, new.parcela, new.parcelas, new.vencimento)
     is distinct from (old.fatura_id, old.ciclo_id, old.linhas, old.valor, old.complemento, old.payload, old.criado_por, old.criado_em,
      old.tipo, old.lote, old.linha_origem, old.parcela, old.parcelas, old.vencimento) then
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
select l.*, pc.nome as criado_por_nome, pr.nome as resolvido_por_nome, fl.descricao as linha_descricao
  from crt_lancamentos_erp l
  left join perfis pc on pc.id = l.criado_por
  left join perfis pr on pr.id = l.resolvido_por
  left join crt_fatura_linhas fl on fl.id = l.linha_origem;

-- 4) Lançado: casa as linhas do título (encargos: todas; compra: a linha, só no título da parcela desta fatura) -------------
create or replace function crt_marcar_encargos_lancados(p_id uuid, p_cod text, p_resposta jsonb, p_usuario uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_lancamentos_erp;
  v_cod text := trim(p_cod);
begin
  select * into v from crt_lancamentos_erp where id = p_id for update;
  update crt_lancamentos_erp
     set situacao = 'lancado', cod_lancamento_erp = v_cod, resposta = coalesce(p_resposta, resposta), concluido_em = now(), erro = null,
         resolvido_por = case when p_motivo is null then resolvido_por else p_usuario end, motivo_resolucao = coalesce(p_motivo, motivo_resolucao)
   where id = p_id;
  if cardinality(v.linhas) > 0 then
    insert into crt_decisoes (fatura_id, tipo, linhas, titulos, motivo, criado_por)
    values (v.fatura_id, 'casar', v.linhas, array[v_cod],
            case when v.tipo = 'encargos' then 'Encargos do mês lançados no Consistem pelo Neo Admin: lançamento '
                 else 'Compra lançada no Consistem pelo Neo Admin: lançamento ' end
            || v_cod || ' (R$ ' || translate(to_char(v.valor, 'FM999,999,990.00'), ',.', '.,') || ')'
            || case when v.tipo = 'compra' and v.parcelas > 1 then ', parcela ' || v.parcela || '/' || v.parcelas else '' end,
            coalesce(p_usuario, v.criado_por));
  end if;
end $$;
revoke all on function crt_marcar_encargos_lancados(uuid, text, jsonb, uuid, text) from public, anon, authenticated;

-- Linhas já em lançamento ativo (encargos ou compra) não entram em outro.
create or replace function crt_linhas_em_lancamento(p_linhas uuid[]) returns text
language sql stable security definer set search_path = public as $$
  select fl.descricao
    from crt_lancamentos_erp l join crt_fatura_linhas fl on fl.id = any(l.linhas) or fl.id = l.linha_origem
   where l.situacao in ('reservado', 'enviando', 'lancado') and fl.id = any(p_linhas)
   limit 1
$$;
revoke all on function crt_linhas_em_lancamento(uuid[]) from public, anon, authenticated;

-- 5) Reservar encargos: mesma regra da 0137, com a chave nova e sem linha já lançada como compra --------------------------
create or replace function crt_reservar_lancamento_encargos(p_fatura uuid, p_linhas uuid[], p_valor numeric, p_complemento text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fatura crt_faturas;
  v_situacao crt_situacao_ciclo;
  v_linhas uuid[] := coalesce((select array_agg(distinct x) from unnest(p_linhas) x), '{}');
  v_validas int;
  v_soma numeric;
  v_conflito text;
  v_ativo text;
  v_id uuid;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) lança encargos no Consistem.';
  end if;
  if not crt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (Configurações: financeiro.cartao.lancar_no_erp).';
  end if;
  v_fatura := crt_fatura_editavel(p_fatura);
  select situacao into v_situacao from crt_ciclos where id = v_fatura.ciclo_id;
  if v_fatura.ciclo_id is null or v_situacao is distinct from 'em_conciliacao' then
    raise exception 'Só se lançam encargos de fatura de um mês em conciliação.';
  end if;
  if cardinality(v_linhas) = 0 then
    raise exception 'Nenhuma linha de encargo para lançar.';
  end if;
  select count(*), coalesce(sum(valor), 0) into v_validas, v_soma
    from crt_fatura_linhas where fatura_id = p_fatura and id = any(v_linhas) and not descartada;
  if v_validas <> cardinality(v_linhas) then
    raise exception 'Uma das linhas não é desta fatura (ou é linha descartada).';
  end if;
  if v_soma <> p_valor or p_valor <= 0 then
    raise exception 'O valor do título (R$ %) não confere com a soma das linhas (R$ %).', to_char(p_valor, 'FM999G999G990D00'), to_char(v_soma, 'FM999G999G990D00');
  end if;
  if (p_payload ->> 'valorDocumento')::numeric is distinct from p_valor or p_payload ->> 'complementoHistorico' is distinct from p_complemento then
    raise exception 'O título montado não confere com o valor e o complemento informados.';
  end if;
  select l.descricao into v_conflito
    from crt_decisoes d join crt_fatura_linhas l on l.id = any(d.linhas)
   where d.fatura_id = p_fatura and d.desfeito_em is null and d.tipo in ('justificar', 'casar', 'compensar') and l.id = any(v_linhas) limit 1;
  if v_conflito is not null then
    raise exception 'A linha % já tem decisão (justificar, casar ou compensar): desfaça-a antes de lançar.', v_conflito;
  end if;
  select coalesce(cod_lancamento_erp, situacao::text) into v_ativo
    from crt_lancamentos_erp where ciclo_id = v_fatura.ciclo_id and tipo = 'encargos' and situacao in ('reservado', 'enviando', 'lancado') limit 1;
  if v_ativo is not null then
    raise exception 'Este mês já tem lançamento de encargos no Consistem (%): confira na lista de lançamentos.', v_ativo;
  end if;
  v_conflito := crt_linhas_em_lancamento(v_linhas);
  if v_conflito is not null then
    raise exception 'A linha % já foi lançada no Consistem.', v_conflito;
  end if;
  insert into crt_lancamentos_erp (fatura_id, ciclo_id, linhas, valor, complemento, payload, tipo)
  values (p_fatura, v_fatura.ciclo_id, v_linhas, p_valor, p_complemento, p_payload, 'encargos')
  returning id into v_id;
  return v_id;
end $$;

-- 6) Reservar uma compra (todas as parcelas restantes num lote) ----------------------------------------------------------
-- p_titulos: [{ "parcela": k, "vencimento": "AAAA-MM-DD", "payload": { ...novoLancamentoContaPagar } }, ...] em ordem.
create function crt_reservar_lancamento_compra(p_fatura uuid, p_linha uuid, p_titulos jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fatura crt_faturas;
  v_situacao crt_situacao_ciclo;
  v_linha crt_fatura_linhas;
  v_primeira int;
  v_total int;
  v_conflito text;
  v_lote uuid := gen_random_uuid();
  v_item jsonb;
  v_k int;
  v_n int := 0;
  v_comp text;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) lança compras no Consistem.';
  end if;
  if not crt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (Configurações: financeiro.cartao.lancar_no_erp).';
  end if;
  v_fatura := crt_fatura_editavel(p_fatura);
  select situacao into v_situacao from crt_ciclos where id = v_fatura.ciclo_id;
  if v_fatura.ciclo_id is null or v_situacao is distinct from 'em_conciliacao' then
    raise exception 'Só se lançam compras de fatura de um mês em conciliação.';
  end if;
  select * into v_linha from crt_fatura_linhas where id = p_linha and fatura_id = p_fatura and not descartada;
  if v_linha.id is null then
    raise exception 'A linha não é desta fatura (ou é linha descartada).';
  end if;
  if v_linha.valor <= 0 then
    raise exception 'Estorno ou crédito não vira título: abata do título da compra.';
  end if;
  select l.descricao into v_conflito
    from crt_decisoes d join crt_fatura_linhas l on l.id = any(d.linhas)
   where d.fatura_id = p_fatura and d.desfeito_em is null and d.tipo in ('justificar', 'casar', 'compensar') and l.id = p_linha limit 1;
  if v_conflito is not null then
    raise exception 'A linha % já tem decisão (justificar, casar ou compensar): desfaça-a antes de lançar.', v_conflito;
  end if;
  v_conflito := crt_linhas_em_lancamento(array[p_linha]);
  if v_conflito is not null then
    raise exception 'A linha % já foi lançada no Consistem.', v_conflito;
  end if;
  v_primeira := coalesce(v_linha.parcela_num, 1);
  v_total := coalesce(v_linha.parcela_total, 1);
  if jsonb_typeof(p_titulos) <> 'array' or jsonb_array_length(p_titulos) <> v_total - v_primeira + 1 then
    raise exception 'Informe um título para cada parcela restante (da % até a %).', v_primeira, v_total;
  end if;
  for v_item in select value from jsonb_array_elements(p_titulos) loop
    v_k := v_primeira + v_n;
    v_comp := v_item -> 'payload' ->> 'complementoHistorico';
    if (v_item ->> 'parcela')::int is distinct from v_k then
      raise exception 'As parcelas precisam vir em ordem, a partir da %.', v_primeira;
    end if;
    if (v_item -> 'payload' ->> 'valorDocumento')::numeric is distinct from v_linha.valor then
      raise exception 'Cada parcela tem o valor da linha da fatura (R$ %).', translate(to_char(v_linha.valor, 'FM999,999,990.00'), ',.', '.,');
    end if;
    if v_item -> 'payload' ->> 'dataVencimento' is distinct from v_item ->> 'vencimento' or (v_item ->> 'vencimento') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Vencimento inválido na parcela %.', v_k;
    end if;
    if coalesce(length(v_comp), 0) = 0 or length(v_comp) > 70 then
      raise exception 'Complemento vazio ou com mais de 70 caracteres na parcela %.', v_k;
    end if;
    if coalesce(jsonb_typeof(v_item -> 'payload' -> 'codFornecedor'), '') <> 'number' then
      raise exception 'Escolha o fornecedor.';
    end if;
    begin
      insert into crt_lancamentos_erp (fatura_id, ciclo_id, linhas, valor, complemento, payload, tipo, lote, linha_origem, parcela, parcelas, vencimento)
      values (p_fatura, v_fatura.ciclo_id, case when v_k = v_primeira then array[p_linha] else '{}'::uuid[] end, v_linha.valor, v_comp,
              v_item -> 'payload', 'compra', v_lote, p_linha, v_k, v_total, (v_item ->> 'vencimento')::date);
    exception when unique_violation then
      raise exception 'A parcela % desta compra já foi lançada no Consistem.', v_k;
    end;
    v_n := v_n + 1;
  end loop;
  return v_lote;
end $$;
revoke all on function crt_reservar_lancamento_compra(uuid, uuid, jsonb) from public, anon;
grant execute on function crt_reservar_lancamento_compra(uuid, uuid, jsonb) to authenticated;

-- 7) Reenviar o que ficou de fora de um lote interrompido (compra) ------------------------------------------------------------
create function crt_reenviar_lancamentos(p_lote uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_novo uuid := gen_random_uuid();
  v_fatura uuid;
  v_n int;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) reenvia lançamentos.';
  end if;
  if not crt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (Configurações: financeiro.cartao.lancar_no_erp).';
  end if;
  select fatura_id into v_fatura from crt_lancamentos_erp where lote = p_lote and tipo = 'compra' limit 1;
  if v_fatura is null then
    raise exception 'Lote de compra não encontrado.';
  end if;
  perform crt_fatura_editavel(v_fatura);
  insert into crt_lancamentos_erp (fatura_id, ciclo_id, linhas, valor, complemento, payload, tipo, lote, linha_origem, parcela, parcelas, vencimento)
  select l.fatura_id, l.ciclo_id, l.linhas, l.valor, l.complemento, l.payload, 'compra', v_novo, l.linha_origem, l.parcela, l.parcelas, l.vencimento
    from crt_lancamentos_erp l
   where l.lote = p_lote and l.situacao = 'erro'
     and not exists (select 1 from crt_lancamentos_erp a where a.tipo = 'compra' and a.linha_origem = l.linha_origem and a.parcela = l.parcela
                                                          and a.situacao in ('reservado', 'enviando', 'lancado'));
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nada a reenviar neste lote.';
  end if;
  return v_novo;
end $$;
revoke all on function crt_reenviar_lancamentos(uuid) from public, anon;
grant execute on function crt_reenviar_lancamentos(uuid) to authenticated;

-- 8) Envio (Edge Function): nomes genéricos ---------------------------------------------------------------------------------
alter function crt_iniciar_envio_encargos(uuid) rename to crt_iniciar_envio_erp;
alter function crt_concluir_lancamento_encargos(uuid, text, jsonb, text) rename to crt_concluir_lancamento_erp;

-- Lote interrompido: os títulos ainda reservados viram erro (nada foi enviado).
create function crt_interromper_lote(p_lote uuid, p_motivo text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  update crt_lancamentos_erp set situacao = 'erro', erro = p_motivo, concluido_em = now()
   where lote = p_lote and situacao = 'reservado';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function crt_interromper_lote(uuid, text) from public, anon, authenticated;
grant execute on function crt_interromper_lote(uuid, text) to service_role;
