-- =========================================================
-- Neo Admin — 0153 Gmail por usuário + kit enviado ao cliente (Faturamento Filial, Fase C)
-- O e-mail ao cliente (nota fatura, demonstrativo, comodato e boleto) sai do Gmail de QUEM o prepara (ex.: a Melina, da
-- filial), e não da caixa do financeiro. Cada pessoa autoriza o próprio Gmail uma vez (escopo gmail.compose: só cria
-- rascunho; quem envia é a pessoa, no Gmail).
--  - gmail_contas: conta conectada por usuário (e-mail e id do segredo no Vault). O refresh token NUNCA fica em tabela:
--    vai para o Vault (vault.secrets, cifrado). O usuário só vê a própria linha (e-mail e datas).
--  - gmail_conexoes: "state" do OAuth (anti-CSRF), válido por 15 minutos e de uso único.
--  - Funções só da service role (Edge Function nucleo-gmail-conectar e rascunhos): gmail_validar_conexao,
--    gmail_concluir_conexao (confere que a conta do Google é a do usuário), gmail_refresh_token.
--  - gmail_iniciar_conexao (usuário logado) e gmail_desconectar (o próprio usuário).
--  - rec_kit_marcar_enviado: depois que a pessoa envia o e-mail pelo Gmail, marca o kit como enviado e as parcelas como
--    boleto enviado (como rec_marcar_boleto_enviado), com histórico; o título segue para a régua normal da Cobrança.
--  - financeiro.filial.copia_cliente: cópia interna do e-mail ao cliente (a filial já copia admcuiaba@).
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.filial.copia_cliente', '["admcuiaba@neoformas.com.br"]', 'Cópia (Cc) do e-mail da filial ao cliente com a nota fatura, o demonstrativo, o comodato e o boleto.')
on conflict (chave) do nothing;

-- 1) Contas e conexões ---------------------------------------------------------------------------------------------------
create table gmail_contas (
  perfil_id uuid primary key references perfis(id),
  email text not null,
  segredo_id uuid not null,               -- vault.secrets.id (refresh token cifrado)
  conectado_em timestamptz not null default now(),
  desconectado_em timestamptz
);
alter table gmail_contas enable row level security;
create policy gmail_contas_ler_propria on gmail_contas for select to authenticated using (perfil_id = auth.uid());
-- Sem insert/update/delete para usuários: só as funções abaixo (service role) gravam.
revoke insert, update, delete on gmail_contas from authenticated, anon;

create table gmail_conexoes (
  state text primary key,
  perfil_id uuid not null references perfis(id),
  destino text not null,                  -- para onde o navegador volta (página do Neo Admin)
  criado_em timestamptz not null default now(),
  usado_em timestamptz
);
alter table gmail_conexoes enable row level security;  -- sem políticas: só as funções (security definer) mexem
revoke all on gmail_conexoes from authenticated, anon;

