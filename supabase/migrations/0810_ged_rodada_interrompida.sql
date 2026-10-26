-- =========================================================
-- Neo Admin — 0810 GED: recuperação segura de rodada interrompida (correção da 0806)
--
-- Posse da trava (ged_trava, uma linha) = direito de gravar e de concluir. As três funções da rodada travam essa linha, sempre
-- antes da linha da rodada (mesma ordem em todas: sem impasse entre elas):
--  - ged_iniciar_indexacao (`for update`): quem chega junto espera; trava válida (< 15 min) = ged:em_andamento, sem mexer em nada;
--    trava esquecida = a rodada dona, se ainda aberta, é encerrada com erro `interrompida` e a nova começa, na mesma transação.
--    Raiz com as 3 últimas rodadas encerradas como `interrompida` nas últimas 24 h = ged:interrupcoes_seguidas (o agendamento não
--    repete sem fim uma rodada que morre sempre; volta a tentar depois de 24 h ou depois de uma rodada que termine).
--  - ged_gravar_indice (`for share`): só a dona grava; a pasta repetida no mesmo lote não derruba mais a gravação.
--  - ged_concluir_indexacao (`for update`): só a dona, ainda aberta, conclui e avança o ponto de continuação; e solta a trava.
-- Uma rodada que perdeu a posse não grava, não conclui e não avança o token. Nada é apagado; documentos e pontos de continuação já
-- gravados não mudam. Mesmas assinaturas e privilégios da 0806; a regra de leitura da 0809 não muda.
-- =========================================================

