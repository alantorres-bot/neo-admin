-- =========================================================
-- Neo Admin — 0186 Contenção da Fase 1 da reestruturação do Contas a receber (docs/auditoria/plano-reestruturacao-receber.md)
-- O que a 0184 não cobriu da Fase 1:
--   1) akf_desdobrar_titulo trava o título (for update): dois cliques ao mesmo tempo não antecipam mais que o valor (F8).
--   2) akf_vw_valor_restante nunca devolve restante negativo: se o Consistem reduz o valor abaixo das partes, o restante
--      fica 0 e `excedido` acusa (a confirmação e a cobrança não mandam "−R$ 100") (H1).
--   3) Trava da sincronização: uma rodada por vez; a segunda termina como ignorada, sem alarme. A rodada que morrer no meio
--      solta a trava sozinha em 15 minutos (F7). Só a service role (Edge Function) usa.
-- =========================================================

-- 1) Antecipação parcial com trava -------------------------------------------------------------------------------------
create or replace function akf_desdobrar_titulo(
  p_titulo uuid, p_valor numeric, p_vencimento date, p_data_operacao date default null, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_titulo record;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_ja numeric;
  v_id uuid;
  v_restante numeric;
  v_texto text;
begin
  if p_valor is null or p_valor <= 0 then
    raise exception 'Informe o valor antecipado.';
  end if;
  if p_valor <> round(p_valor, 2) then
    raise exception 'O valor antecipado tem no máximo 2 casas decimais.';
  end if;
  if p_vencimento is null then
    raise exception 'Informe o vencimento da parte antecipada.';
  end if;
  if p_data_operacao is not null and p_data_operacao > v_hoje then
    raise exception 'A data da operação não pode ser futura.';
  end if;

  select id, documento, parcela, valor, emissao, estagio, cedido, contraparte_id into v_titulo from rec_titulos where id = p_titulo for update;
  if not found then
    raise exception 'Título não encontrado (ou você não tem acesso a ele).';
  end if;
  if v_titulo.estagio in ('pago', 'renegociado', 'cancelado') then
    raise exception 'O título já está encerrado.';
  end if;
  if v_titulo.cedido then
    raise exception 'O título inteiro já está na AKF: não há parte para antecipar.';
  end if;
  if v_titulo.emissao is not null and p_vencimento < v_titulo.emissao then
    raise exception 'O vencimento da parte não pode ser anterior à emissão do título.';
  end if;
  if p_vencimento > v_hoje + 1095 then
    raise exception 'O vencimento da parte está longe demais (mais de 3 anos).';
  end if;

  select coalesce(sum(valor), 0) into v_ja from akf_desdobramentos where titulo_id = p_titulo and status = 'ativo';
  v_restante := v_titulo.valor - v_ja - p_valor;
  if v_restante <= 0 then
    raise exception 'O valor antecipado (somado às partes já antecipadas) precisa ser menor que o do título. Para antecipar o título inteiro, use "Marcar como na AKF".';
  end if;

  insert into akf_desdobramentos (titulo_id, valor, vencimento, data_operacao, observacao)
  values (p_titulo, p_valor, p_vencimento, coalesce(p_data_operacao, v_hoje), nullif(trim(coalesce(p_descricao, '')), ''))
  returning id into v_id;

  v_texto := 'Antecipação parcial na AKF: R$ ' || translate(to_char(p_valor, 'FM999,999,999,990.00'), ',.', '.,') || ' com vencimento em ' || to_char(p_vencimento, 'DD/MM/YYYY')
    || '. Restante com a Neo: R$ ' || translate(to_char(v_restante, 'FM999,999,999,990.00'), ',.', '.,') || '.';
  if nullif(trim(coalesce(p_descricao, '')), '') is not null then
    v_texto := v_texto || ' ' || trim(p_descricao);
  end if;
  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  values ('financeiro.akf', v_titulo.contraparte_id, 'rec_titulos', p_titulo, 'interno', 'akf_desdobramento', v_texto, auth.uid());

  return jsonb_build_object('id', v_id, 'restante', v_restante);
end $$;

-- 2) Restante nunca negativo -------------------------------------------------------------------------------------------
create or replace view akf_vw_valor_restante with (security_invoker = true) as
select t.id as titulo_id,
       t.valor as valor_titulo,
       sum(d.valor) as valor_akf,
       greatest(t.valor - sum(d.valor), 0) as valor_restante,
       count(*)::int as partes,
       sum(d.valor) >= t.valor as excedido
  from rec_titulos t
  join akf_desdobramentos d on d.titulo_id = t.id and d.status = 'ativo'
 where not t.cedido and t.estagio not in ('pago', 'renegociado', 'cancelado')
 group by t.id, t.valor;

-- 3) Trava da sincronização --------------------------------------------------------------------------------------------
create table rec_sincronizacao_trava (
  id smallint primary key default 1 check (id = 1),
  desde timestamptz
);
alter table rec_sincronizacao_trava enable row level security; -- sem política: só a service role (a Edge Function dura no máximo 400 s; 15 min sobra)
insert into rec_sincronizacao_trava (id, desde) values (1, null);
revoke all on rec_sincronizacao_trava from anon, authenticated;
grant select, update on rec_sincronizacao_trava to service_role;

-- true = a trava é desta rodada; false = outra rodada começou há menos de 15 minutos.
create function rec_sincronizacao_iniciar() returns boolean
language sql security invoker set search_path = public as $$
  with tomada as (
    update rec_sincronizacao_trava set desde = now()
     where id = 1 and (desde is null or desde < now() - interval '15 minutes')
    returning 1
  )
  select exists (select 1 from tomada);
$$;

create function rec_sincronizacao_terminar() returns void
language sql security invoker set search_path = public as $$
  update rec_sincronizacao_trava set desde = null where id = 1;
$$;

revoke all on function rec_sincronizacao_iniciar() from public, anon, authenticated;
revoke all on function rec_sincronizacao_terminar() from public, anon, authenticated;
grant execute on function rec_sincronizacao_iniciar() to service_role;
grant execute on function rec_sincronizacao_terminar() to service_role;
