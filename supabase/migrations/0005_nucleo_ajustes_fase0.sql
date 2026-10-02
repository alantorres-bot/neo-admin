-- =========================================================
-- Neo Admin — 0005 NÚCLEO: AJUSTES DA REVISÃO DA FASE 0
--  1. Troca obrigatória de senha no primeiro acesso (perfis.deve_trocar_senha)
--  2. Segregação: quem criou a mensagem não a aprova (admin_geral isento, com auditoria)
--  3. modelos_mensagem: escrita só para gestor da área ou acima
-- =========================================================

-- 1. TROCA OBRIGATÓRIA DE SENHA ---------------------------------
alter table perfis add column deve_trocar_senha boolean not null default false;

-- Enquanto deve_trocar_senha = true o usuário não acessa nenhum dado (nem pela API): só lê o
-- próprio perfil e as próprias permissões, o suficiente para o app levá-lo a /conta.
create or replace function eh_admin_geral() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and admin_geral and ativo and not deve_trocar_senha);
$$;

create or replace function nivel_area(p_area text) returns nivel_acesso
language sql stable security definer set search_path = public as $$
  select case when eh_admin_geral() then 'administrador'::nivel_acesso
    else coalesce((select pe.nivel from permissoes pe join perfis p on p.id = pe.perfil_id
                   where pe.perfil_id = auth.uid() and pe.area = p_area
                     and p.ativo and not p.deve_trocar_senha), 'sem_acesso') end;
$$;

create or replace function usuario_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and ativo and not deve_trocar_senha);
$$;

create or replace function tem_acesso_alguma_area(p_minimo nivel_acesso default 'consulta') returns boolean
language sql stable security definer set search_path = public as $$
  select eh_admin_geral()
      or exists (select 1 from permissoes pe join perfis p on p.id = pe.perfil_id
                 where pe.perfil_id = auth.uid() and p.ativo and not p.deve_trocar_senha and pe.nivel >= p_minimo);
$$;

-- Usuário criado pelo admin chega com app_metadata.deve_trocar_senha = true (só a service role
-- grava app_metadata; o usuário não consegue alterar). O primeiro usuário, criado no painel, não é forçado.
create or replace function fn_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_primeiro boolean;
begin
  perform pg_advisory_xact_lock(hashtext('neo_admin.primeiro_usuario'));
  v_primeiro := not exists (select 1 from perfis);

  insert into perfis (id, nome, email, admin_geral, deve_trocar_senha)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(coalesce(new.email, ''), '@', 1), 'Usuário'),
    coalesce(new.email, ''),
    v_primeiro,
    not v_primeiro and coalesce((new.raw_app_meta_data ->> 'deve_trocar_senha')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Trocou a senha no Auth (pelo próprio usuário): libera. Não dá para o usuário se liberar sem trocar,
-- porque a única coisa que limpa o campo é a mudança real da senha.
create function fn_senha_trocada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update perfis set deve_trocar_senha = false where id = new.id and deve_trocar_senha;
  return new;
end $$;

create trigger trg_auth_senha_trocada after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function fn_senha_trocada();

-- 2. SEGREGAÇÃO NA APROVAÇÃO DE MENSAGENS -----------------------
-- criado_por é nulo em mensagens geradas pela régua (service role): essas não entram na regra.
alter table mensagens add column criado_por uuid references perfis(id) default auth.uid();

-- Recriada como security definer para poder gravar a exceção em `auditoria`
-- (o usuário não tem permissão de escrita nela).
create or replace function fn_mensagens_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;                                   -- Edge Function / cron: livre
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('rascunho', 'aguardando_aprovacao') then
      raise exception 'Mensagem nova só pode ser criada como rascunho ou aguardando aprovação.';
    end if;
    new.criado_por := auth.uid();
    new.aprovado_por := null; new.aprovado_em := null;
    new.enviado_em := null;   new.id_externo := null; new.erro := null;
    return new;
  end if;

  -- UPDATE por usuário
  if new.status in ('enviada', 'falhou', 'respondida') then
    raise exception 'Os status enviada, falhou e respondida só são gravados pela função de envio.';
  end if;
  if old.status in ('enviada', 'falhou', 'respondida', 'descartada') then
    raise exception 'Mensagem com status % não pode mais ser alterada.', old.status;
  end if;

  new.modulo := old.modulo;       new.criado_em := old.criado_em;   new.criado_por := old.criado_por;
  new.enviado_em := old.enviado_em; new.id_externo := old.id_externo; new.erro := old.erro;

  if old.status = 'aprovada' then
    if new.status not in ('aprovada', 'descartada') then
      raise exception 'Mensagem aprovada só pode ser descartada.';
    end if;
    if new.assunto is distinct from old.assunto or new.corpo is distinct from old.corpo
       or new.destinatario is distinct from old.destinatario or new.canal is distinct from old.canal
       or new.contato_id is distinct from old.contato_id or new.contraparte_id is distinct from old.contraparte_id then
      raise exception 'Mensagem aprovada não pode ter o conteúdo alterado.';
    end if;
  end if;

  if new.status = 'aprovada' and old.status <> 'aprovada' then
    if not tem_acesso_modulo(new.modulo, 'gestor') then
      raise exception 'Somente o gestor da área aprova mensagens.';
    end if;
    if old.criado_por is not null and old.criado_por = auth.uid() then
      if not eh_admin_geral() then
        raise exception 'Quem criou a mensagem não pode aprovar a própria. Peça a outro gestor.';
      end if;
      -- admin_geral é isento, mas a exceção fica registrada
      insert into auditoria (tabela, registro_id, acao, depois)
      values ('mensagens', new.id, 'APROVACAO_PROPRIA_ISENTA',
              jsonb_build_object('modulo', new.modulo, 'criado_por', old.criado_por, 'aprovado_por', auth.uid(),
                                 'motivo', 'admin_geral isento da segregação de funções'));
    end if;
    new.aprovado_por := auth.uid();
    new.aprovado_em := now();
  else
    new.aprovado_por := old.aprovado_por;
    new.aprovado_em := old.aprovado_em;
  end if;
  return new;
end $$;

-- 3. MODELOS DE MENSAGEM: ESCRITA SÓ PARA GESTOR ----------------
drop policy modelos_mensagem_inserir on modelos_mensagem;
drop policy modelos_mensagem_alterar on modelos_mensagem;
create policy modelos_mensagem_inserir on modelos_mensagem for insert to authenticated
  with check (tem_acesso_modulo(modulo, 'gestor'));
create policy modelos_mensagem_alterar on modelos_mensagem for update to authenticated
  using (tem_acesso_modulo(modulo, 'gestor')) with check (tem_acesso_modulo(modulo, 'gestor'));
