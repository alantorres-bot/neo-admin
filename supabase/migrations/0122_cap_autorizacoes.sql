-- =========================================================
-- Neo Admin — 0122 Contas a pagar: autorização de pagamento (Fase 2)
-- A diretoria marca títulos e antecipações em aberto (espelho da 0121) e gera UMA autorização de pagamento, que é prova:
-- cabeçalho (cap_autorizacoes, número sequencial sem buracos) + cópia dos itens no momento (cap_autorizacao_itens).
-- Nada é apagado; só muda de status. Fluxo: rascunho -> autorizada (só gestor) | cancelada (motivo obrigatório).
-- Ao autorizar nasce a pendência "Executar autorização de pagamento nº N" na Fila do dia; o financeiro conclui pela Fila.
-- A sincronização (service role) anota `baixado_consistem_em` no item quando o lançamento sai dos abertos do Consistem.
-- Antecipação "já paga fora do Neo Admin": cap_antecipacoes_tratadas (motivo, quem; desfazível), para a lista não repeti-la.
-- Permissões (área Financeiro): operador monta rascunho, remove item de rascunho, marca antecipação tratada;
-- gestor autoriza, cancela e altera a data de corte. Quem montou pode autorizar a própria (fluxo real da diretoria).
-- Especificação: docs/modulos/financeiro-contas-pagar.md.
-- =========================================================

create type cap_status_autorizacao as enum ('rascunho', 'autorizada', 'cancelada');

-- 1) Cabeçalho -----------------------------------------------------
create table cap_autorizacoes (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique,
  empresa_id uuid not null references empresas(id),
  data date not null default (now() at time zone 'America/Cuiaba')::date,
  status cap_status_autorizacao not null default 'rascunho',
  observacao text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  autorizada_por uuid references perfis(id),
  autorizada_em timestamptz,
  cancelada_por uuid references perfis(id),
  cancelada_em timestamptz,
  motivo_cancelamento text,
  atualizado_em timestamptz not null default now(),
  constraint cap_aut_autorizada_registrada check (status <> 'autorizada' or (autorizada_por is not null and autorizada_em is not null)),
  constraint cap_aut_cancelada_registrada check (status <> 'cancelada' or (cancelada_por is not null and cancelada_em is not null and motivo_cancelamento is not null))
);
create index idx_cap_autorizacoes_status on cap_autorizacoes (status, data desc);

-- 2) Itens (cópia do lançamento no momento da autorização: prova) ----
create table cap_autorizacao_itens (
  id uuid primary key default gen_random_uuid(),
  autorizacao_id uuid not null references cap_autorizacoes(id),
  lancamento_id uuid not null references cap_lancamentos(id),
  tipo text not null check (tipo in ('titulo', 'antecipacao')),
  cod_lancamento text not null,
  cod_fornecedor text,
  fornecedor_nome text not null,
  fornecedor_documento varchar(18),
  num_documento text,
  categoria_doc text,
  data_emissao date,
  data_vencimento date,
  data_pagamento date,
  valor numeric(14,2) not null check (valor > 0),       -- saldo no momento (o que se autoriza pagar)
  valor_original numeric(14,2),
  complemento_historico text,
  cod_banco text,
  cod_portador text,
  cod_barras text,
  qrcode_pix text,
  ordem int not null default 0,
  removido_em timestamptz,                               -- só em rascunho; nunca delete
  removido_por uuid references perfis(id),
  motivo_remocao text,
  baixado_consistem_em date,                             -- anotado pela sincronização quando o lançamento sai dos abertos
  criado_em timestamptz not null default now(),
  unique (autorizacao_id, lancamento_id)
);
create index idx_cap_itens_lancamento on cap_autorizacao_itens (lancamento_id) where removido_em is null;

-- 3) Antecipações já pagas fora do Neo Admin -------------------------
create table cap_antecipacoes_tratadas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  lancamento_id uuid not null references cap_lancamentos(id),
  cod_lancamento text not null,
  motivo text not null,
  tratada_por uuid references perfis(id) default auth.uid(),
  tratada_em timestamptz not null default now(),
  desfeita_em timestamptz,
  desfeita_por uuid references perfis(id),
  motivo_desfazer text
);
create unique index uq_cap_tratada_ativa on cap_antecipacoes_tratadas (lancamento_id) where desfeita_em is null;

