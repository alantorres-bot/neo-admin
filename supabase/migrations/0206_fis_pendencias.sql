-- =========================================================
-- Neo Admin — 0206 FISCAL: PENDÊNCIAS NA CENTRAL DE GESTÃO (Fase 6)
-- Créditos tributários publica na Central, pelo contrato do núcleo (0097), o que exige ação:
--  - obrigação ainda não entregue com vencimento em até `fiscal.creditos.dias_alerta_obrigacao` dias (vencida inclusive):
--    "Entregar <obrigação> <MM/AAAA> — <estabelecimento>", prazo = o vencimento registrado no módulo;
--  - obrigação sem vencimento (sem regra cadastrada): "Confirmar vencimento…", prioridade alta e sem prazo, o que na
--    Central aparece como "Avaliar". A Central não calcula prazo legal;
--  - divergência aberta ou em análise SEM tarefa aberta: "Analisar divergência nº N", "precisa distribuir" quando sem
--    responsável. Com tarefa, a própria tarefa já está na Central (fis_tarefa_criar).
-- Tudo se encerra sozinho quando a obrigação é entregue/dispensada, sai da janela, ou a divergência é decidida.
-- Os registros fictícios (carga de demonstração) não geram pendência. Uma rotina diária põe na Central as obrigações
-- que entram na janela só pela passagem do tempo.
-- =========================================================
insert into configuracoes (chave, valor, descricao) values
  ('fiscal.creditos.dias_alerta_obrigacao', '10', 'Central de Gestão: obrigação não entregue aparece como pendência quando faltam até N dias para o vencimento.')
on conflict (chave) do nothing;

create function fis_rotulo_status_obrigacao(p fis_status_obrigacao) returns text language sql immutable as $$
  select case p when 'nao_iniciada' then 'não iniciada' when 'em_preparacao' then 'em preparação'
    when 'aguardando_documentos' then 'aguardando documentos' when 'em_revisao' then 'em revisão'
    when 'aguardando_aprovacao' then 'aguardando aprovação' when 'pronta_transmissao' then 'pronta para transmitir'
    else p::text end;
$$;

