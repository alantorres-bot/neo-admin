-- =========================================================
-- Neo Admin — 0503 RH/SST > Vale-transporte: contas a pagar no Consistem (Fase C)
-- Um título por colaborador no mês APROVADO (fornecedor = "Nº" do VT, valor do mês, vencimento = dia do pagamento).
-- Mesmo desenho do livro do Cartão (0137/0138): o painel monta e confere o título, a reserva grava o payload (imutável) e a
-- Edge Function rh-vt-lancar-no-consistem envia uma vez só. Especificação: docs/modulos/rh-vale-transporte.md, regra 11.
--
-- 1) Chaves: rh.vale_transporte.lancar_no_erp (começa DESLIGADA) e rh.vale_transporte.lancamento (códigos do título).
-- 2) rh_vt_lancamentos_erp: prova do que foi enviado (nunca apagado); no máximo um ativo por item.
-- 3) Reservar (operador), iniciar/concluir/interromper (Edge Function), resolver à mão (incerto), reenviar os com erro.
-- 4) Reabrir o mês passa a recusar quando já há título no Consistem.
-- =========================================================

-- 1) Chaves ------------------------------------------------------------------------------------------------------------------
insert into configuracoes (chave, valor, descricao) values
  ('rh.vale_transporte.lancar_no_erp', 'false',
   'Vale-transporte: mostra o botão "Lançar no Consistem" no mês aprovado. Desligado = o painel só mostra os títulos.'),
  ('rh.vale_transporte.lancamento', 'null',
   'Vale-transporte: códigos do título no Consistem (codHistorico, codPortador, categoriaDoc, grupoContaFluxoCaixa, contaFluxoCaixa, contaContabilDebito, contaContabilCredito).')
on conflict (chave) do nothing;

create function rh_vt_lancar_no_erp_ligado() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select valor from configuracoes where chave = 'rh.vale_transporte.lancar_no_erp'), 'false'::jsonb) = 'true'::jsonb
$$;

create function rh_vt_codigos_lancamento() returns jsonb
language sql stable security definer set search_path = public as $$
  select valor from configuracoes where chave = 'rh.vale_transporte.lancamento'
     and crt_codigos_validos(valor,
           array['codHistorico', 'codPortador', 'categoriaDoc', 'grupoContaFluxoCaixa', 'contaFluxoCaixa', 'contaContabilDebito', 'contaContabilCredito'],
           array['codHistorico', 'codPortador', 'categoriaDoc', 'grupoContaFluxoCaixa', 'contaFluxoCaixa', 'contaContabilDebito', 'contaContabilCredito'])
$$;

