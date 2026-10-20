-- =========================================================
-- Neo Admin — 0173 Financeiro / Comissões: reabrir fechamento (regra 14)
-- Especificação: docs/modulos/financeiro-comissoes.md.
--
-- O gestor reabre o ÚLTIMO mês fechado (nunca um histórico das planilhas), com motivo. A reabertura fica registrada
-- (fin_com_reaberturas: quem fechou, quando, quem reabriu, por quê e os saldos que estavam fechados) — o registro de
-- prova não se perde (regra 4 do projeto); as linhas voltam para conferência e o mês é fechado de novo pelo fluxo normal.
-- =========================================================

create table fin_com_reaberturas (
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null references fin_com_fechamentos(id),
  motivo text not null check (length(trim(motivo)) >= 5),
  fechado_por uuid references perfis(id),
  fechado_em timestamptz,
  saldos jsonb not null,                    -- [{cod_representante, total, antecipado, saldo}] como estavam fechados
  reaberto_por uuid not null references perfis(id) default auth.uid(),
  reaberto_em timestamptz not null default now()
);
create index idx_fin_com_reaberturas_fech on fin_com_reaberturas (fechamento_id);
create trigger trg_aud_fin_com_reab after insert or update or delete on fin_com_reaberturas for each row execute function fn_auditoria();
create trigger trg_fin_com_reab_sem_delete before delete on fin_com_reaberturas for each row execute function fn_bloquear_delete();
alter table fin_com_reaberturas enable row level security;
create policy fin_com_reab_ler on fin_com_reaberturas for select to authenticated using (tem_acesso_modulo('financeiro.comissoes'));

-- Fechado não muda — exceto o histórico (importação) e a reabertura, cada um só dentro da sua função.
create or replace function fn_fin_com_trava() returns trigger
language plpgsql set search_path = public as $$
declare v_status text; v_hist boolean; v_fech uuid;
begin
  if tg_op = 'DELETE' then v_fech := old.fechamento_id; else v_fech := new.fechamento_id; end if;
  select status, historico into v_status, v_hist from fin_com_fechamentos where id = v_fech;
  if v_status = 'fechado' then
    if v_hist and coalesce(current_setting('fin_com.importando_historico', true), '') = 'on' then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
    if tg_table_name = 'fin_com_linhas' and tg_op = 'UPDATE' then
      -- O próprio fechamento marcando as linhas como fechadas.
      if old.fechada = false and new.fechada = true then return new; end if;
      -- A reabertura devolvendo as linhas para conferência (só isso muda).
      if coalesce(current_setting('fin_com.reabrindo', true), '') = 'on' and old.fechada = true and new.fechada = false
         and (to_jsonb(new) - 'fechada' - 'atualizado_em') = (to_jsonb(old) - 'fechada' - 'atualizado_em') then
        return new;
      end if;
    end if;
    raise exception 'O fechamento deste mês já foi fechado; não pode mais ser alterado.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

/** Reabre o último mês fechado (gestor), com motivo. Devolve o id da reabertura. */
create or replace function fin_com_reabrir(p_id uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare f fin_com_fechamentos; v_id uuid;
begin
  perform fin_com_exigir('gestor');
  select * into f from fin_com_fechamentos where id = p_id for update;
  if f.id is null then raise exception 'Fechamento não encontrado.'; end if;
  if f.historico then raise exception 'Mês de histórico (pago pelas planilhas) não se reabre; reimporte a planilha.'; end if;
  if f.status <> 'fechado' then raise exception 'Este fechamento não está fechado.'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo da reabertura.'; end if;
  if exists (select 1 from fin_com_fechamentos where status = 'fechado' and not historico and competencia > f.competencia) then
    raise exception 'Só o último mês fechado pode ser reaberto: há mês posterior já fechado.';
  end if;

  insert into fin_com_reaberturas (fechamento_id, motivo, fechado_por, fechado_em, saldos)
  select f.id, trim(p_motivo), f.fechado_por, f.fechado_em, coalesce(jsonb_agg(s order by s.cod_representante), '[]')
  from (
    select cod_representante,
      sum(valor_comissao) filter (where incluida and origem <> 'antecipacao') as total,
      coalesce(sum(valor_comissao) filter (where incluida and origem = 'antecipacao'), 0) as antecipado,
      coalesce(sum(valor_comissao) filter (where incluida and origem <> 'antecipacao'), 0)
        - coalesce(sum(valor_comissao) filter (where incluida and origem = 'antecipacao'), 0) as saldo
    from fin_com_linhas where fechamento_id = f.id group by cod_representante
  ) s
  returning id into v_id;

  perform set_config('fin_com.reabrindo', 'on', true);
  update fin_com_linhas set fechada = false where fechamento_id = f.id;
  perform set_config('fin_com.reabrindo', 'off', true);
  update fin_com_fechamentos set status = 'em_conferencia', fechado_por = null, fechado_em = null where id = f.id;
  return v_id;
end $$;

revoke all on function fin_com_reabrir(uuid, text) from public, anon;
grant execute on function fin_com_reabrir(uuid, text) to authenticated;
