-- =========================================================
-- Neo Admin — 0106 Confirmação de pagamento (Etapa 1c)
-- A rotina que existe no ClickUp (skill confirmacoes-pagamento) passa a ter o resultado dentro do Neo Admin:
-- contatar os clientes de maior valor 3–4 dias antes do vencimento e confirmar a programação do pagamento.
-- 1) Configuração do valor mínimo por cliente (soma das parcelas da janela).
-- 2) rec_registrar_confirmacao(): grava o resultado do contato numa transação. SECURITY INVOKER: a RLS de quem chama vale.
--    'confirmou'    -> parcelas passam a `confirmado_cliente`, interação registrada, pendência "Confirmar pagamento" concluída.
--    'sem_resposta' -> parcelas continuam como estão, interação registrada, pendência concluída e abre
--                      "Ligar para confirmar pagamento" (contato telefônico, D-1 da régua).
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.recebiveis.confirmacao_valor_minimo', '25000', 'Valor mínimo (R$), somando as parcelas do cliente que vencem nos próximos 7 dias, para abrir a pendência "Confirmar pagamento".')
on conflict (chave) do nothing;

create function rec_registrar_confirmacao(p_titulos uuid[], p_resultado text, p_canal canal default 'whatsapp', p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_qtd int;
  v_clientes int;
  v_cliente uuid;
  v_nome text;
  v_venc date;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atualizados int;
  v_concluidas int := 0;
  v_ligar int := 0;
  v_titulo_ligar text;
begin
  if p_resultado not in ('confirmou', 'sem_resposta') then
    raise exception 'Resultado inválido.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos uma parcela.';
  end if;

  select count(*), count(distinct contraparte_id), min(contraparte_id::text)::uuid, min(vencimento)
    into v_qtd, v_clientes, v_cliente, v_venc
    from rec_titulos
   where id = any(v_ids) and estagio in ('importado', 'aguardando_boleto', 'boleto_enviado');
  if v_qtd <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já foi confirmada, paga ou encerrada (ou você não tem acesso a ela).';
  end if;
  if v_clientes <> 1 then
    raise exception 'As parcelas precisam ser do mesmo cliente.';
  end if;
  select nome into v_nome from contrapartes where id = v_cliente;

  if p_resultado = 'confirmou' then
    update rec_titulos set estagio = 'confirmado_cliente'
     where id = any(v_ids) and estagio in ('importado', 'aguardando_boleto', 'boleto_enviado');
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar esta confirmação (é preciso ser operador do Financeiro).';
    end if;
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, p_canal,
         case when p_resultado = 'confirmou' then 'confirmacao' else 'sem_resposta_confirmacao' end,
         p_descricao, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  -- A tentativa de contato foi feita: a pendência de confirmação acaba (a de ligação, se for o caso, nasce abaixo).
  update pendencias set status = 'concluida'
   where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
     and titulo like 'Confirmar pagamento:%' and status in ('aberta', 'em_andamento');
  get diagnostics v_concluidas = row_count;

  if p_resultado = 'sem_resposta' then
    v_titulo_ligar := 'Ligar para confirmar pagamento: ' || coalesce(nullif(trim(v_nome), ''), 'cliente') || ' — vence ' || to_char(v_venc, 'DD/MM');
    insert into pendencias (modulo, contraparte_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    select 'financeiro.recebiveis', v_cliente, v_titulo_ligar,
           'O cliente não respondeu à confirmação por mensagem. Ligue para confirmar a programação do pagamento e registre o resultado na ficha.',
           v_hoje, 'alta', 'contrapartes', v_cliente, '/financeiro/recebiveis/confirmar/' || v_cliente
     where not exists (
       select 1 from pendencias
        where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
          and titulo = v_titulo_ligar and status in ('aberta', 'em_andamento'));
    get diagnostics v_ligar = row_count;
  end if;

  return jsonb_build_object('parcelas', cardinality(v_ids), 'pendencias_concluidas', v_concluidas, 'pendencia_ligar', v_ligar);
end $$;

revoke all on function rec_registrar_confirmacao(uuid[], text, canal, text) from public, anon;
grant execute on function rec_registrar_confirmacao(uuid[], text, canal, text) to authenticated;