create function fis_publicar_obrigacao(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_dias int := coalesce((select (valor #>> '{}')::int from configuracoes where chave = 'fiscal.creditos.dias_alerta_obrigacao'), 10);
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_nome text;
begin
  select o.*, t.nome as tipo_nome, e.nome as estab_nome into r
    from fis_obrigacoes o join fis_tipos_obrigacao t on t.id = o.tipo_id join fis_estabelecimentos e on e.id = o.estabelecimento_id
   where o.id = p_id;
  if not found then return; end if;
  v_nome := format('%s %s — %s', r.tipo_nome, to_char(r.competencia, 'MM/YYYY'), r.estab_nome);

  if r.ficticio or r.status in ('transmitida', 'entregue_conferida', 'retificada', 'dispensada') then
    perform encerrar_pendencia('fiscal.creditos', 'obrigacao:' || p_id, (case when r.status = 'dispensada' or r.ficticio then 'cancelada' else 'concluida' end)::status_pendencia);
    perform encerrar_pendencia('fiscal.creditos', 'obrigacao-vencimento:' || p_id, 'cancelada');
    return;
  end if;

  if r.vencimento is null then
    perform publicar_pendencia(jsonb_build_object(
      'modulo', 'fiscal.creditos', 'chave_origem', 'obrigacao-vencimento:' || p_id,
      'titulo', 'Confirmar vencimento: ' || v_nome,
      'descricao', 'Sem regra de vencimento cadastrada para esta obrigação: confirme o vencimento com o contador e registre no módulo.',
      'prioridade', 'alta', 'categoria', 'conferencia', 'responsavel_id', r.responsavel_id, 'precisa_distribuir', r.responsavel_id is null,
      'empresa_id', r.empresa_id, 'referencia_tabela', 'fis_obrigacoes', 'referencia_id', p_id, 'link', '/fiscal/creditos/obrigacoes/' || p_id));
    perform encerrar_pendencia('fiscal.creditos', 'obrigacao:' || p_id, 'cancelada');
  elsif r.vencimento <= v_hoje + v_dias then
    perform publicar_pendencia(jsonb_build_object(
      'modulo', 'fiscal.creditos', 'chave_origem', 'obrigacao:' || p_id,
      'titulo', 'Entregar ' || v_nome,
      'descricao', format('Situação: %s. Vencimento %s%s.', fis_rotulo_status_obrigacao(r.status), to_char(r.vencimento, 'DD/MM/YYYY'),
                          case when r.vencimento_confirmado then ' (confirmado)' else ' (a confirmar)' end),
      'prazo', r.vencimento, 'prioridade', 'normal', 'categoria', 'entrega', 'responsavel_id', r.responsavel_id,
      'precisa_distribuir', r.responsavel_id is null, 'empresa_id', r.empresa_id,
      'referencia_tabela', 'fis_obrigacoes', 'referencia_id', p_id, 'link', '/fiscal/creditos/obrigacoes/' || p_id));
    perform encerrar_pendencia('fiscal.creditos', 'obrigacao-vencimento:' || p_id, 'cancelada');
  else
    -- ainda fora da janela (ou o vencimento foi adiado): nada na Central
    perform encerrar_pendencia('fiscal.creditos', 'obrigacao:' || p_id, 'cancelada');
    perform encerrar_pendencia('fiscal.creditos', 'obrigacao-vencimento:' || p_id, 'cancelada');
  end if;
end $$;

create function fis_publicar_divergencia(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  d fis_divergencias;
  v_tem_tarefa boolean;
begin
  select * into d from fis_divergencias where id = p_id;
  if not found then return; end if;
  v_tem_tarefa := exists (select 1 from fis_tarefas t where t.alvo = 'divergencia' and t.alvo_id = p_id and t.status in ('aberta', 'em_andamento'));
  if d.ficticio or d.status in ('justificada', 'resolvida', 'cancelada') or v_tem_tarefa then
    perform encerrar_pendencia('fiscal.creditos', 'divergencia:' || p_id,
      (case when d.status in ('justificada', 'resolvida') then 'concluida' else 'cancelada' end)::status_pendencia);
    return;
  end if;
  perform publicar_pendencia(jsonb_build_object(
    'modulo', 'fiscal.creditos', 'chave_origem', 'divergencia:' || p_id,
    'titulo', format('Analisar divergência nº %s: %s', d.numero, left(d.motivo, 120)),
    'descricao', concat_ws(' ', case when d.valor_diferenca <> 0 then 'Diferença registrada: R$ ' || replace(to_char(d.valor_diferenca, 'FM999G999G990D00'), ',', '#') end,
                           case when d.providencia is not null then 'Providência: ' || d.providencia end),
    'prazo', d.prazo_interno, 'prioridade', 'normal', 'categoria', 'conferencia', 'responsavel_id', d.responsavel_id,
    'precisa_distribuir', d.responsavel_id is null, 'empresa_id', d.empresa_id,
    'referencia_tabela', 'fis_divergencias', 'referencia_id', p_id, 'link', '/fiscal/creditos/conciliacao'));
end $$;

-- Gatilhos: publicar nunca derruba a gravação do módulo (falha vira aviso no log do banco).
create function fn_fis_obrigacoes_central() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform fis_publicar_obrigacao(new.id);
  exception when others then raise warning 'Pendência da obrigação % não publicada: %', new.id, sqlerrm; end;
  return null;
end $$;
create trigger trg_fis_obrigacoes_central after insert or update on fis_obrigacoes for each row execute function fn_fis_obrigacoes_central();

create function fn_fis_divergencias_central() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform fis_publicar_divergencia(new.id);
  exception when others then raise warning 'Pendência da divergência % não publicada: %', new.id, sqlerrm; end;
  return null;
end $$;
create trigger trg_fis_divergencias_central after insert or update on fis_divergencias for each row execute function fn_fis_divergencias_central();

create function fn_fis_tarefas_divergencia_central() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.alvo = 'divergencia' then
    begin perform fis_publicar_divergencia(new.alvo_id);
    exception when others then raise warning 'Pendência da divergência % não publicada: %', new.alvo_id, sqlerrm; end;
  end if;
  return null;
end $$;
create trigger trg_fis_tarefas_divergencia_central after insert or update of status on fis_tarefas
  for each row execute function fn_fis_tarefas_divergencia_central();

-- Rotina diária (e carga inicial): obrigações e divergências que ainda pedem ação.
create function fis_pendencias_rotina() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  if auth.uid() is not null and not eh_admin_geral() then
    raise exception 'Somente o administrador geral roda a rotina de pendências do Fiscal.';
  end if;
  for v_id in select id from fis_obrigacoes where not ficticio
                and status not in ('transmitida', 'entregue_conferida', 'retificada', 'dispensada') loop
    perform fis_publicar_obrigacao(v_id); v_n := v_n + 1;
  end loop;
  for v_id in select id from fis_divergencias where not ficticio and status in ('aberta', 'em_analise') loop
    perform fis_publicar_divergencia(v_id); v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function fis_publicar_obrigacao(uuid) from public, anon, authenticated;
revoke all on function fis_publicar_divergencia(uuid) from public, anon, authenticated;
revoke all on function fis_pendencias_rotina() from public, anon;
grant execute on function fis_publicar_obrigacao(uuid) to service_role;
grant execute on function fis_publicar_divergencia(uuid) to service_role;
grant execute on function fis_pendencias_rotina() to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('fis-pendencias-diario', '15 10 * * *', 'select public.fis_pendencias_rotina()');
  end if;
end $$;

select fis_pendencias_rotina();
