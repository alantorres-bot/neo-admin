-- =========================================================
-- Neo Admin — 0123 Contas a pagar: borderô pela API, caixa disponível (Fase 4a)
-- 1) Antecipação paga = tem borderô no Consistem. A API não devolve o número, mas o filtro dinâmico da listagem
--    (campoFiltroDinamico=codBordero & valorFiltroDinamico=%) devolve só os lançamentos COM borderô. A Edge Function
--    cap-sincronizar-consistem passa a consultar isso para as antecipações abertas e grava `tem_bordero` (nulo = ainda não
--    verificado). Antecipação com borderô sai da lista de pendentes e não entra em autorização.
-- 2) "Caixa disponível": a diretoria informa quanto tem em caixa ao montar a autorização; o relatório fecha com caixa,
--    total autorizado e excedente. Ultrapassar o caixa não bloqueia nada (é aviso).
-- Especificação: docs/modulos/financeiro-contas-pagar.md (seção 15).
-- =========================================================

alter table cap_lancamentos add column tem_bordero boolean;
alter table cap_lancamentos add column bordero_visto_em timestamptz;
create index idx_cap_lancamentos_bordero on cap_lancamentos (empresa_id, tem_bordero) where tipo_lancamento = 'A' and baixado_em is null;

alter table cap_autorizacoes add column caixa_disponivel numeric(14,2) check (caixa_disponivel is null or caixa_disponivel >= 0);

-- Gatilho do cabeçalho: o caixa só muda enquanto a autorização é rascunho (como a observação).
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
    return new;
  end if;

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

-- Views recriadas (a de pendentes ganha o borderô; a de autorizações ganha caixa e excedente).
drop view cap_vw_pendentes;
create view cap_vw_pendentes with (security_invoker = true) as
select l.id, l.empresa_id, l.cod_lancamento, l.tipo_lancamento, l.cod_fornecedor, l.num_documento, l.categoria_doc, l.cod_banco,
       l.complemento_historico, l.data_emissao, l.data_vencimento, l.data_pagamento, l.valor_documento, l.valor_atualizado,
       l.tem_bordero, l.bordero_visto_em,
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

drop view cap_vw_autorizacoes;
create view cap_vw_autorizacoes with (security_invoker = true) as
select a.*, e.nome_curto as empresa_nome, e.razao_social as empresa_razao_social, e.cnpj as empresa_cnpj,
       pc.nome as criado_por_nome, pa.nome as autorizada_por_nome, pk.nome as cancelada_por_nome,
       coalesce(i.itens, 0)::int as itens, coalesce(i.titulos, 0)::int as titulos, coalesce(i.antecipacoes, 0)::int as antecipacoes,
       coalesce(i.total_titulos, 0)::numeric(14,2) as total_titulos, coalesce(i.total_antecipacoes, 0)::numeric(14,2) as total_antecipacoes,
       coalesce(i.total, 0)::numeric(14,2) as total, coalesce(i.baixados, 0)::int as baixados,
       case when a.caixa_disponivel is null then null else greatest(coalesce(i.total, 0) - a.caixa_disponivel, 0)::numeric(14,2) end as excedente
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

-- cap_criar_autorizacao: ganha o caixa e recusa antecipação paga (com borderô).
drop function cap_criar_autorizacao(uuid, uuid[], text, date, boolean);
create function cap_criar_autorizacao(p_empresa uuid, p_lancamentos uuid[], p_observacao text default null, p_data date default null, p_autorizar boolean default false, p_caixa numeric default null)
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
  if p_caixa is not null and (p_caixa < 0 or p_caixa > 1000000000) then
    raise exception 'Caixa disponível inválido.';
  end if;

  lock table cap_autorizacoes in share row exclusive mode;

  select count(*) into v_ok from cap_lancamentos
   where id = any(v_ids) and empresa_id = p_empresa and baixado_em is null and valor_atualizado > 0 and tipo_lancamento in ('C', 'A');
  if v_ok <> cardinality(v_ids) then
    raise exception 'Um dos itens marcados já saiu dos abertos do Consistem, não é título/antecipação ou não é desta empresa. Atualize a lista e tente de novo.';
  end if;

  select cod_lancamento into v_cod from cap_lancamentos where id = any(v_ids) and tipo_lancamento = 'A' and tem_bordero = true limit 1;
  if v_cod is not null then
    raise exception 'A antecipação % já foi paga (tem borderô no Consistem). Atualize a lista.', v_cod;
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
  insert into cap_autorizacoes (numero, empresa_id, data, observacao, caixa_disponivel)
  values (v_numero, p_empresa, coalesce(p_data, v_hoje), nullif(trim(p_observacao), ''), p_caixa)
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
                            'caixa_disponivel', p_caixa, 'status', (select status from cap_autorizacoes where id = v_id));
end $$;
revoke all on function cap_criar_autorizacao(uuid, uuid[], text, date, boolean, numeric) from public, anon;
grant execute on function cap_criar_autorizacao(uuid, uuid[], text, date, boolean, numeric) to authenticated;

-- Ajustar o caixa de um rascunho.
create function cap_definir_caixa(p_id uuid, p_caixa numeric) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_atual int;
begin
  if p_caixa is not null and (p_caixa < 0 or p_caixa > 1000000000) then
    raise exception 'Caixa disponível inválido.';
  end if;
  update cap_autorizacoes set caixa_disponivel = p_caixa where id = p_id and status = 'rascunho';
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Autorização não encontrada ou já não está em rascunho (ou você não tem acesso a ela).';
  end if;
  return jsonb_build_object('caixa_disponivel', p_caixa);
end $$;
revoke all on function cap_definir_caixa(uuid, numeric) from public, anon;
grant execute on function cap_definir_caixa(uuid, numeric) to authenticated;

-- Antecipação paga (com borderô) não precisa ser marcada como "paga fora".
create or replace function cap_marcar_antecipacao_tratada(p_lancamento uuid, p_motivo text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_empresa uuid;
  v_cod text;
  v_tipo char(1);
  v_bordero boolean;
  v_num int;
  v_id uuid;
begin
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo (ex.: paga em 02/10 pelo borderô 123).';
  end if;
  select empresa_id, cod_lancamento, tipo_lancamento, tem_bordero into v_empresa, v_cod, v_tipo, v_bordero from cap_lancamentos where id = p_lancamento;
  if v_cod is null then
    raise exception 'Lançamento não encontrado (ou você não tem acesso a ele).';
  end if;
  if v_tipo <> 'A' then
    raise exception 'Só antecipações podem ser marcadas como pagas fora do Neo Admin.';
  end if;
  if v_bordero = true then
    raise exception 'A antecipação % já consta como paga (tem borderô no Consistem); não precisa marcar.', v_cod;
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
