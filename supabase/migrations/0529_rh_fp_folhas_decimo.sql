-- =========================================================
-- Neo Admin — 0529 RH/SST > Folha de pagamento: folhas próprias do 13º (1ª e 2ª parcela)
-- Decisão de 18/11/2026 (docs/modulos/rh-folha.md, regra 4): o 13º deixa de ser coluna da folha mensal (1ª parcela no mês do
-- aniversário, decisão de 15/10) e ganha folha própria, com o mesmo fluxo (aberta → conferida → aprovada → paga), arquivo do BB,
-- PIX e títulos no Consistem.
--
-- 1) rh_fp_competencias.tipo: mensal | decimo_1 (competência = novembro) | decimo_2 (competência = dezembro).
--    Um registro por mês e por tipo. Pagamento sugerido: último dia útil até 30/11 (1ª) e até 20/12 (2ª).
-- 2) Folha do 13º só tem 13º (líquido, férias e avulso zerados); folha mensal não recebe 13º novo (os meses antigos ficam como estão).
-- 3) Recibos avulsos, pendências e mensagens distinguem o tipo (rh_fp_rotulo).
-- 4) Consistem: na folha do 13º o tipo do título vem da folha (antes, dezembro = 2ª parcela).
-- =========================================================

-- 1) Tipo da folha ------------------------------------------------------------------------------------------------------------------
alter table rh_fp_competencias add column tipo text not null default 'mensal'
  check (tipo = 'mensal' or (tipo = 'decimo_1' and extract(month from competencia) = 11) or (tipo = 'decimo_2' and extract(month from competencia) = 12));
alter table rh_fp_competencias drop constraint rh_fp_competencias_competencia_key;
alter table rh_fp_competencias add constraint rh_fp_competencias_competencia_tipo_key unique (competencia, tipo);
comment on column rh_fp_competencias.tipo is 'mensal = folha do mês (paga no 5º dia útil do mês seguinte); decimo_1 / decimo_2 = folha do 13º 1ª (novembro) e 2ª parcela (dezembro).';

-- "setembro/2026", "13º 1ª parcela/2026", "13º 2ª parcela/2026"
create function rh_fp_rotulo(p_competencia date, p_tipo text) returns text
language sql immutable as $$
  select case p_tipo when 'decimo_1' then '13º 1ª parcela/' || extract(year from p_competencia)::int
                     when 'decimo_2' then '13º 2ª parcela/' || extract(year from p_competencia)::int
                     else rh_vt_rotulo_mes(p_competencia) end
$$;

-- Último dia útil (seg–sex, sem feriados) até a data.
create function rh_dia_util_ate(p_data date) returns date
language sql immutable as $$
  select max(d)::date from generate_series(p_data - 6, p_data, interval '1 day') d where extract(isodow from d) < 6
$$;

-- 2) Valores conforme o tipo da folha -------------------------------------------------------------------------------------------
create function rh_fp_item_tipo_regras() returns trigger
language plpgsql as $$
declare
  v_tipo text;
begin
  select tipo into v_tipo from rh_fp_competencias where id = new.competencia_id;
  if v_tipo <> 'mensal' and (new.liquido, new.ferias_acrescimos, new.avulso) is distinct from (0::numeric, 0::numeric, 0::numeric) then
    raise exception 'A folha do 13º só tem o 13º: líquido, férias/acréscimos e avulso ficam na folha do mês.';
  end if;
  if v_tipo = 'mensal' and new.decimo_terceiro > 0
     and new.decimo_terceiro is distinct from (case when tg_op = 'UPDATE' then old.decimo_terceiro end) then
    raise exception 'O 13º tem folha própria: abra a folha do 13º (1ª ou 2ª parcela) na tela Meses.';
  end if;
  return new;
end $$;
create trigger trg_rh_fp_itens_tipo before insert or update on rh_fp_itens for each row execute function rh_fp_item_tipo_regras();

-- Abrir: p_tipo mensal (como antes) ou decimo_1 / decimo_2 (p_competencia = qualquer dia do ano).
drop function rh_fp_abrir_competencia(date);
create function rh_fp_abrir_competencia(p_competencia date, p_tipo text default 'mensal') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp date;
  v_pag date;
  v_id uuid;
