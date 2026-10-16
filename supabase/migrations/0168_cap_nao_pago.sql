-- =========================================================
-- Neo Admin — 0168 Contas a pagar: "Não pago" na conferência com o banco (pedido do Alan, 16/10/2026)
-- Na conferência nem tudo é pago (ex.: Barra Forte, R$ 39 mil, em 15/10/2026). O item autorizado e não pago é marcado como
-- conferencia_banco = 'nao_pago' (motivo obrigatório, quem/quando carimbados): continua na autorização como prova, mas deixa de
-- "prender" o lançamento — ele volta à tela Autorizar pagamento e pode entrar numa nova autorização.
-- Sempre pelo Consistem: só marca "não pago" se o lançamento ainda está em aberto no espelho (baixado_em nulo e saldo > 0), e a
-- lista/inclusão continuam exigindo o mesmo. Desfazer o "não pago" é recusado se o lançamento já entrou em outra autorização ativa.
-- Só itens do Consistem (títulos e antecipações); pagamentos extras não têm lista para onde voltar.
-- Especificação: docs/modulos/financeiro-contas-pagar.md (seção 17).
-- =========================================================

alter table cap_autorizacao_itens drop constraint cap_autorizacao_itens_conferencia_banco_check;
alter table cap_autorizacao_itens add constraint cap_autorizacao_itens_conferencia_banco_check
  check (conferencia_banco in ('conferido', 'divergente', 'nao_pago'));
comment on column cap_autorizacao_itens.conferencia_banco is
  'Conferência com o banco (Fase 4e): conferido | divergente | nao_pago (não pago; o lançamento volta à lista) | nulo = não conferido.';

