-- =========================================================
-- Neo Admin — 0521 RH/SST: contas a pagar no Consistem por tipo de pagamento (folha F4 — funcionários; VT)
-- Ao fechar a folha (e o VT) o operador clica e a API do Consistem cria os títulos. Decisões de 22/10/2026
-- (docs/modulos/rh-folha.md, regra 10; docs/modulos/rh-vale-transporte.md, regra 11):
--   - um título por funcionário × tipo: vt, salario, ferias, decimo_1, decimo_2, avulso;
--   - histórico, fluxo e contas contábeis por TIPO; categoria única (a do fornecedor-funcionário);
--   - portador pela conta que paga: tabela empregador × forma (fopag | pix), a mesma para folha e VT;
--   - forma de pagamento passa a ser só fopag | pix (a conta pagadora sai da tabela). Meses já fechados ficam como foram gravados.
--
-- 1) Parâmetros: configuracoes 'rh.lancamento' = {categoriaDoc, tipos: {<tipo>: códigos}, portadores: [{empregador, forma, codPortador, conta}]}
--    e a chave 'rh.folha.lancar_no_erp' (começa DESLIGADA). Os códigos do VT (0503) viram o tipo "vt"; os portadores começam vazios.
-- 2) Forma de pagamento fopag | pix (cadastro e meses abertos convertidos).
-- 3) VT: a reserva confere contra os parâmetros novos.
-- 4) Folha: livro rh_fp_lancamentos_erp (igual ao do VT, com o tipo), reserva, envio, resolver; reabrir recusa com título.
-- =========================================================

-- 1) Parâmetros ---------------------------------------------------------------------------------------------------------------
insert into configuracoes (chave, valor, descricao) values
  ('rh.lancamento',
   jsonb_build_object(
     'categoriaDoc', (select valor -> 'categoriaDoc' from configuracoes where chave = 'rh.vale_transporte.lancamento' and jsonb_typeof(valor) = 'object'),
     'tipos', coalesce((select jsonb_build_object('vt', valor - 'codPortador' - 'categoriaDoc') from configuracoes
                         where chave = 'rh.vale_transporte.lancamento' and jsonb_typeof(valor) = 'object'), '{}'::jsonb),
     'portadores', '[]'::jsonb),
   'RH (folha e VT): códigos dos títulos no Consistem. categoriaDoc única; tipos = {vt|salario|ferias|decimo_1|decimo_2|avulso: '
   || 'codHistorico, grupoContaFluxoCaixa, contaFluxoCaixa, contaContabilDebito, contaContabilCredito}; portadores = [{empregador, forma fopag|pix, codPortador, conta}].'),
  ('rh.folha.lancar_no_erp', 'false',
   'Folha de pagamento: mostra o botão "Lançar no Consistem" no mês aprovado. Desligado = o painel só mostra os títulos.')
on conflict (chave) do nothing;
update configuracoes set descricao = 'Obsoleto desde 0521: os códigos do VT estão em rh.lancamento (tipo "vt").' where chave = 'rh.vale_transporte.lancamento';

drop function rh_vt_salvar_parametros(jsonb, boolean);
drop function rh_vt_codigos_lancamento();

