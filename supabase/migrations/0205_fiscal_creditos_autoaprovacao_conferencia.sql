-- Fiscal > Créditos tributários: a chave fiscal.creditos.permitir_autoaprovacao (0204) passa a valer também para a conferência
-- da obrigação ("Entregue e conferida"). Ligada, o Administrador confere a transmissão que ele mesmo registrou, com justificativa
-- (mín. 10 caracteres) gravada como "[autoaprovação] ..." na decisão e no evento. Corpo igual ao da 0202, salvo esse trecho.

create or replace function fis_obrigacao_status(p_id uuid, p_para fis_status_obrigacao, p jsonb default '{}'::jsonb) returns void
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
    if fis_autoaprovacao(o.transmitida_por, v_obs, 'A conferência deve ser feita por outra pessoa (quem registrou a transmissão não confere).') then
      v_obs := '[autoaprovação] ' || v_obs;
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