-- 4) Gatilhos de regra ---------------------------------------------------
-- Cabeçalho: transições de status e campos imutáveis. security definer para consultar os itens e carimbar quem/quando.
create function fn_cap_autorizacao_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;                                   -- service role: não usa esta tabela (fica livre, como nas mensagens)
  end if;

  if tg_op = 'INSERT' then
    new.status := 'rascunho';
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.autorizada_por := null; new.autorizada_em := null;
    new.cancelada_por := null;  new.cancelada_em := null; new.motivo_cancelamento := null;
    return new;
  end if;

  -- UPDATE: o que nunca muda
  new.numero := old.numero; new.empresa_id := old.empresa_id; new.data := old.data;
  new.criado_por := old.criado_por; new.criado_em := old.criado_em;

  if old.status = 'cancelada' then
    raise exception 'A autorização nº % está cancelada e não pode mais ser alterada.', old.numero;
  end if;
  if old.status = 'autorizada' and new.status = 'rascunho' then
    raise exception 'A autorização nº % já foi autorizada e não volta a rascunho.', old.numero;
  end if;
  if old.status <> 'rascunho' and new.observacao is distinct from old.observacao then
    raise exception 'A observação só pode ser alterada enquanto a autorização é rascunho.';
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

create trigger trg_cap_autorizacoes_regras before insert or update on cap_autorizacoes for each row execute function fn_cap_autorizacao_regras();
create trigger trg_cap_autorizacoes_atualizado before update on cap_autorizacoes for each row execute function fn_atualizado_em();
create trigger trg_cap_autorizacoes_sem_delete before delete on cap_autorizacoes for each row execute function fn_bloquear_delete();
create trigger trg_aud_cap_autorizacoes after insert or update on cap_autorizacoes for each row execute function fn_auditoria();

-- Itens: imutáveis. Usuário só remove (em rascunho, com motivo); service role só anota a baixa no Consistem.
create function fn_cap_item_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status cap_status_autorizacao;
  v_numero int;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then return new; end if;
    select status, numero into v_status, v_numero from cap_autorizacoes where id = new.autorizacao_id;
    if v_status is distinct from 'rascunho' then
      raise exception 'Só é possível incluir itens em uma autorização em rascunho.';
    end if;
    new.removido_em := null; new.removido_por := null; new.motivo_remocao := null; new.baixado_consistem_em := null; new.criado_em := now();
    return new;
  end if;

  if auth.uid() is null then
    if (to_jsonb(new) - 'baixado_consistem_em') <> (to_jsonb(old) - 'baixado_consistem_em') then
      raise exception 'Itens de autorização são imutáveis (a sincronização só anota a baixa no Consistem).';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - 'removido_em' - 'removido_por' - 'motivo_remocao') <> (to_jsonb(old) - 'removido_em' - 'removido_por' - 'motivo_remocao') then
    raise exception 'Itens de autorização são imutáveis; só podem ser removidos enquanto a autorização é rascunho.';
  end if;
  if old.removido_em is not null then
    raise exception 'Este item já foi removido da autorização.';
  end if;
  if new.removido_em is not null then
    select status, numero into v_status, v_numero from cap_autorizacoes where id = old.autorizacao_id;
    if v_status <> 'rascunho' then
      raise exception 'Itens só podem ser removidos enquanto a autorização nº % é rascunho.', v_numero;
    end if;
    if coalesce(trim(new.motivo_remocao), '') = '' then
      raise exception 'Informe o motivo da remoção.';
    end if;
    new.removido_por := auth.uid();
    new.removido_em := now();
  end if;
  return new;
end $$;

create trigger trg_cap_itens_regras before insert or update on cap_autorizacao_itens for each row execute function fn_cap_item_regras();
create trigger trg_cap_itens_sem_delete before delete on cap_autorizacao_itens for each row execute function fn_bloquear_delete();
create trigger trg_aud_cap_itens after insert or update on cap_autorizacao_itens for each row execute function fn_auditoria();

