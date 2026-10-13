-- =========================================================
-- Neo Admin — 0154 Cartão de crédito: "Fechar o mês" cria o título PROVISÓRIO da fatura no Consistem
-- Especificação: docs/modulos/financeiro-cartao.md (seção 5, regra 54).
--
-- Pedido do Alan (13/10/2026): ao fechar o mês, o painel lança o provisório no valor da fatura contra o banco emissor (o
-- financeiro fazia à mão; depois da baixa do borderô ele é excluído e o mês vira "Paga" — gatilho fn_crt_provisorio_baixado).
-- Padrão dos provisórios reais (33392 Sicredi PF, 33360 Inter PJ): fornecedor = banco, histórico 1, categoria 17, portador 91,
-- documento = vencimento DDMMAA, emissão no dia do lançamento. Complemento "FATURA CARTÃO <NOME> MM/AAAA" (decisão do Alan).
-- Conta de fluxo e contas contábeis do provisório: os reais já foram excluídos do Consistem (não dá para ler) — a configuração
-- nasce sem elas e o envio é recusado até o Alan informá-las (regra 7: não inventar).
-- Decisão do Alan: se o Consistem recusar ou não responder, o mês fecha mesmo assim; fica a pendência "Criar o provisório".
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.cartao.provisorio', '{"codHistorico": 1, "categoriaDoc": 17, "codPortador": 91}',
   'Cartão de crédito: códigos do título provisório da fatura criado no fechamento (fornecedor = banco do cartão). Faltam grupoContaFluxoCaixa, contaFluxoCaixa, contaContabilDebito e contaContabilCredito.')
on conflict (chave) do nothing;

-- 1) Tipo 'provisorio' em crt_lancamentos_erp ------------------------------------------------------------------------------
alter table crt_lancamentos_erp drop constraint crt_lancamentos_erp_tipo_check;
alter table crt_lancamentos_erp add constraint crt_lancamentos_erp_tipo_check check (tipo in ('encargos', 'compra', 'agrupado', 'provisorio'));
alter table crt_lancamentos_erp drop constraint crt_lancamentos_erp_compra_ck;
alter table crt_lancamentos_erp add constraint crt_lancamentos_erp_compra_ck check (
  tipo = 'encargos'
  or (tipo = 'compra' and linha_origem is not null and parcela is not null and parcelas is not null and parcela <= parcelas and vencimento is not null)
  or (tipo = 'agrupado' and linha_origem is null and cardinality(linhas) >= 2 and vencimento is not null)
  or (tipo = 'provisorio' and linha_origem is null and cardinality(linhas) = 0 and vencimento is not null));
create unique index uq_crt_lancamentos_erp_provisorio_ativo on crt_lancamentos_erp (ciclo_id)
  where tipo = 'provisorio' and situacao in ('reservado', 'enviando', 'lancado');

-- 2) Reservar o provisório (gestor), com o mês já fechado ------------------------------------------------------------------
create function crt_reservar_provisorio(p_ciclo uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo crt_ciclos;
  v_total numeric;
  v_ativo text;
  v_lote uuid := gen_random_uuid();
  v_venc text := p_payload ->> 'dataVencimento';
  v_comp text := p_payload ->> 'complementoHistorico';
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'gestor') then
    raise exception 'Somente gestor do Financeiro (ou acima) cria o provisório da fatura.';
  end if;
  if not crt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (Configurações: financeiro.cartao.lancar_no_erp).';
  end if;
  select * into v_ciclo from crt_ciclos where id = p_ciclo for update;
  if v_ciclo.id is null or v_ciclo.situacao <> 'fechada' then
    raise exception 'O provisório é criado com o mês fechado (e ainda não pago).';
  end if;
  if v_ciclo.provisorio_cod_lancamento is not null then
    raise exception 'Este mês já tem provisório no Consistem (%).', v_ciclo.provisorio_cod_lancamento;
  end if;
  select coalesce(cod_lancamento_erp, situacao::text) into v_ativo
    from crt_lancamentos_erp where ciclo_id = p_ciclo and tipo = 'provisorio' and situacao in ('reservado', 'enviando', 'lancado') limit 1;
  if v_ativo is not null then
    raise exception 'O provisório deste mês já foi enviado (%): confira na lista de lançamentos.', v_ativo;
  end if;
  select total_informado into v_total from crt_faturas where id = v_ciclo.fatura_id;
  if (p_payload ->> 'valorDocumento')::numeric is distinct from v_total then
    raise exception 'O valor do provisório tem de ser o total da fatura (R$ %).', translate(to_char(v_total, 'FM999,999,990.00'), ',.', '.,');
  end if;
  if coalesce(jsonb_typeof(p_payload -> 'codFornecedor'), '') <> 'number' then
    raise exception 'O cartão não tem o fornecedor do banco emissor (códigos de encargos do cartão).';
  end if;
  if v_venc is null or v_venc !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(length(v_comp), 0) = 0 or length(v_comp) > 70 then
    raise exception 'Vencimento ou complemento do provisório inválido.';
  end if;
  insert into crt_lancamentos_erp (fatura_id, ciclo_id, linhas, valor, complemento, payload, tipo, lote, parcela, parcelas, vencimento)
  values (v_ciclo.fatura_id, p_ciclo, '{}', v_total, v_comp, p_payload, 'provisorio', v_lote, 1, 1, v_venc::date);
  return v_lote;
