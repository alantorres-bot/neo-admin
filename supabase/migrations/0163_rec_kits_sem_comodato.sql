-- =========================================================
-- Neo Admin — 0163 Faturamento Filial: o comodato não faz parte do kit
-- O kit da fatura da filial é nota fatura + demonstrativo + boleto (e carta de cessão, quando o cliente exige). Os textos
-- da pendência "Enviar kit ao cliente" e do histórico do envio deixam de citar o comodato; as pendências abertas são
-- corrigidas. O histórico já gravado (interacoes) não muda: é registro de prova.
-- =========================================================

-- 1) Estágio do kit (mesma regra da 0159; só o texto da pendência muda) ---------------------------------------------
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
  -- Nota e demonstrativo já enviados antes do boleto (0159): falta só o boleto, como resposta ao mesmo e-mail.
  v_titulo_pend := format(case when k.nota_enviada_em is not null then 'Enviar boleto ao cliente: NF %s — %s'
                               else 'Enviar kit ao cliente: NF %s — %s' end, k.nota_fiscal, k.cliente_nome);
  if v_novo = 'pronta' then
    insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    values ('financeiro.filial', k.empresa_id, v_titulo_pend,
            case when k.nota_enviada_em is not null
                 then 'O boleto chegou. A nota e o demonstrativo já foram enviados: envie o boleto como resposta ao mesmo e-mail.'
                 else 'NF, demonstrativo e boleto prontos. Gere o rascunho do e-mail e envie ao cliente.' end,
            (now() at time zone 'America/Cuiaba')::date, 'alta', 'rec_kits', p_kit, '/financeiro/filial/' || p_kit)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  else
    update pendencias set status = 'cancelada'
     where modulo = 'financeiro.filial' and referencia_tabela = 'rec_kits' and referencia_id = p_kit
       and (titulo like 'Enviar kit ao cliente%' or titulo like 'Enviar boleto ao cliente%') and status in ('aberta', 'em_andamento');
  end if;
  return v_novo;
end $$;

-- 2) Kit enviado (mesma regra da 0159; só o texto do histórico muda) ---------------------------------------------------
create or replace function rec_kit_marcar_enviado(p_kit uuid, p_mensagem uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k rec_kits%rowtype;
  v_ids uuid[];
  v_n int := 0;
begin
  if not tem_acesso_modulo('financeiro.filial', 'operador') then
    raise exception 'Somente operador do Faturamento Filial marca o envio.';
  end if;
  select * into k from rec_kits where id = p_kit for update;
  if not found then
    raise exception 'Kit não encontrado.';
  end if;
  if k.estagio <> 'pronta' then
    raise exception 'O kit da NF % não está pronto para envio (está %).', k.nota_fiscal, k.estagio;
  end if;

  select array_agg(t.id) into v_ids
    from rec_kit_titulos kt join rec_titulos t on t.id = kt.titulo_id
   where kt.kit_id = p_kit and t.forma_pagamento is distinct from 'transferencia'
     and t.estagio in ('aguardando_boleto', 'importado', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  if v_ids is not null then
    update rec_titulos
       set estagio = case when estagio in ('aguardando_boleto', 'importado') then 'boleto_enviado'::rec_estagio else estagio end,
           boleto_enviado_em = now()
     where id = any(v_ids);
    get diagnostics v_n = row_count;
    insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
    select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, 'email'::canal, 'boleto_enviado',
           case when k.nota_enviada_em is not null
                then format('Boleto da NF %s enviado ao cliente pela filial (nota e demonstrativo já enviados em %s).', k.nota_fiscal,
                            to_char(k.nota_enviada_em at time zone 'America/Cuiaba', 'DD/MM/YYYY'))
                else format('Kit da NF %s (nota fatura, demonstrativo e boleto) enviado ao cliente pela filial.', k.nota_fiscal) end,
           auth.uid()
      from rec_titulos t where t.id = any(v_ids);
    perform rec_concluir_pendencias_anexar_boleto(v_ids);
  end if;

  perform set_config('neo.rec_kit_estagio', 'on', true);
  update rec_kits set estagio = 'enviada', enviado_em = now(), enviado_por = auth.uid() where id = p_kit;
  perform set_config('neo.rec_kit_estagio', '', true);
  update pendencias set status = 'concluida'
   where modulo = 'financeiro.filial' and referencia_tabela = 'rec_kits' and referencia_id = p_kit
     and (titulo like 'Enviar kit ao cliente%' or titulo like 'Enviar boleto ao cliente%') and status in ('aberta', 'em_andamento');
  return jsonb_build_object('parcelas', v_n);
end $$;

-- 3) Pendências abertas com o texto antigo ---------------------------------------------------------------------------
update pendencias
   set descricao = replace(descricao, 'NF, demonstrativo, comodato e boleto prontos.', 'NF, demonstrativo e boleto prontos.')
 where modulo = 'financeiro.filial' and status in ('aberta', 'em_andamento') and descricao like '%comodato%';

-- 4) Descrição da configuração da cópia do e-mail ao cliente --------------------------------------------------------
update configuracoes
   set descricao = 'Cópia (Cc) do e-mail da filial ao cliente com a nota fatura, o demonstrativo e o boleto.'
 where chave = 'financeiro.filial.copia_cliente';
