-- =========================================================
-- Neo Admin — 0806 GED A1a: tabelas do índice e gravação idempotente (especificação 5.3, 8, 9 e 11.5), SEM indexar
--
--  - ged_pastas, ged_documentos, ged_documento_revisoes: leitura pela RLS com ged_pode_ler_raiz (0804), que já aplica a trava da
--    elaboração, o PENDENTE 14 (operador) e a unidade_restrita. Sem colunas sensíveis: só metadados (5.9.5). Gravação só pelas
--    funções da indexação (service role).
--  - ged_indexacoes: nenhuma leitura direta (tem `erro` e `resumo`, 5.11.10); projeção ged_indexacoes_visiveis() sem eles.
--  - ged_trava: uma rodada por vez (padrão rec_sincronizacao_trava, 0186); ninguém lê.
--  - Interruptor administrativo.ged.indexar começa FALSE: nenhuma rodada começa sem decisão (A1b depende da aprovação da A1a e do
--    PENDENTE 12). Só raiz `ativa` é indexada (5.3.0). O token só avança na conclusão sem erro (5.3.3). Nunca há delete (5.3.2).
--  - Ainda não entram: classificação (tipo, cliente, versão, modelo; funções de decisão), pendências [PENDENTE 15],
--    "Atualizar índice agora" [PENDENTE 16] e ged_tipos_presentes [PENDENTE 19].
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('administrativo.ged.indexar', 'false',
   'Liga a indexação do GED (5.3.7). Desligada até a aprovação da A1a e o tratamento do PENDENTE 12 (permissões do Drive).')
on conflict (chave) do nothing;

-- 1) Tabelas ---------------------------------------------------------------------------------------------------------------
create table ged_pastas (
  id uuid primary key default gen_random_uuid(),
  raiz_id uuid not null references ged_pastas_raiz(id),
  drive_id text not null unique,
  nome text not null,
  mae_drive_id text,
  profundidade smallint not null check (profundidade >= 0),
  funcao text check (funcao in ('modelos', 'trabalho')),            -- só na elaboração; definida por pessoa (fase seguinte)
  funcao_tipo_contrato text,
  funcao_definida_por uuid references perfis(id),
  funcao_definida_em timestamptz,
  situacao text not null default 'ativa' check (situacao in ('ativa', 'removida_no_drive', 'fora_do_escopo')),
  web_link text,
  visto_em timestamptz not null default now()
);
create index idx_ged_pastas_raiz on ged_pastas (raiz_id);

create table ged_documentos (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'drive' check (origem = 'drive'),
  drive_id text not null unique,
  pasta_id uuid not null references ged_pastas(id),
  raiz_id uuid not null references ged_pastas_raiz(id),
  nome text not null,
  nome_normalizado text not null,
  mime text not null,
  extensao text not null default '',
  tamanho_bytes bigint,
  md5 text,
  drive_revisao text,
  criado_no_drive_em timestamptz,
  alterado_no_drive_em timestamptz,
  web_link text,
  atalho_para text,
  situacao text not null default 'vigente'
    check (situacao in ('vigente', 'substituido', 'removido_no_drive', 'fora_do_escopo', 'ignorado')),
  primeiro_visto_em timestamptz not null default now(),
  visto_em timestamptz not null default now()
);
create index idx_ged_documentos_raiz on ged_documentos (raiz_id, situacao);
create index idx_ged_documentos_pasta on ged_documentos (pasta_id);

create table ged_documento_revisoes (
  documento_id uuid not null references ged_documentos(id),
  drive_revisao text not null,
  alterado_no_drive_em timestamptz,
  tamanho_bytes bigint,
  md5 text,
  visto_em timestamptz not null default now(),
  primary key (documento_id, drive_revisao)
);

create table ged_indexacoes (
  id uuid primary key default gen_random_uuid(),
  raiz_id uuid not null references ged_pastas_raiz(id),
  tipo text not null check (tipo in ('inicial', 'incremental', 'reconciliacao')),
  agendada boolean not null default false,
  usuario_id uuid references perfis(id),
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz,
  resumo jsonb,
  erro text check (erro ~ '^[a-z_]+$')                              -- só código (5.11.11): nunca nome, id ou link
);
create index idx_ged_indexacoes_raiz on ged_indexacoes (raiz_id, iniciada_em desc);

create table ged_trava (
  id smallint primary key default 1 check (id = 1),
  tomada_em timestamptz,
  por uuid references ged_indexacoes(id)
);
insert into ged_trava (id) values (1);

-- 2) Proteção: RLS, privilégios, sem delete ----------------------------------------------------------------------------------
alter table ged_pastas enable row level security;
alter table ged_documentos enable row level security;
alter table ged_documento_revisoes enable row level security;
alter table ged_indexacoes enable row level security;                  -- sem políticas: só a projeção e as funções
alter table ged_trava enable row level security;                       -- sem políticas: ninguém lê

revoke all on ged_pastas, ged_documentos, ged_documento_revisoes, ged_indexacoes, ged_trava from anon, authenticated;
grant select on ged_pastas, ged_documentos, ged_documento_revisoes to authenticated;

create policy ged_pastas_ler on ged_pastas for select to authenticated using (ged_pode_ler_raiz(raiz_id));
create policy ged_documentos_ler on ged_documentos for select to authenticated using (ged_pode_ler_raiz(raiz_id));
create policy ged_documento_revisoes_ler on ged_documento_revisoes for select to authenticated
  using (exists (select 1 from ged_documentos d where d.id = documento_id and ged_pode_ler_raiz(d.raiz_id)));

