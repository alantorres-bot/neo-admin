-- =========================================================
-- Neo Admin — 0167 Ajustes da Cobrança pedidos pelo Alan em 15/10/2026
-- 1) Filial Contagem: o trabalho de Cuiabá termina ao anexar o boleto. Quando todas as parcelas do kit têm boleto, a pendência
--    "Anexar boleto" (Cuiabá) é concluída; o envio ao cliente é só da filial ("Enviar kit/boleto ao cliente").
-- 2) Janela do envio: a pendência "Enviar kit/boleto ao cliente" só abre quando a parcela mais próxima vence em até
--    `financeiro.recebiveis.janela_anexar_boleto_dias` (30, editável na Regra de cobrança), como o "Anexar boleto". Um job diário
--    abre as dos kits que entraram na janela; as abertas fora dela são canceladas (pendência não é registro de prova).
-- 3) Resultado novo da cobrança, "posição do cliente" (`posicao`): cobrança informal ou o cliente avisou que pagou/vai pagar
--    numa data. Data entre hoje − 30 e hoje + 90 e observação obrigatória; o título vai para `promessa` com a régua pausada até
--    a data (ou hoje, se já passou) + 5 dias. Sem baixa nesse prazo, volta para a fila Cobrar.
-- =========================================================

-- 1) Janela do boleto/envio, legível por quem não lê `configuracoes` (usuária restrita da filial) -------------------------
create or replace function rec_janela_boleto_dias() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (valor #>> '{}')::int from configuracoes where chave = 'financeiro.recebiveis.janela_anexar_boleto_dias'), 30);
$$;
revoke all on function rec_janela_boleto_dias() from public, anon;
grant execute on function rec_janela_boleto_dias() to authenticated, service_role;

-- 2) Estágio do kit (regra da 0163) + conclusão do "Anexar boleto" + janela do envio --------------------------------------
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
  v_vencimento date;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_na_janela boolean;
begin
  select * into k from rec_kits where id = p_kit for update;
  if not found or k.estagio in ('enviada', 'cancelada') then
    return k.estagio;
  end if;

  select count(*),
         count(*) filter (where t.forma_pagamento is distinct from 'transferencia' and not exists (
           select 1 from anexos a where a.referencia_tabela = 'rec_titulos' and a.referencia_id = t.id and a.tipo = 'boleto')),
         coalesce(bool_or(t.cedido and coalesce(c.exige_carta_cessao, false)), false),
         min(t.vencimento) filter (where t.estagio not in ('pago'))
    into v_titulos, v_sem_boleto, v_exige_carta, v_vencimento
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

  -- Todos os boletos anexados: o "Anexar boleto" de Cuiabá acabou (o envio é da filial).
  if v_titulos > 0 and v_sem_boleto = 0 then
    update pendencias p set status = 'concluida'
     where p.modulo = 'financeiro.recebiveis' and p.titulo like 'Anexar boleto%' and p.status in ('aberta', 'em_andamento')
       and ((p.referencia_tabela = 'rec_notas_saida' and p.referencia_id in (
               select t.nota_saida_id from rec_kit_titulos kt join rec_titulos t on t.id = kt.titulo_id
                where kt.kit_id = p_kit and t.nota_saida_id is not null))
         or (p.referencia_tabela = 'rec_titulos' and p.referencia_id in (select kt.titulo_id from rec_kit_titulos kt where kt.kit_id = p_kit)));
  end if;

  -- Envio só a partir de N dias do vencimento (a mesma janela do "Anexar boleto").
  v_na_janela := v_vencimento is null or v_vencimento - v_hoje <= rec_janela_boleto_dias();

  -- Nota e demonstrativo já enviados antes do boleto (0159): falta só o boleto, como resposta ao mesmo e-mail.
  v_titulo_pend := format(case when k.nota_enviada_em is not null then 'Enviar boleto ao cliente: NF %s — %s'
                               else 'Enviar kit ao cliente: NF %s — %s' end, k.nota_fiscal, k.cliente_nome);
  if v_novo = 'pronta' and v_na_janela then
    insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    values ('financeiro.filial', k.empresa_id, v_titulo_pend,
            case when k.nota_enviada_em is not null
                 then 'O boleto chegou. A nota e o demonstrativo já foram enviados: envie o boleto como resposta ao mesmo e-mail.'
                 else 'NF, demonstrativo e boleto prontos. Gere o rascunho do e-mail e envie ao cliente.' end,
            v_hoje, 'alta', 'rec_kits', p_kit, '/financeiro/filial/' || p_kit)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  else
    update pendencias set status = 'cancelada'
     where modulo = 'financeiro.filial' and referencia_tabela = 'rec_kits' and referencia_id = p_kit
       and (titulo like 'Enviar kit ao cliente%' or titulo like 'Enviar boleto ao cliente%') and status in ('aberta', 'em_andamento');
  end if;
  return v_novo;
end $$;