end $$;
revoke all on function crt_reservar_provisorio(uuid, jsonb) from public, anon;
grant execute on function crt_reservar_provisorio(uuid, jsonb) to authenticated;

-- Pendência "Criar o provisório" (o fechamento aconteceu sem provisório). Gestor.
create function crt_pendencia_provisorio(p_ciclo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo crt_ciclos;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'gestor') then
    raise exception 'Somente gestor do Financeiro (ou acima).';
  end if;
  select * into v_ciclo from crt_ciclos where id = p_ciclo;
  if v_ciclo.id is null or v_ciclo.situacao <> 'fechada' or v_ciclo.provisorio_cod_lancamento is not null then
    return;
  end if;
  perform crt_abrir_pendencia(v_ciclo, 'Criar o provisório da fatura ' || crt_rotulo_ciclo(v_ciclo),
    left('O mês foi fechado sem o título provisório no Consistem: ' || coalesce(nullif(trim(p_motivo), ''), 'motivo não informado') || '. Abra o mês e use "Criar provisório no Consistem".', 500),
    v_ciclo.vencimento_nominal);
end $$;
revoke all on function crt_pendencia_provisorio(uuid, text) from public, anon;
grant execute on function crt_pendencia_provisorio(uuid, text) to authenticated;

-- 3) Lançado: o provisório vira o vigiado do mês (gatilho de "Paga") e a pendência é concluída ---------------------------
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
  if v.tipo = 'provisorio' then
    update crt_ciclos set provisorio_cod_lancamento = v_cod where id = v.ciclo_id and provisorio_cod_lancamento is null;
    perform crt_encerrar_pendencias(v.ciclo_id, 'Criar o provisório', 'concluida');
    return;
  end if;
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

-- 4) Resolver à mão: o provisório é do mês fechado (crt_fatura_editavel recusaria). -------------------------------------
create or replace function crt_resolver_lancamento_encargos(p_id uuid, p_cod text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_lancamentos_erp;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) resolve lançamentos no Consistem.';
  end if;
  if coalesce(length(trim(p_motivo)), 0) < 3 then
    raise exception 'Informe o que foi conferido no Consistem.';
  end if;
  select * into v from crt_lancamentos_erp where id = p_id for update;
  if v.id is null or v.situacao not in ('reservado', 'enviando') then
    raise exception 'Só um lançamento sem resposta (reservado ou enviando) pode ser resolvido à mão.';
  end if;
  if v.tipo <> 'provisorio' then
    perform crt_fatura_editavel(v.fatura_id);
  end if;
  if coalesce(trim(p_cod), '') <> '' then
    if trim(p_cod) !~ '^\d{1,12}$' then
      raise exception 'Informe o código do lançamento no Consistem (só números).';
    end if;
    if v.situacao = 'reservado' then
      update crt_lancamentos_erp set situacao = 'enviando' where id = p_id;
    end if;
    perform crt_marcar_encargos_lancados(p_id, trim(p_cod), null, auth.uid(), trim(p_motivo));
  else
    update crt_lancamentos_erp set situacao = 'erro', erro = 'Não foi criado no Consistem (conferido à mão).', concluido_em = now(),
           resolvido_por = auth.uid(), motivo_resolucao = trim(p_motivo)
     where id = p_id;
  end if;
end $$;
