-- =========================================================
-- Neo Admin — 0159 Faturamento Filial, Fase F: demonstrativos pendentes e envio da nota antes do boleto
-- Na prática a filial envia a remessa sem os demonstrativos (cada fatura tem um ou mais) e, muitas vezes, manda ao cliente
-- a nota e o demonstrativo antes de o boleto chegar; o boleto vai depois, como resposta ao mesmo e-mail.
--  - Remessa: além de "Implantar remessa nº N", abre "Subir demonstrativos da remessa nº N (k NFs)" (financeiro.filial), que
--    fecha sozinha quando todas as NFs da remessa têm pelo menos um demonstrativo (gatilho em anexos).
--  - rec_kits.nota_enviada_em/por: nota e demonstrativo enviados antes do boleto (rec_kit_marcar_nota_enviada).
--  - rec_kits.gmail_thread_id / email_message_id / email_assunto: a conversa do primeiro e-mail (o rascunho do boleto vai na
--    mesma conversa, com In-Reply-To/References). Gravados pela Edge Function (rec_kit_registrar_conversa, só service role).
--  - Kit pronto com a nota já enviada: a pendência é "Enviar boleto ao cliente" (não "Enviar kit ao cliente").
-- =========================================================

alter table rec_kits
  add column nota_enviada_em timestamptz,
  add column nota_enviada_por uuid references perfis(id),
  add column gmail_thread_id text,
  add column email_message_id text,
  add column email_assunto text;

-- 1) Nota e demonstrativo enviados antes do boleto ----------------------------------------------------------------------
create function rec_kit_marcar_nota_enviada(p_kit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  k rec_kits%rowtype;
begin
  if not tem_acesso_modulo('financeiro.filial', 'operador') then
    raise exception 'Somente operador do Faturamento Filial marca o envio.';
  end if;
  select * into k from rec_kits where id = p_kit for update;
  if not found then
    raise exception 'Kit não encontrado.';
  end if;
  if k.estagio not in ('recebida', 'implantada') then
    raise exception 'O kit da NF % está %: o envio antecipado vale só antes do boleto.', k.nota_fiscal, k.estagio;
  end if;
  if k.nota_enviada_em is not null then
    raise exception 'A nota da NF % já foi enviada ao cliente.', k.nota_fiscal;
  end if;
  if not exists (select 1 from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = p_kit and a.tipo = 'nota_fatura')
     or not exists (select 1 from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = p_kit and a.tipo = 'demonstrativo') then
    raise exception 'Para enviar antes do boleto, o kit da NF % precisa da nota fatura e de pelo menos um demonstrativo.', k.nota_fiscal;
  end if;
  update rec_kits set nota_enviada_em = now(), nota_enviada_por = auth.uid() where id = p_kit;
  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, 'email'::canal, 'nota_enviada',
         format('Nota fatura e demonstrativo da NF %s enviados ao cliente pela filial; o boleto vai depois.', k.nota_fiscal), auth.uid()
    from rec_kit_titulos kt join rec_titulos t on t.id = kt.titulo_id where kt.kit_id = p_kit;
end $$;
revoke all on function rec_kit_marcar_nota_enviada(uuid) from public, anon;
grant execute on function rec_kit_marcar_nota_enviada(uuid) to authenticated;

-- 2) Conversa do primeiro e-mail (a Edge Function grava depois de criar o rascunho) -------------------------------------
create function rec_kit_registrar_conversa(p_kit uuid, p_thread text, p_message_id text, p_assunto text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update rec_kits set gmail_thread_id = nullif(btrim(p_thread), ''), email_message_id = nullif(btrim(p_message_id), ''),
                      email_assunto = nullif(btrim(p_assunto), '')
   where id = p_kit and estagio not in ('enviada', 'cancelada');
end $$;
revoke all on function rec_kit_registrar_conversa(uuid, text, text, text) from public, anon, authenticated;
grant execute on function rec_kit_registrar_conversa(uuid, text, text, text) to service_role;

-- 3) Estágio do kit: pendência "Enviar boleto" quando a nota já foi enviada ------------------------------------------
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
                 else 'NF, demonstrativo, comodato e boleto prontos. Gere o rascunho do e-mail e envie ao cliente.' end,
            (now() at time zone 'America/Cuiaba')::date, 'alta', 'rec_kits', p_kit, '/financeiro/filial/' || p_kit)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  else
    update pendencias set status = 'cancelada'
     where modulo = 'financeiro.filial' and referencia_tabela = 'rec_kits' and referencia_id = p_kit
       and (titulo like 'Enviar kit ao cliente%' or titulo like 'Enviar boleto ao cliente%') and status in ('aberta', 'em_andamento');
  end if;
  return v_novo;
