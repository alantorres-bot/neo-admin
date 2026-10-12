-- =========================================================
-- Neo Admin — 0130 Módulo AKF, Fase 2: solicitar antecipação (seleção de títulos + e-mail em rascunho no Gmail)
-- Hoje o pedido à AKF é um e-mail montado à mão (print do Consistem). Aqui a solicitação vira um registro:
--  - akf_operacoes: cabeçalho da solicitação (nº sequencial, data, status rascunho → solicitada | cancelada, o e-mail
--    gerado e a mensagem do núcleo com o rascunho do Gmail). Sem exclusão: cancela-se com motivo (prova).
--  - akf_operacao_titulos: cópia de cada título no momento da solicitação (documento, cliente, vencimento, valor do título,
--    valor solicitado — menor que o título = antecipação parcial —, selo "sem boleto" e observação). Imutável.
--  - akf_criar_solicitacao(): valida (título disponível para antecipar, valor dentro do que resta com a Neo, título não
--    repetido em solicitação aberta), grava tudo numa transação e registra a interação no histórico de cada título.
--  - akf_marcar_solicitada(): chamada pela Edge Function akf-rascunho-gmail depois de criar o rascunho (service role).
--  - akf_cancelar_solicitacao(): rascunho ou solicitada → cancelada, com motivo; descarta a mensagem do núcleo.
--  - akf_vw_operacoes (resumo por solicitação) e akf_vw_titulos_solicitados (título em solicitação aberta).
--  - mensagens.cc: cópias do e-mail (o rascunho da AKF vai com cópia para o financeiro).
--  - Parâmetros: lista atual de clientes "sem boleto de factoring" (casa por PALAVRA inteira), texto da OBS igual ao dos
--    e-mails reais, cópia interna (financeiro.akf.copia) e a contraparte "AKF Securitizadora" (destinatários André e Kayza
--    como contatos com a finalidade "akf"; editáveis em Configurações > Contrapartes).
-- =========================================================

-- 1) Parâmetros e destinatários ----------------------------------------------------------------------------------------
update configuracoes
   set valor = '["MIP","MB","JANEIRO","RAJA","CAPARAO","HOUSE GARDEN","QRTZ 39","ROCCA","JBL","LEANDRO","J.MIRO","BF OTICA"]',
       descricao = 'Clientes "sem boleto de factoring": o título é operado com 01 dia após o vencimento e sem emitir boleto. Casa por PALAVRA inteira no nome do cliente (sem acento e sem diferenciar maiúsculas): "MB" marca "MB ENGENHARIA", não "AMBIENTAL".'
 where chave = 'financeiro.akf.clientes_sem_boleto';

update configuracoes
   set valor = '"Operar com 01 dia após o vencimento e não emitir boleto."',
       descricao = 'Texto da OBS, no e-mail de solicitação à AKF, para os títulos de clientes "sem boleto de factoring".'
 where chave = 'financeiro.akf.observacao_sem_boleto';

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.akf.copia', '["rodrigofelicio@neoformas.com.br","financeiro@neoformas.com.br"]', 'E-mails internos que vão em cópia (Cc) no rascunho da solicitação de antecipação à AKF.'),
  ('financeiro.akf.contraparte_id', 'null', 'Id da contraparte "AKF Securitizadora": os contatos dela com a finalidade "akf" e e-mail são os destinatários da solicitação.')
on conflict (chave) do nothing;

do $$
declare
  v_id uuid;
begin
  select id into v_id from contrapartes where nome = 'AKF Securitizadora' limit 1;
  if v_id is null then
    insert into contrapartes (nome, tipos, observacoes)
    values ('AKF Securitizadora', '{outro}', 'Securitizadora que recebe os títulos da Neo Formas em cessão/antecipação (portador 998 no Consistem).')
    returning id into v_id;
    insert into contatos (contraparte_id, nome, funcao, email, canal_preferido, finalidades) values
      (v_id, 'André Kamil', 'Operações', 'andre.kamil@akfsec.com.br', 'email', '{akf}'),
      (v_id, 'Kayza', 'Operações', 'kayza@akfsec.com.br', 'email', '{akf}');
  end if;
  update configuracoes set valor = to_jsonb(v_id::text) where chave = 'financeiro.akf.contraparte_id';
end $$;

