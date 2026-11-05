-- =========================================================
-- Neo Admin — 0528 RH: centro de custo no título do Consistem (folha e VT)
-- Em 11/2026 a conta de débito 3303 (Salários e Ordenados) passou a exigir centro de custo no Consistem (Cadastro dos Centros
-- de Custo por Conta Contábil, vigência desde 01/01/2026): os títulos de salário e 13º de 10/2026 foram recusados com HTTP 400.
-- Decisão do Alan (05/11/2026): salário e 13º continuam na 3303, no centro 210104 (Expedição), o título inteiro (sem rateio).
-- Relatório "Centros de custos por contas" do Consistem (05/11/2026): 3303 aceita só 210102 Vendas e 210104 Expedição; 3203
-- (produção) e 3402 (administrativo) têm outros centros. Código sem pontos, como no relatório.
-- 1) Parâmetros: cada tipo aceita "centroCusto" (texto, opcional).
-- 2) rh_payload_confere: com centro, o título leva exatamente um item {contaContabil = débito, centroCusto, valor = valor do
--    título}; sem centro, a lista vai vazia (como antes).
-- 3) Grava 210104 em salário, 13º 1ª e 13º 2ª parcela (os três usam a 3303).
-- =========================================================

-- 1) -------------------------------------------------------------------------------------------------------------------------
create or replace function rh_salvar_parametros_lancamento(p_parametros jsonb, p_vt_ligado boolean, p_folha_ligado boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_codigos constant text[] := array['codHistorico', 'grupoContaFluxoCaixa', 'contaFluxoCaixa', 'contaContabilDebito', 'contaContabilCredito'];
  v_cat jsonb := p_parametros -> 'categoriaDoc';
  v_tipos jsonb := coalesce(p_parametros -> 'tipos', '{}'::jsonb);
  v_port jsonb := '[]'::jsonb;
  k text; v jsonb; e jsonb; v_cc text;
  v_tipos_ok jsonb := '{}'::jsonb;
begin
  perform rh_exigir('gestor');
  if jsonb_typeof(p_parametros) is distinct from 'object' or jsonb_typeof(v_tipos) <> 'object' then raise exception 'Parâmetros inválidos.'; end if;
  if v_cat is not null and jsonb_typeof(v_cat) = 'null' then v_cat := null; end if;
  if v_cat is not null and not crt_codigos_validos(jsonb_build_object('categoriaDoc', v_cat), array['categoriaDoc'], array['categoriaDoc']) then
    raise exception 'A categoria do documento tem de ser um número inteiro positivo.';
  end if;
  for k, v in select * from jsonb_each(v_tipos) loop
    if k <> all (array['vt', 'salario', 'ferias', 'decimo_1', 'decimo_2', 'avulso']) then raise exception 'Tipo de título desconhecido: %.', k; end if;
    -- centro de custo (texto, opcional): só para conta de débito que exige no Consistem
    v_cc := nullif(trim(coalesce(v ->> 'centroCusto', '')), '');
    if v ? 'centroCusto' and jsonb_typeof(v -> 'centroCusto') not in ('string', 'null') then raise exception 'Centro de custo do tipo % inválido.', k; end if;
    if v_cc is not null and v_cc !~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,29}$' then
      raise exception 'Centro de custo do tipo %: use só letras, números, ponto e hífen (ex.: 210104).', k;
    end if;
    v := v - 'centroCusto';
    if not crt_codigos_validos(v, v_codigos, v_codigos) then
      raise exception 'Preencha todos os códigos do tipo % (números inteiros positivos), ou deixe a linha vazia.', k;
    end if;
    if (v ->> 'contaContabilDebito') = (v ->> 'contaContabilCredito') then
      raise exception 'No tipo %, a conta contábil de débito e a de crédito não podem ser a mesma.', k;
    end if;
    v_tipos_ok := v_tipos_ok || jsonb_build_object(k, case when v_cc is null then v else v || jsonb_build_object('centroCusto', v_cc) end);
  end loop;
  v_tipos := v_tipos_ok;
  for e in select * from jsonb_array_elements(coalesce(p_parametros -> 'portadores', '[]'::jsonb)) loop
    if coalesce(trim(e ->> 'empregador'), '') = '' or coalesce(e ->> 'forma', '') not in ('fopag', 'pix')
       or not crt_codigos_validos(jsonb_build_object('codPortador', e -> 'codPortador'), array['codPortador'], array['codPortador']) then
      raise exception 'Cada portador precisa de empregador, forma (FOPAG ou PIX) e código do portador (número inteiro positivo).';
    end if;
    if exists (select 1 from jsonb_array_elements(v_port) x where x ->> 'empregador' = upper(trim(e ->> 'empregador')) and x ->> 'forma' = e ->> 'forma') then
      raise exception 'Portador repetido: % / %.', upper(trim(e ->> 'empregador')), e ->> 'forma';
    end if;
    v_port := v_port || jsonb_build_array(jsonb_build_object('empregador', upper(trim(e ->> 'empregador')), 'forma', e ->> 'forma',
                                                             'codPortador', e -> 'codPortador', 'conta', nullif(trim(e ->> 'conta'), '')));
  end loop;
  if coalesce(p_vt_ligado, false) and (v_cat is null or v_tipos -> 'vt' is null or jsonb_array_length(v_port) = 0) then
    raise exception 'Preencha a categoria, os códigos do VT e os portadores antes de ligar o lançamento do VT.';
  end if;
  if coalesce(p_folha_ligado, false) and (v_cat is null or v_tipos -> 'salario' is null or jsonb_array_length(v_port) = 0) then
    raise exception 'Preencha a categoria, os códigos de salário e os portadores antes de ligar o lançamento da folha.';
  end if;
  update configuracoes set valor = jsonb_build_object('categoriaDoc', v_cat, 'tipos', v_tipos, 'portadores', v_port) where chave = 'rh.lancamento';
  update configuracoes set valor = to_jsonb(coalesce(p_vt_ligado, false)) where chave = 'rh.vale_transporte.lancar_no_erp';
  update configuracoes set valor = to_jsonb(coalesce(p_folha_ligado, false)) where chave = 'rh.folha.lancar_no_erp';
