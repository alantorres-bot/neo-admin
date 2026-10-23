-- =========================================================
-- Neo Admin — 0184 Recebíveis como espelho do Consistem: baixa só do que saiu do ERP, reabertura só do que voltou
-- Decisão do Alan (23/10/2026): o controle é um espelho do Consistem. Se o título está em aberto no Consistem, pode ser
-- reaberto (estorno); se não está, tem que estar baixado aqui.
--   1) Baixa (rec_registrar_baixa): só de título que saiu da lista de abertos (pendência "Possível baixa" aberta). Trava a
--      linha (duas baixas ao mesmo tempo não passam as duas) e guarda o estágio de antes em estagio_antes_baixa.
--   2) Reabertura (rec_reabrir_titulo, nova): operador do Financeiro, motivo obrigatório, só enquanto a sincronização marca
--      o título como aberto no Consistem (pendência "Baixado aqui, aberto no Consistem"). Volta ao estágio de antes da baixa,
--      tira data e valor da baixa do título (ficam no histórico) e reativa as partes da AKF que a baixa encerrou.
--   3) Trava no banco para quem usa o app (papel authenticated): estágio só vira pago/cancelado pela baixa e só sai de
--      encerrado pela reabertura; dados que vêm do Consistem (valor, vencimento, documento...) só pela sincronização (service
--      role); a correção da unidade só pela rec_definir_unidade. As demais funções (boleto, confirmação, cobrança, AKF, kit)
--      não mudam.
-- =========================================================

alter table rec_titulos add column estagio_antes_baixa rec_estagio;

-- Trava -------------------------------------------------------------------------------------------------------------------
create function fn_rec_titulos_integridade() returns trigger language plpgsql as $$
declare
  -- Dados que vêm do Consistem: só a sincronização (service role) altera.
  do_erp constant text[] := array['empresa_id', 'contraparte_id', 'documento', 'parcela', 'emissao', 'vencimento', 'valor', 'origem',
                                  'cod_portador', 'tipo_cobranca', 'nota_fiscal', 'chave_nfe', 'nota_saida_id',
                                  'consistem_pago_em', 'consistem_valor_pago', 'consistem_tipo_baixa', 'consistem_verificado_em'];
  encerrados constant rec_estagio[] := array['pago', 'cancelado', 'renegociado']::rec_estagio[];
  v_baixa boolean := coalesce(current_setting('neo.rec_baixa', true) = 'on', false);
  v_reabrir boolean := coalesce(current_setting('neo.rec_reabrir', true) = 'on', false);
begin
  -- Sincronização (service role), funções security definer e manutenção (postgres) passam direto.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(do_erp) k)
     is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(do_erp) k) then
    raise exception 'Valor, vencimento, documento e demais dados do Consistem só mudam pela sincronização.';
  end if;
  if new.estagio = any(encerrados) and not old.estagio = any(encerrados) and not v_baixa then
    raise exception 'Para dar baixa ou cancelar o título, use Cobrança > Baixas a conferir.';
  end if;
  if old.estagio = any(encerrados) and new.estagio is distinct from old.estagio and not v_reabrir then
    raise exception 'O título está encerrado: só pode ser reaberto enquanto estiver em aberto no Consistem.';
  end if;
  if (new.data_pagamento, new.valor_pago, new.estagio_antes_baixa) is distinct from (old.data_pagamento, old.valor_pago, old.estagio_antes_baixa)
     and not (v_baixa or v_reabrir) then
    raise exception 'Data e valor da baixa só mudam pela baixa ou pela reabertura do título.';
  end if;
  if new.unidade_manual is distinct from old.unidade_manual and current_setting('neo.rec_unidade', true) is distinct from 'on' then
    raise exception 'A unidade do título só se corrige pela ficha do título (gestor do Financeiro).';
  end if;
  return new;
end $$;
-- "zy": depois do atualizado_em e antes do gatilho da filial ("zz").
create trigger trg_rec_titulos_zy_integridade before update on rec_titulos for each row execute function fn_rec_titulos_integridade();

