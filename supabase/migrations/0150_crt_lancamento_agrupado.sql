-- =========================================================
-- Neo Admin — 0150 Cartão de crédito: lançar várias linhas da fatura como um único título (agrupado)
-- Especificação: docs/modulos/financeiro-cartao.md (seção 5, regra 52).
--
-- Pedido do Alan (13/10/2026, fatura Sicredi PJ 10/2026 com 14 linhas de transporte por aplicativo): selecionar várias linhas
-- da mesma natureza e fazer um único lançamento no Consistem, com a soma. Linhas à vista, positivas, pendentes; título com
-- vencimento da fatura, emissão no fechamento, documento DDMM do fechamento. Lançado: a decisão "casar" liga todas as linhas.
-- Também: estabelecimento "99" (a fatura do Sicredi traz só "99"), com os códigos da Uber (mesmo tipo).
-- =========================================================

alter table crt_lancamentos_erp drop constraint crt_lancamentos_erp_tipo_check;
alter table crt_lancamentos_erp add constraint crt_lancamentos_erp_tipo_check check (tipo in ('encargos', 'compra', 'agrupado'));
alter table crt_lancamentos_erp drop constraint crt_lancamentos_erp_compra_ck;
alter table crt_lancamentos_erp add constraint crt_lancamentos_erp_compra_ck check (
  tipo = 'encargos'
  or (tipo = 'compra' and linha_origem is not null and parcela is not null and parcelas is not null and parcela <= parcelas and vencimento is not null)
  or (tipo = 'agrupado' and linha_origem is null and cardinality(linhas) >= 2 and vencimento is not null));

create function crt_reservar_lancamento_agrupado(p_fatura uuid, p_linhas uuid[], p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fatura crt_faturas;
  v_situacao crt_situacao_ciclo;
  v_linhas uuid[] := coalesce((select array_agg(distinct x) from unnest(p_linhas) x), '{}');
  v_validas int;
  v_soma numeric;
  v_parcelada text;
  v_conflito text;
  v_comp text := p_payload ->> 'complementoHistorico';
  v_venc text := p_payload ->> 'dataVencimento';
  v_lote uuid := gen_random_uuid();
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) lança compras no Consistem.';
  end if;
  if not crt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (Configurações: financeiro.cartao.lancar_no_erp).';
  end if;
  v_fatura := crt_fatura_editavel(p_fatura);
  perform pg_advisory_xact_lock(hashtext('crt_lancar:' || p_fatura::text));
  select situacao into v_situacao from crt_ciclos where id = v_fatura.ciclo_id;
  if v_fatura.ciclo_id is null or v_situacao is distinct from 'em_conciliacao' then
    raise exception 'Só se lançam compras de fatura de um mês em conciliação.';
  end if;
  if cardinality(v_linhas) < 2 then
    raise exception 'Escolha pelo menos duas linhas para agrupar.';
  end if;
  select count(*), coalesce(sum(valor), 0) into v_validas, v_soma
    from crt_fatura_linhas where fatura_id = p_fatura and id = any(v_linhas) and not descartada and valor > 0;
  if v_validas <> cardinality(v_linhas) then
    raise exception 'Uma das linhas não é desta fatura, é descartada ou não tem valor positivo.';
  end if;
  select descricao into v_parcelada from crt_fatura_linhas where id = any(v_linhas) and coalesce(parcela_total, 1) > 1 limit 1;
  if v_parcelada is not null then
    raise exception 'A linha % é parcelada: lance-a sozinha (todas as parcelas restantes).', v_parcelada;
  end if;
  if (p_payload ->> 'valorDocumento')::numeric is distinct from v_soma then
    raise exception 'O valor do título não confere com a soma das linhas (R$ %).', translate(to_char(v_soma, 'FM999,999,990.00'), ',.', '.,');
  end if;
  if coalesce(length(v_comp), 0) = 0 or length(v_comp) > 70 then
    raise exception 'Complemento vazio ou com mais de 70 caracteres.';
  end if;
  if coalesce(jsonb_typeof(p_payload -> 'codFornecedor'), '') <> 'number' then
    raise exception 'Escolha o fornecedor.';
  end if;
  if v_venc is null or v_venc !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Vencimento inválido.';
  end if;
  select l.descricao into v_conflito
    from crt_decisoes d join crt_fatura_linhas l on l.id = any(d.linhas)
   where d.fatura_id = p_fatura and d.desfeito_em is null and d.tipo in ('justificar', 'casar', 'compensar') and l.id = any(v_linhas) limit 1;
  if v_conflito is not null then
    raise exception 'A linha % já tem decisão (justificar, casar ou compensar): desfaça-a antes de lançar.', v_conflito;
  end if;
  v_conflito := crt_linhas_em_lancamento(v_linhas);
  if v_conflito is not null then
    raise exception 'A linha % já foi lançada no Consistem.', v_conflito;
  end if;
  insert into crt_lancamentos_erp (fatura_id, ciclo_id, linhas, valor, complemento, payload, tipo, lote, parcela, parcelas, vencimento)
  values (p_fatura, v_fatura.ciclo_id, v_linhas, v_soma, v_comp, p_payload, 'agrupado', v_lote, 1, 1, v_venc::date);
  return v_lote;
end $$;
revoke all on function crt_reservar_lancamento_agrupado(uuid, uuid[], jsonb) from public, anon;
grant execute on function crt_reservar_lancamento_agrupado(uuid, uuid[], jsonb) to authenticated;

-- O texto do motivo da decisão "casar" passa a nomear o agrupado.
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
            case v.tipo when 'encargos' then 'Encargos do mês lançados no Consistem pelo Neo Admin: lançamento '
                        when 'agrupado' then cardinality(v.linhas) || ' linhas lançadas num título no Consistem pelo Neo Admin: lançamento '
                        else 'Compra lançada no Consistem pelo Neo Admin: lançamento ' end
            || v_cod || ' (R$ ' || translate(to_char(v.valor, 'FM999,999,990.00'), ',.', '.,') || ')'
            || case when v.tipo = 'compra' and v.parcelas > 1 then ', parcela ' || v.parcela || '/' || v.parcelas else '' end,
            coalesce(p_usuario, v.criado_por));
  end if;
end $$;
revoke all on function crt_marcar_encargos_lancados(uuid, text, jsonb, uuid, text) from public, anon, authenticated;

-- Estabelecimento "99" (a fatura do Sicredi traz só "99"): mesmos códigos da Uber.
insert into crt_estabelecimentos (padrao, categoria, conta_fluxo, ativo, lancamento_erp)
select '99', 'Transporte e aplicativos', null, true, lancamento_erp from crt_estabelecimentos where padrao = 'UBER'
on conflict (padrao) do nothing;
