-- =========================================================
-- Neo Admin — 0523 RH/SST: título do VT excluído no Consistem → "cancelado" no livro (decisão de 23/10/2026)
-- O título 34237 (teste do VT de nov/2026) foi excluído no Consistem, mas o livro seguia "lançado": o mês não reabria e a
-- pessoa não podia ser lançada de novo. Agora o gestor marca "cancelado" (com motivo) DEPOIS de excluir lá. Nada é apagado.
-- O índice único, a reserva e o reabrir só contam reservado/enviando/lancado, então "cancelado" libera os três sem mudança.
-- =========================================================

alter type crt_situacao_lancamento_erp add value if not exists 'cancelado';
alter table rh_vt_lancamentos_erp
  add column cancelado_por uuid references perfis(id),
  add column cancelado_em timestamptz,
  add column motivo_cancelamento text;

-- Regras do livro do VT: a única saída de "lancado" é "cancelado"; cancelado e erro são finais.
create or replace function fn_rh_vt_lancamento_regras() returns trigger language plpgsql as $$
begin
  if (new.competencia_id, new.item_id, new.lote, new.ordem, new.valor, new.payload, new.criado_por, new.criado_em)
     is distinct from (old.competencia_id, old.item_id, old.lote, old.ordem, old.valor, old.payload, old.criado_por, old.criado_em) then
    raise exception 'O lançamento enviado ao Consistem é imutável.';
  end if;
  if new.situacao <> old.situacao and not (
       (old.situacao = 'reservado' and new.situacao in ('enviando', 'erro')) or
       (old.situacao = 'enviando' and new.situacao in ('lancado', 'erro')) or
       (old.situacao = 'lancado' and new.situacao = 'cancelado')) then
    raise exception 'Mudança de situação inválida: % → %.', old.situacao, new.situacao;
  end if;
  if old.situacao in ('erro', 'cancelado') or (old.situacao = 'lancado' and new.situacao is distinct from 'cancelado') then
    raise exception 'Este lançamento já foi concluído (%).', old.situacao;
  end if;
  if new.situacao = 'cancelado' and (new.cancelado_em is null or coalesce(trim(new.motivo_cancelamento), '') = '') then
    raise exception 'Cancelado exige data e motivo.';
  end if;
  if new.situacao = 'lancado' and coalesce(trim(new.cod_lancamento_erp), '') = '' then
    raise exception 'Lançado exige o código do lançamento no Consistem.';
  end if;
  return new;
end $$;

-- Gestor: o título foi excluído no Consistem → cancelado aqui (quem e por quê ficam no registro e na auditoria).
create function rh_vt_cancelar_lancamento(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v rh_vt_lancamentos_erp;
begin
  perform rh_vt_exigir('gestor');
  if coalesce(length(trim(p_motivo)), 0) < 3 then raise exception 'Informe o motivo (ex.: excluído no Consistem em dd/mm).'; end if;
  select * into v from rh_vt_lancamentos_erp where id = p_id for update;
  if v.id is null or v.situacao <> 'lancado' then raise exception 'Só um título lançado pode ser cancelado.'; end if;
  update rh_vt_lancamentos_erp set situacao = 'cancelado', cancelado_por = auth.uid(), cancelado_em = now(), motivo_cancelamento = trim(p_motivo)
   where id = p_id;
end $$;
revoke all on function rh_vt_cancelar_lancamento(uuid, text) from public, anon;
