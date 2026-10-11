-- =========================================================
-- Neo Admin — 0124 Contas a pagar: envio da autorização no Slack
-- O diretor clica em "Enviar no Slack" na autorização; o Neo Admin (aplicativo "Neo Admin" do Slack, token em
-- Supabase > Edge Functions > Secrets: SLACK_BOT_TOKEN) publica a mensagem e o PDF do relatório no canal do financeiro.
-- Só no clique, com confirmação: nada é enviado sozinho. O canal fica em `configuracoes` (nunca no código).
-- Registro do envio em cap_autorizacoes (quem, quando, link da mensagem); só a service role da Edge Function grava.
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.contas-pagar.slack_canal_id', '"C088FV34S4A"', 'ID do canal do financeiro no Slack onde o botão "Enviar no Slack" publica a autorização de pagamento (mensagem + PDF).')
on conflict (chave) do update set valor = excluded.valor;

alter table cap_autorizacoes add column slack_enviada_em timestamptz;
alter table cap_autorizacoes add column slack_enviada_por uuid references perfis(id);
alter table cap_autorizacoes add column slack_permalink text;

-- Usuário não grava os campos de envio (a Edge Function grava com a service role, auth.uid() nulo).
create or replace function fn_cap_autorizacao_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'rascunho';
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.autorizada_por := null; new.autorizada_em := null;
    new.cancelada_por := null;  new.cancelada_em := null; new.motivo_cancelamento := null;
    new.slack_enviada_em := null; new.slack_enviada_por := null; new.slack_permalink := null;
    return new;
  end if;

  new.numero := old.numero; new.empresa_id := old.empresa_id; new.data := old.data;
  new.criado_por := old.criado_por; new.criado_em := old.criado_em;
  new.slack_enviada_em := old.slack_enviada_em; new.slack_enviada_por := old.slack_enviada_por; new.slack_permalink := old.slack_permalink;

  if old.status = 'cancelada' then
    raise exception 'A autorização nº % está cancelada e não pode mais ser alterada.', old.numero;
  end if;
  if old.status = 'autorizada' and new.status = 'rascunho' then
    raise exception 'A autorização nº % já foi autorizada e não volta a rascunho.', old.numero;
  end if;
  if old.status <> 'rascunho' and new.observacao is distinct from old.observacao then
    raise exception 'A observação só pode ser alterada enquanto a autorização é rascunho.';
  end if;
  if old.status <> 'rascunho' and new.caixa_disponivel is distinct from old.caixa_disponivel then
    raise exception 'O caixa disponível só pode ser alterado enquanto a autorização é rascunho.';
  end if;

  if new.status = 'autorizada' and old.status <> 'autorizada' then
    if not tem_acesso_area('financeiro', 'gestor') then
      raise exception 'Somente gestor do Financeiro (ou acima) pode autorizar o pagamento.';
    end if;
    if not exists (select 1 from cap_autorizacao_itens where autorizacao_id = old.id and removido_em is null) then
      raise exception 'A autorização nº % não tem itens.', old.numero;
    end if;
    new.autorizada_por := auth.uid();
    new.autorizada_em := now();
  else
    new.autorizada_por := old.autorizada_por;
    new.autorizada_em := old.autorizada_em;
  end if;

  if new.status = 'cancelada' then
    if not tem_acesso_area('financeiro', 'gestor') and not (old.status = 'rascunho' and old.criado_por = auth.uid()) then
      raise exception 'Só gestor do Financeiro cancela uma autorização (ou quem a montou, enquanto é rascunho).';
    end if;
    if coalesce(trim(new.motivo_cancelamento), '') = '' then
      raise exception 'Informe o motivo do cancelamento.';
    end if;
    new.cancelada_por := auth.uid();
    new.cancelada_em := now();
  else
    new.cancelada_por := old.cancelada_por; new.cancelada_em := old.cancelada_em; new.motivo_cancelamento := old.motivo_cancelamento;
  end if;
  return new;
end $$;

