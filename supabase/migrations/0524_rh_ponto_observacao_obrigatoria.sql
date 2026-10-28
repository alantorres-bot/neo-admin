-- RH > Ponto: a observação passa a ser obrigatória em TODA justificativa (não só em "Outro"),
-- para o RH saber o contexto de cada ocorrência. Só muda a checagem do envio em rh_pt_link_salvar (0517).

create or replace function rh_pt_link_salvar(p_chave text, p_itens jsonb, p_enviar boolean, p_nome text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l rh_pt_lotes;
  v_n int;
  v_falta int;
begin
  if p_chave is null or p_chave !~ '^[0-9a-f]{64}$' then raise exception 'Link inválido.'; end if;
  select * into l from rh_pt_lotes where chave = p_chave for update;
  if l.id is null then raise exception 'Link inválido.'; end if;
  if l.status not in ('enviado', 'devolvido') then raise exception 'Estas justificativas já foram enviadas ao RH. Se precisar mudar algo, fale com o RH.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 500 then raise exception 'Nada para salvar.'; end if;
  if exists (select 1 from jsonb_to_recordset(p_itens) as x(id uuid, tipo text, horario text, observacao text)
              where (x.tipo is not null and x.tipo not in ('esqueceu_bater', 'batida_indevida', 'saida_atraso', 'falta_injustificada', 'justificada', 'outro'))
                 or (nullif(trim(x.horario), '') is not null and trim(x.horario) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
                 or length(coalesce(x.observacao, '')) > 500) then
    raise exception 'Há justificativa, horário (use hh:mm) ou observação inválida.';
  end if;
  update rh_pt_ocorrencias o set tipo = x.tipo, horario = nullif(trim(x.horario), ''), observacao = nullif(trim(x.observacao), ''), justificado_em = now()
    from jsonb_to_recordset(p_itens) as x(id uuid, tipo text, horario text, observacao text)
   where o.id = x.id and o.lote_id = l.id
     and (o.tipo, o.horario, o.observacao) is distinct from (x.tipo, nullif(trim(x.horario), ''), nullif(trim(x.observacao), ''));
  get diagnostics v_n = row_count;
  if coalesce(p_enviar, false) then
    if length(coalesce(trim(p_nome), '')) < 3 then raise exception 'Informe o seu nome para enviar.'; end if;
    select count(*) into v_falta from rh_pt_ocorrencias where lote_id = l.id and (tipo is null or coalesce(trim(observacao), '') = '');
    if v_falta > 0 then raise exception 'Faltam % ocorrência(s) sem justificativa ou sem observação.', v_falta; end if;
    update rh_pt_lotes set status = 'justificado', justificado_em = now(), justificado_nome = left(trim(p_nome), 120), justificado_ip = left(p_ip, 60) where id = l.id;
    perform rh_pt_encerrar_pendencias(l.id, 'Aguardando líder', 'concluida');
    perform rh_pt_encerrar_pendencias(l.id, 'Cobrar líder', 'concluida');
    perform rh_pt_abrir_pendencia(l.id, 'Ajustar no Control iD — ' || rh_pt_rotulo(l.id),
      'O líder (' || left(trim(p_nome), 120) || ') justificou as inconsistências: ajustar no Control iD e marcar cada ocorrência.', null, null, '/rh/ponto/lote/' || l.id);
  end if;
  return jsonb_build_object('salvas', v_n, 'enviado', coalesce(p_enviar, false));
end $$;