-- Antecipações tratadas: só "desfazer" muda o registro.
create function fn_cap_tratada_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.tratada_por := auth.uid(); new.tratada_em := now();
    new.desfeita_em := null; new.desfeita_por := null; new.motivo_desfazer := null;
    return new;
  end if;
  if (to_jsonb(new) - 'desfeita_em' - 'desfeita_por' - 'motivo_desfazer') <> (to_jsonb(old) - 'desfeita_em' - 'desfeita_por' - 'motivo_desfazer') then
    raise exception 'A marcação de antecipação paga fora do Neo Admin só pode ser desfeita, não alterada.';
  end if;
  if old.desfeita_em is not null then
    raise exception 'Esta marcação já foi desfeita.';
  end if;
  if new.desfeita_em is not null then
    if coalesce(trim(new.motivo_desfazer), '') = '' then
      raise exception 'Informe o motivo para desfazer.';
    end if;
    new.desfeita_por := auth.uid(); new.desfeita_em := now();
  end if;
  return new;
end $$;

create trigger trg_cap_tratadas_regras before insert or update on cap_antecipacoes_tratadas for each row execute function fn_cap_tratada_regras();
create trigger trg_cap_tratadas_sem_delete before delete on cap_antecipacoes_tratadas for each row execute function fn_bloquear_delete();
create trigger trg_aud_cap_tratadas after insert or update on cap_antecipacoes_tratadas for each row execute function fn_auditoria();

-- 5) Views ----------------------------------------------------------------
-- Pendentes: o que a tela "Autorizar pagamento" lista (C e A em aberto), com fornecedor, autorização ativa e marcação de tratada.
create view cap_vw_pendentes with (security_invoker = true) as
select l.id, l.empresa_id, l.cod_lancamento, l.tipo_lancamento, l.cod_fornecedor, l.num_documento, l.categoria_doc, l.cod_banco,
       l.complemento_historico, l.data_emissao, l.data_vencimento, l.data_pagamento, l.valor_documento, l.valor_atualizado,
       f.nome as fornecedor_nome, f.documento as fornecedor_documento,
       a.id as autorizacao_id, a.numero as autorizacao_numero, a.status as autorizacao_status,
       t.id as tratada_id, t.motivo as tratada_motivo, t.tratada_em
  from cap_lancamentos l
  left join cap_fornecedores f on f.empresa_id = l.empresa_id and f.cod_fornecedor = l.cod_fornecedor
  left join lateral (
    select a.id, a.numero, a.status
      from cap_autorizacao_itens i join cap_autorizacoes a on a.id = i.autorizacao_id
     where i.lancamento_id = l.id and i.removido_em is null and a.status in ('rascunho', 'autorizada')
     order by a.criado_em desc limit 1
  ) a on true
  left join cap_antecipacoes_tratadas t on t.lancamento_id = l.id and t.desfeita_em is null
 where l.baixado_em is null and l.valor_atualizado > 0 and l.tipo_lancamento in ('C', 'A');

-- Autorizações com totais e nomes (histórico e detalhe).
create view cap_vw_autorizacoes with (security_invoker = true) as
select a.*, e.nome_curto as empresa_nome, e.razao_social as empresa_razao_social, e.cnpj as empresa_cnpj,
       pc.nome as criado_por_nome, pa.nome as autorizada_por_nome, pk.nome as cancelada_por_nome,
       coalesce(i.itens, 0)::int as itens, coalesce(i.titulos, 0)::int as titulos, coalesce(i.antecipacoes, 0)::int as antecipacoes,
       coalesce(i.total_titulos, 0)::numeric(14,2) as total_titulos, coalesce(i.total_antecipacoes, 0)::numeric(14,2) as total_antecipacoes,
       coalesce(i.total, 0)::numeric(14,2) as total, coalesce(i.baixados, 0)::int as baixados
  from cap_autorizacoes a
  join empresas e on e.id = a.empresa_id
  left join perfis pc on pc.id = a.criado_por
  left join perfis pa on pa.id = a.autorizada_por
  left join perfis pk on pk.id = a.cancelada_por
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

-- 6) Funções de negócio ("tudo ou nada"; security invoker: a RLS de quem chama vale) ----------------
create function cap_formatar_reais(p numeric) returns text language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(p, 0), 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.');
$$;