drop view cap_vw_autorizacoes;
create view cap_vw_autorizacoes with (security_invoker = true) as
select a.*, e.nome_curto as empresa_nome, e.razao_social as empresa_razao_social, e.cnpj as empresa_cnpj,
       pc.nome as criado_por_nome, pa.nome as autorizada_por_nome, pk.nome as cancelada_por_nome, ps.nome as slack_enviada_por_nome,
       coalesce(i.itens, 0)::int as itens, coalesce(i.titulos, 0)::int as titulos, coalesce(i.antecipacoes, 0)::int as antecipacoes,
       coalesce(i.total_titulos, 0)::numeric(14,2) as total_titulos, coalesce(i.total_antecipacoes, 0)::numeric(14,2) as total_antecipacoes,
       coalesce(i.total, 0)::numeric(14,2) as total, coalesce(i.baixados, 0)::int as baixados,
       case when a.caixa_disponivel is null then null else greatest(coalesce(i.total, 0) - a.caixa_disponivel, 0)::numeric(14,2) end as excedente
  from cap_autorizacoes a
  join empresas e on e.id = a.empresa_id
  left join perfis pc on pc.id = a.criado_por
  left join perfis pa on pa.id = a.autorizada_por
  left join perfis pk on pk.id = a.cancelada_por
  left join perfis ps on ps.id = a.slack_enviada_por
  left join lateral (
    select count(*) as itens,
           count(*) filter (where tipo = 'titulo') as titulos,
           count(*) filter (where tipo = 'antecipacao') as antecipacoes,
           sum(valor) filter (where tipo = 'titulo') as total_titulos,
           sum(valor) filter (where tipo = 'antecipacao') as total_antecipacoes,
           sum(valor) as total,
           count(*) filter (where baixado_consistem_em is not null) as baixados
      from cap_autorizacao_itens where autorizacao_id = a.id and removido_em is null
  ) i on true;

-- Parâmetros editáveis pelo gestor: data de corte, ID do canal e link do canal.
create or replace function cap_salvar_parametros(p_parametros jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_chave text;
  v_valor jsonb;
  v_nome text;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'gestor') then
    raise exception 'Somente gestor do Financeiro (ou acima) pode alterar os parâmetros do contas a pagar.';
  end if;
  if p_parametros is null or jsonb_typeof(p_parametros) <> 'object' or p_parametros = '{}'::jsonb then
    raise exception 'Nenhum parâmetro informado.';
  end if;
  for v_chave, v_valor in select key, value from jsonb_each(p_parametros) loop
    if v_chave = 'financeiro.contas-pagar.antecipacoes_a_partir_de' then
      if jsonb_typeof(v_valor) = 'null' then continue; end if;
      if jsonb_typeof(v_valor) <> 'string' or (v_valor #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Data inválida (use aaaa-mm-dd).';
      end if;
      begin
        perform (v_valor #>> '{}')::date;
      exception when others then
        raise exception 'Data inválida (use aaaa-mm-dd).';
      end;
    elsif v_chave = 'financeiro.contas-pagar.slack_canal_id' then
      if jsonb_typeof(v_valor) = 'null' then continue; end if;
      if jsonb_typeof(v_valor) <> 'string' or (v_valor #>> '{}') !~ '^[CG][A-Z0-9]{8,}$' then
        raise exception 'ID de canal do Slack inválido (ex.: C088FV34S4A).';
      end if;
    elsif v_chave = 'financeiro.contas-pagar.slack_canal_url' then
      if jsonb_typeof(v_valor) = 'null' then continue; end if;
      if jsonb_typeof(v_valor) <> 'string' or (v_valor #>> '{}') !~ '^(https://([a-z0-9-]+\.)?slack\.com/|slack://)' then
        raise exception 'Link do Slack inválido.';
      end if;
    else
      raise exception 'Parâmetro não permitido: %.', v_chave;
    end if;
  end loop;
  for v_chave, v_valor in select key, value from jsonb_each(p_parametros) loop
    insert into configuracoes (chave, valor, descricao) values (v_chave, v_valor, 'Parâmetro do contas a pagar (editado na tela).')
    on conflict (chave) do update set valor = excluded.valor;
  end loop;
  select nome into v_nome from perfis where id = auth.uid();
  insert into configuracoes (chave, valor, descricao)
  values ('financeiro.contas-pagar.parametros_ultima_alteracao',
          jsonb_build_object('por', coalesce(v_nome, 'usuário'), 'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          'Quem alterou os parâmetros do contas a pagar por último e quando.')
  on conflict (chave) do update set valor = excluded.valor;
end $$;
