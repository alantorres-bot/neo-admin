-- =========================================================
-- Neo Admin — 0531 RH/SST > Folha de pagamento: 13º dos recibos recorrentes ("13º por fora") na folha do 13º
-- Decisão de 27/11/2026 (docs/modulos/rh-folha.md, regra 4): quem tem recibo recorrente pode receber, por opção do RH em cada
-- pessoa, o 13º desse valor por fora. Cálculo no app (lib/modulos/rh/folha/recibos.ts → decimoDoRecorrente):
-- proventos do recibo recorrente de um mês × avos ÷ 12; 1ª parcela = metade, 2ª = o restante.
--
-- 1) rh_fp_recibos.folha: a folha em que o recibo entra (mensal, decimo_1 ou decimo_2). Novo tipo de recibo decimo_recorrente,
--    só nas folhas do 13º e um por pessoa e folha. Nova rubrica decimo_por_fora (valor digitado; referência = avos).
-- 2) A folha do 13º passa a aceitar avulso (vem só dos recibos dela); líquido e férias continuam proibidos.
-- 3) rh_fp_recalcular_avulso / gravar / cancelar / somar levam a folha em conta.
-- =========================================================

-- 1) Recibo ligado à folha -------------------------------------------------------------------------------------------------------
alter table rh_fp_recibos add column folha text not null default 'mensal' check (folha in ('mensal', 'decimo_1', 'decimo_2'));
alter table rh_fp_recibos drop constraint rh_fp_recibos_tipo_check;
alter table rh_fp_recibos add constraint rh_fp_recibos_tipo_check
  check (tipo in ('recorrente', 'compra_ferias', 'inicio_antes_registro', 'eventual', 'decimo_recorrente'));
alter table rh_fp_recibos add constraint rh_fp_recibos_decimo_na_folha_do_decimo check ((tipo = 'decimo_recorrente') = (folha <> 'mensal'));
create unique index uq_rh_fp_recibos_decimo on rh_fp_recibos (competencia, colaborador_id, folha) where tipo = 'decimo_recorrente' and not cancelado;
comment on column rh_fp_recibos.folha is 'Folha em que o recibo entra no avulso: mensal (todos os tipos antigos) ou a do 13º (só o 13º por fora, 0531).';

insert into rh_fp_rubricas (codigo, descricao, natureza, forma, parametro, pct_campo, ordem)
values ('decimo_por_fora', '13º SALÁRIO - POR FORA', 'provento', 'valor', null, null, 16);

-- 2) A folha do 13º aceita avulso (dos recibos do 13º por fora) ------------------------------------------------------------------
create or replace function rh_fp_item_tipo_regras() returns trigger
language plpgsql as $$
declare
  v_tipo text;
begin
  select tipo into v_tipo from rh_fp_competencias where id = new.competencia_id;
  if v_tipo <> 'mensal' and (new.liquido, new.ferias_acrescimos) is distinct from (0::numeric, 0::numeric) then
    raise exception 'A folha do 13º só tem o 13º (e o 13º por fora dos recibos): líquido e férias/acréscimos ficam na folha do mês.';
  end if;
  if v_tipo = 'mensal' and new.decimo_terceiro > 0
     and new.decimo_terceiro is distinct from (case when tg_op = 'UPDATE' then old.decimo_terceiro end) then
    raise exception 'O 13º tem folha própria: abra a folha do 13º (1ª ou 2ª parcela) na tela Meses.';
  end if;
  return new;
end $$;

