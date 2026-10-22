-- Fiscal > Créditos tributários: exceção à segregação de funções ("quem lança não valida/aprova").
-- Chave fiscal.creditos.permitir_autoaprovacao (começa desligada). Ligada, só o Administrador do módulo pode validar o crédito
-- ou aprovar/rejeitar o lançamento que ele mesmo registrou, com justificativa obrigatória gravada como "[autoaprovação] ...".

insert into configuracoes (chave, valor, descricao) values
  ('fiscal.creditos.permitir_autoaprovacao', 'false',
   'Fiscal > Créditos: true permite ao Administrador validar/aprovar o que ele mesmo lançou (com justificativa). Desligar quando houver outro aprovador.')
on conflict (chave) do nothing;

-- Devolve true quando é autoaprovação permitida; false quando o usuário não é o autor; erro quando é o autor sem a exceção.
create function fis_autoaprovacao(p_autor uuid, p_justificativa text, p_erro text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or p_autor is distinct from auth.uid() then return false; end if;
  if coalesce((select valor from configuracoes where chave = 'fiscal.creditos.permitir_autoaprovacao'), 'false'::jsonb) <> 'true'::jsonb
     or fis_papel_atual() is distinct from 'administrador' then
    raise exception '%', p_erro;
  end if;
  if length(coalesce(trim(p_justificativa), '')) < 10 then
    raise exception 'Autoaprovação: justifique a decisão (mínimo 10 caracteres).';
  end if;
  return true;
end $$;
revoke all on function fis_autoaprovacao(uuid, text, text) from public, anon, authenticated;

-- Validação pelo responsável (revisor/contador/admin), nunca por quem lançou. Validar exige processo e documentos exigidos.
-- Valor reconhecido menor que o original gera um ajuste negativo (glosa) no razão.
create or replace function fis_credito_validar(p_id uuid, p_decisao fis_validacao, p_valor_reconhecido numeric, p_justificativa text) returns void
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
  if fis_autoaprovacao(c.responsavel_lancamento, p_justificativa, 'Quem lançou o crédito não pode validá-lo (segregação de funções).') then
    p_justificativa := '[autoaprovação] ' || trim(p_justificativa);
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

-- Aprovação/rejeição de lançamento pendente (revisor/contador/admin, nunca quem lançou). Transferência: as duas pernas.
create or replace function fis_movimento_decidir(p_id uuid, p_aprovar boolean, p_motivo text) returns void
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
  if fis_autoaprovacao(m.registrado_por, p_motivo, 'Quem registrou o lançamento não pode aprová-lo nem rejeitá-lo (segregação de funções).') then
    p_motivo := '[autoaprovação] ' || trim(p_motivo);
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
