-- =========================================================
-- Neo Admin — 0002 NÚCLEO: POLÍTICAS RLS, REGRAS DE TRANSIÇÃO E AUDITORIA
-- Depende de 0001. Todas as políticas são para o papel `authenticated`;
-- `anon` não acessa nada. A service role (Edge Functions, pg_cron) ignora RLS.
-- Convenção usada pelas regras em gatilho: auth.uid() nulo = origem de serviço
-- (service role, pg_cron, migrations); auth.uid() preenchido = usuário logado.
-- =========================================================

-- 1. CORREÇÃO: fn_auditoria da 0001 lia new.id/old.id, que não existe em
--    `permissoes` (chave composta) nem em `configuracoes` (chave = chave).
--    Qualquer insert em permissoes falharia. Passa a ler o id pelo jsonb.
create or replace function fn_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if tg_op = 'DELETE' then
    v_id := nullif(to_jsonb(old) ->> 'id', '')::uuid;
    insert into auditoria (tabela, registro_id, acao, antes)
    values (tg_table_name, v_id, tg_op, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    v_id := nullif(to_jsonb(new) ->> 'id', '')::uuid;
    insert into auditoria (tabela, registro_id, acao, antes, depois)
    values (tg_table_name, v_id, tg_op, to_jsonb(old), to_jsonb(new));
  else
    v_id := nullif(to_jsonb(new) ->> 'id', '')::uuid;
    insert into auditoria (tabela, registro_id, acao, depois)
    values (tg_table_name, v_id, tg_op, to_jsonb(new));
  end if;
  return new;
end $$;

-- 2. FUNÇÕES AUXILIARES DE ACESSO -------------------------------
create function usuario_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and ativo);
$$;

-- Tem pelo menos `p_minimo` em alguma área (admin_geral sempre tem).
create function tem_acesso_alguma_area(p_minimo nivel_acesso default 'consulta') returns boolean
language sql stable security definer set search_path = public as $$
  select eh_admin_geral()
      or exists (select 1 from permissoes pe join perfis p on p.id = pe.perfil_id
                 where pe.perfil_id = auth.uid() and p.ativo and pe.nivel >= p_minimo);
$$;

create function area_do_modulo(p_modulo text) returns text
language sql stable security definer set search_path = public as $$
  select area from modulos where codigo = p_modulo;
$$;

create function tem_acesso_modulo(p_modulo text, p_minimo nivel_acesso default 'consulta') returns boolean
language sql stable security definer set search_path = public as $$
  select tem_acesso_area(area_do_modulo(p_modulo), p_minimo);
$$;

-- Lista quem pode receber pendências na área (operador ou acima). Só para gestor da área.
create function usuarios_da_area(p_area text) returns table (id uuid, nome text, nivel nivel_acesso)
language sql stable security definer set search_path = public as $$
  select p.id, p.nome,
         case when p.admin_geral then 'administrador'::nivel_acesso else pe.nivel end
    from perfis p
    left join permissoes pe on pe.perfil_id = p.id and pe.area = p_area
   where p.ativo
     and tem_acesso_area(p_area, 'gestor')
     and (p.admin_geral or pe.nivel >= 'operador')
   order by p.nome;
$$;

-- 3. IMPORTAÇÃO: MODELOS DE MAPEAMENTO --------------------------
create table importacao_modelos (
  id uuid primary key default gen_random_uuid(),
  modulo text not null references modulos(codigo),
  tipo text not null,                 -- ex.: 'titulos_abertos'
  nome text not null,
  mapeamento jsonb not null,          -- coluna do arquivo -> campo de destino
  atualizado_por uuid references perfis(id),
  atualizado_em timestamptz not null default now(),
  unique (modulo, tipo, nome)
);
alter table importacao_modelos enable row level security;

create function fn_carimbo_atualizacao() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  if auth.uid() is not null then new.atualizado_por := auth.uid(); end if;
  return new;
end $$;
create trigger trg_importacao_modelos_carimbo before insert or update on importacao_modelos
  for each row execute function fn_carimbo_atualizacao();

-- 4. REGRAS DE TRANSIÇÃO (a RLS não controla mudança de status) ---

-- 4.1 Registros imutáveis: auditoria não muda nem some, nem para a service role.
create function fn_bloquear_alteracao() returns trigger language plpgsql as $$
begin
  raise exception 'Registros de % são imutáveis.', tg_table_name;
end $$;
create trigger trg_auditoria_imutavel before update or delete on auditoria
  for each row execute function fn_bloquear_alteracao();

-- 4.2 Registros que servem de prova ou histórico nunca são apagados (regra global 4).
create trigger trg_pendencias_sem_delete  before delete on pendencias  for each row execute function fn_bloquear_delete();
create trigger trg_anexos_sem_delete      before delete on anexos      for each row execute function fn_bloquear_delete();
create trigger trg_interacoes_sem_delete  before delete on interacoes  for each row execute function fn_bloquear_delete();
create trigger trg_importacoes_sem_delete before delete on importacoes for each row execute function fn_bloquear_delete();