-- 2) Cópias no e-mail ------------------------------------------------------------------------------------------------
alter table mensagens add column cc text;

-- 3) Tabelas -------------------------------------------------------------------------------------------------------------
create table akf_operacoes (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique,
  data date not null default (now() at time zone 'America/Cuiaba')::date,
  status text not null default 'rascunho' check (status in ('rascunho', 'solicitada', 'cancelada')),
  observacao text,
  assunto text,
  corpo text,
  mensagem_id uuid references mensagens(id),
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  solicitada_em timestamptz,
  solicitada_por uuid references perfis(id),
  cancelada_em timestamptz,
  cancelada_por uuid references perfis(id),
  motivo_cancelamento text,
  constraint cancelamento_registrado check (status <> 'cancelada' or (cancelada_em is not null and motivo_cancelamento is not null)),
  constraint solicitacao_registrada check (status <> 'solicitada' or (solicitada_em is not null and mensagem_id is not null))
);
create index idx_akf_operacoes_abertas on akf_operacoes (status) where status in ('rascunho', 'solicitada');

create table akf_operacao_titulos (
  id uuid primary key default gen_random_uuid(),
  operacao_id uuid not null references akf_operacoes(id),
  titulo_id uuid not null references rec_titulos(id),
  contraparte_id uuid references contrapartes(id),
  documento text not null,                      -- "1335/2": documento e parcela como o e-mail mostra
  cliente_nome text not null,
  vencimento date not null,
  valor_titulo numeric(14,2) not null,          -- valor do título no Consistem
  valor_restante numeric(14,2) not null,        -- o que restava com a Neo na hora (título − partes já antecipadas)
  valor_solicitado numeric(14,2) not null check (valor_solicitado > 0),
  parcial boolean not null default false,       -- valor solicitado menor que o restante
  sem_boleto boolean not null default false,    -- cliente que não aceita boleto de factoring
  observacao text,
  ordem int not null,
  unique (operacao_id, titulo_id)
);
create index idx_akf_operacao_titulos_titulo on akf_operacao_titulos (titulo_id);

alter table akf_operacoes enable row level security;
create policy akf_operacoes_ler on akf_operacoes for select to authenticated using (tem_acesso_area('financeiro'));
create policy akf_operacoes_inserir on akf_operacoes for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
create policy akf_operacoes_alterar on akf_operacoes for update to authenticated
  using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));
create trigger trg_akf_operacoes_sem_delete before delete on akf_operacoes for each row execute function fn_bloquear_delete();
create trigger trg_aud_akf_operacoes after insert or update or delete on akf_operacoes for each row execute function fn_auditoria();

alter table akf_operacao_titulos enable row level security;
create policy akf_operacao_titulos_ler on akf_operacao_titulos for select to authenticated using (tem_acesso_area('financeiro'));
create policy akf_operacao_titulos_inserir on akf_operacao_titulos for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
-- A alteração só existe para a reordenação dentro de akf_criar_solicitacao; o gatilho abaixo barra qualquer outra.
create policy akf_operacao_titulos_alterar on akf_operacao_titulos for update to authenticated
  using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));
create trigger trg_akf_operacao_titulos_sem_delete before delete on akf_operacao_titulos for each row execute function fn_bloquear_delete();
create trigger trg_aud_akf_operacao_titulos after insert or update or delete on akf_operacao_titulos for each row execute function fn_auditoria();

-- Os itens são a prova do que foi pedido: imutáveis.
create function fn_akf_operacao_titulos_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'Os títulos de uma solicitação não podem ser alterados; cancele a solicitação e monte outra.';
end $$;
create trigger trg_akf_operacao_titulos_imutavel before update on akf_operacao_titulos for each row execute function fn_akf_operacao_titulos_imutavel();

-- O cabeçalho só muda pelas funções abaixo (status, mensagem, carimbos); o resto é fixo depois de criado.
create function fn_akf_operacoes_regras() returns trigger language plpgsql as $$
begin
  if new.numero <> old.numero or new.data <> old.data or new.criado_por is distinct from old.criado_por or new.criado_em <> old.criado_em then
    raise exception 'Número, data e autor da solicitação não mudam.';
  end if;
  if old.status = 'cancelada' then
    raise exception 'A solicitação nº % está cancelada e não pode mais ser alterada.', old.numero;
  end if;
  if old.status = 'solicitada' and new.status = 'rascunho' then
    raise exception 'A solicitação nº % já foi solicitada à AKF; não volta a rascunho.', old.numero;
  end if;
  return new;
