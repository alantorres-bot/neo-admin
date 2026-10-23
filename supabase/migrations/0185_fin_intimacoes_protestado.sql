-- =========================================================
-- Neo Admin — 0185 Intimações de cartório: título PROTESTADO marcado no Consistem (pedido do Alan, 23/10/2026).
-- Quando o portal do 4º Ofício informa que o título foi protestado (0183: a intimação vai para "Revisão necessária"), o
-- complemento "CARTORIO - VENC ORIGINAL …" deixa de valer. Nova ação: com o título localizado, o GESTOR aprova trocar o
-- complemento por "PROTESTADO - VENC ORIG dd/mm/aaaa" (vencimento original do título no Consistem). A Edge Function
-- fin-intimacoes-consistem lê o título, altera SÓ o complemento, lê de novo e confere. Sucesso = intimação concluída (o
-- cancelamento do protesto é tratado fora deste fluxo). Mesma chave das alterações no ERP: financeiro.intimacoes.alterar_vencimento_no_erp.
-- =========================================================

alter table fin_intimacoes add column protestado_marcado_em timestamptz;

-- 1) As alterações no ERP ganham o tipo: vencimento (intimação) ou protestado (complemento) --------------------------------
alter table fin_intimacao_vencimentos add column tipo text not null default 'vencimento' check (tipo in ('vencimento', 'protestado'));
do $$
declare
  c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'fin_intimacao_vencimentos'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%dataVencimento%' loop
    execute format('alter table fin_intimacao_vencimentos drop constraint %I', c);
  end loop;
end $$;
alter table fin_intimacao_vencimentos add constraint fin_intimacao_vencimentos_alteracao_check check (
  (tipo = 'vencimento' and alteracao ? 'dataVencimento' and alteracao - 'dataVencimento' = '{}'::jsonb) or
  (tipo = 'protestado' and alteracao ? 'complementoHistorico' and alteracao - 'complementoHistorico' = '{}'::jsonb
                       and alteracao ->> 'complementoHistorico' ~ '^PROTESTADO - VENC ORIG \d{2}/\d{2}/\d{4}$'));
comment on table fin_intimacao_vencimentos is 'Alterações feitas no Consistem pelas intimações de cartório (vencimento; complemento PROTESTADO): antes, depois, quem aprovou. Nunca apagadas.';

create or replace function fn_fin_int_vencimento_regras() returns trigger language plpgsql as $$
begin
  if (new.intimacao_id, new.empresa_id, new.cod_lancamento, new.alteracao, new.tipo, new.aprovado_por, new.criado_em)
     is distinct from (old.intimacao_id, old.empresa_id, old.cod_lancamento, old.alteracao, old.tipo, old.aprovado_por, old.criado_em) then
    raise exception 'A alteração é imutável (título, tipo, campo, quem aprovou e quando).';
  end if;
  if old.situacao in ('concluido', 'erro') then raise exception 'Esta alteração já foi concluída.'; end if;
  if new.situacao <> old.situacao and not (
       (old.situacao = 'reservado' and new.situacao in ('enviando', 'erro')) or
       (old.situacao = 'enviando' and new.situacao in ('concluido', 'erro'))) then
    raise exception 'Mudança de situação inválida: % → %.', old.situacao, new.situacao;
  end if;
  return new;
end $$;

-- Pendência com o mesmo título e texto diferente (ex.: "Título protestado" depois de localizar o título) é fechada e aberta
-- de novo com o texto atual: editar os dados de uma pendência é só do gestor da área (Central de Gestão), mudar o status não.
create or replace function fin_int_trocar_pendencia(p_id uuid, p_titulo text, p_descricao text, p_criticidade criticidade) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pendencias set status = 'concluida', concluido_em = now(), concluido_por = auth.uid()
   where modulo = 'financeiro.intimacoes' and referencia_tabela = 'fin_intimacoes' and referencia_id = p_id
     and status in ('aberta', 'em_andamento')
     and (p_titulo is null or titulo <> p_titulo or descricao is distinct from p_descricao or criticidade is distinct from p_criticidade);
  if p_titulo is not null then
    insert into pendencias (modulo, empresa_id, titulo, descricao, criticidade, referencia_tabela, referencia_id, link)
    select 'financeiro.intimacoes', i.empresa_id, p_titulo, p_descricao, p_criticidade, 'fin_intimacoes', p_id, '/financeiro/intimacoes/' || p_id
      from fin_intimacoes i
     where i.id = p_id
       and not exists (select 1 from pendencias where modulo = 'financeiro.intimacoes' and referencia_tabela = 'fin_intimacoes'
                                                  and referencia_id = p_id and titulo = p_titulo and status in ('aberta', 'em_andamento'));
  end if;
end $$;
revoke all on function fin_int_trocar_pendencia(uuid, text, text, criticidade) from public, anon, authenticated;