begin
  perform rh_exigir('operador');
  if p_tipo not in ('mensal', 'decimo_1', 'decimo_2') then raise exception 'Tipo de folha inválido.'; end if;
  v_comp := case p_tipo when 'decimo_1' then make_date(extract(year from p_competencia)::int, 11, 1)
                        when 'decimo_2' then make_date(extract(year from p_competencia)::int, 12, 1)
                        else date_trunc('month', p_competencia)::date end;
  v_pag := case p_tipo when 'decimo_1' then rh_dia_util_ate(make_date(extract(year from v_comp)::int, 11, 30))
                       when 'decimo_2' then rh_dia_util_ate(make_date(extract(year from v_comp)::int, 12, 20))
                       else rh_enesimo_dia_util((v_comp + interval '1 month')::date, 5) end;
  if exists (select 1 from rh_fp_competencias where competencia = v_comp and tipo = p_tipo) then
    raise exception 'A folha de % já foi aberta.', rh_fp_rotulo(v_comp, p_tipo);
  end if;
  insert into rh_fp_competencias (competencia, tipo, data_pagamento) values (v_comp, p_tipo, v_pag) returning id into v_id;
  -- ativos + (só na mensal) quem já tem recibo para este mês (ex.: compra de férias que cruzou o mês)
  insert into rh_fp_itens (competencia_id, colaborador_id, empresa_id, empregador, cod_fornecedor, matricula_escritorio, nome, cpf, agencia, conta,
                           forma_pagamento, atualizado_por)
  select v_id, c.id, c.empresa_id, c.empregador, c.cod_fornecedor, c.matricula_escritorio, c.nome, c.cpf, c.agencia, c.conta, c.forma_pagamento, auth.uid()
    from rh_colaboradores c
   where c.cod_fornecedor is not null   -- sem nº de fornecedor (cadastro incompleto) não entra na folha
     and (c.ativo or (p_tipo = 'mensal' and exists (select 1 from rh_fp_recibos r where r.competencia = v_comp and r.colaborador_id = c.id and not r.cancelado)));
  if p_tipo = 'mensal' then
    perform rh_fp_somar_recibos_do_mes(v_id);
    perform rh_fp_abrir_pendencia(v_id, 'Fechar folha de ' || rh_fp_rotulo(v_comp, p_tipo),
      'Lançar líquidos e férias/acréscimos, conferir os recibos avulsos e marcar a folha como conferida.', v_pag);
  else
    perform rh_fp_abrir_pendencia(v_id, 'Fechar folha de ' || rh_fp_rotulo(v_comp, p_tipo),
      'Importar a Relação de Líquidos do 13º do escritório e marcar a folha como conferida.', v_pag);
  end if;
  return v_id;
end $$;
revoke all on function rh_fp_abrir_competencia(date, text) from public, anon;

