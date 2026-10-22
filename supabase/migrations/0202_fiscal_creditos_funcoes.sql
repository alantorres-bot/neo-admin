-- =========================================================
-- Neo Admin — 0202 FISCAL > Créditos tributários: funções de escrita (regras de negócio)
-- Toda escrita passa por aqui (as tabelas só têm política de leitura). Cada função confere papel, escopo da empresa e
-- regras, roda numa transação e grava a decisão/auditoria. Mensagens em português (erro P0001 vai direto à tela).
-- =========================================================

-- 0) AUXILIARES -------------------------------------------------------------------------------------------------------------
create function fis_hoje() returns date language sql stable as $$ select (now() at time zone 'America/Cuiaba')::date $$;

create function fis_brl(v numeric) returns text language sql immutable as $$
  select case when v < 0 then '-' else '' end || 'R$ ' || translate(to_char(abs(v), 'FM999,999,999,990.00'), ',.', '.,')
$$;

create function fis_mm(p date) returns text language sql immutable as $$ select to_char(p, 'MM/YYYY') $$;

-- Lê um valor monetário do jsonb: número ou texto com ponto decimal; exige no máximo 2 casas (não arredonda em silêncio).
create function fis_valor(p jsonb, p_campo text, p_obrigatorio boolean default true) returns numeric
language plpgsql immutable as $$
declare v numeric;
begin
  if p ->> p_campo is null or trim(p ->> p_campo) = '' then
    if p_obrigatorio then raise exception 'Informe o valor (%).', p_campo; end if;
    return null;
  end if;
  begin
    v := (p ->> p_campo)::numeric;
  exception when others then
    raise exception 'Valor inválido em %.', p_campo;
  end;
  if v <> round(v, 2) then raise exception 'O valor deve ter no máximo 2 casas decimais (%).', p_campo; end if;
  if abs(v) >= 1e12 then raise exception 'Valor fora do limite (%).', p_campo; end if;
  return v;
end $$;

create function fis_competencia(p text, p_obrigatoria boolean default true) returns date language plpgsql immutable as $$
declare v date;
begin
  if p is null or trim(p) = '' then
    if p_obrigatoria then raise exception 'Informe a competência.'; end if;
    return null;
  end if;
  begin v := date_trunc('month', p::date)::date;
  exception when others then raise exception 'Competência inválida: %.', p; end;
  if v < date '2000-01-01' or v > date '2100-12-01' then raise exception 'Competência fora do intervalo aceito.'; end if;
  return v;
end $$;