-- Kits prontos que entraram na janela ganham a pendência de envio (job diário). Também corrige o estado na publicação.
create or replace function rec_kits_abrir_envios_na_janela() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n int := 0;
begin
  for r in select id from rec_kits where estagio = 'pronta' loop
    perform rec_kit_atualizar_estagio(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function rec_kits_abrir_envios_na_janela() from public, anon, authenticated;

select rec_kits_abrir_envios_na_janela();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 06:05 de Cuiabá (10:05 UTC), todos os dias.
    perform cron.schedule('rec-kits-envio-janela-diario', '5 10 * * *', 'select public.rec_kits_abrir_envios_na_janela()');
  end if;
end $$;

-- 3) rec_registrar_cobranca (0120) com o resultado "posição do cliente" ----------------------------------------------------
create or replace function rec_registrar_cobranca(
  p_titulos uuid[], p_marco int, p_resultado text, p_canal canal default 'whatsapp', p_data_prometida date default null, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_qtd int;
  v_clientes int;
  v_unidades int;
  v_unidade text;
  v_cliente uuid;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atualizados int;
  v_concluidas int := 0;
  v_tipo text;
  v_texto text;
  v_canal_txt text;
  v_pausa date;
begin
  if p_resultado not in ('enviada', 'promessa', 'contestou', 'posicao') then
    raise exception 'Resultado inválido.';
  end if;
  if not exists (select 1 from rec_regua_marcos m join rec_reguas r on r.id = m.regua_id
                  where r.nome = 'Padrao' and r.ativa and m.acao = 'cobranca' and m.ativo and m.dia_relativo = p_marco) then
    raise exception 'Marco da régua inválido.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos uma parcela.';
  end if;

  select count(*), count(distinct contraparte_id), min(contraparte_id::text)::uuid, count(distinct unidade), min(unidade)
    into v_qtd, v_clientes, v_cliente, v_unidades, v_unidade
    from rec_titulos
   where id = any(v_ids)
     and estagio in ('importado', 'aguardando_boleto', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  if v_qtd <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já foi paga ou encerrada (ou você não tem acesso a ela).';
  end if;
  if v_clientes <> 1 then
    raise exception 'As parcelas precisam ser do mesmo cliente.';
  end if;
  if v_unidades <> 1 then
    raise exception 'As parcelas precisam ser da mesma unidade (Matriz ou Filial Contagem).';
  end if;

  v_canal_txt := case p_canal when 'email' then 'por e-mail' when 'whatsapp' then 'por WhatsApp' when 'telefone' then 'por telefone' else 'por outro meio' end;

  if p_resultado = 'promessa' then
    if p_data_prometida is null then
      raise exception 'Informe a data prometida para o pagamento.';
    end if;
    if p_data_prometida <= v_hoje then
      raise exception 'A data prometida precisa ser futura.';
    end if;
    if p_data_prometida > v_hoje + 90 then
      raise exception 'A data prometida não pode passar de 90 dias.';
    end if;
    update rec_titulos set estagio = 'promessa', regua_pausada_ate = p_data_prometida where id = any(v_ids);
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar esta promessa (é preciso ser operador do Financeiro).';
    end if;
    insert into rec_promessas (titulo_id, data_prometida, valor_prometido)
    select t.id, p_data_prometida, t.valor from rec_titulos t where t.id = any(v_ids);
    v_tipo := 'promessa';
    v_texto := 'Cobrança ' || 'D+' || p_marco || ': o cliente prometeu pagar em ' || to_char(p_data_prometida, 'DD/MM/YYYY') || ' (' || v_canal_txt || '). A régua fica pausada até essa data.';
  elsif p_resultado = 'posicao' then
    if p_data_prometida is null then
      raise exception 'Informe a data que o cliente deu (pagamento feito ou previsto).';
    end if;
    if p_data_prometida < v_hoje - 30 then
      raise exception 'A data do cliente não pode ser de mais de 30 dias atrás.';
    end if;
    if p_data_prometida > v_hoje + 90 then
      raise exception 'A data do cliente não pode passar de 90 dias.';
    end if;
    if length(trim(coalesce(p_descricao, ''))) < 5 then
      raise exception 'Descreva a posição do cliente.';
    end if;
    -- Prazo para a baixa aparecer: 5 dias depois da data (ou de hoje, se a data já passou). Sem baixa, volta para Cobrar.
    v_pausa := greatest(p_data_prometida, v_hoje) + 5;
    update rec_titulos set estagio = 'promessa', regua_pausada_ate = v_pausa where id = any(v_ids);
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar a posição do cliente (é preciso ser operador do Financeiro).';
    end if;
    insert into rec_promessas (titulo_id, data_prometida, valor_prometido)
    select t.id, p_data_prometida, t.valor from rec_titulos t where t.id = any(v_ids);
    v_tipo := 'posicao';
    v_texto := 'Cobrança D+' || p_marco || ': posição do cliente (' || v_canal_txt || '), data ' || to_char(p_data_prometida, 'DD/MM/YYYY')
            || '. Fora da cobrança até ' || to_char(v_pausa, 'DD/MM/YYYY') || '; sem baixa até lá, volta para Cobrar.';
  elsif p_resultado = 'contestou' then
    if length(trim(coalesce(p_descricao, ''))) < 5 then
      raise exception 'Informe o motivo da contestação.';
    end if;
    update rec_titulos set contestado = true where id = any(v_ids);
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar esta contestação (é preciso ser operador do Financeiro).';
    end if;
    v_tipo := 'contestacao';
    v_texto := 'Cobrança D+' || p_marco || ': o cliente contestou a cobrança (' || v_canal_txt || '). A régua fica pausada para estes títulos.';
  else
    v_tipo := 'cobranca';
    v_texto := 'Cobrança D+' || p_marco || ' enviada ' || v_canal_txt || '.';
  end if;
  if nullif(trim(coalesce(p_descricao, '')), '') is not null then
    v_texto := v_texto || ' ' || trim(p_descricao);
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, p_canal, v_tipo, v_texto, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  -- A pendência do marco, DESTA UNIDADE, acaba: a cobrança foi feita (ou a régua foi pausada).
  update pendencias set status = 'concluida'
   where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
     and titulo like 'Cobrar D+' || p_marco || ':%' and status in ('aberta', 'em_andamento')
     and (titulo like '%(Filial Contagem)%') = (v_unidade = 'contagem');
  get diagnostics v_concluidas = row_count;

  return jsonb_strip_nulls(jsonb_build_object('parcelas', cardinality(v_ids), 'pendencias_concluidas', v_concluidas, 'pausada_ate', v_pausa));
end $$;
