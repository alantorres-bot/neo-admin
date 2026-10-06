-- =========================================================
-- Neo Admin — 0108 Régua de cobrança (D+1, D+5, D+10)
-- 1) Configuração: a régua só vale para vencimentos a partir desta data (não cobra a carteira antiga em massa).
-- 2) Políticas de rec_promessas (a tabela tinha RLS ligada e nenhuma política): leitura no Financeiro, escrita de operador.
-- 3) rec_registrar_cobranca(): grava o resultado do contato de cobrança numa transação. SECURITY INVOKER: a RLS de quem
--    chama vale.
--    'enviada'   -> interação registrada (cobrança enviada); os títulos continuam como estão.
--    'promessa'  -> títulos viram `promessa` e a régua pausa até a data prometida (rec_promessas registra o valor).
--    'contestou' -> títulos marcados como contestados (régua pausada) e o motivo vai para o histórico.
--    Nos três casos a pendência "Cobrar D+n" daquele marco é concluída.
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.recebiveis.regua_a_partir_de', '"2026-10-06"', 'A régua de cobrança (D+1, D+5, D+10) só vale para títulos com vencimento a partir desta data (aaaa-mm-dd). Vazio = régua desligada.')
on conflict (chave) do nothing;

create policy rec_promessas_ler on rec_promessas for select to authenticated
  using (tem_acesso_area('financeiro'));
create policy rec_promessas_inserir on rec_promessas for insert to authenticated
  with check (tem_acesso_area('financeiro', 'operador'));
create policy rec_promessas_alterar on rec_promessas for update to authenticated
  using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));
-- Sem política de delete: promessas ficam como prova.

create function rec_registrar_cobranca(
  p_titulos uuid[], p_marco int, p_resultado text, p_canal canal default 'whatsapp', p_data_prometida date default null, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_qtd int;
  v_clientes int;
  v_cliente uuid;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atualizados int;
  v_concluidas int := 0;
  v_tipo text;
  v_texto text;
  v_canal_txt text;
begin
  if p_resultado not in ('enviada', 'promessa', 'contestou') then
    raise exception 'Resultado inválido.';
  end if;
  if p_marco not in (1, 5, 10) then
    raise exception 'Marco da régua inválido.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos uma parcela.';
  end if;

  select count(*), count(distinct contraparte_id), min(contraparte_id::text)::uuid
    into v_qtd, v_clientes, v_cliente
    from rec_titulos
   where id = any(v_ids)
     and estagio in ('importado', 'aguardando_boleto', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  if v_qtd <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já foi paga ou encerrada (ou você não tem acesso a ela).';
  end if;
  if v_clientes <> 1 then
    raise exception 'As parcelas precisam ser do mesmo cliente.';
  end if;

  v_canal_txt := case p_canal when 'email' then 'por e-mail' when 'whatsapp' then 'por WhatsApp' when 'telefone' then 'por telefone' else 'por outro meio' end;

  if p_resultado = 'promessa' then
    if p_data_prometida is null then
      raise exception 'Informe a data prometida para o pagamento.';
    end if;
    if p_data_prometida <= v_hoje then
      raise exception 'A data prometida precisa ser futura.';
    end if;
    if p_data_prometida > v_hoje + 90 then
      raise exception 'A data prometida não pode passar de 90 dias.';
    end if;
    update rec_titulos set estagio = 'promessa', regua_pausada_ate = p_data_prometida where id = any(v_ids);
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar esta promessa (é preciso ser operador do Financeiro).';
    end if;
    insert into rec_promessas (titulo_id, data_prometida, valor_prometido)
    select t.id, p_data_prometida, t.valor from rec_titulos t where t.id = any(v_ids);
    v_tipo := 'promessa';
    v_texto := 'Cobrança ' || 'D+' || p_marco || ': o cliente prometeu pagar em ' || to_char(p_data_prometida, 'DD/MM/YYYY') || ' (' || v_canal_txt || '). A régua fica pausada até essa data.';
  elsif p_resultado = 'contestou' then
    if length(trim(coalesce(p_descricao, ''))) < 5 then
      raise exception 'Informe o motivo da contestação.';
    end if;
    update rec_titulos set contestado = true where id = any(v_ids);
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar esta contestação (é preciso ser operador do Financeiro).';
    end if;
    v_tipo := 'contestacao';
    v_texto := 'Cobrança D+' || p_marco || ': o cliente contestou a cobrança (' || v_canal_txt || '). A régua fica pausada para estes títulos.';
  else
    v_tipo := 'cobranca';
    v_texto := 'Cobrança D+' || p_marco || ' enviada ' || v_canal_txt || '.';
  end if;
  if nullif(trim(coalesce(p_descricao, '')), '') is not null then
    v_texto := v_texto || ' ' || trim(p_descricao);
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, p_canal, v_tipo, v_texto, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  -- A pendência do marco acaba: a cobrança foi feita (ou a régua foi pausada).
  update pendencias set status = 'concluida'
   where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
     and titulo like 'Cobrar D+' || p_marco || ':%' and status in ('aberta', 'em_andamento');
  get diagnostics v_concluidas = row_count;

  return jsonb_build_object('parcelas', cardinality(v_ids), 'pendencias_concluidas', v_concluidas);
end $$;

revoke all on function rec_registrar_cobranca(uuid[], int, text, canal, date, text) from public, anon;
grant execute on function rec_registrar_cobranca(uuid[], int, text, canal, date, text) to authenticated;
