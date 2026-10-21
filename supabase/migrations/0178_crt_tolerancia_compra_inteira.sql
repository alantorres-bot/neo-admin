-- Cartão de crédito: tolerância maior entre a NF lançada pelo total e N × parcela (decisão do Alan, 21/10/2026): até 10 centavos por
-- parcela + 5 (era 1 centavo por parcela + 5). Caso real: EC*PICHAU no PicPay PF 10/2026, 12 × R$ 571,98 = R$ 6.863,76 × NF de
-- R$ 6.862,88 (R$ 0,88). O painel só desdobra com UM título candidato. Mesma função de 0177, só muda a conferência do valor.

create or replace function crt_reservar_desdobramento(p_fatura uuid, p_linha uuid, p_cod text, p_titulo jsonb, p_antes jsonb, p_alteracao jsonb, p_parcelas jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fatura crt_faturas;
  v_situacao crt_situacao_ciclo;
  v_linha crt_fatura_linhas;
  v_n int;
  v_kl int;                -- parcela da linha (k)
  v_primeira int;          -- primeira parcela criada como título novo
  v_valor_original numeric; -- o que fica no título original
  v_original numeric;
  v_soma numeric;
  v_conflito text;
  v_lote uuid := gen_random_uuid();
  v_id uuid;
  v_item jsonb;
  v_k int;
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
  v_kl := coalesce(v_linha.parcela_num, 1);
  if coalesce(v_n, 1) < 2 or v_n > 48 or v_kl < 1 or v_kl > v_n or v_linha.valor <= 0 then
    raise exception 'Só se desdobra a partir da linha de uma compra parcelada.';
  end if;
  v_primeira := case when v_kl = 1 then 2 else v_kl end;
  v_valor_original := case when v_kl = 1 then v_linha.valor else (v_kl - 1) * v_linha.valor end;
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
  if v_original is null or abs(v_original - v_n * v_linha.valor) > (v_n * 10 + 5) / 100.0 then
    raise exception 'O título (R$ %) não é a compra inteira (% × R$ %).', translate(to_char(v_original, 'FM999,999,990.00'), ',.', '.,'), v_n,
      translate(to_char(v_linha.valor, 'FM999,999,990.00'), ',.', '.,');
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p_alteracao) k) is distinct from array['codDocumento', 'complementoHistorico', 'valorDocumento'] then
    raise exception 'A alteração do título leva só o valor, o documento e o complemento.';
  end if;
  v_comp := p_alteracao ->> 'complementoHistorico';
  if (p_alteracao ->> 'valorDocumento')::numeric is distinct from v_valor_original or coalesce(length(v_comp), 0) = 0 or length(v_comp) > 70
     or coalesce(length(trim(p_alteracao ->> 'codDocumento')), 0) = 0 or length(p_alteracao ->> 'codDocumento') > 30 then
    raise exception 'A alteração do título original é inválida (valor de R$ % — %; documento e complemento).',
      translate(to_char(v_valor_original, 'FM999,999,990.00'), ',.', '.,'), case when v_kl = 1 then 'a parcela 1' else 'as parcelas já pagas 1 a ' || (v_kl - 1) end;
  end if;
  if jsonb_typeof(p_parcelas) <> 'array' or jsonb_array_length(p_parcelas) <> v_n - v_primeira + 1 then
    raise exception 'Informe as parcelas % a %.', v_primeira, v_n;
  end if;
  v_soma := v_valor_original;
  v_k := v_primeira;
  for v_item in select value from jsonb_array_elements(p_parcelas) loop
    v_valor := (v_item -> 'payload' ->> 'valorDocumento')::numeric;
    v_comp := v_item -> 'payload' ->> 'complementoHistorico';
    if (v_item ->> 'parcela')::int is distinct from v_k then
      raise exception 'As parcelas precisam vir em ordem, a partir da %.', v_primeira;
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

  insert into crt_desdobramentos (fatura_id, ciclo_id, linha_id, cod_lancamento, num_documento, fornecedor, parcelas, parcela_inicial, valor_original, valor_parcela, alteracao, antes, lote)
  values (p_fatura, v_fatura.ciclo_id, p_linha, trim(p_cod), left(p_titulo ->> 'num_documento', 60), left(p_titulo ->> 'fornecedor', 120), v_n, v_kl, v_original,
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
