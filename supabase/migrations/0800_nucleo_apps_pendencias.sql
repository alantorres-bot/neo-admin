-- =========================================================
-- Neo Admin — 0800 NÚCLEO (integrações): PENDÊNCIAS DOS APLICATIVOS EXTERNOS NA CENTRAL DE GESTÃO
-- Especificação: docs/modulos/administrativo-gestao-aplicativos.md (aprovada em 23/10/2026). Faixa 0800–0899 = núcleo
-- estendido (integrações entre sistemas), aberta porque a do núcleo (0001–0099) acabou.
-- A Vigilância Fiscal e o NEOControl expõem uma função só de leitura (neo-admin-pendencias) com um RESUMO por tipo; a Edge
-- Function nucleo-apps-pendencias lê a cada 30 min e publica aqui, pelo contrato do núcleo (publicar_pendencia, 0097/0099).
-- =========================================================

-- 1) Um módulo por aplicativo, inativo no menu (o menu já mostra o aplicativo pelo cadastro `aplicativos`).
insert into modulos (codigo, area, nome, ativo) values
  ('fiscal.vigilancia', 'fiscal', 'Vigilância Fiscal', false),
  ('estoques.neocontrol', 'estoques', 'NEOControl', false)
on conflict (codigo) do nothing;

-- 2) Configuração da leitura no cadastro do aplicativo (Configurações › Aplicativos, só admin_geral pela política existente).
alter table aplicativos
  add column pendencias_ligado boolean not null default false,
  add column pendencias_url text check (pendencias_url ~ '^https://'),
  add column pendencias_modulo text references modulos(codigo),
  add column pendencias_segredo text check (pendencias_segredo ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  add column pendencias_responsaveis jsonb not null default '{}'::jsonb check (jsonb_typeof(pendencias_responsaveis) = 'object');
comment on column aplicativos.pendencias_segredo is 'NOME do segredo da Edge Function com o valor compartilhado (nunca o valor).';
comment on column aplicativos.pendencias_responsaveis is 'Responsável padrão por tipo: {"<codigo do tipo>": "<perfil id>"}.';

update aplicativos set pendencias_modulo = 'fiscal.vigilancia', pendencias_segredo = 'NEO_FISCAL_SEGREDO'
 where codigo = 'vigilancia_fiscal' and pendencias_modulo is null;
update aplicativos set pendencias_modulo = 'estoques.neocontrol', pendencias_segredo = 'NEOCONTROL_SEGREDO'
 where codigo = 'neocontrol' and pendencias_modulo is null;

-- 3) Registro de cada leitura (prova; sem exclusão).
create table apps_pendencias_rodadas (
  id uuid primary key default gen_random_uuid(),
  aplicativo_id uuid not null references aplicativos(id),
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz,
  ok boolean not null default false,
  erro text,
  tipos jsonb not null default '[]'::jsonb,           -- [{codigo, titulo, quantidade}] lidos nesta rodada
  publicadas int not null default 0,
  encerradas int not null default 0,
  origem text not null default 'agendamento' check (origem in ('agendamento', 'manual'))
);
create index apps_pendencias_rodadas_app on apps_pendencias_rodadas (aplicativo_id, iniciado_em desc);
alter table apps_pendencias_rodadas enable row level security;
create policy apps_pendencias_rodadas_ler on apps_pendencias_rodadas for select to authenticated using (eh_admin_geral());
-- Sem política de escrita: só a service role (Edge Function) grava.
create trigger trg_apps_pendencias_rodadas_sem_delete before delete on apps_pendencias_rodadas for each row execute function fn_bloquear_delete();

-- 4) Publicação de uma leitura: publica os tipos com quantidade, encerra (concluída) os do aplicativo que não vieram.
--    p_pendencias = [{chave_origem, titulo, descricao, prazo, prioridade, responsavel_id, precisa_distribuir, link}],
--    montado pela Edge Function (supabase/functions/_shared/apps-pendencias.ts). Só a service role chama.
create function apps_pendencias_publicar(p_aplicativo uuid, p_pendencias jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a aplicativos;
  p jsonb;
  v_chaves text[] := '{}';
  v_publicadas int := 0;
  v_encerradas int;
begin
  select * into a from aplicativos where id = p_aplicativo;
  if a.id is null or a.pendencias_modulo is null then raise exception 'Aplicativo sem módulo de pendências.'; end if;
  if jsonb_typeof(p_pendencias) <> 'array' then raise exception 'Pendências em formato inválido.'; end if;
  for p in select * from jsonb_array_elements(p_pendencias) loop
    if not starts_with(p ->> 'chave_origem', 'app:' || a.codigo || ':') then
      raise exception 'Chave de origem fora do aplicativo: %', p ->> 'chave_origem';
    end if;
    perform publicar_pendencia(p || jsonb_build_object('modulo', a.pendencias_modulo));
    v_chaves := v_chaves || (p ->> 'chave_origem');
    v_publicadas := v_publicadas + 1;
  end loop;
  v_encerradas := encerrar_pendencias_exceto(a.pendencias_modulo, 'app:' || a.codigo || ':', v_chaves, 'concluida');
  return jsonb_build_object('publicadas', v_publicadas, 'encerradas', v_encerradas);
end $$;
revoke all on function apps_pendencias_publicar(uuid, jsonb) from public, anon, authenticated;
grant execute on function apps_pendencias_publicar(uuid, jsonb) to service_role;

-- 5) Agendamento a cada 30 min. URL e segredo do Vault do agendamento de Recebíveis, trocando o nome da função (como 0136).
create function apps_chamar_pendencias() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_segredo text;
  v_req bigint;
begin
  if not exists (select 1 from aplicativos where ativo and pendencias_ligado) then return null; end if;
  select replace(decrypted_secret, 'rec-sincronizar-consistem', 'nucleo-apps-pendencias') into v_url from vault.decrypted_secrets where name = 'rec_sincronizar_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'rec_sincronizar_segredo';
  if v_url is null or v_segredo is null then
    raise warning 'Pendências dos aplicativos sem configuração: faltam rec_sincronizar_url e/ou rec_sincronizar_segredo no Vault.';
    return null;
  end if;
  select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-sincronizacao-segredo', v_segredo),
                       body := '{"acao":"ler"}'::jsonb, timeout_milliseconds := 120000) into v_req;
  return v_req;
end $$;
revoke all on function apps_chamar_pendencias() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('nucleo-apps-pendencias-30min', '*/30 * * * *', 'select public.apps_chamar_pendencias()');
  end if;
end $$;
