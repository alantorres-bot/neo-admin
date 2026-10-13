-- =========================================================
-- Neo Admin — 0137 Cartão de crédito: lançar no Consistem os encargos da fatura (botão com conferência)
-- Especificação: docs/modulos/financeiro-cartao.md (seção 5, regras 31 a 36).
--
-- Até aqui o Neo Admin só LIA o Consistem. Esta é a primeira (e única) escrita: o título com a SOMA dos encargos do mês
-- (IOF, juros, multa, anuidade, tarifa...) contra o banco emissor, pela operação "Gerar um Lançamento de Contas a Pagar"
-- (PUT financeiro/v10/lancamentoContasPagar). Decisões do Alan (12/10/2026):
--   - um título com a soma; botão com conferência (nada sai sozinho); gestor e operador podem lançar;
--   - códigos do Consistem iguais aos dos lançamentos manuais desde jun/2026 (histórico 2, portador 91, categoria 17,
--     grupo de fluxo 22 / conta 28, contábil débito 3473 / crédito 2004; fornecedor = o banco emissor);
--   - emissão e entrada na data de fechamento da fatura; documento = dia e mês do fechamento (DDMM).
-- Fluxo: o painel recalcula a conciliação, monta o título e RESERVA aqui (crt_reservar_lancamento_encargos); a Edge Function
-- crt-lancar-encargos (service role + token do Consistem) marca "enviando", envia e conclui (lançado, com o código, ou erro).
-- Resposta incerta (queda de rede, tempo esgotado) fica "enviando": uma pessoa confere no Consistem e resolve (com o código
-- do lançamento, ou "não foi criado"). Um mês tem no máximo um lançamento de encargos ativo: clique duplo não duplica título.
-- Lançado: grava a decisão "casar" das linhas com o título novo, e a conciliação já trata as linhas como conciliadas.
-- Nada é apagado (prova): erro e resolução ficam registrados.
-- =========================================================

-- 1) Códigos do Consistem por cartão (editáveis pelo gestor na aba Cartões) ---------------------------------------------
create function crt_config_encargos_valida(j jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object' and (
    select bool_and(coalesce(jsonb_typeof(j -> k) = 'number' and (j ->> k)::numeric > 0 and (j ->> k)::numeric = trunc((j ->> k)::numeric), false))
      from unnest(array['codFornecedor', 'codHistorico', 'codPortador', 'categoriaDoc', 'grupoContaFluxoCaixa', 'contaFluxoCaixa',
                        'contaContabilDebito', 'contaContabilCredito']) k)
$$;

alter table crt_cartoes add column lancamento_encargos jsonb
  constraint crt_cartoes_lancamento_encargos_ck check (lancamento_encargos is null or crt_config_encargos_valida(lancamento_encargos));
comment on column crt_cartoes.lancamento_encargos is 'Códigos do Consistem do título de encargos do cartão: codFornecedor (banco emissor), codHistorico, codPortador, categoriaDoc, grupoContaFluxoCaixa, contaFluxoCaixa, contaContabilDebito, contaContabilCredito. Nulo = o cartão não lança encargos pelo painel.';

update crt_cartoes c
   set lancamento_encargos = jsonb_build_object(
         'codFornecedor', v.fornecedor, 'codHistorico', 2, 'codPortador', 91, 'categoriaDoc', 17,
         'grupoContaFluxoCaixa', 22, 'contaFluxoCaixa', 28, 'contaContabilDebito', 3473, 'contaContabilCredito', 2004)
  from (values ('INTER PF', 76), ('INTER PJ', 76), ('ITAU PJ', 276), ('NUBANK PF', 360), ('PICPAY PF', 391),
               ('SICREDI PF', 80), ('SICREDI PJ', 80), ('UNICRED PF', 607)) v(cartao, fornecedor)
 where c.codigo = v.cartao;

-- 2) Chave geral (começa desligada: o primeiro envio real é acompanhado) ------------------------------------------------
insert into configuracoes (chave, valor, descricao) values
  ('financeiro.cartao.lancar_encargos_no_erp', 'false',
   'Cartão de crédito: mostra o botão "Lançar no Consistem" dos encargos da fatura. Desligado = o painel só calcula e mostra o título.')
on conflict (chave) do nothing;

-- 3) Lançamentos feitos no Consistem (prova) -------------------------------------------------------------------------------
create type crt_situacao_lancamento_erp as enum ('reservado', 'enviando', 'lancado', 'erro');

create table crt_lancamentos_erp (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references crt_faturas(id),
  ciclo_id uuid not null references crt_ciclos(id),
  linhas uuid[] not null,                                  -- crt_fatura_linhas.id somadas no título
  valor numeric(14,2) not null check (valor > 0),
  complemento text not null,
  payload jsonb not null,                                  -- exatamente o que vai (foi) para a API
  situacao crt_situacao_lancamento_erp not null default 'reservado',
  cod_lancamento_erp text,                                 -- codLancamento criado no Consistem
  resposta jsonb,                                          -- resposta da API (sucesso ou erro)
  erro text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  concluido_em timestamptz,
  resolvido_por uuid references perfis(id),                -- quem resolveu à mão uma resposta incerta
  motivo_resolucao text
);
comment on table crt_lancamentos_erp is 'Títulos lançados pelo painel no Consistem (encargos da fatura do cartão): o que foi enviado, a resposta e o código criado. Nunca apagados.';
create unique index uq_crt_lancamentos_erp_ciclo_ativo on crt_lancamentos_erp (ciclo_id) where situacao in ('reservado', 'enviando', 'lancado');
create index idx_crt_lancamentos_erp_fatura on crt_lancamentos_erp (fatura_id);