-- 3) Avulso = soma dos recibos da pessoa naquela folha ---------------------------------------------------------------------------
drop function rh_fp_recalcular_avulso(date, uuid);
create function rh_fp_recalcular_avulso(p_competencia date, p_colaborador uuid, p_folha text default 'mensal') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_motivo text;
begin
  select coalesce(sum(r.total), 0),
         string_agg(case r.tipo when 'recorrente' then 'recorrente' when 'compra_ferias' then 'compra de férias' when 'inicio_antes_registro' then 'início antes do registro'
                                when 'decimo_recorrente' then '13º por fora' else 'eventual' end
                    || case when r.periodo_inicio is not null then ' ' || to_char(r.periodo_inicio, 'DD/MM') || '–' || to_char(r.periodo_fim, 'DD/MM') else '' end, '; ' order by r.criado_em)
    into v_total, v_motivo
    from rh_fp_recibos r where r.competencia = p_competencia and r.colaborador_id = p_colaborador and r.folha = p_folha and not r.cancelado;
  update rh_fp_itens i set avulso = v_total, avulso_motivo = case when v_total > 0 then 'Recibo(s): ' || v_motivo end, atualizado_por = auth.uid()
    from rh_fp_competencias c
   where c.id = i.competencia_id and c.competencia = p_competencia and c.tipo = p_folha and c.status = 'aberta' and i.colaborador_id = p_colaborador
     and (i.avulso, i.avulso_motivo) is distinct from (v_total, case when v_total > 0 then 'Recibo(s): ' || v_motivo end);
end $$;
revoke all on function rh_fp_recalcular_avulso(date, uuid, text) from public, anon, authenticated;