-- 1) Baixa ----------------------------------------------------------------------------------------------------------------
create or replace function rec_registrar_baixa(
  p_titulo uuid,
  p_resultado text,
  p_data_pagamento date default null,
  p_valor_pago numeric default null,
  p_descricao text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_t record;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_concluidas int := 0;
  v_descricao text;
begin
  if p_resultado not in ('pago', 'cancelado') then
    raise exception 'Resultado inválido.';
  end if;

  -- for update: a segunda baixa simultânea espera a primeira e encontra o título já encerrado.
  select id, contraparte_id, documento, parcela, valor, emissao, estagio, origem into v_t from rec_titulos where id = p_titulo for update;
  if not found then
    -- for update só enxerga o que a pessoa pode alterar: quem só consulta vê o título, mas não dá baixa.
    if exists (select 1 from rec_titulos where id = p_titulo) then
      raise exception 'Você não tem permissão para dar baixa (é preciso ser operador do Financeiro).';
    end if;
    raise exception 'Título não encontrado (ou você não tem acesso a ele).';
  end if;
  if v_t.estagio in ('pago', 'renegociado', 'cancelado') then
    raise exception 'O título % já está encerrado.', v_t.documento;
  end if;
  -- Espelho do Consistem: baixa-se aqui o que o Consistem já tirou da lista de abertos.
  if v_t.origem = 'importacao' and not exists (
    select 1 from pendencias where modulo = 'financeiro.recebiveis' and referencia_tabela = 'rec_titulos' and referencia_id = p_titulo
       and titulo like 'Possível baixa:%' and status in ('aberta', 'em_andamento')) then
    raise exception 'O título % ainda está em aberto no Consistem: dê a baixa primeiro no Consistem; depois da sincronização ele aparece em Baixas a conferir.', v_t.documento;
  end if;

  perform set_config('neo.rec_baixa', 'on', true);
  if p_resultado = 'pago' then
    if p_data_pagamento is null then
      raise exception 'Informe a data do pagamento.';
    end if;
    if p_data_pagamento > v_hoje then
      raise exception 'A data do pagamento não pode ser futura.';
    end if;
    if v_t.emissao is not null and p_data_pagamento < v_t.emissao then
      raise exception 'A data do pagamento (%) é anterior à emissão do título (%).', to_char(p_data_pagamento, 'DD/MM/YYYY'), to_char(v_t.emissao, 'DD/MM/YYYY');
    end if;
    if p_valor_pago is null or p_valor_pago <= 0 then
      raise exception 'Informe o valor pago.';
    end if;
    if p_valor_pago <> v_t.valor and coalesce(trim(p_descricao), '') = '' then
      raise exception 'O valor pago difere do valor do título: informe o motivo (juros, desconto, pagamento parcial...).';
    end if;

    update rec_titulos set estagio = 'pago', data_pagamento = p_data_pagamento, valor_pago = p_valor_pago, estagio_antes_baixa = v_t.estagio
     where id = p_titulo;
    v_descricao := format('Baixa: pago em %s, valor R$ %s.%s',
      to_char(p_data_pagamento, 'DD/MM/YYYY'), translate(to_char(p_valor_pago, 'FM999,999,999,990.00'), ',.', '.,'),
      case when coalesce(trim(p_descricao), '') <> '' then ' ' || trim(p_descricao) else '' end);
  else
    update rec_titulos set estagio = 'cancelado', estagio_antes_baixa = v_t.estagio where id = p_titulo;
    v_descricao := 'Título cancelado (baixa sem pagamento).' || case when coalesce(trim(p_descricao), '') <> '' then ' ' || trim(p_descricao) else '' end;
  end if;
  if not found then
    raise exception 'Você não tem permissão para dar baixa (é preciso ser operador do Financeiro).';
  end if;
  perform set_config('neo.rec_baixa', 'off', true);

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  values ('financeiro.recebiveis', v_t.contraparte_id, 'rec_titulos', p_titulo, 'interno',
          case when p_resultado = 'pago' then 'baixa' else 'cancelamento' end, v_descricao, auth.uid());

  update pendencias set status = 'concluida'
   where modulo = 'financeiro.recebiveis' and referencia_tabela = 'rec_titulos' and referencia_id = p_titulo
     and titulo like 'Possível baixa:%' and status in ('aberta', 'em_andamento');
  get diagnostics v_concluidas = row_count;

  return jsonb_build_object('titulo', v_t.documento, 'resultado', p_resultado, 'pendencias_concluidas', v_concluidas);
end $$;

-- 2) Reabertura -----------------------------------------------------------------------------------------------------------
create function rec_reabrir_titulo(p_titulo uuid, p_motivo text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_t record;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_destino rec_estagio;
  v_partes int;
  v_rotulo text;
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente o operador do Financeiro (ou acima) pode reabrir o título.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo da reabertura.';
  end if;

  select id, contraparte_id, documento, vencimento, estagio, estagio_antes_baixa into v_t from rec_titulos where id = p_titulo for update;
  if not found then
    if exists (select 1 from rec_titulos where id = p_titulo) then
      raise exception 'Você não tem permissão para reabrir o título (é preciso ser operador do Financeiro).';
    end if;
    raise exception 'Título não encontrado (ou você não tem acesso a ele).';
  end if;
  if v_t.estagio not in ('pago', 'cancelado') then
    raise exception 'O título % não está baixado nem cancelado.', v_t.documento;
  end if;
  -- Espelho do Consistem: só reabre o que a última sincronização viu em aberto lá.
  if not exists (
    select 1 from pendencias where modulo = 'financeiro.recebiveis' and referencia_tabela = 'rec_titulos' and referencia_id = p_titulo
       and titulo like 'Baixado aqui, aberto no Consistem:%' and status in ('aberta', 'em_andamento')) then
    raise exception 'O título % não está em aberto no Consistem: só se reabre o que o Consistem lista em aberto (estorne lá primeiro e aguarde a sincronização).', v_t.documento;
  end if;

  -- Volta ao estágio de antes da baixa; baixa anterior a esta migration: pela data.
  v_destino := coalesce(v_t.estagio_antes_baixa, case when v_t.vencimento < v_hoje then 'vencido' else 'importado' end::rec_estagio);
  perform set_config('neo.rec_reabrir', 'on', true);
  update rec_titulos set estagio = v_destino, data_pagamento = null, valor_pago = null, estagio_antes_baixa = null where id = p_titulo;
  if not found then
    raise exception 'Você não tem permissão para reabrir o título (é preciso ser operador do Financeiro).';
  end if;
  perform set_config('neo.rec_reabrir', 'off', true);

  -- Partes antecipadas na AKF que a baixa encerrou sozinha (0113) voltam a valer; as encerradas por uma pessoa ficam.
  update akf_desdobramentos set status = 'ativo', encerrado_em = null, encerrado_por = null, motivo_encerramento = null
   where titulo_id = p_titulo and status = 'encerrado' and encerrado_por is null and motivo_encerramento like 'Título encerrado em Recebíveis (%';
  get diagnostics v_partes = row_count;

  v_rotulo := case v_destino when 'vencido' then 'vencido' when 'importado' then 'importado' when 'aguardando_boleto' then 'aguardando boleto'
    when 'boleto_enviado' then 'boleto enviado' when 'confirmado_cliente' then 'confirmado pelo cliente' when 'promessa' then 'promessa de pagamento'
    else v_destino::text end;
  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  values ('financeiro.recebiveis', v_t.contraparte_id, 'rec_titulos', p_titulo, 'interno', 'reabertura',
          format('Título reaberto (estava %s; voltou para %s): está em aberto no Consistem.%s %s',
                 case when v_t.estagio = 'pago' then 'pago' else 'cancelado' end, v_rotulo,
                 case when v_partes > 0 then format(' %s antecipação(ões) parcial(is) na AKF voltaram a valer.', v_partes) else '' end,
                 trim(p_motivo)),
          auth.uid());

  update pendencias set status = 'concluida'
   where modulo = 'financeiro.recebiveis' and referencia_tabela = 'rec_titulos' and referencia_id = p_titulo
     and titulo like 'Baixado aqui, aberto no Consistem:%' and status in ('aberta', 'em_andamento');

  return jsonb_build_object('titulo', v_t.documento, 'estagio', v_destino, 'partes_akf', v_partes);
end $$;
revoke all on function rec_reabrir_titulo(uuid, text) from public, anon;
grant execute on function rec_reabrir_titulo(uuid, text) to authenticated;

-- Correção da unidade (0182) passa a se identificar para a trava ----------------------------------------------------------
create or replace function rec_definir_unidade(p_titulo uuid, p_unidade text, p_motivo text)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_t record;
  v_regra text;
  v_alterados int;
  v_rotulo constant jsonb := '{"matriz": "Matriz", "contagem": "Filial Contagem"}';
begin
  if not tem_acesso_area('financeiro', 'gestor') then
    raise exception 'Somente o gestor do Financeiro pode corrigir a unidade do título.';
  end if;
  if p_unidade not in ('matriz', 'contagem') then
    raise exception 'Unidade inválida.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo da correção.';
  end if;

  select id, contraparte_id, documento, unidade, estagio into v_t from rec_titulos where id = p_titulo for update;
  if not found then
    raise exception 'Título não encontrado (ou você não tem acesso a ele).';
  end if;
  if v_t.unidade = p_unidade then
    raise exception 'O título % já é da unidade %.', v_t.documento, v_rotulo ->> p_unidade;
  end if;
  if exists (select 1 from rec_kit_titulos where titulo_id = p_titulo) then
    raise exception 'O título % está ligado a um kit da Filial: cancele o kit antes de mudar a unidade.', v_t.documento;
  end if;

  v_regra := case when v_t.documento like '400%' then 'contagem' else 'matriz' end;
  perform set_config('neo.rec_unidade', 'on', true);
  -- Igual à regra = sem correção: o título volta a seguir o documento.
  update rec_titulos set unidade_manual = nullif(p_unidade, v_regra) where id = p_titulo;
  get diagnostics v_alterados = row_count;
  perform set_config('neo.rec_unidade', 'off', true);
  if v_alterados <> 1 then
    raise exception 'Você não tem permissão para alterar este título.';
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  values ('financeiro.recebiveis', v_t.contraparte_id, 'rec_titulos', p_titulo, 'interno', 'unidade_alterada',
          format('Unidade corrigida: %s → %s. %s', v_rotulo ->> v_t.unidade, v_rotulo ->> p_unidade, trim(p_motivo)), auth.uid());

  return jsonb_build_object('titulo', v_t.documento, 'de', v_t.unidade, 'para', p_unidade);
end $$;
