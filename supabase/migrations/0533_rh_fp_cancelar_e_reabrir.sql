-- =========================================================
-- Neo Admin — 0533 RH/SST: desfazer um título da folha e reabrir sem mexer nos outros (decisão de 27/11/2026)
-- Caso real: avulso do Joanilson errado numa folha com 26 títulos no Consistem; "Reabrir" recusava por causa de QUALQUER título.
--
-- 1) Livro da folha ganha a saída lançado → cancelado (como o VT na 0523). O cancelamento só é gravado pela Edge Function
--    rh-fp-cancelar-titulo, DEPOIS de ler o título no Consistem e ele responder "Lançamento não cadastrado!" (excluído lá à mão:
--    a API não tem exclusão). A resposta lida fica em evidencia_cancelamento. Título pago nunca é cancelado aqui.
-- 2) Reabrir passa a ser permitido com títulos lançados: eles ficam preservados e TRAVADOS. Recusa se houver título em envio
--    ou sem resposta (reservado/enviando) e se a folha já foi paga com título no Consistem (regerar o arquivo do BB pagaria todos).
-- 3) Trava por coluna: com título ativo (reservado/enviando/lançado) de um tipo, a coluna desse tipo não muda; fornecedor,
--    empresa, empregador e forma (que definem fornecedor, empresa e portador do título) não mudam com qualquer título ativo.
--    Para mudar: cancelar o título (1). "Atualizar do cadastro" pula esses campos nas linhas travadas.
-- Nada é apagado; tudo passa pela auditoria do núcleo.
-- =========================================================

-- 1) Cancelado no livro da folha ------------------------------------------------------------------------------------------------
alter table rh_fp_lancamentos_erp
  add column cancelado_por uuid references perfis(id),
  add column cancelado_em timestamptz,
  add column motivo_cancelamento text,
  add column evidencia_cancelamento jsonb;
comment on column rh_fp_lancamentos_erp.evidencia_cancelamento is 'O que o Consistem respondeu ao ler o título antes de cancelar (deve ser "não cadastrado").';

-- Regras: a única saída de "lancado" é "cancelado" (com data, motivo e evidência); cancelado e erro são finais.
create or replace function fn_rh_fp_lancamento_regras() returns trigger language plpgsql as $$
begin
  if (new.competencia_id, new.item_id, new.tipo, new.lote, new.ordem, new.valor, new.payload, new.criado_por, new.criado_em)
     is distinct from (old.competencia_id, old.item_id, old.tipo, old.lote, old.ordem, old.valor, old.payload, old.criado_por, old.criado_em) then
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
  if new.situacao = 'cancelado' and (new.cancelado_em is null or coalesce(trim(new.motivo_cancelamento), '') = '' or new.evidencia_cancelamento is null) then
    raise exception 'Cancelado exige data, motivo e a conferência no Consistem.';
  end if;
  if new.situacao = 'lancado' and coalesce(trim(new.cod_lancamento_erp), '') = '' then
    raise exception 'Lançado exige o código do lançamento no Consistem.';
  end if;
  return new;
end $$;