end $$;   -- a auditoria de configuracoes (gatilho do núcleo) guarda o antes e o depois

-- 2) -------------------------------------------------------------------------------------------------------------------------
create or replace function rh_payload_confere(p_payload jsonb, p_codigos jsonb) returns boolean
language sql immutable as $$
  select p_codigos is not null
     and not exists (select 1 from unnest(array['codHistorico', 'codPortador', 'categoriaDoc', 'grupoContaFluxoCaixa', 'contaFluxoCaixa']) k
                      where (p_payload -> k) is distinct from (p_codigos -> k))
     and (p_payload #> '{dadosContabilidade,contaContabilDebito}') is not distinct from (p_codigos -> 'contaContabilDebito')
     and (p_payload #> '{dadosContabilidade,contaContabilCredito}') is not distinct from (p_codigos -> 'contaContabilCredito')
     and case when nullif(p_codigos ->> 'centroCusto', '') is null
              then coalesce(jsonb_array_length(p_payload #> '{dadosContabilidade,listaCentroCustoContab}'), 0) = 0
              else jsonb_array_length(p_payload #> '{dadosContabilidade,listaCentroCustoContab}') = 1
               and (p_payload #>> '{dadosContabilidade,listaCentroCustoContab,0,centroCusto}') = (p_codigos ->> 'centroCusto')
               and (p_payload #> '{dadosContabilidade,listaCentroCustoContab,0,contaContabil}') = (p_codigos -> 'contaContabilDebito')
               and (p_payload #>> '{dadosContabilidade,listaCentroCustoContab,0,valor}')::numeric = (p_payload ->> 'valorDocumento')::numeric
         end
$$;

-- 3) -------------------------------------------------------------------------------------------------------------------------
update configuracoes c
   set valor = jsonb_set(c.valor, '{tipos}', (
         select jsonb_object_agg(t.key, case when t.key in ('salario', 'decimo_1', 'decimo_2') then t.value || '{"centroCusto": "210104"}'::jsonb else t.value end)
           from jsonb_each(c.valor -> 'tipos') t))
 where c.chave = 'rh.lancamento' and jsonb_typeof(c.valor -> 'tipos') = 'object' and c.valor -> 'tipos' <> '{}'::jsonb;
