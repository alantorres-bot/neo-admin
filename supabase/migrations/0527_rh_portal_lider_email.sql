-- =========================================================
-- Neo Admin — 0527 RH/SST > Portal do Líder: todo pedido também vai por e-mail ao RH (decisão do Alan, 04/11/2026)
--  - O e-mail SAI DE FATO (não é rascunho), do Gmail do próprio líder (conexão "Conectar meu Gmail", 0153, escopo
--    gmail.compose), pela Edge Function rh-ld-enviar-email. Destino: só o e-mail do RH configurado aqui, e só endereços
--    @neoformas.com.br (é comunicação interna; não vale para terceiros — regra 2 do projeto).
--  - rh.portal_lider.email_rh: lista de e-mails do RH (começa com alantorres@). O gestor do RH troca na tela.
--  - O pedido guarda quando o e-mail saiu (email_enviado_em, email_id) ou o último erro (email_erro), para reenviar.
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('rh.portal_lider.email_rh', '["alantorres@neoformas.com.br"]', 'Para quem vai, por e-mail, cada pedido feito no Portal do Líder (só @neoformas.com.br).')
on conflict (chave) do nothing;

alter table rh_ld_solicitacoes
  add column email_enviado_em timestamptz,
  add column email_id text,
  add column email_erro text;

-- Gestor do RH troca o e-mail do RH (lista; só domínio da empresa).
create function rh_ld_salvar_email_rh(p_emails text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v text[];
begin
  perform rh_exigir('gestor');
  select array_agg(distinct lower(trim(e))) into v from unnest(coalesce(p_emails, '{}')) e where trim(e) <> '';
  if v is null or cardinality(v) = 0 then raise exception 'Informe ao menos um e-mail do RH.'; end if;
  if cardinality(v) > 5 then raise exception 'No máximo 5 e-mails.'; end if;
  if exists (select 1 from unnest(v) e where e !~ '^[^@\s,;]+@neoformas\.com\.br$') then
    raise exception 'Use só e-mails @neoformas.com.br.';
  end if;
  update configuracoes set valor = to_jsonb(v) where chave = 'rh.portal_lider.email_rh';
end $$;
revoke all on function rh_ld_salvar_email_rh(text[]) from public, anon;

-- Leitura do e-mail do RH para a tela (RH) e para o aviso do líder ("o pedido vai também para …").
create function rh_ld_email_rh() returns text[]
language sql stable security definer set search_path = public as $$
  select array(select jsonb_array_elements_text(valor) from configuracoes where chave = 'rh.portal_lider.email_rh')
   where auth.uid() is not null and acesso_liberado(auth.uid())
$$;
revoke all on function rh_ld_email_rh() from public, anon;
grant execute on function rh_ld_email_rh() to authenticated;

-- Registro do envio (só a Edge Function, com service role).
create function rh_ld_registrar_email(p_id uuid, p_email_id text, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update rh_ld_solicitacoes
     set email_enviado_em = case when p_email_id is not null then now() else email_enviado_em end,
         email_id = coalesce(p_email_id, email_id),
         email_erro = case when p_email_id is not null then null else left(p_erro, 500) end
   where id = p_id;
end $$;
revoke all on function rh_ld_registrar_email(uuid, text, text) from public, anon, authenticated;

-- rh_ld_pedidos passa a dizer se o e-mail saiu (o líder vê e reenviar quando falhou).
drop function rh_ld_pedidos(uuid);
create function rh_ld_pedidos(p_setor uuid) returns table (
  id uuid, tipo text, status text, dados jsonb, resposta text, pessoa text, criado_em timestamptz, atendido_em timestamptz, anexos int,
  email_enviado_em timestamptz, email_erro text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not rh_ld_lidera(p_setor) then raise exception 'Você não é líder deste setor.'; end if;
  return query
    select s.id, s.tipo, s.status, s.dados, s.resposta, coalesce(c.nome, s.dados ->> 'nome'), s.criado_em, s.atendido_em,
           (select count(*)::int from anexos a where a.referencia_tabela = 'rh_ld_solicitacoes' and a.referencia_id = s.id),
           s.email_enviado_em, s.email_erro
      from rh_ld_solicitacoes s left join rh_colaboradores c on c.id = s.colaborador_id
     where s.setor_id = p_setor order by s.criado_em desc limit 200;
end $$;
revoke all on function rh_ld_pedidos(uuid) from public, anon;
grant execute on function rh_ld_pedidos(uuid) to authenticated;