end $$;
create trigger trg_akf_operacoes_regras before update on akf_operacoes for each row execute function fn_akf_operacoes_regras();

-- 4) Views ---------------------------------------------------------------------------------------------------------------
create view akf_vw_operacoes with (security_invoker = true) as
select o.id, o.numero, o.data, o.status, o.observacao, o.assunto, o.corpo, o.mensagem_id, o.criado_em, o.solicitada_em, o.cancelada_em, o.motivo_cancelamento,
       o.criado_por, o.solicitada_por, o.cancelada_por, pc.nome as criado_por_nome, ps.nome as solicitada_por_nome, pk.nome as cancelada_por_nome,
       m.id_externo as rascunho_gmail, m.destinatario, m.cc,
       (select count(*)::int from akf_operacao_titulos t where t.operacao_id = o.id) as itens,
       (select coalesce(sum(t.valor_solicitado), 0) from akf_operacao_titulos t where t.operacao_id = o.id) as total,
       (select count(*)::int from akf_operacao_titulos t where t.operacao_id = o.id and t.parcial) as parciais,
       (select count(*)::int from akf_operacao_titulos t where t.operacao_id = o.id and t.sem_boleto) as sem_boleto
  from akf_operacoes o
  left join perfis pc on pc.id = o.criado_por
  left join perfis ps on ps.id = o.solicitada_por
  left join perfis pk on pk.id = o.cancelada_por
  left join mensagens m on m.id = o.mensagem_id;

-- Título que está numa solicitação aberta (rascunho ou solicitada): a tela mostra "Na solicitação nº N" e a função recusa repetir.
create view akf_vw_titulos_solicitados with (security_invoker = true) as
select t.titulo_id, o.id as operacao_id, o.numero, o.status, t.valor_solicitado, t.parcial
  from akf_operacao_titulos t
  join akf_operacoes o on o.id = t.operacao_id
 where o.status in ('rascunho', 'solicitada');