-- Parâmetros (gestor do RH): códigos e chave.
create function rh_vt_salvar_parametros(p_codigos jsonb, p_ligado boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_vt_exigir('gestor');
  if p_codigos is not null and not crt_codigos_validos(p_codigos,
       array['codHistorico', 'codPortador', 'categoriaDoc', 'grupoContaFluxoCaixa', 'contaFluxoCaixa', 'contaContabilDebito', 'contaContabilCredito'],
       array['codHistorico', 'codPortador', 'categoriaDoc', 'grupoContaFluxoCaixa', 'contaFluxoCaixa', 'contaContabilDebito', 'contaContabilCredito']) then
    raise exception 'Informe todos os códigos do título (números inteiros positivos).';
  end if;
  if (p_codigos ->> 'contaContabilDebito') = (p_codigos ->> 'contaContabilCredito') then
    raise exception 'A conta contábil de débito e a de crédito não podem ser a mesma.';
  end if;
  if coalesce(p_ligado, false) and p_codigos is null then
    raise exception 'Preencha os códigos antes de ligar o lançamento no Consistem.';
  end if;
  update configuracoes set valor = coalesce(p_codigos, 'null'::jsonb) where chave = 'rh.vale_transporte.lancamento';
  update configuracoes set valor = to_jsonb(coalesce(p_ligado, false)) where chave = 'rh.vale_transporte.lancar_no_erp';
end $$;   -- a auditoria de configuracoes (gatilho do núcleo) guarda o antes e o depois
revoke all on function rh_vt_salvar_parametros(jsonb, boolean) from public, anon;

-- 2) Livro --------------------------------------------------------------------------------------------------------------------
create table rh_vt_lancamentos_erp (
  id uuid primary key default gen_random_uuid(),
  competencia_id uuid not null references rh_vt_competencias(id),
  item_id uuid not null references rh_vt_itens(id),
  lote uuid not null,
  ordem int not null,
  valor numeric(14,2) not null check (valor > 0),
  payload jsonb not null,                                  -- exatamente o que vai (foi) para a API
  situacao crt_situacao_lancamento_erp not null default 'reservado',
  cod_lancamento_erp text,
  resposta jsonb,
  erro text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  concluido_em timestamptz,
  resolvido_por uuid references perfis(id),
  motivo_resolucao text
);
comment on table rh_vt_lancamentos_erp is 'Títulos do vale-transporte lançados pelo painel no Consistem: o que foi enviado, a resposta e o código criado. Nunca apagados.';
create unique index uq_rh_vt_lanc_item_ativo on rh_vt_lancamentos_erp (item_id) where situacao in ('reservado', 'enviando', 'lancado');
create index idx_rh_vt_lanc_lote on rh_vt_lancamentos_erp (lote, ordem);
create index idx_rh_vt_lanc_comp on rh_vt_lancamentos_erp (competencia_id);

create function fn_rh_vt_lancamento_regras() returns trigger language plpgsql as $$
begin
  if (new.competencia_id, new.item_id, new.lote, new.ordem, new.valor, new.payload, new.criado_por, new.criado_em)
     is distinct from (old.competencia_id, old.item_id, old.lote, old.ordem, old.valor, old.payload, old.criado_por, old.criado_em) then
    raise exception 'O lançamento enviado ao Consistem é imutável.';
  end if;
  if new.situacao <> old.situacao and not (
       (old.situacao = 'reservado' and new.situacao in ('enviando', 'erro')) or
       (old.situacao = 'enviando' and new.situacao in ('lancado', 'erro'))) then
    raise exception 'Mudança de situação inválida: % → %.', old.situacao, new.situacao;
  end if;
  if old.situacao in ('lancado', 'erro') then
    raise exception 'Este lançamento já foi concluído (%).', old.situacao;
  end if;
  if new.situacao = 'lancado' and coalesce(trim(new.cod_lancamento_erp), '') = '' then
    raise exception 'Lançado exige o código do lançamento no Consistem.';
  end if;
  return new;
end $$;
create trigger trg_rh_vt_lanc_regras before update on rh_vt_lancamentos_erp for each row execute function fn_rh_vt_lancamento_regras();
create trigger trg_rh_vt_lanc_sem_delete before delete on rh_vt_lancamentos_erp for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_vt_lanc after insert or update on rh_vt_lancamentos_erp for each row execute function fn_auditoria();

alter table rh_vt_lancamentos_erp enable row level security;
create policy rh_vt_lanc_ler on rh_vt_lancamentos_erp for select to authenticated using (tem_acesso_area('rh'));