create function fn_crt_lancamento_erp_regras() returns trigger language plpgsql as $$
begin
  if (new.fatura_id, new.ciclo_id, new.linhas, new.valor, new.complemento, new.payload, new.criado_por, new.criado_em)
     is distinct from (old.fatura_id, old.ciclo_id, old.linhas, old.valor, old.complemento, old.payload, old.criado_por, old.criado_em) then
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
create trigger trg_crt_lancamentos_erp_regras before update on crt_lancamentos_erp for each row execute function fn_crt_lancamento_erp_regras();
create trigger trg_crt_lancamentos_erp_sem_delete before delete on crt_lancamentos_erp for each row execute function fn_bloquear_delete();
create trigger trg_aud_crt_lancamentos_erp after insert or update on crt_lancamentos_erp for each row execute function fn_auditoria();

alter table crt_lancamentos_erp enable row level security;
create policy crt_lancamentos_erp_ler on crt_lancamentos_erp for select to authenticated using (tem_acesso_area('financeiro'));

create view crt_vw_lancamentos_erp with (security_invoker = true) as
select l.*, pc.nome as criado_por_nome, pr.nome as resolvido_por_nome
  from crt_lancamentos_erp l
  left join perfis pc on pc.id = l.criado_por
  left join perfis pr on pr.id = l.resolvido_por;

-- 4) Marcar como lançado: situação + decisão "casar" das linhas com o título criado (uso interno) ------------------------
create function crt_marcar_encargos_lancados(p_id uuid, p_cod text, p_resposta jsonb, p_usuario uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_lancamentos_erp;
  v_cod text := trim(p_cod);
begin
  select * into v from crt_lancamentos_erp where id = p_id for update;
  update crt_lancamentos_erp
     set situacao = 'lancado', cod_lancamento_erp = v_cod, resposta = coalesce(p_resposta, resposta), concluido_em = now(), erro = null,
         resolvido_por = case when p_motivo is null then resolvido_por else p_usuario end, motivo_resolucao = coalesce(p_motivo, motivo_resolucao)
   where id = p_id;
  insert into crt_decisoes (fatura_id, tipo, linhas, titulos, motivo, criado_por)
  values (v.fatura_id, 'casar', v.linhas, array[v_cod],
          'Encargos do mês lançados no Consistem pelo Neo Admin: lançamento ' || v_cod || ' (R$ ' || translate(to_char(v.valor, 'FM999,999,990.00'), ',.', '.,') || ')',
          coalesce(p_usuario, v.criado_por));
end $$;
revoke all on function crt_marcar_encargos_lancados(uuid, text, jsonb, uuid, text) from public, anon, authenticated;

-- 5) Reservar (painel; operador ou acima) ----------------------------------------------------------------------------------
create function crt_reservar_lancamento_encargos(p_fatura uuid, p_linhas uuid[], p_valor numeric, p_complemento text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fatura crt_faturas;
  v_situacao crt_situacao_ciclo;
  v_linhas uuid[] := coalesce((select array_agg(distinct x) from unnest(p_linhas) x), '{}');
  v_validas int;
  v_soma numeric;
  v_conflito text;
  v_ativo text;
  v_id uuid;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) lança encargos no Consistem.';
  end if;
  if coalesce((select valor from configuracoes where chave = 'financeiro.cartao.lancar_encargos_no_erp'), 'false'::jsonb) <> 'true'::jsonb then
    raise exception 'O lançamento de encargos no Consistem está desligado (Configurações: financeiro.cartao.lancar_encargos_no_erp).';
  end if;
  v_fatura := crt_fatura_editavel(p_fatura);
  select situacao into v_situacao from crt_ciclos where id = v_fatura.ciclo_id;
  if v_fatura.ciclo_id is null or v_situacao is distinct from 'em_conciliacao' then
    raise exception 'Só se lançam encargos de fatura de um mês em conciliação.';
  end if;
  if cardinality(v_linhas) = 0 then
    raise exception 'Nenhuma linha de encargo para lançar.';
  end if;
  select count(*), coalesce(sum(valor), 0) into v_validas, v_soma
    from crt_fatura_linhas where fatura_id = p_fatura and id = any(v_linhas) and not descartada;
  if v_validas <> cardinality(v_linhas) then
    raise exception 'Uma das linhas não é desta fatura (ou é linha descartada).';
  end if;
  if v_soma <> p_valor or p_valor <= 0 then
    raise exception 'O valor do título (R$ %) não confere com a soma das linhas (R$ %).', to_char(p_valor, 'FM999G999G990D00'), to_char(v_soma, 'FM999G999G990D00');
  end if;
  if (p_payload ->> 'valorDocumento')::numeric is distinct from p_valor or p_payload ->> 'complementoHistorico' is distinct from p_complemento then
    raise exception 'O título montado não confere com o valor e o complemento informados.';
  end if;
  select l.descricao into v_conflito
    from crt_decisoes d join crt_fatura_linhas l on l.id = any(d.linhas)
   where d.fatura_id = p_fatura and d.desfeito_em is null and d.tipo in ('justificar', 'casar', 'compensar') and l.id = any(v_linhas) limit 1;
  if v_conflito is not null then
    raise exception 'A linha % já tem decisão (justificar, casar ou compensar): desfaça-a antes de lançar.', v_conflito;
  end if;
  select coalesce(cod_lancamento_erp, situacao::text) into v_ativo
    from crt_lancamentos_erp where ciclo_id = v_fatura.ciclo_id and situacao in ('reservado', 'enviando', 'lancado') limit 1;
  if v_ativo is not null then
    raise exception 'Este mês já tem lançamento de encargos no Consistem (%): confira na lista de lançamentos.', v_ativo;
  end if;
  insert into crt_lancamentos_erp (fatura_id, ciclo_id, linhas, valor, complemento, payload)
  values (p_fatura, v_fatura.ciclo_id, v_linhas, p_valor, p_complemento, p_payload)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function crt_reservar_lancamento_encargos(uuid, uuid[], numeric, text, jsonb) from public, anon;
