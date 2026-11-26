-- =========================================================
-- Neo Admin — 0530 RH/SST > Ponto: atestado anexado pelo líder no link público (decisão de 26/11/2026)
-- O líder (sem login) anexa o atestado na linha da ocorrência; o envio passa pela Edge Function rh-ponto-link-anexar
-- (service role, confere a chave do lote) e grava no núcleo (anexos, tipo 'atestado') no mesmo lugar em que o RH anexa.
-- Aqui só muda o que o link devolve: cada ocorrência traz o NOME dos atestados já enviados (o líder não abre o arquivo).
-- =========================================================

create or replace function rh_pt_link_lote(p_chave text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l rh_pt_lotes;
  v_setor text;
begin
  if p_chave is null or p_chave !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into l from rh_pt_lotes where chave = p_chave and status in ('enviado', 'devolvido', 'justificado', 'concluido');
  if l.id is null then return null; end if;
  select nome into v_setor from rh_pt_setores where id = l.setor_id;
  return jsonb_build_object(
    'setor', v_setor, 'periodo_inicio', l.periodo_inicio, 'periodo_fim', l.periodo_fim, 'status', l.status, 'prazo', l.prazo,
    'devolvido_motivo', case when l.status = 'devolvido' then l.devolvido_motivo end,
    'justificado_em', l.justificado_em, 'justificado_nome', l.justificado_nome,
    'ocorrencias', case when l.status in ('enviado', 'devolvido') then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'nome', o.nome, 'cargo', o.cargo, 'data', o.data, 'dia_semana', o.dia_semana, 'previsto', o.previsto,
               'marcacoes', o.marcacoes, 'falta', o.falta, 'falta_atraso_min', o.falta_atraso_min,
               'tipo', o.tipo, 'horario', o.horario, 'observacao', o.observacao,
               'atestados', coalesce((select jsonb_agg(a.nome_arquivo order by a.enviado_em) from anexos a
                                       where a.referencia_tabela = 'rh_pt_ocorrencias' and a.referencia_id = o.id), '[]'::jsonb)) order by o.ordem)
        from rh_pt_ocorrencias o where o.lote_id = l.id), '[]'::jsonb) else '[]'::jsonb end);
end $$;