-- 3) Reservar: p_titulos = [{item_id, payload}] montados pelo painel (lib/modulos/rh/vale-transporte/lancamento.ts).
-- Confere cada um contra o item (mês aprovado, valor, fornecedor, vencimento, códigos dos parâmetros) e grava num lote.
create function rh_vt_reservar_lancamentos(p_competencia uuid, p_titulos jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
  v_lote uuid := gen_random_uuid();
  v_codigos jsonb := rh_vt_codigos_lancamento();
  v_ordem int := 0;
  t jsonb;
  i rh_vt_itens;
  k text;
begin
  perform rh_vt_exigir('operador');
  if not rh_vt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (RH > Vale-transporte > Parâmetros).';
  end if;
  if v_codigos is null then raise exception 'Faltam os códigos do título nos Parâmetros.'; end if;
  c := rh_vt_competencia_para(p_competencia, array['aprovada', 'paga']);
  if p_titulos is null or jsonb_typeof(p_titulos) <> 'array' or jsonb_array_length(p_titulos) = 0 then
    raise exception 'Nenhum título para lançar.';
  end if;
  for t in select * from jsonb_array_elements(p_titulos) loop
    select * into i from rh_vt_itens where id = (t ->> 'item_id')::uuid and competencia_id = p_competencia;
    if i.id is null then raise exception 'Linha que não pertence a este mês; recarregue a página.'; end if;
    if i.valor <= 0 then raise exception 'O VT de % é zero: não vira título.', i.nome; end if;
    if exists (select 1 from rh_vt_lancamentos_erp where item_id = i.id and situacao in ('reservado', 'enviando', 'lancado')) then
      raise exception 'O título de % já foi lançado (ou está em envio).', i.nome;
    end if;
    if (t #>> '{payload,codFornecedor}')::text <> i.cod_fornecedor
       or (t #>> '{payload,valorDocumento}')::numeric <> i.valor
       or (t #>> '{payload,dataVencimento}') <> c.data_pagamento::text then
      raise exception 'O título de % não confere com o mês (fornecedor, valor ou vencimento); recarregue a página.', i.nome;
    end if;
    foreach k in array array['codHistorico', 'codPortador', 'categoriaDoc', 'grupoContaFluxoCaixa', 'contaFluxoCaixa'] loop
      if (t -> 'payload' -> k) is distinct from (v_codigos -> k) then
        raise exception 'Os códigos do título mudaram nos Parâmetros; recarregue a página.';
      end if;
    end loop;
    if (t #> '{payload,dadosContabilidade,contaContabilDebito}') is distinct from (v_codigos -> 'contaContabilDebito')
       or (t #> '{payload,dadosContabilidade,contaContabilCredito}') is distinct from (v_codigos -> 'contaContabilCredito') then
      raise exception 'Os códigos do título mudaram nos Parâmetros; recarregue a página.';
    end if;
    v_ordem := v_ordem + 1;
    insert into rh_vt_lancamentos_erp (competencia_id, item_id, lote, ordem, valor, payload)
    values (p_competencia, i.id, v_lote, v_ordem, i.valor, t -> 'payload');
  end loop;
  return v_lote;
end $$;
revoke all on function rh_vt_reservar_lancamentos(uuid, jsonb) from public, anon;

create function rh_vt_iniciar_envio_erp(p_id uuid) returns rh_vt_lancamentos_erp
language plpgsql security definer set search_path = public as $$
declare
  v rh_vt_lancamentos_erp;
begin
  update rh_vt_lancamentos_erp set situacao = 'enviando', enviado_em = now() where id = p_id and situacao = 'reservado' returning * into v;
  if v.id is null then raise exception 'Lançamento não encontrado ou já enviado.'; end if;
  return v;
end $$;

create function rh_vt_concluir_lancamento_erp(p_id uuid, p_cod text, p_resposta jsonb, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rh_vt_lancamentos_erp where id = p_id and situacao = 'enviando') then
    raise exception 'Lançamento não está em envio.';
  end if;
  if coalesce(trim(p_cod), '') <> '' then
    update rh_vt_lancamentos_erp set situacao = 'lancado', cod_lancamento_erp = trim(p_cod), resposta = p_resposta, erro = null, concluido_em = now() where id = p_id;
  else
    update rh_vt_lancamentos_erp set situacao = 'erro', resposta = p_resposta, erro = coalesce(nullif(trim(p_erro), ''), 'Erro sem mensagem.'), concluido_em = now()
     where id = p_id;
  end if;
end $$;

create function rh_vt_interromper_lote(p_lote uuid, p_motivo text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  update rh_vt_lancamentos_erp set situacao = 'erro', erro = p_motivo, concluido_em = now() where lote = p_lote and situacao = 'reservado';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function rh_vt_iniciar_envio_erp(uuid) from public, anon, authenticated;
revoke all on function rh_vt_concluir_lancamento_erp(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function rh_vt_interromper_lote(uuid, text) from public, anon, authenticated;
grant execute on function rh_vt_iniciar_envio_erp(uuid) to service_role;
grant execute on function rh_vt_concluir_lancamento_erp(uuid, text, jsonb, text) to service_role;
grant execute on function rh_vt_interromper_lote(uuid, text) to service_role;

-- Resposta incerta (ficou "enviando"): o operador confere no Consistem e informa o código, ou que não foi criado.
create function rh_vt_resolver_lancamento(p_id uuid, p_cod text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v rh_vt_lancamentos_erp;
begin
  perform rh_vt_exigir('operador');
  if coalesce(length(trim(p_motivo)), 0) < 3 then raise exception 'Informe o que foi conferido no Consistem.'; end if;
  select * into v from rh_vt_lancamentos_erp where id = p_id for update;
  if v.id is null or v.situacao not in ('reservado', 'enviando') then
    raise exception 'Só um lançamento sem resposta (reservado ou enviando) pode ser resolvido à mão.';
  end if;
  if coalesce(trim(p_cod), '') <> '' then
    if trim(p_cod) !~ '^\d{1,12}$' then raise exception 'Informe o código do lançamento no Consistem (só números).'; end if;
    if v.situacao = 'reservado' then update rh_vt_lancamentos_erp set situacao = 'enviando' where id = p_id; end if;
    update rh_vt_lancamentos_erp set situacao = 'lancado', cod_lancamento_erp = trim(p_cod), concluido_em = now(),
           resolvido_por = auth.uid(), motivo_resolucao = trim(p_motivo) where id = p_id;
  else
    update rh_vt_lancamentos_erp set situacao = 'erro', erro = 'Não foi criado no Consistem (conferido à mão).', concluido_em = now(),
           resolvido_por = auth.uid(), motivo_resolucao = trim(p_motivo) where id = p_id;
  end if;
end $$;
revoke all on function rh_vt_resolver_lancamento(uuid, text, text) from public, anon;

-- 4) Reabrir: recusa se já há título no Consistem (cancele lá e resolva aqui antes) ----------------------------------------------
create or replace function rh_vt_reabrir(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
  v_n int;
begin
  perform rh_vt_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo para reabrir.'; end if;
  c := rh_vt_competencia_para(p_id, array['enviada', 'aprovada', 'paga']);
  select count(*) into v_n from rh_vt_lancamentos_erp where competencia_id = p_id and situacao in ('reservado', 'enviando', 'lancado');
  if v_n > 0 then
    raise exception 'Este mês já tem % título(s) no Consistem (ou em envio). Reabrir mudaria valores já lançados: acerte no Consistem primeiro.', v_n;
  end if;
  update rh_vt_competencias set status = 'aberta', reaberta_por = auth.uid(), reaberta_em = now(), reaberta_motivo = trim(p_motivo),
         arquivo_bb_gerado_por = null, arquivo_bb_gerado_em = null, paga_por = null, paga_em = null where id = p_id;
  perform rh_vt_encerrar_pendencia('Aprovar VT de ' || rh_vt_rotulo_mes(c.competencia), 'cancelada');
  perform rh_vt_encerrar_pendencia('Pagar VT de ' || rh_vt_rotulo_mes(c.competencia), 'cancelada');
  perform rh_vt_abrir_pendencia(p_id, 'Fechar VT de ' || rh_vt_rotulo_mes(c.competencia), 'Reaberto: ' || trim(p_motivo), c.prazo_fechamento);
end $$;