-- 1) CADASTROS (administrador) -------------------------------------------------------------------------------------------
create function fis_salvar_estabelecimento(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_empresa uuid := (p ->> 'empresa_id')::uuid;
begin
  perform fis_exigir('parametrizar', v_empresa);
  if not exists (select 1 from empresas where id = v_empresa) then raise exception 'Empresa não encontrada.'; end if;
  if v_id is null then
    insert into fis_estabelecimentos (empresa_id, nome, cnpj, uf, inscricao_estadual, matriz, ativo, ficticio)
    values (v_empresa, trim(p ->> 'nome'), p ->> 'cnpj', upper(nullif(p ->> 'uf', '')), nullif(p ->> 'inscricao_estadual', ''),
            coalesce((p ->> 'matriz')::boolean, false), coalesce((p ->> 'ativo')::boolean, true), coalesce((p ->> 'ficticio')::boolean, false))
    returning id into v_id;
  else
    update fis_estabelecimentos set nome = trim(p ->> 'nome'), uf = upper(nullif(p ->> 'uf', '')),
           inscricao_estadual = nullif(p ->> 'inscricao_estadual', ''), matriz = coalesce((p ->> 'matriz')::boolean, matriz),
           ativo = coalesce((p ->> 'ativo')::boolean, ativo)
     where id = v_id and empresa_id = v_empresa;
    if not found then raise exception 'Estabelecimento não encontrado.'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe estabelecimento com este CNPJ.';
end $$;

create function fis_salvar_tributo(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform fis_exigir('parametrizar');
  if v_id is null then
    insert into fis_tributos (codigo, nome, esfera, observacao) values (upper(p ->> 'codigo'), p ->> 'nome', p ->> 'esfera', nullif(p ->> 'observacao', ''))
    returning id into v_id;
  else
    update fis_tributos set nome = p ->> 'nome', esfera = p ->> 'esfera', observacao = nullif(p ->> 'observacao', ''),
           ativo = coalesce((p ->> 'ativo')::boolean, ativo) where id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'Já existe tributo com este código.';
end $$;

-- Categoria: alterar parâmetros desfaz a validação do contador, que precisa confirmar de novo.
create function fis_salvar_categoria(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_formas text[] := coalesce(array(select jsonb_array_elements_text(p -> 'formas_utilizacao')), '{}');
  v_docs text[] := coalesce(array(select jsonb_array_elements_text(p -> 'documentos_exigidos')), '{}');
  v_validar boolean := coalesce((p ->> 'regra_validada')::boolean, false);
begin
  perform fis_exigir('parametrizar');
  if exists (select 1 from unnest(v_docs) d where d not in (select codigo from fis_tipos_documento)) then
    raise exception 'Tipo de documento exigido inválido.';
  end if;
  if v_id is null then
    insert into fis_categorias (codigo, nome, tributo_id, natureza, formas_utilizacao, prazo_aproveitamento_meses, exige_processo,
                                documentos_exigidos, observacao_legal, regra_validada, regra_validada_por, regra_validada_em)
    values (upper(p ->> 'codigo'), p ->> 'nome', nullif(p ->> 'tributo_id', '')::uuid, p ->> 'natureza', v_formas,
            nullif(p ->> 'prazo_aproveitamento_meses', '')::int, coalesce((p ->> 'exige_processo')::boolean, false), v_docs,
            nullif(p ->> 'observacao_legal', ''), v_validar, case when v_validar then auth.uid() end, case when v_validar then now() end)
    returning id into v_id;
  else
    update fis_categorias set nome = p ->> 'nome', tributo_id = nullif(p ->> 'tributo_id', '')::uuid, natureza = p ->> 'natureza',
           formas_utilizacao = v_formas, prazo_aproveitamento_meses = nullif(p ->> 'prazo_aproveitamento_meses', '')::int,
           exige_processo = coalesce((p ->> 'exige_processo')::boolean, false), documentos_exigidos = v_docs,
           observacao_legal = nullif(p ->> 'observacao_legal', ''), ativo = coalesce((p ->> 'ativo')::boolean, ativo),
           regra_validada = v_validar, regra_validada_por = case when v_validar then auth.uid() end,
           regra_validada_em = case when v_validar then now() end
     where id = v_id;
    if not found then raise exception 'Categoria não encontrada.'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'Já existe categoria com este código.';
end $$;

create function fis_salvar_tipo_movimento(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_codigo text := lower(p ->> 'codigo');
begin
  perform fis_exigir('parametrizar');
  if exists (select 1 from fis_tipos_movimento where codigo = v_codigo) then
    update fis_tipos_movimento set nome = p ->> 'nome', exige_aprovacao = coalesce((p ->> 'exige_aprovacao')::boolean, exige_aprovacao),
           exige_protocolo = coalesce((p ->> 'exige_protocolo')::boolean, exige_protocolo), ativo = coalesce((p ->> 'ativo')::boolean, ativo)
     where codigo = v_codigo;
  else
    insert into fis_tipos_movimento (codigo, nome, classe, sinal, forma, exige_aprovacao, exige_protocolo)
    values (v_codigo, p ->> 'nome', p ->> 'classe', (p ->> 'sinal')::smallint, nullif(p ->> 'forma', ''),
            coalesce((p ->> 'exige_aprovacao')::boolean, true), coalesce((p ->> 'exige_protocolo')::boolean, false));
  end if;
  return v_codigo;
end $$;

create function fis_salvar_tipo_obrigacao(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_docs text[] := coalesce(array(select jsonb_array_elements_text(p -> 'documentos_exigidos')), '{recibo_transmissao}');
  v_validada boolean := coalesce((p ->> 'regra_vencimento_validada')::boolean, false);
begin
  perform fis_exigir('parametrizar');
  if v_validada and (nullif(p ->> 'dia_vencimento', '') is null or nullif(trim(p ->> 'fonte_regra'), '') is null) then
    raise exception 'Para marcar a regra de vencimento como validada, informe o dia e a fonte da regra.';
  end if;
  if v_id is null then
    insert into fis_tipos_obrigacao (codigo, nome, tributo_id, esfera, periodicidade, dia_vencimento, meses_apos, regra_vencimento_validada,
                                     fonte_regra, exige_recibo, documentos_exigidos, descricao)
    values (upper(p ->> 'codigo'), p ->> 'nome', nullif(p ->> 'tributo_id', '')::uuid, p ->> 'esfera', p ->> 'periodicidade',
            nullif(p ->> 'dia_vencimento', '')::int, coalesce(nullif(p ->> 'meses_apos', '')::int, 1), v_validada,
            nullif(p ->> 'fonte_regra', ''), coalesce((p ->> 'exige_recibo')::boolean, true), v_docs, nullif(p ->> 'descricao', ''))
    returning id into v_id;
  else
    update fis_tipos_obrigacao set nome = p ->> 'nome', tributo_id = nullif(p ->> 'tributo_id', '')::uuid, esfera = p ->> 'esfera',
           periodicidade = p ->> 'periodicidade', dia_vencimento = nullif(p ->> 'dia_vencimento', '')::int,
           meses_apos = coalesce(nullif(p ->> 'meses_apos', '')::int, 1), regra_vencimento_validada = v_validada,
           fonte_regra = nullif(p ->> 'fonte_regra', ''), exige_recibo = coalesce((p ->> 'exige_recibo')::boolean, true),
           documentos_exigidos = v_docs, descricao = nullif(p ->> 'descricao', ''), ativo = coalesce((p ->> 'ativo')::boolean, ativo)
     where id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'Já existe tipo de obrigação com este código.';
end $$;

create function fis_definir_aplicavel(p_tipo uuid, p_estab uuid, p_ativo boolean, p_responsavel uuid default null, p_contador text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fis_exigir('parametrizar', (select empresa_id from fis_estabelecimentos where id = p_estab));
  insert into fis_obrigacoes_aplicaveis (tipo_id, estabelecimento_id, ativo, responsavel_id, contador_responsavel)
  values (p_tipo, p_estab, p_ativo, p_responsavel, nullif(trim(p_contador), ''))
  on conflict (tipo_id, estabelecimento_id) do update set ativo = excluded.ativo, responsavel_id = excluded.responsavel_id,
     contador_responsavel = excluded.contador_responsavel;
end $$;

create function fis_definir_membro(p_perfil uuid, p_papel fis_papel, p_empresas uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fis_exigir('parametrizar');
  if p_papel is null then
    delete from fis_membros where perfil_id = p_perfil;
    return;
  end if;
  insert into fis_membros (perfil_id, papel, empresas) values (p_perfil, p_papel, case when cardinality(p_empresas) = 0 then null else p_empresas end)
  on conflict (perfil_id) do update set papel = excluded.papel, empresas = excluded.empresas, atualizado_por = auth.uid(), atualizado_em = now();
end $$;

-- 2) RAZÃO: inserção interna (todas as regras de consistência) -----------------------------------------------------------
create function fis_mov_inserir(
  p_credito uuid, p_tipo text, p_valor numeric, p_data date, p_comp date, p_descricao text,
  p_documento text default null, p_protocolo text default null, p_processo text default null,
  p_chave uuid default null, p_origem text default 'manual', p_corrige uuid default null, p_transferencia uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c fis_creditos;
  t fis_tipos_movimento;
  cat fis_categorias;
  v_id uuid;
  v_status text;
  v_min numeric;
  v_dup bigint;
begin
  if p_chave is not null then
    select id into v_id from fis_movimentos where chave_idempotencia = p_chave;
    if v_id is not null then return v_id; end if;            -- reenvio do mesmo formulário: não duplica
  end if;
  select * into c from fis_creditos where id = p_credito for update;  -- serializa os lançamentos do crédito
  if c.id is null then raise exception 'Crédito não encontrado.'; end if;
  if c.arquivado then raise exception 'Crédito arquivado não recebe lançamentos.'; end if;
  select * into t from fis_tipos_movimento where codigo = p_tipo;
  if t.codigo is null or not t.ativo then raise exception 'Tipo de movimentação inválido ou inativo.'; end if;
  if t.classe = 'estorno' then raise exception 'Use a função de estorno.'; end if;
  select * into cat from fis_categorias where id = c.categoria_id;

  if p_valor is null or p_valor <= 0 then raise exception 'O valor deve ser maior que zero.'; end if;
  if p_valor <> round(p_valor, 2) then raise exception 'O valor deve ter no máximo 2 casas decimais.'; end if;
  if p_data is null then raise exception 'Informe a data.'; end if;
  if p_data > fis_hoje() then raise exception 'A data da movimentação não pode ser futura.'; end if;
  if p_comp is null or extract(day from p_comp) <> 1 then raise exception 'Competência inválida.'; end if;
  if p_comp < c.competencia_origem then
    raise exception 'A competência (%) é anterior à origem do crédito (%).', fis_mm(p_comp), fis_mm(c.competencia_origem);
  end if;
  if p_descricao is null or length(trim(p_descricao)) < 3 then raise exception 'Descreva a movimentação.'; end if;
  if t.exige_protocolo and nullif(trim(p_protocolo), '') is null then
    raise exception 'O tipo "%" exige o número do protocolo/pedido.', t.nome;
  end if;
  if t.classe = 'saldo_inicial' and exists (select 1 from fis_movimentos where credito_id = c.id and status <> 'rejeitado') then
    raise exception 'Saldo inicial só pode ser o primeiro lançamento do crédito.';
  end if;

  if t.sinal < 0 then
    -- Utilização/compensação/ressarcimento/restituição/transferência: só crédito validado, livre, no prazo e com a forma permitida.
    if t.forma is not null then
      if c.validacao <> 'validado' then
        raise exception 'Crédito % não está validado: não pode ser utilizado, compensado ou baixado por %.', c.codigo, lower(t.nome);
      end if;
      if c.bloqueado then raise exception 'Crédito % está bloqueado: %.', c.codigo, c.bloqueio_motivo; end if;
      if c.data_limite_aproveitamento is not null and p_data > c.data_limite_aproveitamento then
        raise exception 'Prazo de aproveitamento do crédito % encerrado em %.', c.codigo, to_char(c.data_limite_aproveitamento, 'DD/MM/YYYY');
      end if;
      if not (t.forma = any (cat.formas_utilizacao)) then
        raise exception 'A categoria "%" não permite a forma "%" nos parâmetros cadastrados.', cat.nome, t.forma;
      end if;
    end if;
    v_min := fis_saldo_minimo_apos(c.id, p_comp, true);
    if v_min - p_valor < 0 then
      raise exception 'Saldo insuficiente no crédito %: disponível % na competência % (já descontadas as saídas pendentes); pedido %.',
        c.codigo, fis_brl(greatest(v_min, 0)), fis_mm(p_comp), fis_brl(p_valor);
    end if;
  end if;

  v_status := case when t.exige_aprovacao and auth.uid() is not null then 'pendente' else 'efetivo' end;
  begin
    insert into fis_movimentos (credito_id, empresa_id, estabelecimento_id, tributo_id, tipo, classe, natureza, valor, valor_assinado, data,
                                competencia, descricao, documento_ref, protocolo, processo, corrige_id, transferencia_id, status,
                                chave_idempotencia, origem_registro, aprovado_por, aprovado_em)
    values (c.id, c.empresa_id, c.estabelecimento_id, c.tributo_id, t.codigo, t.classe, case when t.sinal > 0 then 'entrada' else 'saida' end,
            p_valor, t.sinal * p_valor, p_data, p_comp, trim(p_descricao), nullif(trim(p_documento), ''), nullif(trim(p_protocolo), ''),
            nullif(trim(p_processo), ''), p_corrige, p_transferencia, v_status, p_chave, p_origem,
            null, null)
    returning id into v_id;
  exception when unique_violation then
    select numero into v_dup from fis_movimentos
     where credito_id = c.id and tipo = t.codigo and competencia = p_comp and data = p_data and valor = p_valor
       and coalesce(protocolo, '') = coalesce(nullif(trim(p_protocolo), ''), '') and not estornado and status <> 'rejeitado' and tipo <> 'estorno';
    raise exception 'Movimentação duplicada: já existe o lançamento nº % com o mesmo crédito, tipo, competência, data, valor e protocolo.', v_dup;
  end;
  return v_id;
end $$;
revoke all on function fis_mov_inserir(uuid, text, numeric, date, date, text, text, text, text, uuid, text, uuid, uuid) from public, anon, authenticated;

-- 3) CRÉDITOS ---------------------------------------------------------------------------------------------------------------
-- Cria o crédito e o primeiro lançamento do razão (saldo inicial, crédito apurado ou reconhecido), numa transação.
create function fis_credito_criar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_estab fis_estabelecimentos;
  v_cat fis_categorias;
  v_id uuid;
  v_comp date := fis_competencia(p ->> 'competencia_origem');
  v_valor numeric := fis_valor(p, 'valor_original');
  v_tipo text := coalesce(nullif(p ->> 'tipo_entrada', ''), 'credito_apurado');
  v_comp_entrada date := coalesce(fis_competencia(p ->> 'competencia_entrada', false), v_comp);
  v_data date := coalesce(nullif(p ->> 'data_entrada', '')::date, nullif(p ->> 'data_reconhecimento', '')::date, least(fis_hoje(), (v_comp_entrada + interval '1 month - 1 day')::date));
  v_tributo uuid := (p ->> 'tributo_id')::uuid;
  v_limite date := nullif(p ->> 'data_limite_aproveitamento', '')::date;
begin
  select * into v_estab from fis_estabelecimentos where id = (p ->> 'estabelecimento_id')::uuid;
  if v_estab.id is null or not v_estab.ativo then raise exception 'Escolha um estabelecimento ativo.'; end if;
  perform fis_exigir('lancar', v_estab.empresa_id);
  if not exists (select 1 from fis_tributos where id = v_tributo and ativo) then raise exception 'Escolha um tributo ativo.'; end if;
  select * into v_cat from fis_categorias where id = (p ->> 'categoria_id')::uuid;
  if v_cat.id is null or not v_cat.ativo then raise exception 'Escolha uma categoria ativa.'; end if;
  if v_tipo not in ('saldo_inicial', 'credito_apurado', 'credito_reconhecido') then
    raise exception 'O lançamento inicial deve ser saldo inicial, crédito apurado ou crédito reconhecido.';
  end if;
  if v_cat.exige_processo and nullif(trim(p ->> 'numero_processo'), '') is null then
    raise exception 'A categoria "%" exige o número do processo.', v_cat.nome;
  end if;
  if v_limite is null and v_cat.prazo_aproveitamento_meses is not null then
    v_limite := (v_comp + make_interval(months => v_cat.prazo_aproveitamento_meses) - interval '1 day')::date;
  end if;

  begin
    insert into fis_creditos (codigo, empresa_id, estabelecimento_id, tributo_id, categoria_id, origem, competencia_origem, data_reconhecimento,
                              descricao, numero_processo, documento_ref, valor_original, data_limite_aproveitamento, responsavel_id, observacoes,
                              ficticio, importacao_lote_id)
    values ('CR-' || to_char(v_comp, 'YYYY') || '-' || lpad(nextval('fis_creditos_numero')::text, 5, '0'),
            v_estab.empresa_id, v_estab.id, v_tributo, v_cat.id, coalesce(nullif(p ->> 'origem', ''), 'outro'), v_comp,
            nullif(p ->> 'data_reconhecimento', '')::date, trim(p ->> 'descricao'), nullif(trim(p ->> 'numero_processo'), ''),
            nullif(trim(p ->> 'documento_ref'), ''), v_valor, v_limite, coalesce(nullif(p ->> 'responsavel_id', '')::uuid, auth.uid()),
            nullif(trim(p ->> 'observacoes'), ''), coalesce((p ->> 'ficticio')::boolean, false), nullif(p ->> 'importacao_lote_id', '')::uuid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Crédito duplicado: já existe crédito com o mesmo estabelecimento, tributo, categoria, origem, competência, valor e processo.';
  end;

  perform fis_mov_inserir(v_id, v_tipo, v_valor, v_data, v_comp_entrada,
                          coalesce(nullif(trim(p ->> 'descricao_entrada'), ''), 'Lançamento inicial: ' || trim(p ->> 'descricao')),
                          nullif(p ->> 'documento_ref', ''), null, nullif(p ->> 'numero_processo', ''),
                          nullif(p ->> 'chave_idempotencia', '')::uuid, coalesce(nullif(p ->> 'origem_registro', ''), 'manual'));
  perform fis_registrar_decisao('credito', v_id, v_estab.empresa_id, 'cadastro', null, jsonb_build_object('valor_original', v_valor, 'tipo_entrada', v_tipo));
  return v_id;
end $$;

-- Edição controlada: textos sempre; categoria/origem só antes da validação; prazo só quem valida. Valor e competência: nunca
-- (lançamento errado é arquivado com estorno e cadastrado de novo).
create function fis_credito_atualizar(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c fis_creditos;
begin
  select * into c from fis_creditos where id = p_id for update;
  if c.id is null then raise exception 'Crédito não encontrado.'; end if;
  perform fis_exigir('lancar', c.empresa_id);
  if c.arquivado then raise exception 'Crédito arquivado não é editado.'; end if;
  if (p ? 'categoria_id' and (p ->> 'categoria_id')::uuid <> c.categoria_id) or (p ? 'origem' and p ->> 'origem' <> c.origem) then
    if c.validacao = 'validado' then raise exception 'Crédito validado: categoria e origem não mudam (peça a revisão da validação).'; end if;
  end if;
  if p ? 'data_limite_aproveitamento' and (nullif(p ->> 'data_limite_aproveitamento', '')::date) is distinct from c.data_limite_aproveitamento then
    perform fis_exigir('validar', c.empresa_id);
  end if;
  update fis_creditos set
    descricao = coalesce(nullif(trim(p ->> 'descricao'), ''), descricao),
    observacoes = case when p ? 'observacoes' then nullif(trim(p ->> 'observacoes'), '') else observacoes end,
    numero_processo = case when p ? 'numero_processo' then nullif(trim(p ->> 'numero_processo'), '') else numero_processo end,
    documento_ref = case when p ? 'documento_ref' then nullif(trim(p ->> 'documento_ref'), '') else documento_ref end,
    data_reconhecimento = case when p ? 'data_reconhecimento' then nullif(p ->> 'data_reconhecimento', '')::date else data_reconhecimento end,
    responsavel_id = case when p ? 'responsavel_id' then nullif(p ->> 'responsavel_id', '')::uuid else responsavel_id end,
    categoria_id = coalesce(nullif(p ->> 'categoria_id', '')::uuid, categoria_id),
    origem = coalesce(nullif(p ->> 'origem', ''), origem),
    data_limite_aproveitamento = case when p ? 'data_limite_aproveitamento' then nullif(p ->> 'data_limite_aproveitamento', '')::date else data_limite_aproveitamento end
  where id = p_id;
  perform fis_registrar_decisao('credito', p_id, c.empresa_id, 'edicao', null, p);
end $$;

-- Validação pelo responsável (revisor/contador/admin), nunca por quem lançou. Validar exige processo e documentos exigidos.
-- Valor reconhecido menor que o original gera um ajuste negativo (glosa) no razão.
create function fis_credito_validar(p_id uuid, p_decisao fis_validacao, p_valor_reconhecido numeric, p_justificativa text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c fis_creditos;
  cat fis_categorias;
  v_faltam text[];
  v_reconhecido numeric;
  v_comp date;
begin
  select * into c from fis_creditos where id = p_id for update;
  if c.id is null then raise exception 'Crédito não encontrado.'; end if;
  perform fis_exigir('validar', c.empresa_id);
  if c.arquivado then raise exception 'Crédito arquivado.'; end if;
  if auth.uid() is not null and c.responsavel_lancamento = auth.uid() then
    raise exception 'Quem lançou o crédito não pode validá-lo (segregação de funções).';
  end if;
  if p_decisao = 'pendente' then raise exception 'Escolha a decisão.'; end if;
  if p_decisao in ('rejeitado', 'contestado') and length(coalesce(trim(p_justificativa), '')) < 10 then
    raise exception 'Justifique a decisão (mínimo 10 caracteres).';
  end if;
  if p_decisao = 'validado' then
    select * into cat from fis_categorias where id = c.categoria_id;
    if cat.exige_processo and c.numero_processo is null then raise exception 'Informe o número do processo antes de validar.'; end if;
    select array_agg(td.nome order by td.nome) into v_faltam from unnest(cat.documentos_exigidos) d join fis_tipos_documento td on td.codigo = d
     where not exists (select 1 from fis_docs_do_alvo('credito', c.id) x where x.tipo = d);
    if v_faltam is not null then
      raise exception 'Documentação pendente para validar: %.', array_to_string(v_faltam, ', ');
    end if;
    if exists (select 1 from fis_movimentos where credito_id = c.id and status = 'pendente' and natureza = 'entrada' and classe in ('saldo_inicial', 'gerado', 'reconhecido')) then
      raise exception 'Aprove antes o lançamento inicial pendente do crédito.';
    end if;
    v_reconhecido := coalesce(p_valor_reconhecido, c.valor_reconhecido, c.valor_original);
    if v_reconhecido <> round(v_reconhecido, 2) or v_reconhecido < 0 or v_reconhecido > c.valor_original then
      raise exception 'O valor reconhecido deve estar entre zero e o valor original (%).', fis_brl(c.valor_original);
    end if;
    if v_reconhecido < coalesce(c.valor_reconhecido, c.valor_original) then
      if length(coalesce(trim(p_justificativa), '')) < 10 then raise exception 'Justifique o reconhecimento parcial (mínimo 10 caracteres).'; end if;
      v_comp := greatest(c.competencia_origem, date_trunc('month', fis_hoje())::date);
      -- glosa como baixa automática (não depende de aprovação: a própria validação é a decisão)
      insert into fis_movimentos (credito_id, empresa_id, estabelecimento_id, tributo_id, tipo, classe, natureza, valor, valor_assinado, data, competencia,
                                  descricao, status, origem_registro, aprovado_por, aprovado_em)
      select c.id, c.empresa_id, c.estabelecimento_id, c.tributo_id, 'ajuste_negativo', 'ajuste', 'saida', d, -d, fis_hoje(), v_comp,
             'Glosa na validação: reconhecido ' || fis_brl(v_reconhecido) || ' de ' || fis_brl(coalesce(c.valor_reconhecido, c.valor_original)) || '. ' || trim(p_justificativa),
             'efetivo', 'sistema', auth.uid(), now()
        from (select coalesce(c.valor_reconhecido, c.valor_original) - v_reconhecido d) x
       where fis_saldo_minimo_apos(c.id, v_comp, false) >= x.d;
      if not found then raise exception 'Saldo insuficiente para registrar a glosa do valor não reconhecido.'; end if;
    end if;
    update fis_creditos set validacao = 'validado', valor_reconhecido = v_reconhecido, validado_por = auth.uid(), validado_em = now(),
           validacao_justificativa = nullif(trim(p_justificativa), '') where id = c.id;
  else
    update fis_creditos set validacao = p_decisao, validado_por = auth.uid(), validado_em = now(),
           validacao_justificativa = nullif(trim(p_justificativa), '') where id = c.id;
  end if;
  perform fis_registrar_decisao('credito', c.id, c.empresa_id, 'validacao:' || p_decisao, p_justificativa,
                                jsonb_build_object('de', c.validacao, 'valor_reconhecido', coalesce(v_reconhecido, c.valor_reconhecido)));
end $$;

create function fis_credito_bloquear(p_id uuid, p_bloquear boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare c fis_creditos;
begin
  select * into c from fis_creditos where id = p_id for update;
  if c.id is null then raise exception 'Crédito não encontrado.'; end if;
  perform fis_exigir('validar', c.empresa_id);
  if length(coalesce(trim(p_motivo), '')) < 10 then raise exception 'Informe o motivo (mínimo 10 caracteres).'; end if;
  update fis_creditos set bloqueado = p_bloquear, bloqueio_motivo = case when p_bloquear then trim(p_motivo) else null end where id = p_id;
  perform fis_registrar_decisao('credito', p_id, c.empresa_id, case when p_bloquear then 'bloqueio' else 'desbloqueio' end, p_motivo);
end $$;

-- 4) MOVIMENTAÇÕES -----------------------------------------------------------------------------------------------------------
create function fis_movimento_registrar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c fis_creditos; v_tipo text := p ->> 'tipo'; v_id uuid;
begin
  select * into c from fis_creditos where id = (p ->> 'credito_id')::uuid;
  if c.id is null then raise exception 'Escolha o crédito.'; end if;
  perform fis_exigir('lancar', c.empresa_id);
  if v_tipo in ('estorno', 'saldo_inicial', 'transferencia_saida', 'transferencia_entrada') then
    raise exception 'Este tipo tem rotina própria (estorno, cadastro do crédito ou transferência).';
  end if;
  v_id := fis_mov_inserir(c.id, v_tipo, fis_valor(p, 'valor'), (p ->> 'data')::date, fis_competencia(p ->> 'competencia'), p ->> 'descricao',
                          p ->> 'documento_ref', p ->> 'protocolo', p ->> 'processo', nullif(p ->> 'chave_idempotencia', '')::uuid,
                          coalesce(nullif(p ->> 'origem_registro', ''), 'manual'));
  return v_id;
end $$;

-- Estorno: inverte o lançamento original na MESMA competência (que precisa estar aberta) e marca o original como estornado.
-- Transferência: estorna as duas pernas.
create function fis_movimento_estornar(p_id uuid, p_motivo text, p_chave uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o fis_movimentos;
  par fis_movimentos;
  v_id uuid;
  v_min numeric;
begin
  if p_chave is not null then
    select id into v_id from fis_movimentos where chave_idempotencia = p_chave;
    if v_id is not null then return v_id; end if;
  end if;
  select * into o from fis_movimentos where id = p_id for update;
  if o.id is null then raise exception 'Movimentação não encontrada.'; end if;
  perform fis_exigir('lancar', o.empresa_id);
  if length(coalesce(trim(p_motivo), '')) < 10 then raise exception 'Informe o motivo do estorno (mínimo 10 caracteres).'; end if;
  if o.tipo = 'estorno' then raise exception 'Estorno não é estornado: faça um novo lançamento.'; end if;
  if o.status <> 'efetivo' then raise exception 'Só lançamentos efetivos são estornados (pendente: rejeite).'; end if;
  if o.estornado then raise exception 'Este lançamento já foi estornado.'; end if;
  perform 1 from fis_creditos where id = o.credito_id for update;
  -- tirar uma entrada não pode deixar o saldo negativo em nenhuma competência
  if o.natureza = 'entrada' then
    v_min := fis_saldo_minimo_apos(o.credito_id, o.competencia, true, o.id);
    if v_min < 0 then
      raise exception 'O estorno deixaria o saldo do crédito negativo (faltariam %). Estorne antes as utilizações posteriores.', fis_brl(-v_min);
    end if;
  end if;
  update fis_movimentos set estornado = true where id = o.id;
  insert into fis_movimentos (credito_id, empresa_id, estabelecimento_id, tributo_id, tipo, classe, natureza, valor, valor_assinado, data, competencia,
                              descricao, estorno_de, status, chave_idempotencia, origem_registro, transferencia_id)
  values (o.credito_id, o.empresa_id, o.estabelecimento_id, o.tributo_id, 'estorno', o.classe, o.natureza, o.valor, -o.valor_assinado,
          fis_hoje(), o.competencia, 'Estorno do lançamento nº ' || o.numero || ': ' || trim(p_motivo), o.id, 'efetivo', p_chave, 'manual', o.transferencia_id)
  returning id into v_id;
  perform fis_registrar_decisao('movimento', o.id, o.empresa_id, 'estorno', p_motivo, jsonb_build_object('estorno_id', v_id));

  if o.transferencia_id is not null then
    select * into par from fis_movimentos where transferencia_id = o.transferencia_id and id <> o.id and tipo <> 'estorno' and not estornado and status = 'efetivo';
    if par.id is not null then
      if par.natureza = 'entrada' and fis_saldo_minimo_apos(par.credito_id, par.competencia, true, par.id) < 0 then
        raise exception 'O estorno da transferência deixaria o crédito de destino negativo. Estorne antes as utilizações dele.';
      end if;
      update fis_movimentos set estornado = true where id = par.id;
      insert into fis_movimentos (credito_id, empresa_id, estabelecimento_id, tributo_id, tipo, classe, natureza, valor, valor_assinado, data, competencia,
                                  descricao, estorno_de, status, origem_registro, transferencia_id)
      values (par.credito_id, par.empresa_id, par.estabelecimento_id, par.tributo_id, 'estorno', par.classe, par.natureza, par.valor, -par.valor_assinado,
              fis_hoje(), par.competencia, 'Estorno do lançamento nº ' || par.numero || ' (transferência): ' || trim(p_motivo), par.id, 'efetivo', 'manual', par.transferencia_id);
    end if;
  end if;
  return v_id;
end $$;

-- Correção: estorna o original e registra o lançamento correto ligado a ele (corrige_id), numa transação.
create function fis_movimento_corrigir(p_id uuid, p jsonb, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o fis_movimentos; v_novo uuid;
begin
  select * into o from fis_movimentos where id = p_id;
  if o.id is null then raise exception 'Movimentação não encontrada.'; end if;
  if o.transferencia_id is not null then raise exception 'Transferência se corrige por estorno e nova transferência.'; end if;
  perform fis_movimento_estornar(p_id, 'Correção: ' || coalesce(p_motivo, ''), null);
  v_novo := fis_mov_inserir(o.credito_id, coalesce(nullif(p ->> 'tipo', ''), o.tipo), coalesce(fis_valor(p, 'valor', false), o.valor),
                            coalesce(nullif(p ->> 'data', '')::date, o.data), coalesce(fis_competencia(p ->> 'competencia', false), o.competencia),
                            coalesce(nullif(p ->> 'descricao', ''), o.descricao), coalesce(p ->> 'documento_ref', o.documento_ref),
                            coalesce(p ->> 'protocolo', o.protocolo), coalesce(p ->> 'processo', o.processo),
                            nullif(p ->> 'chave_idempotencia', '')::uuid, 'manual', o.id, null);
  perform fis_registrar_decisao('movimento', o.id, o.empresa_id, 'correcao', p_motivo, jsonb_build_object('novo_id', v_novo));
  return v_novo;
end $$;

-- Aprovação/rejeição de lançamento pendente (revisor/contador/admin, nunca quem lançou). Transferência: as duas pernas.
create function fis_movimento_decidir(p_id uuid, p_aprovar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  m fis_movimentos;
  c fis_creditos;
  t fis_tipos_movimento;
  cat fis_categorias;
  v_ids uuid[];
  x uuid;
begin
  select * into m from fis_movimentos where id = p_id;
  if m.id is null then raise exception 'Movimentação não encontrada.'; end if;
  perform fis_exigir('validar', m.empresa_id);
  if m.status <> 'pendente' then raise exception 'Esta movimentação não está pendente.'; end if;
  if auth.uid() is not null and m.registrado_por = auth.uid() then
    raise exception 'Quem registrou o lançamento não pode aprová-lo nem rejeitá-lo (segregação de funções).';
  end if;
  if not p_aprovar and length(coalesce(trim(p_motivo), '')) < 10 then raise exception 'Informe o motivo da rejeição (mínimo 10 caracteres).'; end if;
  v_ids := case when m.transferencia_id is null then array[m.id]
                else array(select id from fis_movimentos where transferencia_id = m.transferencia_id and status = 'pendente' order by natureza desc) end;
  foreach x in array v_ids loop
    select * into m from fis_movimentos where id = x for update;
    perform fis_exigir('validar', m.empresa_id);
    if p_aprovar and m.natureza = 'saida' then
      select * into c from fis_creditos where id = m.credito_id for update;
      select * into t from fis_tipos_movimento where codigo = m.tipo;
      select * into cat from fis_categorias where id = c.categoria_id;
      if t.forma is not null and (c.validacao <> 'validado' or c.bloqueado or not (t.forma = any (cat.formas_utilizacao))
                                   or (c.data_limite_aproveitamento is not null and m.data > c.data_limite_aproveitamento)) then
        raise exception 'O crédito % não está disponível para esta saída (validação, bloqueio, prazo ou forma).', c.codigo;
      end if;
      if fis_saldo_minimo_apos(m.credito_id, m.competencia, false, m.id) - m.valor < 0 then
        raise exception 'Saldo insuficiente no crédito % para aprovar este lançamento.', c.codigo;
      end if;
    end if;
    update fis_movimentos set status = case when p_aprovar then 'efetivo' else 'rejeitado' end, aprovado_por = auth.uid(), aprovado_em = now(),
           decisao_motivo = nullif(trim(p_motivo), '') where id = x;
    perform fis_registrar_decisao('movimento', x, m.empresa_id, case when p_aprovar then 'aprovado' else 'rejeitado' end, p_motivo);
  end loop;
end $$;

-- Transferência autorizada entre créditos: sempre com fundamento e aprovação; nunca automática.
create function fis_transferir(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o fis_creditos; d fis_creditos;
  v_tr uuid := gen_random_uuid();
  v_valor numeric := fis_valor(p, 'valor');
  v_comp date := fis_competencia(p ->> 'competencia');
  v_data date := (p ->> 'data')::date;
  v_fund text := trim(coalesce(p ->> 'fundamento', ''));
begin
  select * into o from fis_creditos where id = (p ->> 'origem_id')::uuid;
  select * into d from fis_creditos where id = (p ->> 'destino_id')::uuid;
  if o.id is null or d.id is null then raise exception 'Escolha os créditos de origem e de destino.'; end if;
  if o.id = d.id then raise exception 'Origem e destino devem ser créditos diferentes.'; end if;
  perform fis_exigir('lancar', o.empresa_id);
  perform fis_exigir('lancar', d.empresa_id);
  if length(v_fund) < 15 then raise exception 'Informe o fundamento e a autorização da transferência (mínimo 15 caracteres).'; end if;
  perform fis_mov_inserir(o.id, 'transferencia_saida', v_valor, v_data, v_comp, 'Transferência para ' || d.codigo || '. Fundamento: ' || v_fund,
                          p ->> 'documento_ref', p ->> 'protocolo', null, nullif(p ->> 'chave_idempotencia', '')::uuid, 'manual', null, v_tr);
  perform fis_mov_inserir(d.id, 'transferencia_entrada', v_valor, v_data, greatest(v_comp, d.competencia_origem), 'Transferência de ' || o.codigo || '. Fundamento: ' || v_fund,
                          p ->> 'documento_ref', p ->> 'protocolo', null, null, 'manual', null, v_tr);
  return v_tr;
end $$;

-- Arquivamento lógico: saldo zerado, ou lançamento indevido sem saídas (estorna as entradas). Pendentes são rejeitados.
create function fis_credito_arquivar(p_id uuid, p_motivo text, p_estornar_entradas boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare c fis_creditos; v_saldo numeric; x record;
begin
  select * into c from fis_creditos where id = p_id for update;
  if c.id is null then raise exception 'Crédito não encontrado.'; end if;
  perform fis_exigir('lancar', c.empresa_id);
  if c.arquivado then raise exception 'Crédito já arquivado.'; end if;
  if length(coalesce(trim(p_motivo), '')) < 10 then raise exception 'Informe o motivo do arquivamento (mínimo 10 caracteres).'; end if;
  select coalesce(sum(valor_assinado), 0) into v_saldo from fis_movimentos where credito_id = c.id and status = 'efetivo';
  if v_saldo <> 0 then
    if not p_estornar_entradas then
      raise exception 'O crédito ainda tem saldo de %. Zere o saldo ou arquive como lançamento indevido (estorna as entradas).', fis_brl(v_saldo);
    end if;
    if exists (select 1 from fis_movimentos where credito_id = c.id and status = 'efetivo' and natureza = 'saida' and tipo <> 'estorno' and not estornado) then
      raise exception 'O crédito tem utilizações/baixas: estorne-as antes de arquivar como lançamento indevido.';
    end if;
    for x in select id from fis_movimentos where credito_id = c.id and status = 'efetivo' and natureza = 'entrada' and tipo <> 'estorno' and not estornado order by competencia desc loop
      perform fis_movimento_estornar(x.id, 'Arquivamento do crédito: ' || trim(p_motivo), null);
    end loop;
  end if;
  update fis_movimentos set status = 'rejeitado', aprovado_por = auth.uid(), aprovado_em = now(), decisao_motivo = 'Crédito arquivado: ' || trim(p_motivo)
   where credito_id = c.id and status = 'pendente';
  update fis_creditos set arquivado = true, arquivado_em = now(), arquivado_por = auth.uid(), arquivado_motivo = trim(p_motivo) where id = c.id;
  perform fis_registrar_decisao('credito', c.id, c.empresa_id, 'arquivamento', p_motivo, jsonb_build_object('saldo_antes', v_saldo));
end $$;

-- 5) COMPETÊNCIAS: revisão, saldos oficiais, fechamento, reabertura e reconciliação ----------------------------------------
create function fis_periodo_obter(p_estab uuid, p_tributo uuid, p_comp date) returns fis_periodos
language plpgsql security definer set search_path = public as $$
declare v fis_periodos;
begin
  perform fis_periodo_garantir(p_estab, p_tributo, p_comp);
  select * into v from fis_periodos where estabelecimento_id = p_estab and tributo_id = p_tributo and competencia = p_comp for update;
  return v;
end $$;
revoke all on function fis_periodo_obter(uuid, uuid, date) from public, anon, authenticated;

create function fis_periodo_enviar_revisao(p_estab uuid, p_tributo uuid, p_comp date, p_obs text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v fis_periodos;
begin
  v := fis_periodo_obter(p_estab, p_tributo, date_trunc('month', p_comp)::date);
  perform fis_exigir('lancar', v.empresa_id);
  if v.status <> 'aberto' then raise exception 'A competência não está aberta.'; end if;
  update fis_periodos set status = 'em_revisao', enviado_revisao_por = auth.uid(), enviado_revisao_em = now() where id = v.id;
  insert into fis_periodos_eventos (periodo_id, evento, motivo) values (v.id, 'envio_revisao', nullif(trim(p_obs), ''));
  return v.id;
end $$;

create function fis_periodo_informar_saldos(p_estab uuid, p_tributo uuid, p_comp date, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v fis_periodos;
begin
  v := fis_periodo_obter(p_estab, p_tributo, date_trunc('month', p_comp)::date);
  perform fis_exigir('lancar', v.empresa_id);
  if v.status = 'fechado' then raise exception 'Competência fechada: reabra para alterar os saldos informados.'; end if;
  update fis_periodos set
    saldo_oficial = case when p ? 'saldo_oficial' then fis_valor(p, 'saldo_oficial', false) else saldo_oficial end,
    saldo_oficial_fonte = case when p ? 'saldo_oficial_fonte' then nullif(trim(p ->> 'saldo_oficial_fonte'), '') else saldo_oficial_fonte end,
    saldo_declarado = case when p ? 'saldo_declarado' then fis_valor(p, 'saldo_declarado', false) else saldo_declarado end,
    saldo_declarado_fonte = case when p ? 'saldo_declarado_fonte' then nullif(trim(p ->> 'saldo_declarado_fonte'), '') else saldo_declarado_fonte end,
    diferenca_justificativa = case when p ? 'diferenca_justificativa' then nullif(trim(p ->> 'diferenca_justificativa'), '') else diferenca_justificativa end
  where id = v.id;
  insert into fis_periodos_eventos (periodo_id, evento, dados) values (v.id, 'saldos_informados', p);
  return v.id;
end $$;

-- Fechamento: sequencial (anteriores fechados e reconciliados), sem pendentes, diferença com o oficial justificada e
-- divergências abertas só com aceite explícito e justificativa. Congela os valores (snapshot).
create function fis_periodo_fechar(p_estab uuid, p_tributo uuid, p_comp date, p_justificativa text default null, p_aceitar_divergencias boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v fis_periodos;
  v_comp date := date_trunc('month', p_comp)::date;
  v_snap jsonb;
  v_abertas text;
  v_div int;
  v_dif numeric;
begin
  v := fis_periodo_obter(p_estab, p_tributo, v_comp);
  perform fis_exigir('fechar', v.empresa_id);
  if v.status = 'fechado' then raise exception 'A competência % já está fechada.', fis_mm(v_comp); end if;
  if v_comp >= date_trunc('month', fis_hoje())::date then raise exception 'Só competências encerradas (meses anteriores ao atual) podem ser fechadas.'; end if;
  select string_agg(fis_mm(x.competencia), ', ' order by x.competencia) into v_abertas from (
    select distinct m.competencia from fis_movimentos m
     where m.estabelecimento_id = p_estab and m.tributo_id = p_tributo and m.competencia < v_comp
       and not exists (select 1 from fis_periodos p where p.estabelecimento_id = p_estab and p.tributo_id = p_tributo and p.competencia = m.competencia
                         and p.status = 'fechado' and not p.requer_reconciliacao)
  ) x;
  if v_abertas is not null then raise exception 'Feche (ou reconcilie) antes as competências anteriores com movimentação: %.', v_abertas; end if;
  if exists (select 1 from fis_movimentos where estabelecimento_id = p_estab and tributo_id = p_tributo and competencia = v_comp and status = 'pendente') then
    raise exception 'Há movimentações pendentes de aprovação na competência %.', fis_mm(v_comp);
  end if;
  v_snap := fis_apuracao_chave(p_estab, p_tributo, v_comp);
  if v.saldo_oficial is not null then
    v_dif := (v_snap ->> 'saldo_final')::numeric - v.saldo_oficial;
    if v_dif <> 0 and length(coalesce(trim(coalesce(p_justificativa, v.diferenca_justificativa)), '')) < 10 then
      raise exception 'Saldo calculado (%) difere do saldo oficial informado (%) em %. Justifique a diferença para fechar.',
        fis_brl((v_snap ->> 'saldo_final')::numeric), fis_brl(v.saldo_oficial), fis_brl(v_dif);
    end if;
  end if;
  select count(*) into v_div from fis_divergencias where status in ('aberta', 'em_analise')
     and (periodo_id = v.id or (estabelecimento_id = p_estab and tributo_id = p_tributo and competencia = v_comp));
  if v_div > 0 and (not p_aceitar_divergencias or length(coalesce(trim(p_justificativa), '')) < 10) then
    raise exception 'Há % divergência(s) aberta(s) nesta competência. Resolva-as ou confirme o fechamento com justificativa.', v_div;
  end if;
  v_snap := v_snap || jsonb_build_object('saldo_oficial', v.saldo_oficial, 'diferenca', v_dif, 'divergencias_abertas', v_div);
  update fis_periodos set status = 'fechado', fechado_por = auth.uid(), fechado_em = now(), conferido_por = coalesce(conferido_por, auth.uid()),
         snapshot = v_snap, requer_reconciliacao = false, reconciliacao_motivo = null,
         diferenca_justificativa = coalesce(nullif(trim(p_justificativa), ''), diferenca_justificativa)
   where id = v.id;
  insert into fis_periodos_eventos (periodo_id, evento, motivo, dados) values (v.id, 'fechamento', nullif(trim(p_justificativa), ''), v_snap);
  perform fis_registrar_decisao('periodo', v.id, v.empresa_id, 'fechamento', p_justificativa, v_snap);
  return v.id;
end $$;

-- Reabertura (revisor/admin) com motivo. Devolve as competências fechadas posteriores, potencialmente afetadas.
create function fis_periodo_reabrir(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v fis_periodos; v_post jsonb;
begin
  select * into v from fis_periodos where id = p_id for update;
  if v.id is null then raise exception 'Competência não encontrada.'; end if;
  perform fis_exigir('reabrir', v.empresa_id);
  if v.status <> 'fechado' then raise exception 'A competência não está fechada.'; end if;
  if length(coalesce(trim(p_motivo), '')) < 15 then raise exception 'Informe o motivo da reabertura (mínimo 15 caracteres).'; end if;
  update fis_periodos set status = 'aberto', reaberturas = reaberturas + 1 where id = v.id;
  insert into fis_periodos_eventos (periodo_id, evento, motivo, dados) values (v.id, 'reabertura', trim(p_motivo), v.snapshot);
  perform fis_registrar_decisao('periodo', v.id, v.empresa_id, 'reabertura', p_motivo, v.snapshot);
  select coalesce(jsonb_agg(fis_mm(competencia) order by competencia), '[]'::jsonb) into v_post from fis_periodos
   where estabelecimento_id = v.estabelecimento_id and tributo_id = v.tributo_id and competencia > v.competencia and status = 'fechado';
  return jsonb_build_object('posteriores_fechadas', v_post);
end $$;

-- Reconciliação de competência fechada cujo saldo transportado mudou: recalcula o congelado (em ordem cronológica).
create function fis_periodo_reconciliar(p_id uuid, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
declare v fis_periodos; v_snap jsonb;
begin
  select * into v from fis_periodos where id = p_id for update;
  if v.id is null then raise exception 'Competência não encontrada.'; end if;
  perform fis_exigir('fechar', v.empresa_id);
  if not v.requer_reconciliacao then raise exception 'Esta competência não precisa de reconciliação.'; end if;
  if length(coalesce(trim(p_obs), '')) < 10 then raise exception 'Registre a conferência feita (mínimo 10 caracteres).'; end if;
  if exists (select 1 from fis_periodos where estabelecimento_id = v.estabelecimento_id and tributo_id = v.tributo_id and competencia < v.competencia
               and (requer_reconciliacao or status <> 'fechado')
               and exists (select 1 from fis_movimentos m where m.estabelecimento_id = v.estabelecimento_id and m.tributo_id = v.tributo_id and m.competencia = fis_periodos.competencia)) then
    raise exception 'Reconcilie/feche antes as competências anteriores.';
  end if;
  v_snap := fis_apuracao_chave(v.estabelecimento_id, v.tributo_id, v.competencia)
            || jsonb_build_object('saldo_oficial', v.saldo_oficial, 'reconciliado_de', v.snapshot -> 'saldo_final');
  update fis_periodos set snapshot = v_snap, requer_reconciliacao = false, reconciliacao_motivo = null where id = v.id;
  insert into fis_periodos_eventos (periodo_id, evento, motivo, dados) values (v.id, 'reconciliacao', trim(p_obs), jsonb_build_object('antes', v.snapshot, 'depois', v_snap));
  perform fis_registrar_decisao('periodo', v.id, v.empresa_id, 'reconciliacao', p_obs, jsonb_build_object('antes', v.snapshot -> 'saldo_final', 'depois', v_snap -> 'saldo_final'));
end $$;

-- 6) OBRIGAÇÕES -------------------------------------------------------------------------------------------------------------
create function fis_vencimento_pela_regra(p_tipo uuid, p_comp date) returns date
language sql stable security definer set search_path = public as $$
  select case when t.dia_vencimento is null then null else
    least((date_trunc('month', p_comp) + make_interval(months => t.meses_apos))::date + (t.dia_vencimento - 1),
          (date_trunc('month', p_comp) + make_interval(months => t.meses_apos + 1) - interval '1 day')::date) end
  from fis_tipos_obrigacao t where t.id = p_tipo
$$;

create function fis_obrigacao_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  e fis_estabelecimentos;
  t fis_tipos_obrigacao;
  o fis_obrigacoes;
  v_comp date;
  v_venc date := nullif(p ->> 'vencimento', '')::date;
begin
  if v_id is null then
    select * into e from fis_estabelecimentos where id = (p ->> 'estabelecimento_id')::uuid;
    if e.id is null then raise exception 'Escolha o estabelecimento.'; end if;
    perform fis_exigir('lancar', e.empresa_id);
    select * into t from fis_tipos_obrigacao where id = (p ->> 'tipo_id')::uuid and ativo;
    if t.id is null then raise exception 'Escolha o tipo de obrigação.'; end if;
    v_comp := fis_competencia(p ->> 'competencia');
    if v_venc is not null and coalesce((p ->> 'vencimento_confirmado')::boolean, false) then
      perform fis_exigir('validar', e.empresa_id);
      if nullif(trim(p ->> 'vencimento_fonte'), '') is null then raise exception 'Informe a fonte do vencimento confirmado.'; end if;
    end if;
    begin
      insert into fis_obrigacoes (tipo_id, tributo_id, empresa_id, estabelecimento_id, competencia, vencimento, vencimento_confirmado, vencimento_fonte,
                                  responsavel_id, contador_responsavel, observacoes, ficticio)
      values (t.id, coalesce(nullif(p ->> 'tributo_id', '')::uuid, t.tributo_id), e.empresa_id, e.id, v_comp,
              coalesce(v_venc, fis_vencimento_pela_regra(t.id, v_comp)),
              case when v_venc is not null then coalesce((p ->> 'vencimento_confirmado')::boolean, false) else t.regra_vencimento_validada and t.dia_vencimento is not null end,
              case when v_venc is not null then nullif(trim(p ->> 'vencimento_fonte'), '') when t.dia_vencimento is not null then t.fonte_regra end,
              nullif(p ->> 'responsavel_id', '')::uuid, nullif(trim(p ->> 'contador_responsavel'), ''), nullif(trim(p ->> 'observacoes'), ''),
              coalesce((p ->> 'ficticio')::boolean, false))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Já existe esta obrigação para o estabelecimento na competência %.', fis_mm(v_comp);
    end;
    insert into fis_obrigacoes_eventos (obrigacao_id, de, para, observacao) values (v_id, null, 'nao_iniciada', 'Cadastro');
  else
    select * into o from fis_obrigacoes where id = v_id for update;
    if o.id is null then raise exception 'Obrigação não encontrada.'; end if;
    perform fis_exigir('lancar', o.empresa_id);
    if o.status in ('transmitida', 'entregue_conferida', 'retificada', 'dispensada') then
      raise exception 'Obrigação % não é editada (use retificação).', o.status;
    end if;
    -- confirmar o vencimento é decisão de quem valida
    if coalesce((p ->> 'vencimento_confirmado')::boolean, false) and (not o.vencimento_confirmado or v_venc is distinct from o.vencimento) then
      perform fis_exigir('validar', o.empresa_id);
      if nullif(trim(p ->> 'vencimento_fonte'), '') is null then raise exception 'Informe a fonte do vencimento confirmado.'; end if;
    end if;
    update fis_obrigacoes set vencimento = v_venc,
           vencimento_confirmado = coalesce((p ->> 'vencimento_confirmado')::boolean, false) and v_venc is not null,
           vencimento_fonte = nullif(trim(p ->> 'vencimento_fonte'), ''),
           responsavel_id = nullif(p ->> 'responsavel_id', '')::uuid, contador_responsavel = nullif(trim(p ->> 'contador_responsavel'), ''),
           observacoes = nullif(trim(p ->> 'observacoes'), '')
     where id = v_id;
  end if;
  return v_id;
end $$;

-- Gera as obrigações da competência para os estabelecimentos em que o tipo foi marcado como aplicável.
create function fis_obrigacoes_gerar(p_comp date, p_empresa uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_comp date := date_trunc('month', p_comp)::date; x record; v_n int := 0;
begin
  perform fis_exigir('lancar', p_empresa);
  for x in select a.*, e.empresa_id, t.periodicidade from fis_obrigacoes_aplicaveis a join fis_estabelecimentos e on e.id = a.estabelecimento_id
             join fis_tipos_obrigacao t on t.id = a.tipo_id
            where a.ativo and t.ativo and e.ativo and t.periodicidade = 'mensal' and (p_empresa is null or e.empresa_id = p_empresa)
              and fis_empresa_permitida(e.empresa_id)
              and not exists (select 1 from fis_obrigacoes o where o.tipo_id = a.tipo_id and o.estabelecimento_id = a.estabelecimento_id
                                and o.competencia = v_comp and o.retificadora_de is null) loop
    perform fis_obrigacao_salvar(jsonb_build_object('tipo_id', x.tipo_id, 'estabelecimento_id', x.estabelecimento_id, 'competencia', v_comp,
                                                    'responsavel_id', x.responsavel_id, 'contador_responsavel', x.contador_responsavel));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Fluxo de situação. Transmitida: data + recibo/protocolo + recibo anexado (se exigido). Conferida: outra pessoa (validar).
create function fis_obrigacao_status(p_id uuid, p_para fis_status_obrigacao, p jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  o fis_obrigacoes;
  t fis_tipos_obrigacao;
  v_data date;
  v_recibo text;
  v_obs text := nullif(trim(p ->> 'observacao'), '');
  v_faltam text[];
begin
  select * into o from fis_obrigacoes where id = p_id for update;
  if o.id is null then raise exception 'Obrigação não encontrada.'; end if;
  perform fis_exigir('lancar', o.empresa_id);
  select * into t from fis_tipos_obrigacao where id = o.tipo_id;
  if o.status = p_para then raise exception 'A obrigação já está nesta situação.'; end if;
  if o.status in ('entregue_conferida', 'retificada', 'dispensada') then
    raise exception 'Obrigação encerrada (%) não muda de situação.', o.status;
  end if;
  if p_para = 'retificada' then raise exception 'Use "Retificar" para gerar a retificadora.'; end if;
  if o.status = 'transmitida' and p_para <> 'entregue_conferida' then
    raise exception 'Obrigação transmitida só avança para "Entregue e conferida" ou é retificada.';
  end if;

  if p_para = 'pronta_transmissao' then
    perform fis_exigir('validar', o.empresa_id);
    perform fis_registrar_decisao('obrigacao', o.id, o.empresa_id, 'aprovada_para_transmissao', v_obs);
  end if;

  if p_para = 'transmitida' then
    if o.status <> 'pronta_transmissao' then raise exception 'Antes de transmitida, a obrigação precisa estar "Pronta para transmissão".'; end if;
    v_data := nullif(p ->> 'data_transmissao', '')::date;
    v_recibo := nullif(trim(p ->> 'numero_recibo'), '');
    if v_data is null or v_recibo is null then raise exception 'Informe a data da transmissão e o número do recibo/protocolo.'; end if;
    if v_data > fis_hoje() then raise exception 'A data da transmissão não pode ser futura.'; end if;
    if t.exige_recibo then
      select array_agg(td.nome) into v_faltam from unnest(t.documentos_exigidos) d join fis_tipos_documento td on td.codigo = d
       where not exists (select 1 from fis_docs_do_alvo('obrigacao', o.id) x where x.tipo = d);
      if v_faltam is not null then
        raise exception 'Anexe e vincule antes: %. Arquivo salvo não comprova transmissão.', array_to_string(v_faltam, ', ');
      end if;
    end if;
    update fis_obrigacoes set data_transmissao = v_data, numero_recibo = v_recibo, transmitida_por = auth.uid() where id = o.id;
  end if;

  if p_para = 'entregue_conferida' then
    if o.status <> 'transmitida' then raise exception 'Só obrigação transmitida é conferida.'; end if;
    perform fis_exigir('validar', o.empresa_id);
    if auth.uid() is not null and o.transmitida_por = auth.uid() then
      raise exception 'A conferência deve ser feita por outra pessoa (quem registrou a transmissão não confere).';
    end if;
    update fis_obrigacoes set conferida_por = auth.uid(), conferida_em = now() where id = o.id;
    perform fis_registrar_decisao('obrigacao', o.id, o.empresa_id, 'conferida', v_obs);
  end if;

  if p_para = 'dispensada' then
    perform fis_exigir('validar', o.empresa_id);
    if length(coalesce(trim(p ->> 'justificativa'), '')) < 15 then raise exception 'Justifique a dispensa (mínimo 15 caracteres).'; end if;
    update fis_obrigacoes set justificativa_dispensa = trim(p ->> 'justificativa') where id = o.id;
    perform fis_registrar_decisao('obrigacao', o.id, o.empresa_id, 'dispensada', p ->> 'justificativa');
  end if;

  if p_para = 'em_preparacao' and o.data_preparacao is null then update fis_obrigacoes set data_preparacao = fis_hoje() where id = o.id; end if;
  if p_para = 'em_revisao' then update fis_obrigacoes set data_revisao = fis_hoje() where id = o.id; end if;

  update fis_obrigacoes set status = p_para where id = o.id;
  insert into fis_obrigacoes_eventos (obrigacao_id, de, para, observacao) values (o.id, o.status, p_para, coalesce(v_obs, nullif(trim(p ->> 'justificativa'), '')));
end $$;

-- Retificação: a original vira "retificada" e nasce a retificadora (em preparação), ligada a ela.
create function fis_obrigacao_retificar(p_id uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o fis_obrigacoes; v_id uuid;
begin
  select * into o from fis_obrigacoes where id = p_id for update;
  if o.id is null then raise exception 'Obrigação não encontrada.'; end if;
  perform fis_exigir('lancar', o.empresa_id);
  if o.status not in ('transmitida', 'entregue_conferida') then raise exception 'Só obrigação transmitida ou conferida é retificada.'; end if;
  if length(coalesce(trim(p_motivo), '')) < 10 then raise exception 'Informe o motivo da retificação (mínimo 10 caracteres).'; end if;
  insert into fis_obrigacoes (tipo_id, tributo_id, empresa_id, estabelecimento_id, competencia, vencimento, vencimento_confirmado, vencimento_fonte,
                              responsavel_id, contador_responsavel, status, data_preparacao, retificadora_de, observacoes, ficticio)
  values (o.tipo_id, o.tributo_id, o.empresa_id, o.estabelecimento_id, o.competencia, null, false, null, o.responsavel_id, o.contador_responsavel,
          'em_preparacao', fis_hoje(), o.id, 'Retificadora: ' || trim(p_motivo), o.ficticio)
  returning id into v_id;
  update fis_obrigacoes set status = 'retificada' where id = o.id;
  insert into fis_obrigacoes_eventos (obrigacao_id, de, para, observacao) values (o.id, o.status, 'retificada', trim(p_motivo));
  insert into fis_obrigacoes_eventos (obrigacao_id, de, para, observacao) values (v_id, null, 'em_preparacao', 'Retificadora de ' || o.id);
  perform fis_registrar_decisao('obrigacao', o.id, o.empresa_id, 'retificada', p_motivo, jsonb_build_object('retificadora_id', v_id));
  return v_id;
end $$;

-- 7) DOCUMENTOS -------------------------------------------------------------------------------------------------------------
-- Alvo visível e da mesma empresa do documento.
create function fis_alvo_empresa(p_alvo text, p_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case p_alvo
    when 'credito' then (select empresa_id from fis_creditos where id = p_id)
    when 'movimento' then (select empresa_id from fis_movimentos where id = p_id)
    when 'obrigacao' then (select empresa_id from fis_obrigacoes where id = p_id)
    when 'periodo' then (select empresa_id from fis_periodos where id = p_id)
    when 'divergencia' then (select empresa_id from fis_divergencias where id = p_id)
    when 'tarefa' then (select empresa_id from fis_tarefas where id = p_id)
    when 'documento' then (select empresa_id from fis_documentos where id = p_id)
  end
$$;
revoke all on function fis_alvo_empresa(text, uuid) from public, anon;

-- Registra o documento (o arquivo já foi enviado ao bucket pela aplicação). Com substitui_id: nova versão, a anterior
-- fica "substituída" e os vínculos passam para a nova.
create function fis_documento_registrar(p jsonb, p_vinculos jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  ant fis_documentos;
  x jsonb;
  v_path text := nullif(p ->> 'arquivo_path', '');
begin
  perform fis_exigir('lancar', v_empresa);
  if v_path is not null and v_path not like 'fiscal.creditos/' || v_empresa::text || '/%' then
    raise exception 'Caminho do arquivo inválido para a empresa.';
  end if;
  if v_path is null and not coalesce((p ->> 'ficticio')::boolean, false) then raise exception 'Envie o arquivo.'; end if;
  if nullif(p ->> 'substitui_id', '') is not null then
    select * into ant from fis_documentos where id = (p ->> 'substitui_id')::uuid for update;
    if ant.id is null or ant.situacao <> 'vigente' then raise exception 'Só a versão vigente pode ser substituída.'; end if;
    if ant.empresa_id <> v_empresa then raise exception 'A nova versão deve ser da mesma empresa.'; end if;
    if length(coalesce(trim(p ->> 'motivo_substituicao'), '')) < 5 then raise exception 'Informe o motivo da substituição.'; end if;
  end if;
  insert into fis_documentos (tipo, titulo, empresa_id, estabelecimento_id, tributo_id, competencia, observacoes, arquivo_path, nome_arquivo, mime,
                              tamanho_bytes, sha256, versao, raiz_id, substitui_id, motivo_substituicao, ficticio)
  values (coalesce(nullif(p ->> 'tipo', ''), ant.tipo), coalesce(nullif(trim(p ->> 'titulo'), ''), ant.titulo), v_empresa,
          coalesce(nullif(p ->> 'estabelecimento_id', '')::uuid, ant.estabelecimento_id), coalesce(nullif(p ->> 'tributo_id', '')::uuid, ant.tributo_id),
          coalesce(fis_competencia(p ->> 'competencia', false), ant.competencia), nullif(trim(p ->> 'observacoes'), ''), v_path,
          nullif(p ->> 'nome_arquivo', ''), nullif(p ->> 'mime', ''), nullif(p ->> 'tamanho_bytes', '')::bigint, nullif(p ->> 'sha256', ''),
          coalesce(ant.versao + 1, 1), coalesce(ant.raiz_id, ant.id), ant.id, nullif(trim(p ->> 'motivo_substituicao'), ''),
          coalesce((p ->> 'ficticio')::boolean, false))
  returning id into v_id;
  if ant.id is not null then
    update fis_documentos set situacao = 'substituido' where id = ant.id;
    insert into fis_documentos_vinculos (documento_id, alvo, alvo_id)
    select v_id, alvo, alvo_id from fis_documentos_vinculos where documento_id = ant.id and removido_em is null;
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_vinculos, '[]'::jsonb)) loop
    perform fis_documento_vincular(v_id, x ->> 'alvo', (x ->> 'alvo_id')::uuid);
  end loop;
  return v_id;
end $$;

create function fis_documento_vincular(p_documento uuid, p_alvo text, p_alvo_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d fis_documentos; v_emp uuid;
begin
  select * into d from fis_documentos where id = p_documento;
  if d.id is null then raise exception 'Documento não encontrado.'; end if;
  perform fis_exigir('lancar', d.empresa_id);
  v_emp := fis_alvo_empresa(p_alvo, p_alvo_id);
  if v_emp is null then raise exception 'Registro a vincular não encontrado.'; end if;
  if v_emp <> d.empresa_id then raise exception 'O documento e o registro são de empresas diferentes.'; end if;
  insert into fis_documentos_vinculos (documento_id, alvo, alvo_id) values (p_documento, p_alvo, p_alvo_id)
  on conflict do nothing;
end $$;

create function fis_documento_desvincular(p_vinculo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v fis_documentos_vinculos; d fis_documentos;
begin
  select * into v from fis_documentos_vinculos where id = p_vinculo for update;
  if v.id is null or v.removido_em is not null then raise exception 'Vínculo não encontrado.'; end if;
  select * into d from fis_documentos where id = v.documento_id;
  perform fis_exigir('lancar', d.empresa_id);
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Informe o motivo.'; end if;
  if v.alvo = 'obrigacao' and exists (select 1 from fis_obrigacoes o where o.id = v.alvo_id and o.status in ('transmitida', 'entregue_conferida')) then
    raise exception 'O recibo de obrigação transmitida não é desvinculado (é a prova da entrega).';
  end if;
  update fis_documentos_vinculos set removido_em = now(), removido_por = auth.uid(), removido_motivo = trim(p_motivo) where id = v.id;
end $$;

create function fis_documento_arquivar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare d fis_documentos;
begin
  select * into d from fis_documentos where id = p_id for update;
  if d.id is null then raise exception 'Documento não encontrado.'; end if;
  perform fis_exigir('validar', d.empresa_id);
  if d.situacao <> 'vigente' then raise exception 'Só documento vigente é arquivado.'; end if;
  if length(coalesce(trim(p_motivo), '')) < 10 then raise exception 'Informe o motivo (mínimo 10 caracteres).'; end if;
  if exists (select 1 from fis_documentos_vinculos v join fis_obrigacoes o on o.id = v.alvo_id
              where v.documento_id = d.id and v.alvo = 'obrigacao' and v.removido_em is null and o.status in ('transmitida', 'entregue_conferida')) then
    raise exception 'Documento que comprova obrigação transmitida não é arquivado.';
  end if;
  update fis_documentos set situacao = 'arquivado' where id = d.id;
  perform fis_registrar_decisao('documento', d.id, d.empresa_id, 'arquivamento', p_motivo);
end $$;

-- 8) DIVERGÊNCIAS ------------------------------------------------------------------------------------------------------------
create function fis_divergencia_registrar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_emp uuid := (p ->> 'empresa_id')::uuid; v_int numeric; v_ext numeric;
begin
  perform fis_exigir('lancar', v_emp);
  if nullif(p ->> 'responsavel_id', '') is not null and (p ->> 'responsavel_id')::uuid <> auth.uid() then
    perform fis_exigir('atribuir', v_emp);
  end if;
  v_int := fis_valor(p, 'valor_interno', false);
  v_ext := fis_valor(p, 'valor_externo', false);
  insert into fis_divergencias (empresa_id, estabelecimento_id, tributo_id, competencia, credito_id, periodo_id, obrigacao_id, regra, chave_regra,
                                fonte_comparada, valor_interno, valor_externo, valor_diferenca, motivo, providencia, responsavel_id, prazo_interno, ficticio)
  values (v_emp, nullif(p ->> 'estabelecimento_id', '')::uuid, nullif(p ->> 'tributo_id', '')::uuid, fis_competencia(p ->> 'competencia', false),
          nullif(p ->> 'credito_id', '')::uuid, nullif(p ->> 'periodo_id', '')::uuid, nullif(p ->> 'obrigacao_id', '')::uuid,
          nullif(p ->> 'regra', ''), nullif(p ->> 'chave_regra', ''), nullif(p ->> 'fonte_comparada', ''), v_int, v_ext,
          coalesce(fis_valor(p, 'valor_diferenca', false), coalesce(v_int, 0) - coalesce(v_ext, 0)),
          trim(p ->> 'motivo'), nullif(trim(p ->> 'providencia'), ''), nullif(p ->> 'responsavel_id', '')::uuid,
          nullif(p ->> 'prazo_interno', '')::date, coalesce((p ->> 'ficticio')::boolean, false))
  returning id into v_id;
  if nullif(p ->> 'responsavel_id', '') is not null then
    perform fis_tarefa_criar(jsonb_build_object('tipo', 'tarefa', 'titulo', 'Analisar divergência nº ' || (select numero from fis_divergencias where id = v_id),
            'descricao', trim(p ->> 'motivo'), 'empresa_id', v_emp, 'alvo', 'divergencia', 'alvo_id', v_id,
            'responsavel_id', p ->> 'responsavel_id', 'prazo', nullif(p ->> 'prazo_interno', '')));
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Esta verificação já está registrada como divergência aberta.';
end $$;

create function fis_divergencia_status(p_id uuid, p_status text, p_texto text, p_responsavel uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare d fis_divergencias;
begin
  select * into d from fis_divergencias where id = p_id for update;
  if d.id is null then raise exception 'Divergência não encontrada.'; end if;
  perform fis_exigir('lancar', d.empresa_id);
  if d.status in ('resolvida', 'cancelada') then raise exception 'Divergência encerrada.'; end if;
  if p_status in ('justificada', 'resolvida', 'cancelada') then
    perform fis_exigir('validar', d.empresa_id);
    if length(coalesce(trim(p_texto), '')) < 10 then raise exception 'Registre a justificativa/solução (mínimo 10 caracteres).'; end if;
  end if;
  if p_responsavel is not null and p_responsavel is distinct from d.responsavel_id and p_responsavel <> auth.uid() then
    perform fis_exigir('atribuir', d.empresa_id);
  end if;
  update fis_divergencias set status = p_status, responsavel_id = coalesce(p_responsavel, responsavel_id),
         resolucao = case when p_status in ('justificada', 'resolvida', 'cancelada') then trim(p_texto) else resolucao end,
         resolvido_por = case when p_status in ('justificada', 'resolvida', 'cancelada') then auth.uid() else resolvido_por end,
         resolvido_em = case when p_status in ('justificada', 'resolvida', 'cancelada') then now() else resolvido_em end
   where id = d.id;
  perform fis_registrar_decisao('divergencia', d.id, d.empresa_id, 'status:' || p_status, p_texto);
end $$;

-- 9) TAREFAS E COMENTÁRIOS ---------------------------------------------------------------------------------------------------
-- A tarefa também vira pendência no núcleo (Fila do dia / Início). Atribuir a outra pessoa: revisor, contador ou admin.
create function fis_tarefa_criar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_emp uuid := nullif(p ->> 'empresa_id', '')::uuid;
  v_resp uuid := nullif(p ->> 'responsavel_id', '')::uuid;
  v_alvo text := nullif(p ->> 'alvo', '');
  v_alvo_id uuid := nullif(p ->> 'alvo_id', '')::uuid;
  v_pend uuid;
begin
  if v_alvo is not null then
    v_emp := coalesce(v_emp, fis_alvo_empresa(v_alvo, v_alvo_id));
    if fis_alvo_empresa(v_alvo, v_alvo_id) is distinct from v_emp then raise exception 'Registro da tarefa não encontrado.'; end if;
  end if;
  perform fis_exigir('lancar', v_emp);
  if v_resp is not null and v_resp <> coalesce(auth.uid(), v_resp) then perform fis_exigir('atribuir', v_emp); end if;
  if (p ->> 'tipo') = 'solicitacao_documento' and nullif(p ->> 'tipo_documento_solicitado', '') is null then
    raise exception 'Escolha o tipo de documento solicitado.';
  end if;
  insert into fis_tarefas (tipo, titulo, descricao, empresa_id, alvo, alvo_id, tipo_documento_solicitado, responsavel_id, prazo, ficticio)
  values (coalesce(nullif(p ->> 'tipo', ''), 'tarefa'), trim(p ->> 'titulo'), nullif(trim(p ->> 'descricao'), ''), v_emp, v_alvo, v_alvo_id,
          nullif(p ->> 'tipo_documento_solicitado', ''), v_resp, nullif(p ->> 'prazo', '')::date, coalesce((p ->> 'ficticio')::boolean, false))
  returning id into v_id;
  insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, responsavel_id, referencia_tabela, referencia_id, link)
  values ('fiscal.creditos', v_emp, 'Fiscal: ' || trim(p ->> 'titulo'), nullif(trim(p ->> 'descricao'), ''), nullif(p ->> 'prazo', '')::date,
          case when nullif(p ->> 'prazo', '')::date < fis_hoje() then 'alta'::criticidade else 'normal'::criticidade end,
          v_resp, 'fis_tarefas', v_id, '/fiscal/creditos/tarefas?tarefa=' || v_id)
  on conflict do nothing
  returning id into v_pend;
  return v_id;
end $$;

create function fis_tarefa_status(p_id uuid, p_status text, p_resposta text default null, p_responsavel uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare t fis_tarefas;
begin
  select * into t from fis_tarefas where id = p_id for update;
  if t.id is null then raise exception 'Tarefa não encontrada.'; end if;
  perform fis_exigir('lancar', t.empresa_id);
  if t.status in ('concluida', 'cancelada') then raise exception 'Tarefa encerrada.'; end if;
  if p_status not in ('aberta', 'em_andamento', 'concluida', 'cancelada') then raise exception 'Situação inválida.'; end if;
  -- quem não atribui só mexe na tarefa que é sua (ou sem dono, assumindo-a)
  if not fis_pode('atribuir', t.empresa_id) and t.responsavel_id is not null and t.responsavel_id <> auth.uid() and t.solicitante_id <> auth.uid() then
    raise exception 'Somente o responsável, o solicitante ou um revisor altera esta tarefa.';
  end if;
  if p_responsavel is not null and p_responsavel is distinct from t.responsavel_id and p_responsavel <> auth.uid() then
    perform fis_exigir('atribuir', t.empresa_id);
  end if;
  if p_status = 'cancelada' and t.solicitante_id is distinct from auth.uid() then perform fis_exigir('atribuir', t.empresa_id); end if;
  if p_status = 'concluida' and t.tipo = 'solicitacao_documento' and t.alvo is not null
     and not exists (select 1 from fis_docs_do_alvo(t.alvo, t.alvo_id) x where x.tipo = t.tipo_documento_solicitado) then
    raise exception 'O documento solicitado ainda não foi anexado e vinculado ao registro.';
  end if;
  update fis_tarefas set status = p_status, resposta = coalesce(nullif(trim(p_resposta), ''), resposta),
         responsavel_id = coalesce(p_responsavel, responsavel_id),
         concluida_por = case when p_status = 'concluida' then auth.uid() end, concluida_em = case when p_status = 'concluida' then now() end
   where id = t.id;
  update pendencias set status = case p_status when 'aberta' then 'aberta' when 'em_andamento' then 'em_andamento'
                                      when 'concluida' then 'concluida' else 'cancelada' end::status_pendencia,
         responsavel_id = coalesce(p_responsavel, responsavel_id)
   where modulo = 'fiscal.creditos' and referencia_tabela = 'fis_tarefas' and referencia_id = t.id and status in ('aberta', 'em_andamento');
  if nullif(trim(p_resposta), '') is not null then
    insert into fis_comentarios (alvo, alvo_id, empresa_id, texto) values ('tarefa', t.id, t.empresa_id, trim(p_resposta));
  end if;
end $$;

create function fis_comentar(p_alvo text, p_alvo_id uuid, p_texto text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := fis_alvo_empresa(p_alvo, p_alvo_id); v_id uuid;
begin
  if v_emp is null then raise exception 'Registro não encontrado.'; end if;
  perform fis_exigir('lancar', v_emp);
  insert into fis_comentarios (alvo, alvo_id, empresa_id, texto) values (p_alvo, p_alvo_id, v_emp, trim(p_texto)) returning id into v_id;
  return v_id;
end $$;

-- 10) PRIVILÉGIOS -------------------------------------------------------------------------------------------------------------
-- Funções públicas do módulo: usuários logados (as regras de papel estão dentro). Internas: só as próprias funções.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'fis\_%' and p.prorettype <> 'trigger'::regtype loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname in ('fis_periodo_garantir', 'fis_mov_inserir', 'fis_registrar_decisao', 'fis_docs_do_alvo', 'fis_apuracao_chave',
                     'fis_periodo_obter', 'fis_alvo_empresa', 'fis_saldo_minimo_apos', 'fis_vencimento_pela_regra') then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