-- 5) Criar a solicitação --------------------------------------------------------------------------------------------------
-- p_itens: [{"titulo_id": uuid, "valor": 123.45, "sem_boleto": true|false, "observacao": "..."}, ...]
-- `valor` ausente ou nulo = o que resta com a Neo (título inteiro, ou o restante se já houver antecipação parcial).
create function akf_criar_solicitacao(p_itens jsonb, p_observacao text default null, p_data date default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_data date := coalesce(p_data, v_hoje);
  v_id uuid;
  v_numero int;
  v_item jsonb;
  v_titulo record;
  v_valor numeric;
  v_restante numeric;
  v_parcial boolean;
  v_doc text;
  v_ordem int := 0;
  v_total numeric := 0;
  v_qtd int;
  v_aberta int;
begin
  if auth.uid() is null or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode montar uma solicitação de antecipação.';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Marque pelo menos um título.';
  end if;
  if jsonb_array_length(p_itens) > 100 then
    raise exception 'No máximo 100 títulos por solicitação.';
  end if;
  if v_data < v_hoje - 30 or v_data > v_hoje + 30 then
    raise exception 'A data da solicitação deve ficar até 30 dias antes ou depois de hoje.';
  end if;
  select count(distinct x ->> 'titulo_id') into v_qtd from jsonb_array_elements(p_itens) as x;
  if v_qtd <> jsonb_array_length(p_itens) then
    raise exception 'O mesmo título aparece mais de uma vez.';
  end if;

  lock table akf_operacoes in share row exclusive mode;
  select coalesce(max(numero), 0) + 1 into v_numero from akf_operacoes;
  insert into akf_operacoes (numero, data, observacao) values (v_numero, v_data, nullif(trim(coalesce(p_observacao, '')), ''))
  returning id into v_id;

  for v_item in
    select x from jsonb_array_elements(p_itens) as x
  loop
    select t.id, t.documento, t.parcela, t.contraparte_id, t.vencimento, t.valor, t.estagio, t.cedido, t.contestado, t.cod_portador, c.nome as cliente
      into v_titulo
      from rec_titulos t join contrapartes c on c.id = t.contraparte_id
     where t.id = (v_item ->> 'titulo_id')::uuid;
    if not found then
      raise exception 'Título não encontrado (ou você não tem acesso a ele).';
    end if;
    v_doc := v_titulo.documento || case when v_titulo.parcela <> '1' then '/' || v_titulo.parcela else '' end;

    -- Disponível para antecipar: a vencer, fora da AKF, sem contestação, em estágio normal (mesma regra de _shared/akf.ts).
    if v_titulo.estagio in ('pago', 'renegociado', 'cancelado') then
      raise exception 'O título % já está encerrado.', v_doc;
    end if;
    if v_titulo.cedido or v_titulo.cod_portador = '998' then
      raise exception 'O título % já está na AKF.', v_doc;
    end if;
    if v_titulo.contestado then
      raise exception 'O título % está contestado pelo cliente.', v_doc;
    end if;
    if v_titulo.estagio not in ('importado', 'aguardando_boleto', 'boleto_enviado', 'confirmado_cliente') then
      raise exception 'O título % não está em estágio antecipável (%).', v_doc, v_titulo.estagio;
    end if;
    if v_titulo.vencimento < v_hoje then
      raise exception 'O título % já venceu: título vencido não é antecipável.', v_doc;
    end if;
    select count(*) into v_aberta from akf_vw_titulos_solicitados s where s.titulo_id = v_titulo.id;
    if v_aberta > 0 then
      raise exception 'O título % já está em outra solicitação em aberto (nº %).', v_doc,
        (select min(s.numero) from akf_vw_titulos_solicitados s where s.titulo_id = v_titulo.id);
    end if;

    select v_titulo.valor - coalesce(sum(d.valor), 0) into v_restante from akf_desdobramentos d where d.titulo_id = v_titulo.id and d.status = 'ativo';
    v_valor := coalesce(nullif(v_item ->> 'valor', '')::numeric, v_restante);
    if v_valor <= 0 then
      raise exception 'Informe o valor a solicitar do título %.', v_doc;
    end if;
    if v_valor <> round(v_valor, 2) then
      raise exception 'O valor do título % tem no máximo 2 casas decimais.', v_doc;
    end if;
    if v_valor > v_restante then
      raise exception 'O valor solicitado do título % (R$ %) passa do que resta com a Neo (R$ %).', v_doc,
        translate(to_char(v_valor, 'FM999,999,999,990.00'), ',.', '.,'), translate(to_char(v_restante, 'FM999,999,999,990.00'), ',.', '.,');
    end if;
    v_parcial := v_valor < v_restante;

    v_ordem := v_ordem + 1;
    insert into akf_operacao_titulos (operacao_id, titulo_id, contraparte_id, documento, cliente_nome, vencimento, valor_titulo, valor_restante,
                                      valor_solicitado, parcial, sem_boleto, observacao, ordem)
    values (v_id, v_titulo.id, v_titulo.contraparte_id, v_doc, v_titulo.cliente, v_titulo.vencimento, v_titulo.valor, v_restante,
            v_valor, v_parcial, coalesce((v_item ->> 'sem_boleto')::boolean, false), nullif(trim(coalesce(v_item ->> 'observacao', '')), ''), v_ordem);
    v_total := v_total + v_valor;

    insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
    values ('financeiro.akf', v_titulo.contraparte_id, 'rec_titulos', v_titulo.id, 'interno', 'akf_solicitacao',
            'Incluído na solicitação de antecipação nº ' || v_numero || ': R$ ' || translate(to_char(v_valor, 'FM999,999,999,990.00'), ',.', '.,')
            || case when v_parcial then ' (parcial; restava R$ ' || translate(to_char(v_restante, 'FM999,999,999,990.00'), ',.', '.,') || ')' else '' end
            || case when coalesce((v_item ->> 'sem_boleto')::boolean, false) then '. Operar 01 dia após o vencimento, sem boleto' else '' end || '.',
            auth.uid());
  end loop;

  -- Reordena pelo vencimento e documento (a ordem do e-mail), independentemente da ordem em que a tela mandou.
  update akf_operacao_titulos t set ordem = n.ordem
    from (select id, row_number() over (order by vencimento, documento) as ordem from akf_operacao_titulos where operacao_id = v_id) n
   where t.id = n.id and t.ordem <> n.ordem;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'itens', v_ordem, 'total', v_total);
end $$;
revoke all on function akf_criar_solicitacao(jsonb, text, date) from public, anon;
grant execute on function akf_criar_solicitacao(jsonb, text, date) to authenticated;