create or replace function rh_fp_atualizar_do_cadastro(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_atu int; v_inc int;
begin
  perform rh_exigir('operador');
  c := rh_fp_competencia_para(p_id, array['aberta']);
  update rh_fp_itens i set empresa_id = k.empresa_id, empregador = k.empregador, cod_fornecedor = k.cod_fornecedor, matricula_escritorio = k.matricula_escritorio,
         nome = k.nome, cpf = k.cpf, agencia = k.agencia, conta = k.conta, atualizado_por = auth.uid()
    from rh_colaboradores k
   where i.competencia_id = p_id and k.id = i.colaborador_id and k.cod_fornecedor is not null
     and (i.empresa_id, i.empregador, i.cod_fornecedor, i.matricula_escritorio, i.nome, i.cpf, i.agencia, i.conta)
         is distinct from (k.empresa_id, k.empregador, k.cod_fornecedor, k.matricula_escritorio, k.nome, k.cpf, k.agencia, k.conta);
  get diagnostics v_atu = row_count;
  insert into rh_fp_itens (competencia_id, colaborador_id, empresa_id, empregador, cod_fornecedor, matricula_escritorio, nome, cpf, agencia, conta,
                           forma_pagamento, atualizado_por)
  select p_id, k.id, k.empresa_id, k.empregador, k.cod_fornecedor, k.matricula_escritorio, k.nome, k.cpf, k.agencia, k.conta, k.forma_pagamento, auth.uid()
    from rh_colaboradores k
   where k.cod_fornecedor is not null
     and (k.ativo or (c.tipo = 'mensal' and exists (select 1 from rh_fp_recibos r where r.competencia = c.competencia and r.colaborador_id = k.id and not r.cancelado)))
     and not exists (select 1 from rh_fp_itens i where i.competencia_id = p_id and i.colaborador_id = k.id);
  get diagnostics v_inc = row_count;
  if c.tipo = 'mensal' then perform rh_fp_somar_recibos_do_mes(p_id); end if;
  return jsonb_build_object('atualizados', v_atu, 'incluidos', v_inc);
end $$;

-- 3) Recibos avulsos: só a folha mensal ----------------------------------------------------------------------------------------
create or replace function rh_fp_recalcular_avulso(p_competencia date, p_colaborador uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_motivo text;
begin
  select coalesce(sum(r.total), 0),
         string_agg(case r.tipo when 'recorrente' then 'recorrente' when 'compra_ferias' then 'compra de férias' when 'inicio_antes_registro' then 'início antes do registro' else 'eventual' end
                    || case when r.periodo_inicio is not null then ' ' || to_char(r.periodo_inicio, 'DD/MM') || '–' || to_char(r.periodo_fim, 'DD/MM') else '' end, '; ' order by r.criado_em)
    into v_total, v_motivo
    from rh_fp_recibos r where r.competencia = p_competencia and r.colaborador_id = p_colaborador and not r.cancelado;
  update rh_fp_itens i set avulso = v_total, avulso_motivo = case when v_total > 0 then 'Recibo(s): ' || v_motivo end, atualizado_por = auth.uid()
    from rh_fp_competencias c
   where c.id = i.competencia_id and c.competencia = p_competencia and c.tipo = 'mensal' and c.status = 'aberta' and i.colaborador_id = p_colaborador
     and (i.avulso, i.avulso_motivo) is distinct from (v_total, case when v_total > 0 then 'Recibo(s): ' || v_motivo end);
end $$;

create or replace function rh_fp_gravar_recibo(p_competencia date, p_colaborador uuid, p_tipo text, p_salario numeric, p_insalubridade int, p_noturno int,
                                    p_funcao text, p_inicio date, p_fim date, p_mensagem text, p_linhas jsonb, p_substitui uuid default null)
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
  select * into v_mes from rh_fp_competencias where competencia = v_comp and tipo = 'mensal';
  if v_mes.id is not null and v_mes.status <> 'aberta' then
    raise exception 'A folha de % não está aberta; para mudar recibos, o gestor precisa reabrir.', rh_vt_rotulo_mes(v_comp);
  end if;
  if v_mes.id is not null and not exists (select 1 from rh_fp_itens where competencia_id = v_mes.id and colaborador_id = p_colaborador) then
    raise exception 'A pessoa não está na folha de %; use "Atualizar do cadastro" na folha.', rh_vt_rotulo_mes(v_comp);
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
     where id = p_substitui and not cancelado and colaborador_id = p_colaborador;
    if not found then raise exception 'O recibo a substituir não existe ou já foi cancelado.'; end if;
  end if;
  insert into rh_fp_recibos (competencia, colaborador_id, tipo, salario, insalubridade_pct, adicional_noturno_pct, funcao, periodo_inicio, periodo_fim, mensagem, proventos, descontos, total)
  values (v_comp, p_colaborador, p_tipo, round(p_salario, 2), coalesce(p_insalubridade, 0), coalesce(p_noturno, 0), nullif(trim(p_funcao), ''),
          p_inicio, p_fim, nullif(trim(p_mensagem), ''), round(v_prov, 2), round(v_desc, 2), round(v_prov - v_desc, 2))
  returning id into v_id;
  insert into rh_fp_recibo_linhas (recibo_id, ordem, rubrica, descricao, natureza, referencia, valor)
  select v_id, x.ord, x.rubrica, coalesce(nullif(trim(x.descricao), ''), r.descricao), r.natureza, coalesce(x.referencia, 0), round(x.valor, 2)
    from rows from (jsonb_to_recordset(p_linhas) as (rubrica text, descricao text, referencia numeric, valor numeric)) with ordinality as x(rubrica, descricao, referencia, valor, ord)
    join rh_fp_rubricas r on r.codigo = x.rubrica;
  perform rh_fp_recalcular_avulso(v_comp, p_colaborador);
  return v_id;
end $$;

create or replace function rh_fp_cancelar_recibo(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r rh_fp_recibos;
begin
  perform rh_exigir('operador');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into r from rh_fp_recibos where id = p_id for update;
  if r.id is null or r.cancelado then raise exception 'Recibo não encontrado ou já cancelado.'; end if;
  if exists (select 1 from rh_fp_competencias where competencia = r.competencia and tipo = 'mensal' and status <> 'aberta') then
    raise exception 'A folha de % não está aberta; para cancelar o recibo, o gestor precisa reabrir.', rh_vt_rotulo_mes(r.competencia);
  end if;
  update rh_fp_recibos set cancelado = true, cancelado_motivo = trim(p_motivo), cancelado_por = auth.uid(), cancelado_em = now() where id = p_id;
  perform rh_fp_recalcular_avulso(r.competencia, r.colaborador_id);
end $$;

-- 4) Fluxo: rótulo com o tipo (pendências e mensagens) ---------------------------------------------------------------------------
create or replace function rh_fp_competencia_para(p_id uuid, p_status text[]) returns rh_fp_competencias
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
begin
  select * into c from rh_fp_competencias where id = p_id for update;
  if c.id is null then raise exception 'Mês da folha não encontrado.'; end if;
  if not (c.status = any (p_status)) then
    raise exception 'A folha de % está "%"; esta ação não vale nessa situação.', rh_fp_rotulo(c.competencia, c.tipo), c.status;
  end if;
  return c;
end $$;

create or replace function rh_fp_conferir(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_faltando text;
begin
  perform rh_exigir('operador');
  c := rh_fp_competencia_para(p_id, array['aberta']);
  if not exists (select 1 from rh_fp_itens where competencia_id = p_id and valor > 0) then
    raise exception 'Nenhum valor lançado na folha de %.', rh_fp_rotulo(c.competencia, c.tipo);
  end if;
  select string_agg(cod_fornecedor || ' ' || nome, ', ' order by nome) into v_faltando
    from rh_fp_itens where competencia_id = p_id and forma_pagamento = 'fopag' and valor > 0 and (cpf is null or agencia is null or conta is null);
  if v_faltando is not null then
    raise exception 'FOPAG sem CPF, agência ou conta (não entram no arquivo do BB): %. Complete o cadastro e use "Atualizar do cadastro", ou mude a forma de pagamento.', v_faltando;
  end if;
  update rh_fp_competencias set status = 'conferida', conferida_por = auth.uid(), conferida_em = now() where id = p_id;
  perform rh_fp_encerrar_pendencia('Fechar folha de ' || rh_fp_rotulo(c.competencia, c.tipo), 'concluida');
  perform rh_fp_abrir_pendencia(p_id, 'Aprovar folha de ' || rh_fp_rotulo(c.competencia, c.tipo), 'Conferir e aprovar a folha (gestor).', c.data_pagamento);
end $$;

create or replace function rh_fp_aprovar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
begin
  perform rh_exigir('gestor');
  c := rh_fp_competencia_para(p_id, array['conferida']);
  update rh_fp_competencias set status = 'aprovada', aprovada_por = auth.uid(), aprovada_em = now() where id = p_id;
  perform rh_fp_encerrar_pendencia('Aprovar folha de ' || rh_fp_rotulo(c.competencia, c.tipo), 'concluida');
  perform rh_fp_abrir_pendencia(p_id, 'Pagar folha de ' || rh_fp_rotulo(c.competencia, c.tipo), 'Gerar o arquivo do BB (FOPAG) e pagar os PIX.', c.data_pagamento);
end $$;

create or replace function rh_fp_reabrir(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_n int;
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo para reabrir.'; end if;
  c := rh_fp_competencia_para(p_id, array['conferida', 'aprovada', 'paga']);
  select count(*) into v_n from rh_fp_lancamentos_erp where competencia_id = p_id and situacao in ('reservado', 'enviando', 'lancado');
  if v_n > 0 then
    raise exception 'Esta folha já tem % título(s) no Consistem (ou em envio). Reabrir mudaria valores já lançados: acerte no Consistem primeiro.', v_n;
  end if;
  update rh_fp_competencias set status = 'aberta', reaberta_por = auth.uid(), reaberta_em = now(), reaberta_motivo = trim(p_motivo),
         arquivo_bb_gerado_por = null, arquivo_bb_gerado_em = null, paga_por = null, paga_em = null where id = p_id;
  perform rh_fp_encerrar_pendencia('Aprovar folha de ' || rh_fp_rotulo(c.competencia, c.tipo), 'cancelada');
  perform rh_fp_encerrar_pendencia('Pagar folha de ' || rh_fp_rotulo(c.competencia, c.tipo), 'cancelada');
  perform rh_fp_abrir_pendencia(p_id, 'Fechar folha de ' || rh_fp_rotulo(c.competencia, c.tipo), 'Reaberta: ' || trim(p_motivo), c.data_pagamento);
end $$;

create or replace function rh_fp_marcar_paga(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_pix int;
begin
  perform rh_exigir('operador');
  c := rh_fp_competencia_para(p_id, array['aprovada']);
  if c.arquivo_bb_gerado_em is null and exists (select 1 from rh_fp_itens where competencia_id = p_id and forma_pagamento = 'fopag' and valor > 0) then
    raise exception 'Gere o arquivo do BB (FOPAG) antes de marcar a folha como paga.';
  end if;
  select count(*) into v_pix from rh_fp_itens where competencia_id = p_id and forma_pagamento <> 'fopag' and valor > 0 and pix_pago_em is null;
  if v_pix > 0 then raise exception 'Ainda há % PIX sem marcação de pago.', v_pix; end if;
  update rh_fp_competencias set status = 'paga', paga_por = auth.uid(), paga_em = now() where id = p_id;
  perform rh_fp_encerrar_pendencia('Pagar folha de ' || rh_fp_rotulo(c.competencia, c.tipo), 'concluida');
end $$;

-- 5) Consistem: tipo do 13º pela folha ---------------------------------------------------------------------------------------------
-- Valor do tipo: salario = líquido, ferias = férias/acréscimos, avulso; decimo_1/decimo_2 = 13º da folha do 13º (pelo tipo dela) ou,
-- nas folhas mensais antigas, pelo mês (dezembro = 2ª parcela).
create or replace function rh_fp_reservar_lancamentos(p_competencia uuid, p_titulos jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_lote uuid := gen_random_uuid();
  v_ordem int := 0;
  v_tipo text;
  v_valor numeric;
  v_codigos jsonb;
  v_decimo text;
  t jsonb;
  i rh_fp_itens;
begin
  perform rh_exigir('operador');
  if not rh_fp_lancar_no_erp_ligado() then
    raise exception 'O lançamento da folha no Consistem está desligado (RH > Folha de pagamento > Parâmetros).';
  end if;
  c := rh_fp_competencia_para(p_competencia, array['aprovada', 'paga']);
  v_decimo := case when c.tipo <> 'mensal' then c.tipo when extract(month from c.competencia) = 12 then 'decimo_2' else 'decimo_1' end;
  if p_titulos is null or jsonb_typeof(p_titulos) <> 'array' or jsonb_array_length(p_titulos) = 0 then
    raise exception 'Nenhum título para lançar.';
  end if;
  for t in select * from jsonb_array_elements(p_titulos) loop
    select * into i from rh_fp_itens where id = (t ->> 'item_id')::uuid and competencia_id = p_competencia;
    if i.id is null then raise exception 'Linha que não pertence a este mês; recarregue a página.'; end if;
    v_tipo := t ->> 'tipo';
    v_valor := case v_tipo
      when 'salario' then i.liquido
      when 'ferias' then i.ferias_acrescimos
      when 'avulso' then i.avulso
      when 'decimo_1' then case when v_decimo = 'decimo_1' then i.decimo_terceiro end
      when 'decimo_2' then case when v_decimo = 'decimo_2' then i.decimo_terceiro end
    end;
    if v_valor is null then raise exception 'Tipo de título inválido para %; recarregue a página.', i.nome; end if;
    if v_valor <= 0 then raise exception 'O valor de % (%) é zero: não vira título.', i.nome, v_tipo; end if;
    if exists (select 1 from rh_fp_lancamentos_erp where item_id = i.id and tipo = v_tipo and situacao in ('reservado', 'enviando', 'lancado')) then
      raise exception 'O título de % (%) já foi lançado (ou está em envio).', i.nome, v_tipo;
    end if;
    if (t #>> '{payload,codFornecedor}')::text <> i.cod_fornecedor
       or (t #>> '{payload,valorDocumento}')::numeric <> v_valor
       or (t #>> '{payload,dataVencimento}') <> c.data_pagamento::text then
      raise exception 'O título de % não confere com o mês (fornecedor, valor ou vencimento); recarregue a página.', i.nome;
    end if;
    v_codigos := rh_codigos_titulo(v_tipo, i.empregador, i.forma_pagamento);
    if v_codigos is null then
      raise exception 'Faltam nos Parâmetros os códigos de % ou o portador de % (%).', v_tipo, i.empregador, case when i.forma_pagamento = 'fopag' then 'FOPAG' else 'PIX' end;
    end if;
    if not rh_payload_confere(t -> 'payload', v_codigos) then
      raise exception 'Os códigos do título mudaram nos Parâmetros; recarregue a página.';
    end if;
    v_ordem := v_ordem + 1;
    insert into rh_fp_lancamentos_erp (competencia_id, item_id, tipo, lote, ordem, valor, payload)
    values (p_competencia, i.id, v_tipo, v_lote, v_ordem, v_valor, t -> 'payload');
  end loop;
  return v_lote;
end $$;