-- Códigos completos de um título (tipo + portador da empregadora/forma + categoria) ou null se faltar algum.
-- Forma antiga (pix_neo_formas / pix_neo_servicos, meses fechados antes de 0521) conta como pix.
create function rh_codigos_titulo(p_tipo text, p_empregador text, p_forma text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.v -> 'tipos' -> p_tipo is not null and jsonb_typeof(p.v -> 'categoriaDoc') = 'number' and x.port is not null
              then (p.v -> 'tipos' -> p_tipo) || jsonb_build_object('categoriaDoc', p.v -> 'categoriaDoc', 'codPortador', x.port) end
    from (select valor as v from configuracoes where chave = 'rh.lancamento') p
    left join lateral (
      select e -> 'codPortador' as port from jsonb_array_elements(coalesce(p.v -> 'portadores', '[]'::jsonb)) e
       where upper(trim(e ->> 'empregador')) = upper(trim(p_empregador))
         and e ->> 'forma' = case when p_forma = 'fopag' then 'fopag' else 'pix' end
       limit 1) x on true
$$;

-- O payload montado pelo painel tem exatamente os códigos dos Parâmetros?
create function rh_payload_confere(p_payload jsonb, p_codigos jsonb) returns boolean
language sql immutable as $$
  select p_codigos is not null
     and not exists (select 1 from unnest(array['codHistorico', 'codPortador', 'categoriaDoc', 'grupoContaFluxoCaixa', 'contaFluxoCaixa']) k
                      where (p_payload -> k) is distinct from (p_codigos -> k))
     and (p_payload #> '{dadosContabilidade,contaContabilDebito}') is not distinct from (p_codigos -> 'contaContabilDebito')
     and (p_payload #> '{dadosContabilidade,contaContabilCredito}') is not distinct from (p_codigos -> 'contaContabilCredito')
$$;

-- Parâmetros (gestor do RH): códigos por tipo, categoria, portadores e as duas chaves.
create function rh_salvar_parametros_lancamento(p_parametros jsonb, p_vt_ligado boolean, p_folha_ligado boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_codigos constant text[] := array['codHistorico', 'grupoContaFluxoCaixa', 'contaFluxoCaixa', 'contaContabilDebito', 'contaContabilCredito'];
  v_cat jsonb := p_parametros -> 'categoriaDoc';
  v_tipos jsonb := coalesce(p_parametros -> 'tipos', '{}'::jsonb);
  v_port jsonb := '[]'::jsonb;
  k text; v jsonb; e jsonb;
begin
  perform rh_exigir('gestor');
  if jsonb_typeof(p_parametros) is distinct from 'object' or jsonb_typeof(v_tipos) <> 'object' then raise exception 'Parâmetros inválidos.'; end if;
  if v_cat is not null and jsonb_typeof(v_cat) = 'null' then v_cat := null; end if;
  if v_cat is not null and not crt_codigos_validos(jsonb_build_object('categoriaDoc', v_cat), array['categoriaDoc'], array['categoriaDoc']) then
    raise exception 'A categoria do documento tem de ser um número inteiro positivo.';
  end if;
  for k, v in select * from jsonb_each(v_tipos) loop
    if k <> all (array['vt', 'salario', 'ferias', 'decimo_1', 'decimo_2', 'avulso']) then raise exception 'Tipo de título desconhecido: %.', k; end if;
    if not crt_codigos_validos(v, v_codigos, v_codigos) then
      raise exception 'Preencha todos os códigos do tipo % (números inteiros positivos), ou deixe a linha vazia.', k;
    end if;
    if (v ->> 'contaContabilDebito') = (v ->> 'contaContabilCredito') then
      raise exception 'No tipo %, a conta contábil de débito e a de crédito não podem ser a mesma.', k;
    end if;
  end loop;
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
revoke all on function rh_salvar_parametros_lancamento(jsonb, boolean, boolean) from public, anon;

-- 2) Forma de pagamento: fopag | pix -----------------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select conrelid::regclass as t, conname from pg_constraint
            where contype = 'c' and conrelid in ('rh_colaboradores'::regclass, 'rh_vt_itens'::regclass, 'rh_fp_itens'::regclass)
              and pg_get_constraintdef(oid) like '%forma_pagamento%' loop
    execute format('alter table %s drop constraint %I', r.t, r.conname);
  end loop;
end $$;
update rh_colaboradores set forma_pagamento = 'pix' where forma_pagamento <> 'fopag';
update rh_vt_itens i set forma_pagamento = 'pix' from rh_vt_competencias c
 where c.id = i.competencia_id and c.status = 'aberta' and i.forma_pagamento <> 'fopag';
update rh_fp_itens i set forma_pagamento = 'pix' from rh_fp_competencias c
 where c.id = i.competencia_id and c.status = 'aberta' and i.forma_pagamento <> 'fopag';
alter table rh_colaboradores add constraint rh_colaboradores_forma_pagamento_ck check (forma_pagamento in ('fopag', 'pix'));
-- nos meses: as formas antigas ficam só no que já estava fechado; as funções do mês gravam fopag | pix
alter table rh_vt_itens add constraint rh_vt_itens_forma_pagamento_ck check (forma_pagamento in ('fopag', 'pix', 'pix_neo_formas', 'pix_neo_servicos'));
alter table rh_fp_itens add constraint rh_fp_itens_forma_pagamento_ck check (forma_pagamento in ('fopag', 'pix', 'pix_neo_formas', 'pix_neo_servicos'));

-- 3) VT: reserva confere contra rh.lancamento (tipo "vt" + portador da empregadora/forma) --------------------------------------
create or replace function rh_vt_reservar_lancamentos(p_competencia uuid, p_titulos jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
  v_lote uuid := gen_random_uuid();
  v_ordem int := 0;
  v_codigos jsonb;
  t jsonb;
  i rh_vt_itens;
begin
  perform rh_vt_exigir('operador');
  if not rh_vt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (RH > Vale-transporte > Parâmetros).';
  end if;
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
    v_codigos := rh_codigos_titulo('vt', i.empregador, i.forma_pagamento);
    if v_codigos is null then
      raise exception 'Faltam nos Parâmetros os códigos do VT ou o portador de % (%).', i.empregador, case when i.forma_pagamento = 'fopag' then 'FOPAG' else 'PIX' end;
    end if;
    if not rh_payload_confere(t -> 'payload', v_codigos) then
      raise exception 'Os códigos do título mudaram nos Parâmetros; recarregue a página.';
    end if;
    v_ordem := v_ordem + 1;
    insert into rh_vt_lancamentos_erp (competencia_id, item_id, lote, ordem, valor, payload)
    values (p_competencia, i.id, v_lote, v_ordem, i.valor, t -> 'payload');
  end loop;
  return v_lote;
end $$;

-- 4) Folha: livro, reserva e envio (mesmo desenho do VT, 0503) -----------------------------------------------------------------
create function rh_fp_lancar_no_erp_ligado() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select valor from configuracoes where chave = 'rh.folha.lancar_no_erp'), 'false'::jsonb) = 'true'::jsonb
$$;