create or replace function rh_fp_somar_recibos_do_mes(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  k uuid;
begin
  select * into c from rh_fp_competencias where id = p_id;
  for k in select distinct colaborador_id from rh_fp_recibos where competencia = c.competencia and folha = c.tipo and not cancelado loop
    perform rh_fp_recalcular_avulso(c.competencia, k, c.tipo);
  end loop;
end $$;

-- Gravar: p_folha = mensal (como antes) ou decimo_1/decimo_2 (só o tipo decimo_recorrente, com a folha do 13º aberta e a pessoa nela).
drop function rh_fp_gravar_recibo(date, uuid, text, numeric, int, int, text, date, date, text, jsonb, uuid);
create function rh_fp_gravar_recibo(p_competencia date, p_colaborador uuid, p_tipo text, p_salario numeric, p_insalubridade int, p_noturno int,
                                    p_funcao text, p_inicio date, p_fim date, p_mensagem text, p_linhas jsonb, p_substitui uuid default null,
                                    p_folha text default 'mensal')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_mes rh_fp_competencias;
  v_id uuid;
  v_prov numeric; v_desc numeric;
begin
  perform rh_exigir('operador');
  if not exists (select 1 from rh_colaboradores where id = p_colaborador) then raise exception 'Colaborador não encontrado.'; end if;
  if (p_tipo = 'decimo_recorrente') <> (coalesce(p_folha, 'mensal') <> 'mensal') then
    raise exception 'O recibo do 13º por fora só vai na folha do 13º, e a folha do 13º só aceita esse recibo.';
  end if;
  select * into v_mes from rh_fp_competencias where competencia = v_comp and tipo = coalesce(p_folha, 'mensal');
  if p_folha <> 'mensal' and v_mes.id is null then raise exception 'Abra a folha de % antes de gerar o recibo.', rh_fp_rotulo(v_comp, p_folha); end if;
  if v_mes.id is not null and v_mes.status <> 'aberta' then
    raise exception 'A folha de % não está aberta; para mudar recibos, o gestor precisa reabrir.', rh_fp_rotulo(v_comp, v_mes.tipo);
  end if;
  if v_mes.id is not null and not exists (select 1 from rh_fp_itens where competencia_id = v_mes.id and colaborador_id = p_colaborador) then
    raise exception 'A pessoa não está na folha de %; use "Atualizar do cadastro" na folha.', rh_fp_rotulo(v_comp, v_mes.tipo);
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then raise exception 'O recibo não tem linhas.'; end if;
  if exists (select 1 from jsonb_to_recordset(p_linhas) as x(rubrica text) left join rh_fp_rubricas r on r.codigo = x.rubrica where r.codigo is null) then
    raise exception 'Rubrica desconhecida no recibo.';
  end if;
  select coalesce(sum(x.valor) filter (where r.natureza = 'provento'), 0), coalesce(sum(x.valor) filter (where r.natureza = 'desconto'), 0)
    into v_prov, v_desc
    from jsonb_to_recordset(p_linhas) as x(rubrica text, valor numeric) join rh_fp_rubricas r on r.codigo = x.rubrica;
  if v_prov - v_desc < 0 then raise exception 'Os descontos passam dos proventos: o recibo ficaria negativo.'; end if;
  if p_substitui is not null then
    update rh_fp_recibos set cancelado = true, cancelado_motivo = 'Substituído por um novo recibo', cancelado_por = auth.uid(), cancelado_em = now()
     where id = p_substitui and not cancelado and colaborador_id = p_colaborador and folha = coalesce(p_folha, 'mensal');
    if not found then raise exception 'O recibo a substituir não existe ou já foi cancelado.'; end if;
  end if;
  if p_tipo = 'decimo_recorrente' and exists (select 1 from rh_fp_recibos where competencia = v_comp and colaborador_id = p_colaborador and folha = p_folha
                                                 and tipo = 'decimo_recorrente' and not cancelado) then
    raise exception 'A pessoa já tem o recibo do 13º por fora em %; cancele o atual para gerar outro.', rh_fp_rotulo(v_comp, p_folha);
  end if;
  insert into rh_fp_recibos (competencia, colaborador_id, tipo, folha, salario, insalubridade_pct, adicional_noturno_pct, funcao, periodo_inicio, periodo_fim, mensagem, proventos, descontos, total)
  values (v_comp, p_colaborador, p_tipo, coalesce(p_folha, 'mensal'), round(p_salario, 2), coalesce(p_insalubridade, 0), coalesce(p_noturno, 0), nullif(trim(p_funcao), ''),
          p_inicio, p_fim, nullif(trim(p_mensagem), ''), round(v_prov, 2), round(v_desc, 2), round(v_prov - v_desc, 2))
  returning id into v_id;
  insert into rh_fp_recibo_linhas (recibo_id, ordem, rubrica, descricao, natureza, referencia, valor)
  select v_id, x.ord, x.rubrica, coalesce(nullif(trim(x.descricao), ''), r.descricao), r.natureza, coalesce(x.referencia, 0), round(x.valor, 2)
    from rows from (jsonb_to_recordset(p_linhas) as (rubrica text, descricao text, referencia numeric, valor numeric)) with ordinality as x(rubrica, descricao, referencia, valor, ord)
    join rh_fp_rubricas r on r.codigo = x.rubrica;
  perform rh_fp_recalcular_avulso(v_comp, p_colaborador, coalesce(p_folha, 'mensal'));
  return v_id;
end $$;
revoke all on function rh_fp_gravar_recibo(date, uuid, text, numeric, int, int, text, date, date, text, jsonb, uuid, text) from public, anon;

create or replace function rh_fp_cancelar_recibo(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r rh_fp_recibos;
begin
  perform rh_exigir('operador');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into r from rh_fp_recibos where id = p_id for update;
  if r.id is null or r.cancelado then raise exception 'Recibo não encontrado ou já cancelado.'; end if;
  if exists (select 1 from rh_fp_competencias where competencia = r.competencia and tipo = r.folha and status <> 'aberta') then
    raise exception 'A folha de % não está aberta; para cancelar o recibo, o gestor precisa reabrir.', rh_fp_rotulo(r.competencia, r.folha);
  end if;
  update rh_fp_recibos set cancelado = true, cancelado_motivo = trim(p_motivo), cancelado_por = auth.uid(), cancelado_em = now() where id = p_id;
  perform rh_fp_recalcular_avulso(r.competencia, r.colaborador_id, r.folha);
end $$;