grant execute on function crt_reservar_lancamento_encargos(uuid, uuid[], numeric, text, jsonb) to authenticated;

-- 6) Envio (só a Edge Function, com a service role) ------------------------------------------------------------------------
-- Marca "enviando" (só a partir de "reservado": duas chamadas não enviam duas vezes) e devolve o lançamento.
create function crt_iniciar_envio_encargos(p_id uuid) returns crt_lancamentos_erp
language plpgsql security definer set search_path = public as $$
declare
  v crt_lancamentos_erp;
begin
  update crt_lancamentos_erp set situacao = 'enviando', enviado_em = now() where id = p_id and situacao = 'reservado' returning * into v;
  if v.id is null then
    raise exception 'Lançamento não encontrado ou já enviado.';
  end if;
  return v;
end $$;
revoke all on function crt_iniciar_envio_encargos(uuid) from public, anon, authenticated;
grant execute on function crt_iniciar_envio_encargos(uuid) to service_role;

-- Conclui o envio: com código = lançado (e casa as linhas); sem código = erro (o Consistem recusou; nada foi criado).
create function crt_concluir_lancamento_encargos(p_id uuid, p_cod text, p_resposta jsonb, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from crt_lancamentos_erp where id = p_id and situacao = 'enviando') then
    raise exception 'Lançamento não está em envio.';
  end if;
  if coalesce(trim(p_cod), '') <> '' then
    perform crt_marcar_encargos_lancados(p_id, p_cod, p_resposta, null, null);
  else
    update crt_lancamentos_erp set situacao = 'erro', resposta = p_resposta, erro = coalesce(nullif(trim(p_erro), ''), 'Erro sem mensagem.'), concluido_em = now()
     where id = p_id;
  end if;
end $$;
revoke all on function crt_concluir_lancamento_encargos(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function crt_concluir_lancamento_encargos(uuid, text, jsonb, text) to service_role;

-- 7) Resolver à mão uma resposta incerta (operador ou acima), depois de conferir no Consistem ---------------------------------
create function crt_resolver_lancamento_encargos(p_id uuid, p_cod text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_lancamentos_erp;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) resolve lançamentos no Consistem.';
  end if;
  if coalesce(length(trim(p_motivo)), 0) < 3 then
    raise exception 'Informe o que foi conferido no Consistem.';
  end if;
  select * into v from crt_lancamentos_erp where id = p_id for update;
  if v.id is null or v.situacao not in ('reservado', 'enviando') then
    raise exception 'Só um lançamento sem resposta (reservado ou enviando) pode ser resolvido à mão.';
  end if;
  perform crt_fatura_editavel(v.fatura_id);
  if coalesce(trim(p_cod), '') <> '' then
    if trim(p_cod) !~ '^\d{1,12}$' then
      raise exception 'Informe o código do lançamento no Consistem (só números).';
    end if;
    if v.situacao = 'reservado' then
      update crt_lancamentos_erp set situacao = 'enviando' where id = p_id;
    end if;
    perform crt_marcar_encargos_lancados(p_id, trim(p_cod), null, auth.uid(), trim(p_motivo));
  else
    update crt_lancamentos_erp set situacao = 'erro', erro = 'Não foi criado no Consistem (conferido à mão).', concluido_em = now(),
           resolvido_por = auth.uid(), motivo_resolucao = trim(p_motivo)
     where id = p_id;
  end if;
end $$;
revoke all on function crt_resolver_lancamento_encargos(uuid, text, text) from public, anon;
grant execute on function crt_resolver_lancamento_encargos(uuid, text, text) to authenticated;
