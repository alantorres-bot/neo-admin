-- Cartão de crédito: um título por linha da fatura (decisão do Alan, 21/10/2026, depois do Nubank PF 10/2026).
-- Os títulos agrupados (encargos do mês num título só; várias compras num título) dificultavam a conferência: o cruzamento não os
-- reconhece e, ao reprocessar a fatura, viravam divergência com as linhas de novo "a lançar". A partir daqui:
--   * encargos: um clique cria UM TÍTULO POR LINHA (multa, IOF, juros…), num lote, enviado em ordem;
--   * compras: "Lançar selecionadas" cria um título por linha (pela reserva de compra que já existe);
--   * registrar "Excluído no Consistem" desfaz também a decisão "casar" do lançamento, para as linhas voltarem a lançar.
-- Regras 31 a 36, 52 e 64 de docs/modulos/financeiro-cartao.md.

-- 1) Encargos: um lançamento ativo por LINHA (era um por mês) ----------------------------------------------------------------
drop index if exists uq_crt_lancamentos_erp_ciclo_ativo;
create unique index uq_crt_lancamentos_erp_encargo_linha_ativo on crt_lancamentos_erp (linha_origem)
  where tipo = 'encargos' and situacao in ('reservado', 'enviando', 'lancado') and excluido_no_erp_em is null;

-- 2) Reservar os encargos, um título por linha -------------------------------------------------------------------------------
-- p_titulos: [{ "linha": "<uuid>", "payload": { ...novoLancamentoContaPagar } }, ...] na ordem de envio. Devolve o lote.
-- parcela = posição no lote (ordena o envio e o "Reenviar o que faltou"); parcelas = tamanho do lote.
create function crt_reservar_lancamentos_encargos(p_fatura uuid, p_titulos jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fatura crt_faturas;
  v_situacao crt_situacao_ciclo;
  v_lote uuid := gen_random_uuid();
  v_total int;
  v_item jsonb;
  v_linha crt_fatura_linhas;
  v_comp text;
  v_conflito text;
  v_k int := 0;
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
  if jsonb_typeof(p_titulos) is distinct from 'array' or jsonb_array_length(p_titulos) = 0 then
    raise exception 'Nenhuma linha de encargo para lançar.';
  end if;
  v_total := jsonb_array_length(p_titulos);
  if (select count(distinct x ->> 'linha') from jsonb_array_elements(p_titulos) x) <> v_total then
    raise exception 'A mesma linha apareceu duas vezes.';
  end if;
  for v_item in select value from jsonb_array_elements(p_titulos) loop
    v_k := v_k + 1;
    select * into v_linha from crt_fatura_linhas where id = (v_item ->> 'linha')::uuid and fatura_id = p_fatura and not descartada;
    if v_linha.id is null then
      raise exception 'Uma das linhas não é desta fatura (ou é linha descartada).';
    end if;
    if v_linha.valor <= 0 then
      raise exception 'A linha % não tem valor positivo: estorno não vira título.', v_linha.descricao;
    end if;
    if (v_item -> 'payload' ->> 'valorDocumento')::numeric is distinct from v_linha.valor then
      raise exception 'O título da linha % não tem o valor dela (R$ %).', v_linha.descricao, translate(to_char(v_linha.valor, 'FM999,999,990.00'), ',.', '.,');
    end if;
    v_comp := v_item -> 'payload' ->> 'complementoHistorico';
    if coalesce(length(v_comp), 0) = 0 or length(v_comp) > 70 then
      raise exception 'Complemento vazio ou com mais de 70 caracteres na linha %.', v_linha.descricao;
    end if;
    if coalesce(v_item -> 'payload' ->> 'dataVencimento', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Vencimento inválido na linha %.', v_linha.descricao;
    end if;
    if coalesce(jsonb_typeof(v_item -> 'payload' -> 'codFornecedor'), '') <> 'number' then
      raise exception 'O cartão não tem o fornecedor dos encargos (aba Cartões).';
    end if;
    select l.descricao into v_conflito
      from crt_decisoes d join crt_fatura_linhas l on l.id = any(d.linhas)
     where d.fatura_id = p_fatura and d.desfeito_em is null and d.tipo in ('justificar', 'casar', 'compensar') and l.id = v_linha.id limit 1;
    if v_conflito is not null then
      raise exception 'A linha % já tem decisão (justificar, casar ou compensar): desfaça-a antes de lançar.', v_conflito;
    end if;
    v_conflito := crt_linhas_em_lancamento(array[v_linha.id]);
    if v_conflito is not null then
      raise exception 'A linha % já foi lançada no Consistem.', v_conflito;
    end if;
    begin
      insert into crt_lancamentos_erp (fatura_id, ciclo_id, linhas, valor, complemento, payload, tipo, lote, linha_origem, parcela, parcelas, vencimento)
      values (p_fatura, v_fatura.ciclo_id, array[v_linha.id], v_linha.valor, v_comp, v_item -> 'payload', 'encargos', v_lote, v_linha.id, v_k, v_total,
              (v_item -> 'payload' ->> 'dataVencimento')::date);
    exception when unique_violation then
      raise exception 'O encargo % já foi lançado no Consistem.', v_linha.descricao;
    end;
  end loop;
  return v_lote;
end $$;
revoke all on function crt_reservar_lancamentos_encargos(uuid, jsonb) from public, anon;
grant execute on function crt_reservar_lancamentos_encargos(uuid, jsonb) to authenticated;

-- 3) "Reenviar o que faltou" aceita também o lote de encargos ------------------------------------------------------------------
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
  select fatura_id, tipo into v_fatura, v_tipo from crt_lancamentos_erp
   where lote = p_lote and (tipo in ('compra', 'desdobramento') or (tipo = 'encargos' and linha_origem is not null)) limit 1;
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
     and not exists (select 1 from crt_lancamentos_erp a where a.tipo = l.tipo and a.linha_origem = l.linha_origem
                                                          and (l.tipo = 'encargos' or a.parcela = l.parcela)
                                                          and a.situacao in ('reservado', 'enviando', 'lancado') and a.excluido_no_erp_em is null);
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nada a reenviar neste lote.';
  end if;
  return v_novo;
end $$;
revoke all on function crt_reenviar_lancamentos(uuid) from public, anon;
grant execute on function crt_reenviar_lancamentos(uuid) to authenticated;

-- 4) Registrar a exclusão no Consistem desfaz o "casar" do lançamento (as linhas voltam a lançar) -----------------------------
-- Só com a fatura editável (importada e mês aberto): mês fechado ou pago guarda o que foi decidido.
create or replace function crt_registrar_exclusao_erp(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_lancamentos_erp;
  v_editavel boolean;
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
  select f.status = 'importada' and c.situacao not in ('fechada', 'paga') into v_editavel
    from crt_faturas f left join crt_ciclos c on c.id = f.ciclo_id where f.id = v.fatura_id;
  if coalesce(v_editavel, false) and v.cod_lancamento_erp is not null then
    update crt_decisoes
       set desfeito_por = auth.uid(), desfeito_em = now(),
           motivo_desfazer = left('Título ' || v.cod_lancamento_erp || ' excluído no Consistem: ' || trim(p_motivo), 500)
     where fatura_id = v.fatura_id and tipo = 'casar' and desfeito_em is null and titulos = array[v.cod_lancamento_erp];
  end if;
end $$;
revoke all on function crt_registrar_exclusao_erp(uuid, text) from public, anon;
grant execute on function crt_registrar_exclusao_erp(uuid, text) to authenticated;