create or replace function ged_iniciar_indexacao(p_raiz uuid, p_tipo text, p_agendada boolean, p_usuario uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t ged_trava%rowtype;
  v_id uuid;
begin
  if coalesce((select valor = 'true'::jsonb from configuracoes where chave = 'administrativo.ged.indexar'), false) is not true then
    raise exception 'ged:indexacao_desligada';
  end if;
  if not exists (select 1 from ged_pastas_raiz where id = p_raiz and situacao = 'ativa') then
    raise exception 'ged:raiz_inativa';
  end if;
  if p_tipo is null or p_tipo not in ('inicial', 'incremental', 'reconciliacao') then
    raise exception 'ged:tipo_invalido';
  end if;
  if (select count(*) = 3 and bool_and(coalesce(u.erro, '') = 'interrompida')   -- erro nulo (rodada boa) conta como não interrompida
        from (select erro from ged_indexacoes
               where raiz_id = p_raiz and concluida_em is not null and iniciada_em > now() - interval '24 hours'
               order by iniciada_em desc limit 3) u) then
    raise exception 'ged:interrupcoes_seguidas';
  end if;

  select * into t from ged_trava where id = 1 for update;              -- serializa quem chega junto
  if t.tomada_em is not null and t.tomada_em >= now() - interval '15 minutes' then
    raise exception 'ged:em_andamento';
  end if;
  if t.por is not null then                                            -- trava esquecida: a dona morreu no meio
    update ged_indexacoes set concluida_em = now(), erro = 'interrompida' where id = t.por and concluida_em is null;
  end if;

  insert into ged_indexacoes (raiz_id, tipo, agendada, usuario_id) values (p_raiz, p_tipo, coalesce(p_agendada, false), p_usuario)
  returning id into v_id;
  update ged_trava set tomada_em = now(), por = v_id where id = 1;
  return v_id;
end $$;
revoke all on function ged_iniciar_indexacao(uuid, text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function ged_iniciar_indexacao(uuid, text, boolean, uuid) to service_role;

create or replace function ged_gravar_indice(p_indexacao uuid, p_pastas jsonb, p_documentos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_raiz uuid;
  v_pastas int := 0;
  v_docs int := 0;
  v_revisoes int := 0;
  d jsonb;
  v_pasta uuid;
  v_doc uuid;
begin
  -- Só a dona da trava grava. `for share` segura a posse até o fim desta gravação: a recuperação (ged_iniciar_indexacao, `for update`)
  -- espera; e se a recuperação vier antes, esta consulta reavalia e não acha mais a posse.
  perform 1 from ged_trava where id = 1 and por = p_indexacao for share;
  if not found then
    raise exception 'ged:rodada_invalida';
  end if;
  select i.raiz_id into v_raiz from ged_indexacoes i where i.id = p_indexacao and i.concluida_em is null;
  if v_raiz is null then
    raise exception 'ged:rodada_invalida';
  end if;
  -- Um item, uma raiz. Item movido entre raízes só muda de raiz depois que a rodada da outra o marcou fora do escopo ou removido
  -- (até lá esta rodada falha e o token não avança; a seguinte resolve).
  if exists (select 1 from jsonb_array_elements(coalesce(p_pastas, '[]')) p
              join ged_pastas g on g.drive_id = p ->> 'drive_id' where g.raiz_id <> v_raiz and g.situacao = 'ativa')
     or exists (select 1 from jsonb_array_elements(coalesce(p_documentos, '[]')) x
              join ged_documentos g on g.drive_id = x ->> 'drive_id'
             where g.raiz_id <> v_raiz and g.situacao in ('vigente', 'substituido', 'ignorado')) then
    raise exception 'ged:raiz_divergente';
  end if;

  insert into ged_pastas (raiz_id, drive_id, nome, mae_drive_id, profundidade, situacao, web_link, visto_em)
  select v_raiz, p ->> 'drive_id', p ->> 'nome', p ->> 'mae_drive_id', (p ->> 'profundidade')::smallint, p ->> 'situacao',
         p ->> 'web_link', now()
    from (select distinct on (e ->> 'drive_id') e as p                 -- a mesma pasta duas vezes no lote: vale a última
            from jsonb_array_elements(coalesce(p_pastas, '[]')) with ordinality as x(e, n)
           order by e ->> 'drive_id', n desc) u
  on conflict (drive_id) do update
     set raiz_id = excluded.raiz_id, nome = excluded.nome, mae_drive_id = excluded.mae_drive_id, profundidade = excluded.profundidade,
         situacao = excluded.situacao, web_link = coalesce(excluded.web_link, ged_pastas.web_link), visto_em = now();
  get diagnostics v_pastas = row_count;

  for d in select * from jsonb_array_elements(coalesce(p_documentos, '[]')) loop
    select id into v_pasta from ged_pastas where drive_id = d ->> 'pasta_drive_id' and raiz_id = v_raiz;
    if v_pasta is null then
      raise exception 'ged:pasta_ausente';                             -- não deixa documento órfão
    end if;
    insert into ged_documentos (drive_id, pasta_id, raiz_id, nome, nome_normalizado, mime, extensao, tamanho_bytes, md5, drive_revisao,
                                criado_no_drive_em, alterado_no_drive_em, web_link, atalho_para, situacao)
    values (d ->> 'drive_id', v_pasta, v_raiz, d ->> 'nome', d ->> 'nome_normalizado', d ->> 'mime', coalesce(d ->> 'extensao', ''),
            (d ->> 'tamanho_bytes')::bigint, d ->> 'md5', d ->> 'drive_revisao', (d ->> 'criado_no_drive_em')::timestamptz,
            (d ->> 'alterado_no_drive_em')::timestamptz, d ->> 'web_link', d ->> 'atalho_para', d ->> 'situacao')
    on conflict (drive_id) do update
       set raiz_id = excluded.raiz_id, pasta_id = excluded.pasta_id, nome = excluded.nome, nome_normalizado = excluded.nome_normalizado, mime = excluded.mime,
           extensao = excluded.extensao, tamanho_bytes = excluded.tamanho_bytes, md5 = excluded.md5,
           drive_revisao = excluded.drive_revisao, criado_no_drive_em = excluded.criado_no_drive_em,
           alterado_no_drive_em = excluded.alterado_no_drive_em, web_link = excluded.web_link, atalho_para = excluded.atalho_para,
           situacao = case when ged_documentos.situacao = 'substituido' then 'substituido' else excluded.situacao end,
           visto_em = now()
    returning id into v_doc;
    v_docs := v_docs + 1;
    if coalesce((d ->> 'nova_revisao')::boolean, false) and d ->> 'drive_revisao' is not null then
      insert into ged_documento_revisoes (documento_id, drive_revisao, alterado_no_drive_em, tamanho_bytes, md5)
      values (v_doc, d ->> 'drive_revisao', (d ->> 'alterado_no_drive_em')::timestamptz, (d ->> 'tamanho_bytes')::bigint, d ->> 'md5')
      on conflict do nothing;
      if found then v_revisoes := v_revisoes + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('pastas', v_pastas, 'documentos', v_docs, 'revisoes', v_revisoes);
end $$;
revoke all on function ged_gravar_indice(uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function ged_gravar_indice(uuid, jsonb, jsonb) to service_role;

create or replace function ged_concluir_indexacao(p_indexacao uuid, p_resumo jsonb, p_page_token text, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
declare
  i ged_indexacoes%rowtype;
begin
  -- Só a dona da trava conclui (e só ela avança o ponto de continuação). Trava antes da rodada, como nas outras funções.
  perform 1 from ged_trava where id = 1 and por = p_indexacao for update;
  if not found then
    raise exception 'ged:rodada_invalida';
  end if;
  select * into i from ged_indexacoes where id = p_indexacao and concluida_em is null for update;
  if not found then
    raise exception 'ged:rodada_invalida';
  end if;
  if p_erro is not null and p_erro !~ '^[a-z_]+$' then
    raise exception 'ged:codigo_invalido';
  end if;
  update ged_indexacoes set concluida_em = now(), resumo = p_resumo, erro = p_erro where id = p_indexacao;
  if p_erro is null and p_page_token is not null then
    update ged_pastas_raiz
       set page_token = p_page_token,
           indexada_em = case when i.tipo = 'inicial' then now() else indexada_em end,
           reconciliada_em = case when i.tipo = 'reconciliacao' then now() else reconciliada_em end
     where id = i.raiz_id;
  end if;
  update ged_trava set tomada_em = null, por = null where id = 1;
end $$;
revoke all on function ged_concluir_indexacao(uuid, jsonb, text, text) from public, anon, authenticated, service_role;
grant execute on function ged_concluir_indexacao(uuid, jsonb, text, text) to service_role;