-- 4.3 Mensagens: operador só lida com rascunho/aguardando_aprovacao; aprovar exige gestor;
--     enviada/falhou/respondida só a service role grava.
create function fn_mensagens_regras() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then
    return new;                                   -- Edge Function / cron: livre
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('rascunho', 'aguardando_aprovacao') then
      raise exception 'Mensagem nova só pode ser criada como rascunho ou aguardando aprovação.';
    end if;
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

  -- campos de controle do envio nunca vêm do usuário
  new.modulo := old.modulo;       new.criado_em := old.criado_em;
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
    new.aprovado_por := auth.uid();
    new.aprovado_em := now();
  else
    new.aprovado_por := old.aprovado_por;
    new.aprovado_em := old.aprovado_em;
  end if;
  return new;
end $$;
create trigger trg_mensagens_regras before insert or update on mensagens
  for each row execute function fn_mensagens_regras();

-- 4.4 Pendências: responsável conclui as próprias; só o gestor da área reatribui e edita dados.
create function fn_pendencias_regras() returns trigger language plpgsql as $$
declare
  v_gestor boolean;
begin
  if auth.uid() is null then
    -- origem de serviço: só carimba a conclusão
    if new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') then
      new.concluido_em := coalesce(new.concluido_em, now());
    end if;
    return new;
  end if;

  v_gestor := tem_acesso_modulo(new.modulo, 'gestor');

  if tg_op = 'INSERT' then
    if not v_gestor and new.responsavel_id is not null and new.responsavel_id <> auth.uid() then
      raise exception 'Somente o gestor da área atribui pendência a outra pessoa.';
    end if;
    new.concluido_em := null; new.concluido_por := null;
    if new.status = 'concluida' then
      new.concluido_em := now(); new.concluido_por := auth.uid();
    end if;
    return new;
  end if;

  if not v_gestor then
    if new.modulo is distinct from old.modulo or new.empresa_id is distinct from old.empresa_id
       or new.contraparte_id is distinct from old.contraparte_id or new.titulo is distinct from old.titulo
       or new.descricao is distinct from old.descricao or new.prazo is distinct from old.prazo
       or new.criticidade is distinct from old.criticidade
       or new.referencia_tabela is distinct from old.referencia_tabela
       or new.referencia_id is distinct from old.referencia_id or new.link is distinct from old.link
       or new.clickup_task_id is distinct from old.clickup_task_id or new.criado_em is distinct from old.criado_em then
      raise exception 'Somente o gestor da área altera os dados da pendência.';
    end if;
    if new.responsavel_id is distinct from old.responsavel_id
       and not (old.responsavel_id is null and new.responsavel_id = auth.uid()) then
      raise exception 'Somente o gestor da área reatribui a pendência.';
    end if;
    if old.status in ('concluida', 'cancelada') and new.status is distinct from old.status then
      raise exception 'Pendência encerrada só é reaberta pelo gestor da área.';
    end if;
  end if;

  if new.status = 'concluida' and old.status <> 'concluida' then
    new.concluido_em := now(); new.concluido_por := auth.uid();
  elsif new.status = 'concluida' then
    new.concluido_em := old.concluido_em; new.concluido_por := old.concluido_por;
  else
    new.concluido_em := null; new.concluido_por := null;
  end if;
  return new;
end $$;
create trigger trg_pendencias_regras before insert or update on pendencias
  for each row execute function fn_pendencias_regras();

-- 4.5 Nunca ficar sem administrador geral ativo.
create function fn_perfis_ultimo_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.admin_geral and old.ativo and (not new.admin_geral or not new.ativo)
     and not exists (select 1 from perfis where admin_geral and ativo and id <> old.id) then
    raise exception 'Deve existir ao menos um administrador geral ativo.';
  end if;
  return new;
end $$;
create trigger trg_perfis_ultimo_admin before update on perfis
  for each row execute function fn_perfis_ultimo_admin();

-- 5. AUDITORIA nas tabelas de cadastro e controle (mensagens e permissoes já têm, na 0001)
create trigger trg_aud_perfis            after insert or update or delete on perfis            for each row execute function fn_auditoria();
create trigger trg_aud_configuracoes     after insert or update or delete on configuracoes     for each row execute function fn_auditoria();
create trigger trg_aud_modulos           after update                     on modulos           for each row execute function fn_auditoria();
create trigger trg_aud_empresas          after insert or update or delete on empresas          for each row execute function fn_auditoria();
create trigger trg_aud_contrapartes      after insert or update or delete on contrapartes      for each row execute function fn_auditoria();
create trigger trg_aud_contatos          after insert or update or delete on contatos          for each row execute function fn_auditoria();
create trigger trg_aud_pendencias        after insert or update or delete on pendencias        for each row execute function fn_auditoria();
create trigger trg_aud_modelos_mensagem  after insert or update or delete on modelos_mensagem  for each row execute function fn_auditoria();
create trigger trg_aud_importacao_modelos after insert or update or delete on importacao_modelos for each row execute function fn_auditoria();