-- 2) Protestado em revisão: informar dados e escolher o título não o tiram da revisão --------------------------------------
create or replace function fin_int_informar_dados(p_id uuid, p_empresa uuid, p_credor_documento text, p_credor_nome text, p_numero text,
                                                  p_valor numeric, p_vencimento date, p_data_limite date, p_custas numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
  v_trocou boolean;
  v_protestado boolean;
begin
  perform fin_int_exigir('operador');
  r := fin_int_carregar(p_id, array['identificada', 'titulo_localizado', 'revisao']::fin_int_status[]);
  if p_empresa is null or not exists (select 1 from empresas where id = p_empresa and ativa) then raise exception 'Escolha a empresa devedora.'; end if;
  if p_custas is not null and p_custas <= 0 then raise exception 'As custas precisam ser maiores que zero.'; end if;
  if p_valor is not null and p_valor <= 0 then raise exception 'O valor do título precisa ser maior que zero.'; end if;
  v_protestado := r.status = 'revisao' and r.situacao_cartorio = 'protestado';
  v_trocou := (p_empresa, nullif(regexp_replace(coalesce(p_credor_documento, ''), '\D', '', 'g'), ''), nullif(trim(p_numero), ''))
              is distinct from (r.empresa_id, nullif(regexp_replace(coalesce(r.credor_documento, ''), '\D', '', 'g'), ''), r.numero_titulo);
  update fin_intimacoes
     set empresa_id = p_empresa, credor_documento = nullif(trim(p_credor_documento), ''), credor_nome = nullif(trim(p_credor_nome), ''),
         numero_titulo = nullif(trim(p_numero), ''), valor_titulo = p_valor, vencimento_titulo = p_vencimento,
         data_limite = p_data_limite, valor_custas = p_custas, dados_informados_por = auth.uid(), dados_informados_em = now(),
         cod_lancamento = case when v_trocou then null else cod_lancamento end,
         titulo = case when v_trocou then null else titulo end,
         status = case when v_protestado then 'revisao'::fin_int_status
                       when v_trocou or r.cod_lancamento is null then 'identificada'::fin_int_status else 'titulo_localizado'::fin_int_status end,
         motivo = case when r.status = 'revisao' and not v_protestado then null else motivo end
   where id = p_id;
end $$;

create or replace function fin_int_escolher_titulo(p_id uuid, p_cod text, p_titulo jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
  v_protestado boolean;
begin
  perform fin_int_exigir('operador');
  r := fin_int_carregar(p_id, array['identificada', 'titulo_localizado', 'revisao']::fin_int_status[]);
  v_protestado := r.status = 'revisao' and r.situacao_cartorio = 'protestado';
  if r.status = 'revisao' and not v_protestado then raise exception 'A intimação está em revisão: volte para a conferência antes de escolher o título.'; end if;
  if r.empresa_id is null then raise exception 'Informe a empresa devedora antes de escolher o título.'; end if;
  if coalesce(p_cod, '') !~ '^\d{1,12}$' then raise exception 'Código de lançamento inválido.'; end if;
  if jsonb_typeof(p_titulo) is distinct from 'object' then raise exception 'Título inválido.'; end if;
  begin
    update fin_intimacoes set cod_lancamento = p_cod, titulo = p_titulo, titulo_escolhido_por = auth.uid(), titulo_escolhido_em = now(),
                              status = case when v_protestado then 'revisao'::fin_int_status else 'titulo_localizado'::fin_int_status end
     where id = p_id;
  exception when unique_violation then
    raise exception 'O título % já está em outra intimação em andamento.', p_cod;
  end;
  if v_protestado then
    perform fin_int_trocar_pendencia(p_id, 'Título protestado: ' || fin_int_rotulo(r),
      'Título ' || p_cod || ' localizado. Gestor: marque como PROTESTADO no Consistem (complemento "PROTESTADO - VENC ORIG …").', 'critica');
  else
    perform fin_int_trocar_pendencia(p_id, 'Intimação de protesto: ' || fin_int_rotulo(r),
      'Título localizado. Proponha o novo vencimento (prazo da intimação) para o gestor aprovar.', 'alta');
  end if;
end $$;

-- 3) Aprovação do gestor: reserva a troca do complemento (o texto vem da prévia lida no Consistem) ------------------------
create function fin_int_aprovar_protestado(p_id uuid, p_complemento text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
  v_id uuid;
begin
  perform fin_int_exigir('gestor');
  if not fin_int_chave_ligada('financeiro.intimacoes.alterar_vencimento_no_erp') then
    raise exception 'As alterações no Consistem estão desligadas (Configurações: financeiro.intimacoes.alterar_vencimento_no_erp).';
  end if;
  r := fin_int_carregar(p_id, array['revisao']::fin_int_status[]);
  if r.situacao_cartorio is distinct from 'protestado' then raise exception 'Só se marca como protestado o título que o cartório informa como protestado.'; end if;
  if r.cod_lancamento is null then raise exception 'Localize o título no Consistem antes.'; end if;
  if coalesce(p_complemento, '') !~ '^PROTESTADO - VENC ORIG \d{2}/\d{2}/\d{4}$' then
    raise exception 'O complemento deve ser "PROTESTADO - VENC ORIG dd/mm/aaaa".';
  end if;
  begin
    insert into fin_intimacao_vencimentos (intimacao_id, empresa_id, cod_lancamento, tipo, alteracao)
    values (p_id, r.empresa_id, r.cod_lancamento, 'protestado', jsonb_build_object('complementoHistorico', p_complemento))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já há uma alteração em andamento para esta intimação.';
  end;
  return v_id;
end $$;
revoke all on function fin_int_aprovar_protestado(uuid, text) from public, anon;
grant execute on function fin_int_aprovar_protestado(uuid, text) to authenticated;

-- 4) Conclusão: vencimento → adiantamento manual (como antes); protestado → concluída ----------------------------------------
create or replace function fin_int_concluir_vencimento(p_id uuid, p_ok boolean, p_ja_estava boolean, p_antes jsonb, p_depois jsonb, p_resposta jsonb, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v fin_intimacao_vencimentos;
  r fin_intimacoes;
  v_cartorio jsonb;
begin
  if p_ok and p_depois is null then raise exception 'Sem a leitura do título depois da alteração não há conferência.'; end if;
  update fin_intimacao_vencimentos
     set situacao = case when p_ok then 'concluido'::fin_int_situacao_envio else 'erro'::fin_int_situacao_envio end,
         ja_estava = coalesce(p_ja_estava, false), antes = p_antes, depois = p_depois, resposta = p_resposta,
         erro = case when p_ok then null else coalesce(nullif(trim(p_erro), ''), 'Erro não informado.') end, concluido_em = now()
   where id = p_id and situacao in ('reservado', 'enviando')
  returning * into v;
  if v.id is null then raise exception 'A alteração não está em envio.'; end if;
  select * into r from fin_intimacoes where id = v.intimacao_id for update;
  if v.tipo = 'protestado' then
    if p_ok then
      update fin_intimacoes set status = 'concluida', protestado_marcado_em = now(),
                                motivo = 'Título ' || r.cod_lancamento || ' marcado no Consistem: "' || (v.alteracao ->> 'complementoHistorico') ||
                                         '". O cancelamento do protesto é tratado fora deste fluxo.'
       where id = r.id;
      perform fin_int_trocar_pendencia(r.id, null, null, 'normal');
    else
      -- Continua em revisão (protestado); o motivo passa a ser o erro, para quem for olhar.
      update fin_intimacoes set motivo = left('Falhou ao marcar como PROTESTADO no Consistem: ' || coalesce(nullif(trim(p_erro), ''), 'erro não informado.'), 500)
       where id = r.id;
      perform fin_int_trocar_pendencia(r.id, 'Título protestado: ' || fin_int_rotulo(r), 'Falhou ao marcar no Consistem: ' || left(coalesce(p_erro, ''), 300), 'critica');
    end if;
    return;
  end if;
  if p_ok then
    update fin_intimacoes set status = 'adiantamento_pendente', vencimento_alterado_em = now(), motivo = null where id = r.id;
    v_cartorio := (select valor -> r.cartorio from configuracoes where chave = 'financeiro.intimacoes.cartorios');
    perform fin_int_trocar_pendencia(r.id, 'Lançar adiantamento ao cartório: ' || fin_int_rotulo(r),
      'Vencimento do título ' || r.cod_lancamento || ' alterado para ' || to_char(r.nova_data_vencimento, 'DD/MM/YYYY') ||
      '. Lance À MÃO, na tela do Consistem, o adiantamento de R$ ' || translate(to_char(r.valor_custas, 'FM999,999,990.00'), ',.', '.,') || ' a ' ||
      coalesce(v_cartorio ->> 'nome', r.cartorio) || ' e confirme aqui.', 'alta');
  else
    update fin_intimacoes set status = 'revisao', motivo = left(coalesce(nullif(trim(p_erro), ''), 'Erro não informado.'), 500) where id = r.id;
    perform fin_int_trocar_pendencia(r.id, 'Revisar intimação: ' || fin_int_rotulo(r), 'A alteração do vencimento no Consistem falhou: ' || left(coalesce(p_erro, ''), 300), 'critica');
  end if;
end $$;

-- A view (i.*) ganha protestado_marcado_em.
drop view fin_int_vw_intimacoes;
create view fin_int_vw_intimacoes with (security_invoker = true) as
select i.*, e.nome_curto as empresa_nome,
       pp.nome as proposto_por_nome, pa.nome as aprovado_por_nome, pc.nome as adiantamento_confirmado_por_nome,
       (select count(*)::int from fin_intimacao_origens o where o.intimacao_id = i.id) as emails
  from fin_intimacoes i
  left join empresas e on e.id = i.empresa_id
  left join perfis pp on pp.id = i.proposto_por
  left join perfis pa on pa.id = i.aprovado_por
  left join perfis pc on pc.id = i.adiantamento_confirmado_por;