end $$;

-- 4) Remessa: pendência dos demonstrativos -------------------------------------------------------------------------
create or replace function rec_remessa_concluir(p_remessa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  r rec_remessas%rowtype;
  v_total int;
  v_faltam int;
  v_sem_demonstrativo int;
begin
  if not tem_acesso_modulo('financeiro.filial', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima registra remessas da filial.';
  end if;
  select * into r from rec_remessas where id = p_remessa;
  if not found then
    raise exception 'Remessa não encontrada.';
  end if;
  select count(*), count(*) filter (where k.estagio = 'recebida') into v_total, v_faltam
    from rec_remessa_kits rk join rec_kits k on k.id = rk.kit_id where rk.remessa_id = p_remessa and k.estagio <> 'cancelada';
  if v_total = 0 then
    raise exception 'A remessa nº % não tem faturas.', r.numero;
  end if;
  if v_faltam > 0 then
    insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    values ('financeiro.filial', r.empresa_id, format('Implantar remessa nº %s da filial (%s %s)', r.numero, v_faltam, case when v_faltam = 1 then 'NF' else 'NFs' end),
            'Baixar as notas da remessa, implantar no Consistem e emitir os boletos. A ligação com o título é automática.',
            (now() at time zone 'America/Cuiaba')::date, 'normal', 'rec_remessas', p_remessa, '/financeiro/filial/remessas/' || r.numero)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  end if;
  -- Demonstrativos (0159): cada fatura tem um ou mais; a filial costuma enviar a remessa antes de tê-los.
  select count(*) into v_sem_demonstrativo
    from rec_remessa_kits rk join rec_kits k on k.id = rk.kit_id
   where rk.remessa_id = p_remessa and k.estagio <> 'cancelada'
     and not exists (select 1 from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = k.id and a.tipo = 'demonstrativo');
  if v_sem_demonstrativo > 0 then
    insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    values ('financeiro.filial', r.empresa_id,
            format('Subir demonstrativos da remessa nº %s (%s %s)', r.numero, v_sem_demonstrativo, case when v_sem_demonstrativo = 1 then 'NF' else 'NFs' end),
            'Anexe o demonstrativo de faturamento de cada NF da remessa (pode ter mais de um por NF).',
            (now() at time zone 'America/Cuiaba')::date, 'normal', 'rec_remessas', p_remessa, '/financeiro/filial/remessas/' || r.numero)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  end if;
  return v_faltam;
end $$;

-- 5) Kit enviado: conclui também "Enviar boleto" --------------------------------------------------------------------
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
                else format('Kit da NF %s (nota fatura, demonstrativo, comodato e boleto) enviado ao cliente pela filial.', k.nota_fiscal) end,
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

-- 6) Demonstrativo anexado: fecha a pendência das remessas em que todas as NFs já têm demonstrativo ---------------------
create function fn_anexos_demonstrativo_remessa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update pendencias p set status = 'concluida'
   where p.modulo = 'financeiro.filial' and p.referencia_tabela = 'rec_remessas' and p.status in ('aberta', 'em_andamento')
     and p.titulo like 'Subir demonstrativos%'
     and p.referencia_id in (select remessa_id from rec_remessa_kits where kit_id = new.referencia_id)
     and not exists (
       select 1 from rec_remessa_kits rk join rec_kits k on k.id = rk.kit_id
        where rk.remessa_id = p.referencia_id and k.estagio <> 'cancelada'
          and not exists (select 1 from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = k.id and a.tipo = 'demonstrativo'));
  return null;
end $$;
create trigger trg_anexos_demonstrativo_remessa after insert on anexos
  for each row when (new.referencia_tabela = 'rec_kits' and new.tipo = 'demonstrativo') execute function fn_anexos_demonstrativo_remessa();