-- O gatilho de imutabilidade dos itens precisa deixar passar a reordenação feita dentro de akf_criar_solicitacao.
create or replace function fn_akf_operacao_titulos_imutavel() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'ordem') = (to_jsonb(old) - 'ordem') and (select status from akf_operacoes where id = old.operacao_id) = 'rascunho' then
    return new;
  end if;
  raise exception 'Os títulos de uma solicitação não podem ser alterados; cancele a solicitação e monte outra.';
end $$;

-- 6) Marcar como solicitada (depois do rascunho no Gmail) ------------------------------------------------------------------
-- Chamada pela Edge Function akf-rascunho-gmail (service role) com a mensagem já ligada ao rascunho (id_externo).
create function akf_marcar_solicitada(p_operacao uuid, p_mensagem uuid, p_usuario uuid default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_op record;
  v_msg record;
  v_quem uuid := coalesce(p_usuario, auth.uid());
begin
  select id, numero, status into v_op from akf_operacoes where id = p_operacao;
  if not found then
    raise exception 'Solicitação não encontrada (ou você não tem acesso a ela).';
  end if;
  if v_op.status <> 'rascunho' then
    raise exception 'A solicitação nº % não está em rascunho.', v_op.numero;
  end if;
  select id, modulo, status, id_externo, assunto, corpo into v_msg from mensagens where id = p_mensagem;
  if not found or v_msg.modulo <> 'financeiro.akf' then
    raise exception 'Mensagem da solicitação não encontrada.';
  end if;
  if v_msg.id_externo is null then
    raise exception 'A mensagem ainda não tem o rascunho do Gmail.';
  end if;

  update akf_operacoes
     set status = 'solicitada', mensagem_id = p_mensagem, assunto = v_msg.assunto, corpo = v_msg.corpo,
         solicitada_em = now(), solicitada_por = v_quem
   where id = p_operacao;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.akf', t.contraparte_id, 'rec_titulos', t.titulo_id, 'email', 'akf_solicitacao_rascunho',
         'Solicitação de antecipação nº ' || v_op.numero || ': rascunho do e-mail à AKF criado no Gmail. Aguardando conferência e envio.', v_quem
    from akf_operacao_titulos t where t.operacao_id = p_operacao;

  return jsonb_build_object('id', p_operacao, 'numero', v_op.numero);
end $$;
revoke all on function akf_marcar_solicitada(uuid, uuid, uuid) from public, anon;
grant execute on function akf_marcar_solicitada(uuid, uuid, uuid) to authenticated, service_role;

-- 7) Cancelar --------------------------------------------------------------------------------------------------------------
create function akf_cancelar_solicitacao(p_operacao uuid, p_motivo text)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_op record;
  v_atualizados int;
begin
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  select id, numero, status, mensagem_id into v_op from akf_operacoes where id = p_operacao;
  if not found then
    raise exception 'Solicitação não encontrada (ou você não tem acesso a ela).';
  end if;
  if v_op.status = 'cancelada' then
    raise exception 'A solicitação nº % já está cancelada.', v_op.numero;
  end if;

  update akf_operacoes
     set status = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(), motivo_cancelamento = trim(p_motivo)
   where id = p_operacao;
  get diagnostics v_atualizados = row_count;
  if v_atualizados <> 1 then
    raise exception 'Você não tem permissão para cancelar (é preciso ser operador do Financeiro).';
  end if;
  -- A mensagem do núcleo (se ainda for rascunho) é descartada; o rascunho no Gmail continua lá para quem for apagar.
  if v_op.mensagem_id is not null then
    update mensagens set status = 'descartada' where id = v_op.mensagem_id and status = 'rascunho';
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.akf', t.contraparte_id, 'rec_titulos', t.titulo_id, 'interno', 'akf_solicitacao_cancelada',
         'Solicitação de antecipação nº ' || v_op.numero || ' cancelada. ' || trim(p_motivo), auth.uid()
    from akf_operacao_titulos t where t.operacao_id = p_operacao;

  return jsonb_build_object('id', p_operacao, 'numero', v_op.numero);
end $$;
revoke all on function akf_cancelar_solicitacao(uuid, text) from public, anon;
grant execute on function akf_cancelar_solicitacao(uuid, text) to authenticated;