-- Regra comum da conferência: "não pago" exige o motivo (observação) e não tem valor do banco.
create or replace function fn_cap_aplicar_conferencia(p_new jsonb, p_autorizacao uuid, p_removido timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status cap_status_autorizacao;
  v_codigo text;
  v_situacao text := p_new->>'conferencia_banco';
  v_obs text := nullif(trim(coalesce(p_new->>'observacao_conferencia', '')), '');
begin
  select status, codigo into v_status, v_codigo from cap_autorizacoes where id = p_autorizacao;
  if v_status is distinct from 'autorizada' then
    raise exception 'A conferência com o banco só vale para autorização autorizada.';
  end if;
  if p_removido is not null then
    raise exception 'Este item foi removido da autorização % e não entra na conferência.', v_codigo;
  end if;
  if v_situacao is null then
    return p_new || jsonb_build_object('valor_banco', null, 'observacao_conferencia', null,
                                       'conferido_banco_por', null, 'conferido_banco_em', null);
  end if;
  if v_situacao = 'divergente' and p_new->>'valor_banco' is null and v_obs is null then
    raise exception 'Para marcar divergente, informe o valor que está no banco ou uma observação.';
  end if;
  if v_situacao = 'nao_pago' and v_obs is null then
    raise exception 'Para marcar como não pago, informe o motivo (ex.: sem saldo, fica para amanhã).';
  end if;
  if v_situacao in ('conferido', 'nao_pago') then
    p_new := p_new || jsonb_build_object('valor_banco', null);
  end if;
  return p_new || jsonb_build_object('observacao_conferencia', v_obs, 'conferido_banco_por', auth.uid(), 'conferido_banco_em', now());
end $$;

-- Gatilho dos itens: a conferência ganha as duas travas do "não pago" (em aberto no Consistem; desfazer sem outra autorização ativa).
create or replace function fn_cap_item_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status cap_status_autorizacao;
  v_codigo text;
  v_outra text;
  v_conf constant text[] := array['conferencia_banco', 'valor_banco', 'observacao_conferencia', 'conferido_banco_por', 'conferido_banco_em'];
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then return new; end if;
    select status, codigo into v_status, v_codigo from cap_autorizacoes where id = new.autorizacao_id;
    if v_status is distinct from 'rascunho' then
      raise exception 'Só é possível incluir itens em uma autorização em rascunho.';
    end if;
    new.removido_em := null; new.removido_por := null; new.motivo_remocao := null; new.baixado_consistem_em := null; new.confirmado_consistem_em := null; new.criado_em := now();
    new.conferencia_banco := null; new.valor_banco := null; new.observacao_conferencia := null; new.conferido_banco_por := null; new.conferido_banco_em := null;
    return new;
  end if;

  if auth.uid() is null then
    if (to_jsonb(new) - 'baixado_consistem_em' - 'confirmado_consistem_em') <> (to_jsonb(old) - 'baixado_consistem_em' - 'confirmado_consistem_em') then
      raise exception 'Itens de autorização são imutáveis (a sincronização só anota a baixa e a confirmação no Consistem).';
    end if;
    return new;
  end if;

  -- Conferência com o banco: só as cinco colunas mudam.
  if (to_jsonb(new) - v_conf) = (to_jsonb(old) - v_conf) and to_jsonb(new) <> to_jsonb(old) then
    if new.conferencia_banco = 'nao_pago' and old.conferencia_banco is distinct from 'nao_pago' then
      if old.baixado_consistem_em is not null or not exists (
           select 1 from cap_lancamentos where id = old.lancamento_id and baixado_em is null and valor_atualizado > 0) then
        raise exception 'O lançamento % não está mais em aberto no Consistem (já foi baixado); não volta para a lista.', old.cod_lancamento;
      end if;
    end if;
    if old.conferencia_banco = 'nao_pago' and new.conferencia_banco is distinct from 'nao_pago' then
      select a.codigo into v_outra
        from cap_autorizacao_itens i join cap_autorizacoes a on a.id = i.autorizacao_id
       where i.lancamento_id = old.lancamento_id and i.id <> old.id and i.removido_em is null
         and i.conferencia_banco is distinct from 'nao_pago' and a.status in ('rascunho', 'autorizada')
       limit 1;
      if v_outra is not null then
        raise exception 'O lançamento % já entrou na autorização %; para desfazer o "não pago", tire-o de lá primeiro.', old.cod_lancamento, v_outra;
      end if;
    end if;
    return jsonb_populate_record(new, fn_cap_aplicar_conferencia(to_jsonb(new), old.autorizacao_id, old.removido_em));
  end if;

  if (to_jsonb(new) - 'removido_em' - 'removido_por' - 'motivo_remocao') <> (to_jsonb(old) - 'removido_em' - 'removido_por' - 'motivo_remocao') then
    raise exception 'Itens de autorização são imutáveis; só podem ser removidos enquanto a autorização é rascunho.';
  end if;
  select status, codigo into v_status, v_codigo from cap_autorizacoes where id = old.autorizacao_id;
  if old.removido_em is not null then
    -- Reativação (marcado de novo na tela): só em rascunho e só zerando os três campos.
    if new.removido_em is null and new.removido_por is null and new.motivo_remocao is null and v_status = 'rascunho' then
      return new;
    end if;
    raise exception 'Este item já foi removido da autorização.';
  end if;
  if new.removido_em is not null then
    if v_status <> 'rascunho' then
      raise exception 'Itens só podem ser removidos enquanto a autorização % é rascunho.', v_codigo;
    end if;
    if coalesce(trim(new.motivo_remocao), '') = '' then
      raise exception 'Informe o motivo da remoção.';
    end if;
    new.removido_por := auth.uid();
    new.removido_em := now();
  end if;
  return new;
end $$;

-- RPC da tela: aceita 'nao_pago' (só em item) e devolve também a contagem de não pagos.
create or replace function cap_conferir(p_origem text, p_id uuid, p_situacao text, p_valor_banco numeric default null, p_observacao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_atual int;
  v_aut uuid;
  v_linha jsonb;
  v_resumo jsonb;
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Só operador ou gestor do Financeiro marca a conferência com o banco.';
  end if;
  if p_situacao is not null and p_situacao not in ('conferido', 'divergente', 'nao_pago') then
    raise exception 'Situação de conferência inválida.';
  end if;
  if p_situacao = 'nao_pago' and p_origem <> 'item' then
    raise exception 'Só títulos e antecipações do Consistem podem ser marcados como não pagos.';
  end if;
  if p_origem = 'item' then
    update cap_autorizacao_itens
       set conferencia_banco = p_situacao, valor_banco = p_valor_banco, observacao_conferencia = p_observacao
     where id = p_id
    returning autorizacao_id, jsonb_build_object('conferencia_banco', conferencia_banco, 'valor_banco', valor_banco,
              'observacao_conferencia', observacao_conferencia, 'conferido_banco_em', conferido_banco_em) into v_aut, v_linha;
  elsif p_origem = 'extra' then
    update cap_autorizacao_extras
       set conferencia_banco = p_situacao, valor_banco = p_valor_banco, observacao_conferencia = p_observacao
     where id = p_id
    returning autorizacao_id, jsonb_build_object('conferencia_banco', conferencia_banco, 'valor_banco', valor_banco,
              'observacao_conferencia', observacao_conferencia, 'conferido_banco_em', conferido_banco_em) into v_aut, v_linha;
  else
    raise exception 'Origem inválida (item ou extra).';
  end if;
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Item não encontrado (ou você não tem acesso a ele).';
  end if;
  select jsonb_build_object('itens', itens + extras, 'conferidos', conferidos, 'divergentes', divergentes, 'nao_pagos', nao_pagos) into v_resumo
    from cap_vw_autorizacoes where id = v_aut;
  return v_linha || jsonb_build_object('resumo', v_resumo);
end $$;

-- Inclusão: item "não pago" não prende o lançamento.
-- 1) Acrescentar itens a um rascunho (validações) ------------------------------
create or replace function cap_adicionar_itens(p_autorizacao uuid, p_lancamentos uuid[]) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_status cap_status_autorizacao;
  v_empresa uuid;
  v_codigo text;
  v_ok int;
  v_atuais int;
  v_corte date;
  v_cod text;
  v_cod_aut text;
  v_forn text;
  v_ordem int;
  v_novos int;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode montar uma autorização de pagamento.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_lancamentos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    return jsonb_build_object('adicionados', 0);
  end if;

  select status, empresa_id, codigo into v_status, v_empresa, v_codigo from cap_autorizacoes where id = p_autorizacao for update;
  if v_status is null then
    raise exception 'Autorização não encontrada (ou você não tem acesso a ela).';
  end if;
  if v_status <> 'rascunho' then
    raise exception 'A autorização % não é mais rascunho; itens só entram em rascunho.', v_codigo;
  end if;
  select count(*) into v_atuais from cap_autorizacao_itens where autorizacao_id = p_autorizacao and removido_em is null;
  if v_atuais + cardinality(v_ids) > 500 then
    raise exception 'Uma autorização aceita no máximo 500 itens (ficaria com %).', v_atuais + cardinality(v_ids);
  end if;

  select count(*) into v_ok from cap_lancamentos
   where id = any(v_ids) and empresa_id = v_empresa and baixado_em is null and valor_atualizado > 0 and tipo_lancamento in ('C', 'A');
  if v_ok <> cardinality(v_ids) then
    raise exception 'Um dos itens marcados já saiu dos abertos do Consistem, não é título/antecipação ou não é desta empresa. Atualize a lista e tente de novo.';
  end if;

  select cod_lancamento into v_cod from cap_lancamentos where id = any(v_ids) and tipo_lancamento = 'A' and tem_bordero = true limit 1;
  if v_cod is not null then
    raise exception 'A antecipação % já foi paga (tem borderô no Consistem). Atualize a lista.', v_cod;
  end if;

  select l.cod_lancamento, a.codigo, f.nome into v_cod, v_cod_aut, v_forn
    from cap_autorizacao_itens i
    join cap_autorizacoes a on a.id = i.autorizacao_id
    join cap_lancamentos l on l.id = i.lancamento_id
    left join cap_fornecedores f on f.empresa_id = l.empresa_id and f.cod_fornecedor = l.cod_fornecedor
   where i.lancamento_id = any(v_ids) and i.removido_em is null and i.conferencia_banco is distinct from 'nao_pago' and a.status in ('rascunho', 'autorizada')
   limit 1;
  if v_cod is not null then
    raise exception 'O lançamento % (%) já está na autorização %.', v_cod, coalesce(v_forn, 'fornecedor'), v_cod_aut;
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

  select coalesce(max(ordem), 0) into v_ordem from cap_autorizacao_itens where autorizacao_id = p_autorizacao;
  -- Lançamento removido do rascunho e marcado de novo: a linha removida fica (prova); entra uma linha nova. Como há
  -- unique (autorizacao_id, lancamento_id), a nova inclusão reativa a linha removida em vez de inserir outra.
  update cap_autorizacao_itens set removido_em = null, removido_por = null, motivo_remocao = null
   where autorizacao_id = p_autorizacao and lancamento_id = any(v_ids) and removido_em is not null;

  insert into cap_autorizacao_itens (autorizacao_id, lancamento_id, tipo, cod_lancamento, cod_fornecedor, fornecedor_nome, fornecedor_documento,
                                     num_documento, categoria_doc, data_emissao, data_vencimento, data_pagamento, valor, valor_original,
                                     complemento_historico, cod_banco, cod_portador, cod_barras, qrcode_pix, ordem)
  select p_autorizacao, l.id, case when l.tipo_lancamento = 'A' then 'antecipacao' else 'titulo' end, l.cod_lancamento, l.cod_fornecedor,
         coalesce(f.nome, 'Fornecedor ' || coalesce(l.cod_fornecedor, '?')), f.documento,
         l.num_documento, l.categoria_doc, l.data_emissao, l.data_vencimento, l.data_pagamento, l.valor_atualizado, l.valor_documento,
         l.complemento_historico, l.cod_banco, l.cod_portador, l.cod_barras, l.qrcode_pix,
         v_ordem + row_number() over (order by case when l.tipo_lancamento = 'A' then 1 else 0 end, coalesce(l.data_vencimento, l.data_pagamento, l.data_emissao), f.nome, l.cod_lancamento)
    from cap_lancamentos l
    left join cap_fornecedores f on f.empresa_id = l.empresa_id and f.cod_fornecedor = l.cod_fornecedor
   where l.id = any(v_ids)
     and not exists (select 1 from cap_autorizacao_itens i where i.autorizacao_id = p_autorizacao and i.lancamento_id = l.id);
  get diagnostics v_novos = row_count;
  return jsonb_build_object('adicionados', cardinality(v_ids), 'inseridos', v_novos);
end $$;
revoke all on function cap_adicionar_itens(uuid, uuid[]) from public, anon;
grant execute on function cap_adicionar_itens(uuid, uuid[]) to authenticated;


-- Antecipação "já paga fora": item "não pago" também não prende.
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
   where i.lancamento_id = p_lancamento and i.removido_em is null and i.conferencia_banco is distinct from 'nao_pago' and a.status in ('rascunho', 'autorizada') limit 1;
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

-- Pendentes: item "não pago" não conta como autorização ativa; + a última autorização em que o lançamento ficou sem pagar.
drop view cap_vw_pendentes;
create view cap_vw_pendentes with (security_invoker = true) as
select l.id, l.empresa_id, l.cod_lancamento, l.tipo_lancamento, l.cod_fornecedor, l.num_documento, l.categoria_doc, l.cod_banco,
       l.complemento_historico, l.data_emissao, l.data_vencimento, l.data_pagamento, l.valor_documento, l.valor_atualizado,
       l.tem_bordero, l.bordero_visto_em, l.confirmado_consistem, l.confirmacao_vista_em,
       f.nome as fornecedor_nome, f.documento as fornecedor_documento,
       a.id as autorizacao_id, a.numero as autorizacao_numero, a.codigo as autorizacao_codigo, a.status as autorizacao_status,
       t.id as tratada_id, t.motivo as tratada_motivo, t.tratada_em,
       np.codigo as nao_pago_autorizacao_codigo, np.conferido_banco_em as nao_pago_em
  from cap_lancamentos l
  left join cap_fornecedores f on f.empresa_id = l.empresa_id and f.cod_fornecedor = l.cod_fornecedor
  left join lateral (
    select a.id, a.numero, a.codigo, a.status
      from cap_autorizacao_itens i join cap_autorizacoes a on a.id = i.autorizacao_id
     where i.lancamento_id = l.id and i.removido_em is null and i.conferencia_banco is distinct from 'nao_pago'
       and a.status in ('rascunho', 'autorizada')
     order by a.criado_em desc limit 1
  ) a on true
  left join lateral (
    select a.codigo, i.conferido_banco_em
      from cap_autorizacao_itens i join cap_autorizacoes a on a.id = i.autorizacao_id
     where i.lancamento_id = l.id and i.removido_em is null and i.conferencia_banco = 'nao_pago' and a.status = 'autorizada'
     order by i.conferido_banco_em desc limit 1
  ) np on true
  left join cap_antecipacoes_tratadas t on t.lancamento_id = l.id and t.desfeita_em is null
 where l.baixado_em is null and l.valor_atualizado > 0 and l.tipo_lancamento in ('C', 'A');

-- Autorizações: + não pagos (quantidade e R$). O item não pago não conta em "baixados" (a baixa, se vier, é de outra autorização).
drop view cap_vw_autorizacoes;
create view cap_vw_autorizacoes with (security_invoker = true) as
select a.*, e.nome_curto as empresa_nome, e.razao_social as empresa_razao_social, e.cnpj as empresa_cnpj,
       pc.nome as criado_por_nome, pa.nome as autorizada_por_nome, pk.nome as cancelada_por_nome, ps.nome as slack_enviada_por_nome,
       px.nome as excluida_por_nome,
       coalesce(i.itens, 0)::int as itens, coalesce(i.titulos, 0)::int as titulos, coalesce(i.antecipacoes, 0)::int as antecipacoes,
       coalesce(i.total_titulos, 0)::numeric(14,2) as total_titulos, coalesce(i.total_antecipacoes, 0)::numeric(14,2) as total_antecipacoes,
       coalesce(x.extras, 0)::int as extras, coalesce(x.total_extras, 0)::numeric(14,2) as total_extras,
       (coalesce(i.total, 0) + coalesce(x.total_extras, 0))::numeric(14,2) as total, coalesce(i.baixados, 0)::int as baixados,
       coalesce(i.confirmados, 0)::int as confirmados,
       case when a.caixa_disponivel is null then null
            else greatest(coalesce(i.total, 0) + coalesce(x.total_extras, 0) - a.caixa_disponivel, 0)::numeric(14,2) end as excedente,
       (coalesce(i.conferidos, 0) + coalesce(x.conferidos, 0))::int as conferidos,
       (coalesce(i.divergentes, 0) + coalesce(x.divergentes, 0))::int as divergentes,
       (coalesce(i.total_conferido, 0) + coalesce(x.total_conferido, 0))::numeric(14,2) as total_conferido,
       coalesce(i.nao_pagos, 0)::int as nao_pagos,
       coalesce(i.total_nao_pago, 0)::numeric(14,2) as total_nao_pago
  from cap_autorizacoes a
  join empresas e on e.id = a.empresa_id
  left join perfis pc on pc.id = a.criado_por
  left join perfis pa on pa.id = a.autorizada_por
  left join perfis pk on pk.id = a.cancelada_por
  left join perfis ps on ps.id = a.slack_enviada_por
  left join perfis px on px.id = a.excluida_por
  left join lateral (
    select count(*) as itens,
           count(*) filter (where tipo = 'titulo') as titulos,
           count(*) filter (where tipo = 'antecipacao') as antecipacoes,
           sum(valor) filter (where tipo = 'titulo') as total_titulos,
           sum(valor) filter (where tipo = 'antecipacao') as total_antecipacoes,
           sum(valor) as total,
           count(*) filter (where baixado_consistem_em is not null and conferencia_banco is distinct from 'nao_pago') as baixados,
           -- confirmado no Consistem e ainda não baixado (depois da baixa a confirmação já cumpriu o papel)
           count(*) filter (where confirmado_consistem_em is not null and baixado_consistem_em is null) as confirmados,
           count(*) filter (where conferencia_banco = 'conferido') as conferidos,
           count(*) filter (where conferencia_banco = 'divergente') as divergentes,
           sum(valor) filter (where conferencia_banco = 'conferido') as total_conferido,
           count(*) filter (where conferencia_banco = 'nao_pago') as nao_pagos,
           sum(valor) filter (where conferencia_banco = 'nao_pago') as total_nao_pago
      from cap_autorizacao_itens where autorizacao_id = a.id and removido_em is null
  ) i on true
  left join lateral (
    select count(*) as extras, sum(valor) as total_extras,
           count(*) filter (where conferencia_banco = 'conferido') as conferidos,
           count(*) filter (where conferencia_banco = 'divergente') as divergentes,
           sum(valor) filter (where conferencia_banco = 'conferido') as total_conferido
      from cap_autorizacao_extras where autorizacao_id = a.id and removido_em is null
  ) x on true;