-- Só a Edge Function (service role), que conferiu o gestor do RH pelo JWT e leu o título no Consistem.
create function rh_fp_cancelar_lancamento_conferido(p_id uuid, p_usuario uuid, p_motivo text, p_evidencia jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v rh_fp_lancamentos_erp;
begin
  if coalesce(length(trim(p_motivo)), 0) < 3 then raise exception 'Informe o motivo (ex.: valor errado; excluído no Consistem em dd/mm).'; end if;
  if p_evidencia is null then raise exception 'Falta a conferência do título no Consistem.'; end if;
  if not exists (select 1 from perfis where id = p_usuario) then raise exception 'Usuário inválido.'; end if;
  select * into v from rh_fp_lancamentos_erp where id = p_id for update;
  if v.id is null or v.situacao <> 'lancado' then raise exception 'Só um título lançado pode ser cancelado.'; end if;
  update rh_fp_lancamentos_erp set situacao = 'cancelado', cancelado_por = p_usuario, cancelado_em = now(),
         motivo_cancelamento = trim(p_motivo), evidencia_cancelamento = p_evidencia
   where id = p_id;
end $$;
revoke all on function rh_fp_cancelar_lancamento_conferido(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function rh_fp_cancelar_lancamento_conferido(uuid, uuid, text, jsonb) to service_role;

-- 2) Reabrir com títulos preservados ----------------------------------------------------------------------------------------------
create or replace function rh_fp_reabrir(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_envio int;
  v_lancados int;
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo para reabrir.'; end if;
  c := rh_fp_competencia_para(p_id, array['conferida', 'aprovada', 'paga']);
  select count(*) filter (where situacao in ('reservado', 'enviando')), count(*) filter (where situacao = 'lancado')
    into v_envio, v_lancados from rh_fp_lancamentos_erp where competencia_id = p_id;
  if v_envio > 0 then
    raise exception 'Esta folha tem % título(s) em envio ou sem resposta do Consistem: resolva-os em "Contas a pagar no Consistem" antes de reabrir.', v_envio;
  end if;
  if v_lancados > 0 and c.status = 'paga' then
    raise exception 'Esta folha já foi paga e tem % título(s) no Consistem: reabrir regeraria o arquivo do BB com todos. Acerte no Consistem primeiro.', v_lancados;
  end if;
  update rh_fp_competencias set status = 'aberta', reaberta_por = auth.uid(), reaberta_em = now(), reaberta_motivo = trim(p_motivo),
         arquivo_bb_gerado_por = null, arquivo_bb_gerado_em = null, paga_por = null, paga_em = null where id = p_id;
  perform rh_fp_encerrar_pendencia('Aprovar folha de ' || rh_fp_rotulo(c.competencia, c.tipo), 'cancelada');
  perform rh_fp_encerrar_pendencia('Pagar folha de ' || rh_fp_rotulo(c.competencia, c.tipo), 'cancelada');
  perform rh_fp_abrir_pendencia(p_id, 'Fechar folha de ' || rh_fp_rotulo(c.competencia, c.tipo),
    'Reaberta: ' || trim(p_motivo) || case when v_lancados > 0 then ' (' || v_lancados || ' título(s) no Consistem continuam valendo e travados)' else '' end,
    c.data_pagamento);
end $$;

-- 3) Trava por coluna -------------------------------------------------------------------------------------------------------------
-- security definer: lê o livro mesmo quando chamado por função de quem não lê a tabela.
create or replace function rh_fp_item_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_trava text;
begin
  select status into v_status from rh_fp_competencias where id = new.competencia_id;
  if tg_op = 'INSERT' and v_status <> 'aberta' then
    raise exception 'A folha deste mês não está aberta.';
  end if;
  if tg_op = 'UPDATE' and v_status <> 'aberta'
     -- "valor" é coluna gerada: num gatilho BEFORE ela ainda não foi calculada (fica de fora da comparação)
     and (to_jsonb(new) - array['pix_pago_por', 'pix_pago_em', 'atualizado_em', 'atualizado_por', 'valor'])
         is distinct from (to_jsonb(old) - array['pix_pago_por', 'pix_pago_em', 'atualizado_em', 'atualizado_por', 'valor']) then
    raise exception 'A folha deste mês não está aberta; para alterar, o gestor precisa reabrir.';
  end if;
  if tg_op = 'UPDATE' then
    select l.tipo || coalesce(' (cód. ' || l.cod_lancamento_erp || ')', '') into v_trava
      from rh_fp_lancamentos_erp l
     where l.item_id = new.id and l.situacao in ('reservado', 'enviando', 'lancado')
       and ((new.cod_fornecedor, new.empresa_id, new.empregador, new.forma_pagamento)
              is distinct from (old.cod_fornecedor, old.empresa_id, old.empregador, old.forma_pagamento)
            or (l.tipo = 'salario' and new.liquido is distinct from old.liquido)
            or (l.tipo = 'ferias' and new.ferias_acrescimos is distinct from old.ferias_acrescimos)
            or (l.tipo = 'avulso' and new.avulso is distinct from old.avulso)
            or (l.tipo in ('decimo_1', 'decimo_2') and new.decimo_terceiro is distinct from old.decimo_terceiro))
     order by l.criado_em limit 1;
    if v_trava is not null then
      raise exception 'O título % de % já está no Consistem: para mudar este valor, cancele o título antes (Contas a pagar no Consistem).', v_trava, old.nome;
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end $$;

-- Atualizar do cadastro: nas linhas com título ativo, fornecedor, empresa e empregador ficam como estão (o resto atualiza).
create or replace function rh_fp_atualizar_do_cadastro(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_atu int; v_inc int; v_trav int;
begin
  perform rh_exigir('operador');
  c := rh_fp_competencia_para(p_id, array['aberta']);
  select count(*) into v_trav
    from rh_fp_itens i join rh_colaboradores k on k.id = i.colaborador_id
   where i.competencia_id = p_id and k.cod_fornecedor is not null
     and (i.empresa_id, i.empregador, i.cod_fornecedor) is distinct from (k.empresa_id, k.empregador, k.cod_fornecedor)
     and exists (select 1 from rh_fp_lancamentos_erp l where l.item_id = i.id and l.situacao in ('reservado', 'enviando', 'lancado'));
  update rh_fp_itens i set
         empresa_id = case when x.travada then i.empresa_id else x.empresa_id end,
         empregador = case when x.travada then i.empregador else x.empregador end,
         cod_fornecedor = case when x.travada then i.cod_fornecedor else x.cod_fornecedor end,
         matricula_escritorio = x.matricula_escritorio, nome = x.nome, cpf = x.cpf, agencia = x.agencia, conta = x.conta, atualizado_por = auth.uid()
    from (select i2.id, k.empresa_id, k.empregador, k.cod_fornecedor, k.matricula_escritorio, k.nome, k.cpf, k.agencia, k.conta,
                 exists (select 1 from rh_fp_lancamentos_erp l where l.item_id = i2.id and l.situacao in ('reservado', 'enviando', 'lancado')) as travada,
                 (i2.empresa_id, i2.empregador, i2.cod_fornecedor) is distinct from (k.empresa_id, k.empregador, k.cod_fornecedor) as muda_chave,
                 (i2.matricula_escritorio, i2.nome, i2.cpf, i2.agencia, i2.conta)
                   is distinct from (k.matricula_escritorio, k.nome, k.cpf, k.agencia, k.conta) as muda_resto
            from rh_fp_itens i2 join rh_colaboradores k on k.id = i2.colaborador_id
           where i2.competencia_id = p_id and k.cod_fornecedor is not null) x
   where i.id = x.id and (x.muda_resto or (x.muda_chave and not x.travada));
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
  return jsonb_build_object('atualizados', v_atu, 'incluidos', v_inc, 'travados', v_trav);
end $$;
