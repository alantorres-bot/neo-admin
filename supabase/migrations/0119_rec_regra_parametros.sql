-- =========================================================
-- Neo Admin — 0119 Regra de cobrança editável, Fase 1 (parâmetros)
-- A tela Cobrança > Regra de cobrança deixa de ser só consulta: o gestor do Financeiro (ou acima) altera os parâmetros abaixo.
-- Antes, janelas e trava estavam cravadas no código; só as datas de corte e o mínimo de confirmação vinham de `configuracoes`.
-- Os valores semeados são os de sempre: publicar esta migration não muda o comportamento até alguém editar.
--
-- 1) Sementes das chaves novas em `configuracoes` (a RLS da tabela só deixa o admin geral gravar direto).
-- 2) rec_salvar_regua(p_parametros jsonb): única porta de gravação para o gestor. Valida tudo (chave permitida, tipo e faixa),
--    grava numa transação (um valor inválido não grava nenhum) e registra quem alterou. `security definer` com `search_path`
--    fixo e checagem explícita de nível; a auditoria da tabela (trg_aud_configuracoes) registra antes e depois, com o usuário.
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.recebiveis.janela_anexar_boleto_dias', '30', 'A tarefa "Anexar boleto" só aparece quando faltam até N dias para o vencimento da parcela.'),
  ('financeiro.recebiveis.janela_confirmacao_dias', '7', 'A tarefa "Confirmar pagamento" aparece para parcelas que vencem em até N dias.'),
  ('financeiro.recebiveis.prazo_contato_antes_dias', '4', 'O prazo do contato de confirmação é o vencimento menos N dias (se já passou, hoje).'),
  ('financeiro.recebiveis.trava_pendencias_cobranca', '40', 'Se uma rodada tentar abrir mais de N cobranças novas de uma vez, nenhuma é aberta (provável erro de configuração).')
on conflict (chave) do nothing;

create function rec_salvar_regua(p_parametros jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prefixo constant text := 'financeiro.recebiveis.';
  v_chave text;
  v_valor jsonb;
  v_numero numeric;
  v_nome text;
begin
  if auth.uid() is null or not usuario_ativo() or nivel_area('financeiro') < 'gestor'::nivel_acesso then
    raise exception 'Somente gestor do Financeiro ou acima pode alterar a regra de cobrança.';
  end if;
  if p_parametros is null or jsonb_typeof(p_parametros) <> 'object' or p_parametros = '{}'::jsonb then
    raise exception 'Nenhum parâmetro informado.';
  end if;

  -- 1) valida tudo antes de gravar qualquer coisa
  for v_chave, v_valor in select key, value from jsonb_each(p_parametros) loop
    if v_chave in (v_prefixo || 'esteira_a_partir_de', v_prefixo || 'regua_a_partir_de') then
      -- data aaaa-mm-dd; null desliga (sem data a esteira/régua não abre nada)
      if jsonb_typeof(v_valor) = 'null' then
        continue;
      end if;
      if jsonb_typeof(v_valor) <> 'string' or (v_valor #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Data inválida (use aaaa-mm-dd).';
      end if;
      begin
        perform (v_valor #>> '{}')::date;
      exception when others then
        raise exception 'Data inválida (use aaaa-mm-dd).';
      end;
    elsif v_chave = v_prefixo || 'confirmacao_valor_minimo' then
      if jsonb_typeof(v_valor) <> 'number' then raise exception 'O valor mínimo da confirmação deve ser um número em reais.'; end if;
      v_numero := (v_valor #>> '{}')::numeric;
      if v_numero <= 0 or v_numero > 100000000 then raise exception 'O valor mínimo da confirmação deve ser maior que zero.'; end if;
    elsif v_chave in (v_prefixo || 'janela_anexar_boleto_dias', v_prefixo || 'janela_confirmacao_dias', v_prefixo || 'prazo_contato_antes_dias', v_prefixo || 'trava_pendencias_cobranca') then
      if jsonb_typeof(v_valor) <> 'number' or (v_valor #>> '{}')::numeric <> trunc((v_valor #>> '{}')::numeric) then
        raise exception 'Informe um número inteiro de dias.';
      end if;
      v_numero := (v_valor #>> '{}')::numeric;
      if v_chave = v_prefixo || 'janela_anexar_boleto_dias' and (v_numero < 1 or v_numero > 365) then raise exception 'A janela do boleto deve ficar entre 1 e 365 dias.'; end if;
      if v_chave = v_prefixo || 'janela_confirmacao_dias' and (v_numero < 1 or v_numero > 60) then raise exception 'A janela da confirmação deve ficar entre 1 e 60 dias.'; end if;
      if v_chave = v_prefixo || 'prazo_contato_antes_dias' and (v_numero < 0 or v_numero > 30) then raise exception 'O prazo do contato deve ficar entre 0 e 30 dias antes do vencimento.'; end if;
      if v_chave = v_prefixo || 'trava_pendencias_cobranca' and (v_numero < 1 or v_numero > 500) then raise exception 'A trava de cobranças deve ficar entre 1 e 500.'; end if;
    else
      raise exception 'Parâmetro não permitido: %.', v_chave;
    end if;
  end loop;

  -- 2) grava (mesma transação: se algo falhar, nada fica gravado)
  for v_chave, v_valor in select key, value from jsonb_each(p_parametros) loop
    insert into configuracoes (chave, valor, descricao) values (v_chave, v_valor, 'Parâmetro da regra de cobrança (editado na tela Cobrança > Regra de cobrança).')
    on conflict (chave) do update set valor = excluded.valor;
  end loop;

  select nome into v_nome from perfis where id = auth.uid();
  insert into configuracoes (chave, valor, descricao)
  values (v_prefixo || 'regra_ultima_alteracao', jsonb_build_object('por', coalesce(v_nome, 'usuário'), 'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          'Quem alterou a regra de cobrança por último e quando (mostrado na tela).')
  on conflict (chave) do update set valor = excluded.valor;
end;
$$;

revoke all on function rec_salvar_regua(jsonb) from public, anon;
grant execute on function rec_salvar_regua(jsonb) to authenticated;
