-- =========================================================
-- Neo Admin — 0147 Faturamento da Filial: carta de cessão só para quem pede
-- A carta de cessão de crédito é opcional: só vai ao cliente que pede (ex.: Capanema). Cliente que não aceita boleto de
-- factoring (ex.: Janeiro) nem sabe da cessão — operação "1 dia após o vencimento, sem boleto" — e não pode recebê-la.
--  - rec_clientes_config.exige_carta_cessao: marca no cadastro do cliente (ficha do cliente em Recebíveis).
--  - O kit só exige a carta quando há parcela cedida E o cliente tem a marca (antes: qualquer parcela cedida).
--  - rec_cliente_definir_carta_cessao(): grava a marca (operador do Financeiro) e recalcula os kits abertos do cliente.
--  - rec_clientes_config ganha leitura pela área Financeiro (estava sem política: só as funções liam).
-- =========================================================

alter table rec_clientes_config add column exige_carta_cessao boolean not null default false;

create policy rec_clientes_config_ler on rec_clientes_config for select to authenticated using (tem_acesso_area('financeiro'));
create trigger trg_aud_rec_clientes_config after insert or update or delete on rec_clientes_config for each row execute function fn_auditoria();

create or replace function rec_kit_atualizar_estagio(p_kit uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  k rec_kits%rowtype;
  v_titulos int;
  v_sem_boleto int;
  v_exige_carta boolean;
  v_carta boolean;
  v_novo text;
  v_titulo_pend text;
begin
  select * into k from rec_kits where id = p_kit for update;
  if not found or k.estagio in ('enviada', 'cancelada') then
    return k.estagio;
  end if;

  select count(*),
         count(*) filter (where t.forma_pagamento is distinct from 'transferencia' and not exists (
           select 1 from anexos a where a.referencia_tabela = 'rec_titulos' and a.referencia_id = t.id and a.tipo = 'boleto')),
         coalesce(bool_or(t.cedido and coalesce(c.exige_carta_cessao, false)), false)
    into v_titulos, v_sem_boleto, v_exige_carta
    from rec_kit_titulos kt join rec_titulos t on t.id = kt.titulo_id
    left join rec_clientes_config c on c.contraparte_id = t.contraparte_id
   where kt.kit_id = p_kit and t.estagio not in ('cancelado', 'renegociado');
  v_carta := exists (select 1 from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = p_kit and a.tipo = 'carta_cessao');

  v_novo := case
    when v_titulos = 0 then 'recebida'
    when v_sem_boleto = 0 and (not v_exige_carta or v_carta) then 'pronta'
    else 'implantada' end;

  if v_novo <> k.estagio then
    perform set_config('neo.rec_kit_estagio', 'on', true);
    update rec_kits
       set estagio = v_novo,
           implantada_em = case when v_novo in ('implantada', 'pronta') then coalesce(implantada_em, now()) else implantada_em end,
           pronta_em = case when v_novo = 'pronta' then now() else null end
     where id = p_kit;
    perform set_config('neo.rec_kit_estagio', '', true);
  end if;

  -- Pendências do kit (núcleo): a de implantar fecha quando há título; a de enviar existe só enquanto pronto.
  if v_novo <> 'recebida' then
    update pendencias set status = 'concluida'
     where modulo = 'financeiro.filial' and referencia_tabela = 'rec_kits' and referencia_id = p_kit
       and titulo like 'Implantar fatura da filial%' and status in ('aberta', 'em_andamento');
  end if;
  v_titulo_pend := format('Enviar kit ao cliente: NF %s — %s', k.nota_fiscal, k.cliente_nome);
  if v_novo = 'pronta' then
    insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    values ('financeiro.filial', k.empresa_id, v_titulo_pend,
            'NF, demonstrativo, comodato e boleto prontos. Gere o rascunho do e-mail e envie ao cliente.',
            (now() at time zone 'America/Cuiaba')::date, 'alta', 'rec_kits', p_kit, '/financeiro/filial/' || p_kit)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  else
    update pendencias set status = 'cancelada'
     where modulo = 'financeiro.filial' and referencia_tabela = 'rec_kits' and referencia_id = p_kit
       and titulo like 'Enviar kit ao cliente%' and status in ('aberta', 'em_andamento');
  end if;
  return v_novo;
end $$;

create or replace view rec_vw_kits with (security_invoker = true) as
select k.id, k.empresa_id, k.unidade, k.nota_fiscal, k.cliente_nome, k.obra, k.periodo_inicio, k.periodo_fim, k.aceita_boleto_factoring,
       k.estagio, k.observacao, k.criado_em, k.implantada_em, k.pronta_em, k.enviado_em, k.cancelada_em, k.motivo_cancelamento,
       p.nome as criado_por_nome,
       t.parcelas, t.valor_total, t.primeiro_vencimento, t.cedido, t.contraparte_id,
       coalesce(t.boletos, 0) as boletos,
       (select count(*)::int from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = k.id and a.tipo = 'nota_fatura') as notas,
       (select count(*)::int from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = k.id and a.tipo = 'demonstrativo') as demonstrativos,
       (select count(*)::int from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = k.id and a.tipo = 'comodato') as comodatos,
       (select count(*)::int from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = k.id and a.tipo = 'carta_cessao') as cartas,
       coalesce(t.exige_carta, false) as exige_carta
  from rec_kits k
  left join perfis p on p.id = k.criado_por
  left join lateral (
    select count(*)::int as parcelas, sum(x.valor) as valor_total, min(x.vencimento) as primeiro_vencimento,
           coalesce(bool_or(x.cedido), false) as cedido, (array_agg(x.contraparte_id))[1] as contraparte_id,
           count(*) filter (where exists (select 1 from anexos a where a.referencia_tabela = 'rec_titulos' and a.referencia_id = x.id and a.tipo = 'boleto'))::int as boletos,
           bool_or(x.cedido and coalesce(c.exige_carta_cessao, false)) as exige_carta
      from rec_kit_titulos kt join rec_titulos x on x.id = kt.titulo_id
      left join rec_clientes_config c on c.contraparte_id = x.contraparte_id
     where kt.kit_id = k.id and x.estagio not in ('cancelado', 'renegociado')
  ) t on true;

create function rec_cliente_definir_carta_cessao(p_contraparte uuid, p_exige boolean) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_kit uuid;
  v_n int := 0;
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima altera o cadastro do cliente.';
  end if;
  if not exists (select 1 from contrapartes where id = p_contraparte) then
    raise exception 'Cliente não encontrado.';
  end if;
  insert into rec_clientes_config (contraparte_id, exige_carta_cessao) values (p_contraparte, coalesce(p_exige, false))
  on conflict (contraparte_id) do update set exige_carta_cessao = excluded.exige_carta_cessao;

  for v_kit in
    select distinct kt.kit_id from rec_kit_titulos kt
      join rec_titulos t on t.id = kt.titulo_id
      join rec_kits k on k.id = kt.kit_id
     where t.contraparte_id = p_contraparte and k.estagio in ('recebida', 'implantada', 'pronta')
  loop
    perform rec_kit_atualizar_estagio(v_kit);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function rec_cliente_definir_carta_cessao(uuid, boolean) from public, anon;
grant execute on function rec_cliente_definir_carta_cessao(uuid, boolean) to authenticated;