-- O usuário logado começa a conexão: gera o state e guarda para onde voltar.
create function gmail_iniciar_conexao(p_destino text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_state text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null or not acesso_liberado(auth.uid()) then
    raise exception 'Entre no Neo Admin para conectar o Gmail.';
  end if;
  if p_destino is null or p_destino !~ '^https?://[^/]+/' then
    raise exception 'Destino inválido.';
  end if;
  delete from gmail_conexoes where criado_em < now() - interval '1 day';
  insert into gmail_conexoes (state, perfil_id, destino) values (v_state, auth.uid(), p_destino);
  return v_state;
end $$;
revoke all on function gmail_iniciar_conexao(text) from public, anon;
grant execute on function gmail_iniciar_conexao(text) to authenticated;

-- Edge Function, ao receber o usuário de volta do Google (antes de trocar o código): o state existe, não venceu e não foi usado.
create function gmail_validar_conexao(p_state text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('perfil_id', c.perfil_id, 'email', p.email, 'destino', c.destino)
    from gmail_conexoes c join perfis p on p.id = c.perfil_id
   where c.state = p_state and c.usado_em is null and c.criado_em > now() - interval '15 minutes' and p.ativo;
$$;
revoke all on function gmail_validar_conexao(text) from public, anon, authenticated;
grant execute on function gmail_validar_conexao(text) to service_role;

-- Edge Function, depois de trocar o código: grava o refresh token no Vault (a conta do Google tem de ser a do usuário).
create function gmail_concluir_conexao(p_state text, p_email text, p_refresh_token text) returns text
language plpgsql security definer set search_path = public as $$
declare
  c gmail_conexoes%rowtype;
  v_email_perfil text;
  v_segredo uuid;
begin
  select * into c from gmail_conexoes where state = p_state for update;
  if not found or c.usado_em is not null or c.criado_em < now() - interval '15 minutes' then
    raise exception 'A autorização expirou. Clique de novo em "Conectar meu Gmail".';
  end if;
  update gmail_conexoes set usado_em = now() where state = p_state;
  select email into v_email_perfil from perfis where id = c.perfil_id and ativo;
  if v_email_perfil is null or lower(btrim(p_email)) <> lower(btrim(v_email_perfil)) then
    raise exception 'Autorize com a sua própria conta (%), não com outra.', v_email_perfil;
  end if;
  if coalesce(p_refresh_token, '') = '' then
    raise exception 'O Google não devolveu a autorização permanente. Tente de novo.';
  end if;

  select segredo_id into v_segredo from gmail_contas where perfil_id = c.perfil_id;
  if v_segredo is not null and exists (select 1 from vault.secrets where id = v_segredo) then
    perform vault.update_secret(v_segredo, p_refresh_token);
  else
    v_segredo := vault.create_secret(p_refresh_token, 'gmail_refresh_' || c.perfil_id::text, 'Refresh token do Gmail (gmail.compose) de ' || v_email_perfil);
  end if;
  insert into gmail_contas (perfil_id, email, segredo_id, conectado_em, desconectado_em)
  values (c.perfil_id, lower(btrim(p_email)), v_segredo, now(), null)
  on conflict (perfil_id) do update set email = excluded.email, segredo_id = excluded.segredo_id, conectado_em = now(), desconectado_em = null;
  return c.destino;
end $$;
revoke all on function gmail_concluir_conexao(text, text, text) from public, anon, authenticated;
grant execute on function gmail_concluir_conexao(text, text, text) to service_role;

-- Edge Function de rascunho: e-mail e refresh token do usuário (nulo = não conectado).
create function gmail_refresh_token(p_perfil uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return (select jsonb_build_object('email', g.email, 'refresh_token', s.decrypted_secret)
            from gmail_contas g join vault.decrypted_secrets s on s.id = g.segredo_id
           where g.perfil_id = p_perfil and g.desconectado_em is null);
end $$;
revoke all on function gmail_refresh_token(uuid) from public, anon, authenticated;
grant execute on function gmail_refresh_token(uuid) to service_role;

-- O próprio usuário desconecta: apaga o segredo do Vault e marca a conta.
create function gmail_desconectar() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_segredo uuid;
begin
  if auth.uid() is null then
    raise exception 'Entre no Neo Admin.';
  end if;
  select segredo_id into v_segredo from gmail_contas where perfil_id = auth.uid() and desconectado_em is null;
  if v_segredo is null then
    return;
  end if;
  delete from vault.secrets where id = v_segredo;
  update gmail_contas set desconectado_em = now() where perfil_id = auth.uid();
end $$;
revoke all on function gmail_desconectar() from public, anon;
grant execute on function gmail_desconectar() to authenticated;

-- 2) Kit enviado ao cliente ---------------------------------------------------------------------------------------------
-- Chamado depois que a pessoa enviou o e-mail pelo Gmail. Marca o kit (enviada) e as parcelas de boleto (boleto enviado,
-- histórico, pendências "Anexar boleto" concluídas), como rec_marcar_boleto_enviado — que exige a área Financeiro, e o
-- usuário da filial só tem o módulo. Security definer, com a checagem do módulo no início.
create function rec_kit_marcar_enviado(p_kit uuid, p_mensagem uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k rec_kits%rowtype;
  v_ids uuid[];
  v_n int := 0;
begin
  if not tem_acesso_modulo('financeiro.filial', 'operador') then
    raise exception 'Somente operador do Faturamento Filial marca o envio.';
  end if;
  select * into k from rec_kits where id = p_kit for update;
  if not found then
    raise exception 'Kit não encontrado.';
  end if;
  if k.estagio <> 'pronta' then
    raise exception 'O kit da NF % não está pronto para envio (está %).', k.nota_fiscal, k.estagio;
  end if;

  select array_agg(t.id) into v_ids
    from rec_kit_titulos kt join rec_titulos t on t.id = kt.titulo_id
   where kt.kit_id = p_kit and t.forma_pagamento is distinct from 'transferencia'
     and t.estagio in ('aguardando_boleto', 'importado', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  if v_ids is not null then
    update rec_titulos
       set estagio = case when estagio in ('aguardando_boleto', 'importado') then 'boleto_enviado'::rec_estagio else estagio end,
           boleto_enviado_em = now()
     where id = any(v_ids);
    get diagnostics v_n = row_count;
    insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
    select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, 'email'::canal, 'boleto_enviado',
           format('Kit da NF %s (nota fatura, demonstrativo, comodato e boleto) enviado ao cliente pela filial.', k.nota_fiscal), auth.uid()
      from rec_titulos t where t.id = any(v_ids);
    perform rec_concluir_pendencias_anexar_boleto(v_ids);
  end if;

  perform set_config('neo.rec_kit_estagio', 'on', true);
  update rec_kits set estagio = 'enviada', enviado_em = now(), enviado_por = auth.uid() where id = p_kit;
  perform set_config('neo.rec_kit_estagio', '', true);
  update pendencias set status = 'concluida'
   where modulo = 'financeiro.filial' and referencia_tabela = 'rec_kits' and referencia_id = p_kit
     and titulo like 'Enviar kit ao cliente%' and status in ('aberta', 'em_andamento');
  return jsonb_build_object('parcelas', v_n);
end $$;
revoke all on function rec_kit_marcar_enviado(uuid, uuid) from public, anon;
grant execute on function rec_kit_marcar_enviado(uuid, uuid) to authenticated;