create trigger trg_ged_pastas_sem_delete before delete on ged_pastas for each row execute function fn_bloquear_delete();
create trigger trg_ged_documentos_sem_delete before delete on ged_documentos for each row execute function fn_bloquear_delete();
create trigger trg_ged_documento_revisoes_sem_delete before delete on ged_documento_revisoes for each row execute function fn_bloquear_delete();
create trigger trg_ged_indexacoes_sem_delete before delete on ged_indexacoes for each row execute function fn_bloquear_delete();
create trigger trg_ged_trava_sem_delete before delete on ged_trava for each row execute function fn_bloquear_delete();

-- 3) Projeção das rodadas (seção 9): sem `erro` nem `resumo`; só das raízes que a pessoa lê ------------------------------------
create function ged_indexacoes_visiveis()
returns table (id uuid, raiz_id uuid, tipo text, agendada boolean, iniciada_em timestamptz, concluida_em timestamptz, com_erro boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.raiz_id, i.tipo, i.agendada, i.iniciada_em, i.concluida_em, i.erro is not null
    from ged_indexacoes i
   where ged_pode_ler_raiz(i.raiz_id)
   order by i.iniciada_em desc
   limit 200;
$$;
revoke all on function ged_indexacoes_visiveis() from public, anon, authenticated, service_role;
grant execute on function ged_indexacoes_visiveis() to authenticated;

-- 4) Rodada (Edge Function de indexação, service role) ------------------------------------------------------------------------
-- Abre a rodada: interruptor ligado, raiz ativa e trava livre (ou esquecida há mais de 15 min). Devolve o id da rodada.
create function ged_iniciar_indexacao(p_raiz uuid, p_tipo text, p_agendada boolean, p_usuario uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
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
  insert into ged_indexacoes (raiz_id, tipo, agendada, usuario_id) values (p_raiz, p_tipo, coalesce(p_agendada, false), p_usuario)
  returning id into v_id;
  update ged_trava set tomada_em = now(), por = v_id
   where id = 1 and (tomada_em is null or tomada_em < now() - interval '15 minutes');
  if not found then
    raise exception 'ged:em_andamento';                                -- desfaz a linha da rodada
  end if;
  return v_id;
end $$;

-- Grava um lote do índice (pastas antes dos documentos), idempotente pelo drive_id (5.3.3). Nunca apaga; `substituido` é decisão
-- de pessoa e não é sobrescrito (8.1). Revisão nova só com `nova_revisao`. Devolve contagens (sem nomes).
-- Formato: p_pastas = [{drive_id, nome, mae_drive_id, profundidade, situacao, web_link?}]
--          p_documentos = [{drive_id, pasta_drive_id, nome, nome_normalizado, mime, extensao, tamanho_bytes, md5, drive_revisao,
--                           criado_no_drive_em, alterado_no_drive_em, web_link, atalho_para, situacao, nova_revisao}]
create function ged_gravar_indice(p_indexacao uuid, p_pastas jsonb, p_documentos jsonb) returns jsonb
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
  select i.raiz_id into v_raiz from ged_indexacoes i join ged_trava t on t.por = i.id
   where i.id = p_indexacao and i.concluida_em is null;
  if v_raiz is null then
    raise exception 'ged:rodada_invalida';                             -- só a rodada que tem a trava grava
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
    from jsonb_array_elements(coalesce(p_pastas, '[]')) p
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

-- Fecha a rodada e solta a trava. O token só avança sem erro (5.3.3); erro é só um código.
create function ged_concluir_indexacao(p_indexacao uuid, p_resumo jsonb, p_page_token text, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
declare
  i ged_indexacoes%rowtype;
begin
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
  update ged_trava set tomada_em = null, por = null where id = 1 and por = p_indexacao;
end $$;

-- Estado atual do índice de uma raiz, no formato da camada pura (PastaIndice/DocumentoIndice), numa chamada só (sem o teto de
-- linhas da API). Datas no formato do Drive (UTC com milissegundos), para a comparação não ver mudança onde não há.
create function ged_estado_indice(p_raiz uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pastas', coalesce((select jsonb_agg(jsonb_build_object('driveId', p.drive_id, 'maeDriveId', p.mae_drive_id, 'nome', p.nome,
                                                             'profundidade', p.profundidade, 'situacao', p.situacao))
                          from ged_pastas p where p.raiz_id = p_raiz), '[]'),
    'documentos', coalesce((select jsonb_agg(jsonb_build_object(
                              'driveId', d.drive_id, 'pastaDriveId', p.drive_id, 'nome', d.nome, 'nomeNormalizado', d.nome_normalizado,
                              'extensao', d.extensao, 'mime', d.mime, 'driveRevisao', d.drive_revisao,
                              'criadoNoDriveEm', to_char(d.criado_no_drive_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                              'alteradoNoDriveEm', to_char(d.alterado_no_drive_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                              'tamanhoBytes', d.tamanho_bytes, 'md5', d.md5, 'webLink', d.web_link, 'atalhoPara', d.atalho_para,
                              'situacao', d.situacao))
                              from ged_documentos d join ged_pastas p on p.id = d.pasta_id where d.raiz_id = p_raiz), '[]'));
$$;
revoke all on function ged_estado_indice(uuid) from public, anon, authenticated, service_role;
grant execute on function ged_estado_indice(uuid) to service_role;

revoke all on function ged_iniciar_indexacao(uuid, text, boolean, uuid) from public, anon, authenticated, service_role;
revoke all on function ged_gravar_indice(uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function ged_concluir_indexacao(uuid, jsonb, text, text) from public, anon, authenticated, service_role;
grant execute on function ged_iniciar_indexacao(uuid, text, boolean, uuid) to service_role;
grant execute on function ged_gravar_indice(uuid, jsonb, jsonb) to service_role;
grant execute on function ged_concluir_indexacao(uuid, jsonb, text, text) to service_role;