create function cap_autorizar(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atual int;
  v_numero int;
  v_empresa uuid;
  v_itens int;
  v_total numeric(14,2);
  v_prazo date;
  v_titulo text;
begin
  update cap_autorizacoes set status = 'autorizada' where id = p_id and status = 'rascunho';
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Autorização não encontrada, já autorizada ou cancelada (ou você não tem acesso a ela).';
  end if;
  select numero, empresa_id into v_numero, v_empresa from cap_autorizacoes where id = p_id;
  select count(*), coalesce(sum(valor), 0), min(coalesce(data_vencimento, data_pagamento, v_hoje))
    into v_itens, v_total, v_prazo
    from cap_autorizacao_itens where autorizacao_id = p_id and removido_em is null;
  if v_prazo is null or v_prazo < v_hoje then v_prazo := v_hoje; end if;

  v_titulo := 'Executar autorização de pagamento nº ' || v_numero || ' — ' || cap_formatar_reais(v_total);
  insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
  select 'financeiro.contas-pagar', v_empresa, v_titulo,
         'A diretoria autorizou o pagamento de ' || v_itens || case when v_itens = 1 then ' item' else ' itens' end || ' (' || cap_formatar_reais(v_total) || '). Abra a autorização, imprima o relatório, faça os pagamentos e dê baixa no Consistem. Depois conclua esta pendência.',
         v_prazo, case when v_prazo <= v_hoje + 3 then 'alta'::criticidade else 'normal'::criticidade end,
         'cap_autorizacoes', p_id, '/financeiro/contas-pagar/autorizacoes/' || p_id
   where not exists (
     select 1 from pendencias where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'cap_autorizacoes' and referencia_id = p_id
        and titulo = v_titulo and status in ('aberta', 'em_andamento'));
  return jsonb_build_object('numero', v_numero, 'itens', v_itens, 'total', v_total, 'prazo', v_prazo);
end $$;

create function cap_criar_autorizacao(p_empresa uuid, p_lancamentos uuid[], p_observacao text default null, p_data date default null, p_autorizar boolean default false)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_ok int;
  v_numero int;
  v_id uuid;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_corte date;
  v_cod text;
  v_num int;
  v_forn text;
  v_itens int;
  v_tot_t numeric(14,2);
  v_tot_a numeric(14,2);
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode montar uma autorização de pagamento.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_lancamentos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos um item.';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'Uma autorização aceita no máximo 500 itens (marcados: %).', cardinality(v_ids);
  end if;
  if not exists (select 1 from empresas where id = p_empresa and ativa) then
    raise exception 'Empresa inválida.';
  end if;
  if p_data is not null and (p_data < v_hoje - 30 or p_data > v_hoje + 30) then
    raise exception 'A data da autorização deve ficar até 30 dias antes ou depois de hoje.';
  end if;

  -- numeração sem buracos e sem corrida com outra autorização
  lock table cap_autorizacoes in share row exclusive mode;

  select count(*) into v_ok from cap_lancamentos
   where id = any(v_ids) and empresa_id = p_empresa and baixado_em is null and valor_atualizado > 0 and tipo_lancamento in ('C', 'A');
  if v_ok <> cardinality(v_ids) then
    raise exception 'Um dos itens marcados já saiu dos abertos do Consistem, não é título/antecipação ou não é desta empresa. Atualize a lista e tente de novo.';
  end if;

  select l.cod_lancamento, a.numero, f.nome into v_cod, v_num, v_forn
    from cap_autorizacao_itens i
    join cap_autorizacoes a on a.id = i.autorizacao_id
    join cap_lancamentos l on l.id = i.lancamento_id
    left join cap_fornecedores f on f.empresa_id = l.empresa_id and f.cod_fornecedor = l.cod_fornecedor
   where i.lancamento_id = any(v_ids) and i.removido_em is null and a.status in ('rascunho', 'autorizada')
   limit 1;
  if v_cod is not null then
    raise exception 'O lançamento % (%) já está na autorização nº %.', v_cod, coalesce(v_forn, 'fornecedor'), v_num;
  end if;

  select l.cod_lancamento into v_cod
    from cap_antecipacoes_tratadas t join cap_lancamentos l on l.id = t.lancamento_id
   where t.lancamento_id = any(v_ids) and t.desfeita_em is null limit 1;
  if v_cod is not null then
    raise exception 'A antecipação % foi marcada como já paga fora do Neo Admin. Desfaça a marcação antes de incluí-la.', v_cod;
  end if;

  select nullif(valor #>> '{}', '')::date into v_corte from configuracoes
   where chave = 'financeiro.contas-pagar.antecipacoes_a_partir_de' and jsonb_typeof(valor) = 'string';
  if v_corte is not null then
    select cod_lancamento into v_cod from cap_lancamentos
     where id = any(v_ids) and tipo_lancamento = 'A' and coalesce(data_pagamento, data_emissao) < v_corte limit 1;
    if v_cod is not null then
      raise exception 'A antecipação % é anterior à data de corte (%) e é considerada paga fora do Neo Admin.', v_cod, to_char(v_corte, 'DD/MM/YYYY');
    end if;
  end if;

  select coalesce(max(numero), 0) + 1 into v_numero from cap_autorizacoes;
  insert into cap_autorizacoes (numero, empresa_id, data, observacao)
  values (v_numero, p_empresa, coalesce(p_data, v_hoje), nullif(trim(p_observacao), ''))
  returning id into v_id;

  insert into cap_autorizacao_itens (autorizacao_id, lancamento_id, tipo, cod_lancamento, cod_fornecedor, fornecedor_nome, fornecedor_documento,
                                     num_documento, categoria_doc, data_emissao, data_vencimento, data_pagamento, valor, valor_original,
                                     complemento_historico, cod_banco, cod_portador, cod_barras, qrcode_pix, ordem)
  select v_id, l.id, case when l.tipo_lancamento = 'A' then 'antecipacao' else 'titulo' end, l.cod_lancamento, l.cod_fornecedor,
         coalesce(f.nome, 'Fornecedor ' || coalesce(l.cod_fornecedor, '?')), f.documento,
         l.num_documento, l.categoria_doc, l.data_emissao, l.data_vencimento, l.data_pagamento, l.valor_atualizado, l.valor_documento,
         l.complemento_historico, l.cod_banco, l.cod_portador, l.cod_barras, l.qrcode_pix,
         row_number() over (order by case when l.tipo_lancamento = 'A' then 1 else 0 end, coalesce(l.data_vencimento, l.data_pagamento, l.data_emissao), f.nome, l.cod_lancamento)
    from cap_lancamentos l
    left join cap_fornecedores f on f.empresa_id = l.empresa_id and f.cod_fornecedor = l.cod_fornecedor
   where l.id = any(v_ids);

  select count(*), coalesce(sum(valor) filter (where tipo = 'titulo'), 0), coalesce(sum(valor) filter (where tipo = 'antecipacao'), 0)
    into v_itens, v_tot_t, v_tot_a from cap_autorizacao_itens where autorizacao_id = v_id;

  if p_autorizar then
    perform cap_autorizar(v_id);
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'itens', v_itens, 'total_titulos', v_tot_t, 'total_antecipacoes', v_tot_a,
                            'status', (select status from cap_autorizacoes where id = v_id));
end $$;

create function cap_cancelar(p_id uuid, p_motivo text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_atual int;
  v_numero int;
  v_pend int;
begin
  update cap_autorizacoes set status = 'cancelada', motivo_cancelamento = nullif(trim(p_motivo), '')
   where id = p_id and status in ('rascunho', 'autorizada');
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Autorização não encontrada ou já cancelada (ou você não tem acesso a ela).';
  end if;
  select numero into v_numero from cap_autorizacoes where id = p_id;
  update pendencias set status = 'cancelada'
   where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'cap_autorizacoes' and referencia_id = p_id and status in ('aberta', 'em_andamento');
  get diagnostics v_pend = row_count;
  return jsonb_build_object('numero', v_numero, 'pendencias_canceladas', v_pend);
end $$;

create function cap_remover_item(p_item uuid, p_motivo text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_atual int;
  v_restantes int;
  v_aut uuid;
begin
  update cap_autorizacao_itens set removido_em = now(), motivo_remocao = nullif(trim(p_motivo), '')
   where id = p_item and removido_em is null
  returning autorizacao_id into v_aut;
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Item não encontrado ou já removido (ou você não tem acesso a ele).';
  end if;
  select count(*) into v_restantes from cap_autorizacao_itens where autorizacao_id = v_aut and removido_em is null;
  return jsonb_build_object('restantes', v_restantes);
end $$;

create function cap_marcar_antecipacao_tratada(p_lancamento uuid, p_motivo text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_empresa uuid;
  v_cod text;
  v_tipo char(1);
  v_num int;
  v_id uuid;
begin
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo (ex.: paga em 02/10 pelo borderô 123).';
  end if;
  select empresa_id, cod_lancamento, tipo_lancamento into v_empresa, v_cod, v_tipo from cap_lancamentos where id = p_lancamento;
  if v_cod is null then
    raise exception 'Lançamento não encontrado (ou você não tem acesso a ele).';
  end if;
  if v_tipo <> 'A' then
    raise exception 'Só antecipações podem ser marcadas como pagas fora do Neo Admin.';
  end if;
  select a.numero into v_num from cap_autorizacao_itens i join cap_autorizacoes a on a.id = i.autorizacao_id
   where i.lancamento_id = p_lancamento and i.removido_em is null and a.status in ('rascunho', 'autorizada') limit 1;
  if v_num is not null then
    raise exception 'A antecipação % está na autorização nº %; cancele-a ou remova o item antes.', v_cod, v_num;
  end if;
  if exists (select 1 from cap_antecipacoes_tratadas where lancamento_id = p_lancamento and desfeita_em is null) then
    raise exception 'A antecipação % já está marcada como paga fora do Neo Admin.', v_cod;
  end if;
  insert into cap_antecipacoes_tratadas (empresa_id, lancamento_id, cod_lancamento, motivo)
  values (v_empresa, p_lancamento, v_cod, trim(p_motivo)) returning id into v_id;
  return jsonb_build_object('id', v_id, 'cod_lancamento', v_cod);
end $$;

create function cap_desfazer_antecipacao_tratada(p_id uuid, p_motivo text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_atual int;
begin
  update cap_antecipacoes_tratadas set desfeita_em = now(), motivo_desfazer = nullif(trim(p_motivo), '')
   where id = p_id and desfeita_em is null;
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Marcação não encontrada ou já desfeita (ou você não tem acesso a ela).';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Parâmetros do módulo (hoje só a data de corte). security definer: a RLS de `configuracoes` só deixa o admin geral gravar direto.
create function cap_salvar_parametros(p_parametros jsonb) returns void
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

revoke all on function cap_autorizar(uuid) from public, anon;
grant execute on function cap_autorizar(uuid) to authenticated;
revoke all on function cap_criar_autorizacao(uuid, uuid[], text, date, boolean) from public, anon;
grant execute on function cap_criar_autorizacao(uuid, uuid[], text, date, boolean) to authenticated;
revoke all on function cap_cancelar(uuid, text) from public, anon;
grant execute on function cap_cancelar(uuid, text) to authenticated;
revoke all on function cap_remover_item(uuid, text) from public, anon;
grant execute on function cap_remover_item(uuid, text) to authenticated;
revoke all on function cap_marcar_antecipacao_tratada(uuid, text) from public, anon;
grant execute on function cap_marcar_antecipacao_tratada(uuid, text) to authenticated;
revoke all on function cap_desfazer_antecipacao_tratada(uuid, text) from public, anon;
grant execute on function cap_desfazer_antecipacao_tratada(uuid, text) to authenticated;
revoke all on function cap_salvar_parametros(jsonb) from public, anon;
grant execute on function cap_salvar_parametros(jsonb) to authenticated;

-- 7) RLS -------------------------------------------------------------------
alter table cap_autorizacoes enable row level security;
alter table cap_autorizacao_itens enable row level security;
alter table cap_antecipacoes_tratadas enable row level security;

create policy cap_autorizacoes_ler on cap_autorizacoes for select to authenticated using (tem_acesso_area('financeiro'));
create policy cap_autorizacoes_inserir on cap_autorizacoes for insert to authenticated
  with check (tem_acesso_area('financeiro', 'operador') and criado_por = auth.uid());
create policy cap_autorizacoes_alterar on cap_autorizacoes for update to authenticated
  using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));
-- Sem delete: o gatilho bloqueia e não há política.

create policy cap_itens_ler on cap_autorizacao_itens for select to authenticated using (tem_acesso_area('financeiro'));
create policy cap_itens_inserir on cap_autorizacao_itens for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
create policy cap_itens_alterar on cap_autorizacao_itens for update to authenticated
  using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));

create policy cap_tratadas_ler on cap_antecipacoes_tratadas for select to authenticated using (tem_acesso_area('financeiro'));
create policy cap_tratadas_inserir on cap_antecipacoes_tratadas for insert to authenticated
  with check (tem_acesso_area('financeiro', 'operador') and tratada_por = auth.uid());
create policy cap_tratadas_alterar on cap_antecipacoes_tratadas for update to authenticated
  using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));
