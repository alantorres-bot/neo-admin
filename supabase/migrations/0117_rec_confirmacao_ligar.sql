-- Confirmação de pagamento: quando o cliente CONFIRMA, a pendência "Ligar para confirmar pagamento" (aberta antes por um
-- "sem resposta") também acaba. Antes ela ficava aberta para sempre na Fila do dia. Corpo da função = 0109 + a conclusão da ligação.
create or replace function rec_registrar_confirmacao(p_titulos uuid[], p_resultado text, p_canal canal default 'whatsapp', p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_qtd int;
  v_clientes int;
  v_unidades int;
  v_unidade text;
  v_cliente uuid;
  v_nome text;
  v_venc date;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atualizados int;
  v_concluidas int := 0;
  v_ligacoes_concluidas int := 0;
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

  select count(*), count(distinct contraparte_id), min(contraparte_id::text)::uuid, min(vencimento), count(distinct unidade), min(unidade)
    into v_qtd, v_clientes, v_cliente, v_venc, v_unidades, v_unidade
    from rec_titulos
   where id = any(v_ids) and estagio in ('importado', 'aguardando_boleto', 'boleto_enviado');
  if v_qtd <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já foi confirmada, paga ou encerrada (ou você não tem acesso a ela).';
  end if;
  if v_clientes <> 1 then
    raise exception 'As parcelas precisam ser do mesmo cliente.';
  end if;
  if v_unidades <> 1 then
    raise exception 'As parcelas precisam ser da mesma unidade (Matriz ou Filial Contagem).';
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

  -- A tentativa de contato foi feita: a pendência de confirmação DESTA UNIDADE acaba (a de ligação, se for o caso, nasce abaixo).
  update pendencias set status = 'concluida'
   where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
     and titulo like 'Confirmar pagamento:%' and status in ('aberta', 'em_andamento')
     and (titulo like '%(Filial Contagem)%') = (v_unidade = 'contagem');
  get diagnostics v_concluidas = row_count;

  -- O cliente confirmou: a ligação para confirmar (aberta por um "sem resposta" anterior) também perdeu o sentido.
  if p_resultado = 'confirmou' then
    update pendencias set status = 'concluida'
     where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
       and titulo like 'Ligar para confirmar pagamento:%' and status in ('aberta', 'em_andamento')
       and (titulo like '%(Filial Contagem)%') = (v_unidade = 'contagem');
    get diagnostics v_ligacoes_concluidas = row_count;
    v_concluidas := v_concluidas + v_ligacoes_concluidas;
  end if;

  if p_resultado = 'sem_resposta' then
    v_titulo_ligar := 'Ligar para confirmar pagamento: ' || coalesce(nullif(trim(v_nome), ''), 'cliente')
      || case when v_unidade = 'contagem' then ' (Filial Contagem)' else '' end || ' — vence ' || to_char(v_venc, 'DD/MM');
    insert into pendencias (modulo, contraparte_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    select 'financeiro.recebiveis', v_cliente, v_titulo_ligar,
           'O cliente não respondeu à confirmação por mensagem. Ligue para confirmar a programação do pagamento e registre o resultado na ficha.',
           v_hoje, 'alta', 'contrapartes', v_cliente,
           '/financeiro/recebiveis/confirmar/' || v_cliente || case when v_unidade = 'contagem' then '?unidade=contagem' else '' end
     where not exists (
       select 1 from pendencias
        where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
          and titulo = v_titulo_ligar and status in ('aberta', 'em_andamento'));
    get diagnostics v_ligar = row_count;
  end if;

  return jsonb_build_object('parcelas', cardinality(v_ids), 'pendencias_concluidas', v_concluidas, 'pendencia_ligar', v_ligar);
end $$;