create table rh_fp_lancamentos_erp (
  id uuid primary key default gen_random_uuid(),
  competencia_id uuid not null references rh_fp_competencias(id),
  item_id uuid not null references rh_fp_itens(id),
  tipo text not null check (tipo in ('salario', 'ferias', 'decimo_1', 'decimo_2', 'avulso')),
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
comment on table rh_fp_lancamentos_erp is 'Títulos da folha lançados pelo painel no Consistem (um por pessoa × tipo): o que foi enviado, a resposta e o código criado. Nunca apagados.';
create unique index uq_rh_fp_lanc_item_tipo_ativo on rh_fp_lancamentos_erp (item_id, tipo) where situacao in ('reservado', 'enviando', 'lancado');
create index idx_rh_fp_lanc_lote on rh_fp_lancamentos_erp (lote, ordem);
create index idx_rh_fp_lanc_comp on rh_fp_lancamentos_erp (competencia_id);

create function fn_rh_fp_lancamento_regras() returns trigger language plpgsql as $$
begin
  if (new.competencia_id, new.item_id, new.tipo, new.lote, new.ordem, new.valor, new.payload, new.criado_por, new.criado_em)
     is distinct from (old.competencia_id, old.item_id, old.tipo, old.lote, old.ordem, old.valor, old.payload, old.criado_por, old.criado_em) then
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
create trigger trg_rh_fp_lanc_regras before update on rh_fp_lancamentos_erp for each row execute function fn_rh_fp_lancamento_regras();
create trigger trg_rh_fp_lanc_sem_delete before delete on rh_fp_lancamentos_erp for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_fp_lanc after insert or update on rh_fp_lancamentos_erp for each row execute function fn_auditoria();

alter table rh_fp_lancamentos_erp enable row level security;
create policy rh_fp_lanc_ler on rh_fp_lancamentos_erp for select to authenticated using (tem_acesso_area('rh'));

-- Reservar: p_titulos = [{item_id, tipo, payload}] montados pelo painel (lib/modulos/rh/folha/lancamento.ts).
-- Valor do tipo: salario = líquido, ferias = férias/acréscimos, decimo_1/decimo_2 = 13º (2ª parcela só na folha de dezembro), avulso.
create function rh_fp_reservar_lancamentos(p_competencia uuid, p_titulos jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_lote uuid := gen_random_uuid();
  v_ordem int := 0;
  v_tipo text;
  v_valor numeric;
  v_codigos jsonb;
  t jsonb;
  i rh_fp_itens;
begin
  perform rh_exigir('operador');
  if not rh_fp_lancar_no_erp_ligado() then
    raise exception 'O lançamento da folha no Consistem está desligado (RH > Folha de pagamento > Parâmetros).';
  end if;
  c := rh_fp_competencia_para(p_competencia, array['aprovada', 'paga']);
  if p_titulos is null or jsonb_typeof(p_titulos) <> 'array' or jsonb_array_length(p_titulos) = 0 then
    raise exception 'Nenhum título para lançar.';
  end if;
  for t in select * from jsonb_array_elements(p_titulos) loop
    select * into i from rh_fp_itens where id = (t ->> 'item_id')::uuid and competencia_id = p_competencia;
    if i.id is null then raise exception 'Linha que não pertence a este mês; recarregue a página.'; end if;
    v_tipo := t ->> 'tipo';
    v_valor := case v_tipo
      when 'salario' then i.liquido
      when 'ferias' then i.ferias_acrescimos
      when 'avulso' then i.avulso
      when 'decimo_1' then case when extract(month from c.competencia) <> 12 then i.decimo_terceiro end
      when 'decimo_2' then case when extract(month from c.competencia) = 12 then i.decimo_terceiro end
    end;
    if v_valor is null then raise exception 'Tipo de título inválido para %; recarregue a página.', i.nome; end if;
    if v_valor <= 0 then raise exception 'O valor de % (%) é zero: não vira título.', i.nome, v_tipo; end if;
    if exists (select 1 from rh_fp_lancamentos_erp where item_id = i.id and tipo = v_tipo and situacao in ('reservado', 'enviando', 'lancado')) then
      raise exception 'O título de % (%) já foi lançado (ou está em envio).', i.nome, v_tipo;
    end if;
    if (t #>> '{payload,codFornecedor}')::text <> i.cod_fornecedor
       or (t #>> '{payload,valorDocumento}')::numeric <> v_valor
       or (t #>> '{payload,dataVencimento}') <> c.data_pagamento::text then
      raise exception 'O título de % não confere com o mês (fornecedor, valor ou vencimento); recarregue a página.', i.nome;
    end if;
    v_codigos := rh_codigos_titulo(v_tipo, i.empregador, i.forma_pagamento);
    if v_codigos is null then
      raise exception 'Faltam nos Parâmetros os códigos de % ou o portador de % (%).', v_tipo, i.empregador, case when i.forma_pagamento = 'fopag' then 'FOPAG' else 'PIX' end;
    end if;
    if not rh_payload_confere(t -> 'payload', v_codigos) then
      raise exception 'Os códigos do título mudaram nos Parâmetros; recarregue a página.';
    end if;
    v_ordem := v_ordem + 1;
    insert into rh_fp_lancamentos_erp (competencia_id, item_id, tipo, lote, ordem, valor, payload)
    values (p_competencia, i.id, v_tipo, v_lote, v_ordem, v_valor, t -> 'payload');
  end loop;
  return v_lote;
end $$;
revoke all on function rh_fp_reservar_lancamentos(uuid, jsonb) from public, anon;

create function rh_fp_iniciar_envio_erp(p_id uuid) returns rh_fp_lancamentos_erp
language plpgsql security definer set search_path = public as $$
declare
  v rh_fp_lancamentos_erp;
begin
  update rh_fp_lancamentos_erp set situacao = 'enviando', enviado_em = now() where id = p_id and situacao = 'reservado' returning * into v;
  if v.id is null then raise exception 'Lançamento não encontrado ou já enviado.'; end if;
  return v;
end $$;

create function rh_fp_concluir_lancamento_erp(p_id uuid, p_cod text, p_resposta jsonb, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rh_fp_lancamentos_erp where id = p_id and situacao = 'enviando') then
    raise exception 'Lançamento não está em envio.';
  end if;
  if coalesce(trim(p_cod), '') <> '' then
    update rh_fp_lancamentos_erp set situacao = 'lancado', cod_lancamento_erp = trim(p_cod), resposta = p_resposta, erro = null, concluido_em = now() where id = p_id;
  else
    update rh_fp_lancamentos_erp set situacao = 'erro', resposta = p_resposta, erro = coalesce(nullif(trim(p_erro), ''), 'Erro sem mensagem.'), concluido_em = now()
     where id = p_id;
  end if;
end $$;

create function rh_fp_interromper_lote(p_lote uuid, p_motivo text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  update rh_fp_lancamentos_erp set situacao = 'erro', erro = p_motivo, concluido_em = now() where lote = p_lote and situacao = 'reservado';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function rh_fp_iniciar_envio_erp(uuid) from public, anon, authenticated;
revoke all on function rh_fp_concluir_lancamento_erp(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function rh_fp_interromper_lote(uuid, text) from public, anon, authenticated;
grant execute on function rh_fp_iniciar_envio_erp(uuid) to service_role;
grant execute on function rh_fp_concluir_lancamento_erp(uuid, text, jsonb, text) to service_role;
grant execute on function rh_fp_interromper_lote(uuid, text) to service_role;

-- Resposta incerta (ficou "enviando"): o operador confere no Consistem e informa o código, ou que não foi criado.
create function rh_fp_resolver_lancamento(p_id uuid, p_cod text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v rh_fp_lancamentos_erp;
begin
  perform rh_exigir('operador');
  if coalesce(length(trim(p_motivo)), 0) < 3 then raise exception 'Informe o que foi conferido no Consistem.'; end if;
  select * into v from rh_fp_lancamentos_erp where id = p_id for update;
  if v.id is null or v.situacao not in ('reservado', 'enviando') then
    raise exception 'Só um lançamento sem resposta (reservado ou enviando) pode ser resolvido à mão.';
  end if;
  if coalesce(trim(p_cod), '') <> '' then
    if trim(p_cod) !~ '^\d{1,12}$' then raise exception 'Informe o código do lançamento no Consistem (só números).'; end if;
    if v.situacao = 'reservado' then update rh_fp_lancamentos_erp set situacao = 'enviando' where id = p_id; end if;
    update rh_fp_lancamentos_erp set situacao = 'lancado', cod_lancamento_erp = trim(p_cod), concluido_em = now(),
           resolvido_por = auth.uid(), motivo_resolucao = trim(p_motivo) where id = p_id;
  else
    update rh_fp_lancamentos_erp set situacao = 'erro', erro = 'Não foi criado no Consistem (conferido à mão).', concluido_em = now(),
           resolvido_por = auth.uid(), motivo_resolucao = trim(p_motivo) where id = p_id;
  end if;
end $$;
revoke all on function rh_fp_resolver_lancamento(uuid, text, text) from public, anon;

-- Reabrir: recusa se já há título no Consistem (cancele lá e resolva aqui antes).
create or replace function rh_fp_reabrir(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_n int;
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo para reabrir.'; end if;
  c := rh_fp_competencia_para(p_id, array['conferida', 'aprovada', 'paga']);
  select count(*) into v_n from rh_fp_lancamentos_erp where competencia_id = p_id and situacao in ('reservado', 'enviando', 'lancado');
  if v_n > 0 then
    raise exception 'Esta folha já tem % título(s) no Consistem (ou em envio). Reabrir mudaria valores já lançados: acerte no Consistem primeiro.', v_n;
  end if;
  update rh_fp_competencias set status = 'aberta', reaberta_por = auth.uid(), reaberta_em = now(), reaberta_motivo = trim(p_motivo),
         arquivo_bb_gerado_por = null, arquivo_bb_gerado_em = null, paga_por = null, paga_em = null where id = p_id;
  perform rh_fp_encerrar_pendencia('Aprovar folha de ' || rh_vt_rotulo_mes(c.competencia), 'cancelada');
  perform rh_fp_encerrar_pendencia('Pagar folha de ' || rh_vt_rotulo_mes(c.competencia), 'cancelada');
  perform rh_fp_abrir_pendencia(p_id, 'Fechar folha de ' || rh_vt_rotulo_mes(c.competencia), 'Reaberta: ' || trim(p_motivo), c.data_pagamento);
end $$;