-- 6. POLÍTICAS RLS ----------------------------------------------

-- 6.1 Áreas, módulos, configurações (leitura ampla; escrita só admin_geral)
create policy areas_ler on areas for select to authenticated using (usuario_ativo());
create policy areas_admin on areas for all to authenticated using (eh_admin_geral()) with check (eh_admin_geral());

create policy modulos_ler on modulos for select to authenticated using (usuario_ativo());
create policy modulos_admin on modulos for all to authenticated using (eh_admin_geral()) with check (eh_admin_geral());

create policy configuracoes_ler on configuracoes for select to authenticated using (tem_acesso_alguma_area());
create policy configuracoes_admin on configuracoes for all to authenticated using (eh_admin_geral()) with check (eh_admin_geral());

-- 6.2 Perfis e permissões (criação de perfil só pelo gatilho de primeiro acesso; sem delete)
create policy perfis_ler on perfis for select to authenticated
  using (id = auth.uid() or (usuario_ativo() and tem_acesso_alguma_area()));
create policy perfis_alterar on perfis for update to authenticated
  using (eh_admin_geral()) with check (eh_admin_geral());

create policy permissoes_ler on permissoes for select to authenticated
  using (perfil_id = auth.uid() or eh_admin_geral());
create policy permissoes_admin on permissoes for all to authenticated
  using (eh_admin_geral()) with check (eh_admin_geral());

-- 6.3 Empresas
create policy empresas_ler on empresas for select to authenticated using (tem_acesso_alguma_area());
create policy empresas_admin on empresas for all to authenticated using (eh_admin_geral()) with check (eh_admin_geral());

-- 6.4 Contrapartes e contatos. Tipo `colaborador` só para quem tem a área rh.
--     Sem delete: use o campo `ativo`.
create policy contrapartes_ler on contrapartes for select to authenticated
  using (tem_acesso_alguma_area('consulta')
         and (not ('colaborador'::tipo_contraparte = any (tipos)) or tem_acesso_area('rh', 'consulta')));
create policy contrapartes_inserir on contrapartes for insert to authenticated
  with check (tem_acesso_alguma_area('operador')
              and (not ('colaborador'::tipo_contraparte = any (tipos)) or tem_acesso_area('rh', 'operador')));
create policy contrapartes_alterar on contrapartes for update to authenticated
  using (tem_acesso_alguma_area('operador')
         and (not ('colaborador'::tipo_contraparte = any (tipos)) or tem_acesso_area('rh', 'operador')))
  with check (tem_acesso_alguma_area('operador')
              and (not ('colaborador'::tipo_contraparte = any (tipos)) or tem_acesso_area('rh', 'operador')));

-- A subconsulta em `contrapartes` já passa pela RLS dela: contato herda a visibilidade da contraparte.
create policy contatos_ler on contatos for select to authenticated
  using (exists (select 1 from contrapartes c where c.id = contatos.contraparte_id));
create policy contatos_inserir on contatos for insert to authenticated
  with check (tem_acesso_alguma_area('operador')
              and exists (select 1 from contrapartes c where c.id = contatos.contraparte_id
                          and (not ('colaborador'::tipo_contraparte = any (c.tipos)) or tem_acesso_area('rh', 'operador'))));
create policy contatos_alterar on contatos for update to authenticated
  using (tem_acesso_alguma_area('operador')
         and exists (select 1 from contrapartes c where c.id = contatos.contraparte_id
                     and (not ('colaborador'::tipo_contraparte = any (c.tipos)) or tem_acesso_area('rh', 'operador'))))
  with check (tem_acesso_alguma_area('operador')
              and exists (select 1 from contrapartes c where c.id = contatos.contraparte_id
                          and (not ('colaborador'::tipo_contraparte = any (c.tipos)) or tem_acesso_area('rh', 'operador'))));

-- 6.5 Pendências (Fila do dia). Leitura pela área do módulo; escrita refinada no gatilho 4.4.
create policy pendencias_ler on pendencias for select to authenticated
  using (tem_acesso_modulo(modulo, 'consulta'));
create policy pendencias_inserir on pendencias for insert to authenticated
  with check (tem_acesso_modulo(modulo, 'operador'));
create policy pendencias_alterar on pendencias for update to authenticated
  using (tem_acesso_modulo(modulo, 'gestor')
         or (tem_acesso_modulo(modulo, 'operador') and (responsavel_id = auth.uid() or responsavel_id is null)))
  with check (tem_acesso_modulo(modulo, 'gestor')
              or (tem_acesso_modulo(modulo, 'operador') and (responsavel_id = auth.uid() or responsavel_id is null)));

-- 6.6 Anexos (imutáveis: sem update/delete) e interações (histórico: sem update/delete)
create policy anexos_ler on anexos for select to authenticated using (tem_acesso_modulo(modulo, 'consulta'));
create policy anexos_inserir on anexos for insert to authenticated
  with check (tem_acesso_modulo(modulo, 'operador') and enviado_por = auth.uid());

create policy interacoes_ler on interacoes for select to authenticated using (tem_acesso_modulo(modulo, 'consulta'));
create policy interacoes_inserir on interacoes for insert to authenticated
  with check (tem_acesso_modulo(modulo, 'operador') and usuario_id = auth.uid());

-- 6.7 Modelos de mensagem (desativar em vez de excluir)
create policy modelos_mensagem_ler on modelos_mensagem for select to authenticated
  using (tem_acesso_modulo(modulo, 'consulta'));
create policy modelos_mensagem_inserir on modelos_mensagem for insert to authenticated
  with check (tem_acesso_modulo(modulo, 'operador'));
create policy modelos_mensagem_alterar on modelos_mensagem for update to authenticated
  using (tem_acesso_modulo(modulo, 'operador')) with check (tem_acesso_modulo(modulo, 'operador'));

-- 6.8 Mensagens: operador só em rascunho/aguardando_aprovacao; gestor também mexe em aprovada
--     (descartar). Transições e status de envio: gatilho 4.3.
create policy mensagens_ler on mensagens for select to authenticated using (tem_acesso_modulo(modulo, 'consulta'));
create policy mensagens_inserir on mensagens for insert to authenticated
  with check (tem_acesso_modulo(modulo, 'operador') and status in ('rascunho', 'aguardando_aprovacao'));
create policy mensagens_alterar_operador on mensagens for update to authenticated
  using (tem_acesso_modulo(modulo, 'operador') and status in ('rascunho', 'aguardando_aprovacao'))
  with check (tem_acesso_modulo(modulo, 'operador'));
create policy mensagens_alterar_gestor on mensagens for update to authenticated
  using (tem_acesso_modulo(modulo, 'gestor') and status in ('rascunho', 'aguardando_aprovacao', 'aprovada'))
  with check (tem_acesso_modulo(modulo, 'gestor'));

-- 6.9 Importações (registro de cada importação) e modelos de mapeamento
create policy importacoes_ler on importacoes for select to authenticated using (tem_acesso_modulo(modulo, 'consulta'));
create policy importacoes_inserir on importacoes for insert to authenticated
  with check (tem_acesso_modulo(modulo, 'operador') and usuario_id = auth.uid());
create policy importacoes_alterar on importacoes for update to authenticated
  using (tem_acesso_modulo(modulo, 'operador') and usuario_id = auth.uid())
  with check (tem_acesso_modulo(modulo, 'operador') and usuario_id = auth.uid());

create policy importacao_modelos_ler on importacao_modelos for select to authenticated
  using (tem_acesso_modulo(modulo, 'consulta'));
create policy importacao_modelos_inserir on importacao_modelos for insert to authenticated
  with check (tem_acesso_modulo(modulo, 'operador'));
create policy importacao_modelos_alterar on importacao_modelos for update to authenticated
  using (tem_acesso_modulo(modulo, 'operador')) with check (tem_acesso_modulo(modulo, 'operador'));
create policy importacao_modelos_excluir on importacao_modelos for delete to authenticated
  using (tem_acesso_modulo(modulo, 'operador'));

-- 6.10 Auditoria: só admin_geral lê. Ninguém grava direto; só o gatilho security definer.
create policy auditoria_ler on auditoria for select to authenticated using (eh_admin_geral());
revoke insert, update, delete, truncate on auditoria from authenticated;
revoke usage, select, update on sequence auditoria_id_seq from authenticated;

-- 7. PRIVILÉGIOS ------------------------------------------------
-- `anon` (sem login) não acessa nada do núcleo.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Funções de acesso: só usuários logados e a service role.
revoke execute on function eh_admin_geral(), nivel_area(text), tem_acesso_area(text, nivel_acesso),
  usuario_ativo(), tem_acesso_alguma_area(nivel_acesso), area_do_modulo(text),
  tem_acesso_modulo(text, nivel_acesso), usuarios_da_area(text) from public, anon;
grant execute on function eh_admin_geral(), nivel_area(text), tem_acesso_area(text, nivel_acesso),
  usuario_ativo(), tem_acesso_alguma_area(nivel_acesso), area_do_modulo(text),
  tem_acesso_modulo(text, nivel_acesso), usuarios_da_area(text) to authenticated, service_role;
