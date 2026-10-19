-- =========================================================
-- Neo Admin — 0169 Saldos bancários e caixa disponível automático na autorização de pagamento (pedido do Alan, 19/10/2026)
-- Antes: o "Caixa disponível" da autorização era digitado à mão. Agora sai sozinho dos saldos conciliados das contas
-- bancárias da empresa, mais valores adicionais do dia (depósitos esperados, ainda sem registro), tudo gravado como prova.
-- A API do Consistem (v1.0.15) NÃO tem saldo nem conciliação: só o cadastro das contas (GET financeiro/v10/dadosBancarios),
-- que a sincronização do contas a pagar espelha em fin_contas_bancarias. O saldo conciliado do dia é registrado pelo
-- financeiro em Contas a pagar > Saldos bancários (origem 'digitado'; 'importado' e 'api' ficam reservados).
-- Prefixo fin_: tabelas do Financeiro em geral (a futura Conciliação bancária e o Fluxo de caixa vão reutilizar).
-- 1) fin_contas_bancarias + fin_sincronizar_contas (service role)        4) cap_autorizacao_caixa (composição gravada)
-- 2) fin_saldos_bancarios + fin_registrar_saldos + fin_definir_conta_caixa 5) cap_aplicar_composicao_caixa e chamadas
-- 3) fin_vw_saldo_atual                                                 6) view cap_vw_autorizacoes; 7) pendência diária
-- =========================================================

-- 1) Contas bancárias (espelho do cadastro do Consistem) --------------------
create table fin_contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  cod_conta_bancaria text not null,
  cod_banco text,
  descricao text not null,
  agencia text,
  conta text,
  conta_contabil text,
  tipo_conta smallint,                                   -- 1 = conta corrente, 2 = outras
  considera_saldo_erp boolean not null default false,    -- "Considera saldo no fluxo" no Consistem
  inativa_erp boolean not null default false,
  entra_no_caixa boolean not null default false,         -- decisão local (gestor): soma no caixa da autorização
  entra_no_caixa_alterado_por uuid references perfis(id),
  entra_no_caixa_alterado_em timestamptz,
  sincronizada_em timestamptz not null default now(),
  sumiu_em timestamptz,                                  -- não veio mais da API (não se apaga)
  criado_em timestamptz not null default now(),
  unique (empresa_id, cod_conta_bancaria)
);
comment on table fin_contas_bancarias is 'Contas bancárias de cada empresa, espelhadas do Consistem (dadosBancarios). entra_no_caixa = soma no caixa disponível da autorização de pagamento.';

create trigger trg_fin_contas_sem_delete before delete on fin_contas_bancarias for each row execute function fn_bloquear_delete();
create trigger trg_aud_fin_contas after insert or update of entra_no_caixa, sumiu_em on fin_contas_bancarias for each row execute function fn_auditoria();

alter table fin_contas_bancarias enable row level security;
create policy fin_contas_ler on fin_contas_bancarias for select to authenticated using (tem_acesso_area('financeiro'));
-- Escrita só pelas funções abaixo (security definer) e pela service role.

-- Merge da sincronização: conta nova entra com entra_no_caixa = p_contas[].entra_no_caixa (padrão calculado na função de borda);
-- conta existente só tem o cadastro atualizado (a decisão local não muda); conta que não veio ganha sumiu_em.
create function fin_sincronizar_contas(p_empresa uuid, p_contas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_novas int;
  v_atualizadas int;
  v_sumiram int;
begin
  if auth.uid() is not null then
    raise exception 'Somente a sincronização do Consistem atualiza as contas bancárias.';
  end if;
  if jsonb_typeof(p_contas) <> 'array' then
    raise exception 'Lista de contas inválida.';
  end if;

  with api as (
    select distinct on (x ->> 'cod_conta_bancaria') x ->> 'cod_conta_bancaria' as cod, x
      from jsonb_array_elements(p_contas) as x
     where coalesce(trim(x ->> 'cod_conta_bancaria'), '') <> ''
  ), upd as (
    update fin_contas_bancarias c
       set cod_banco = nullif(api.x ->> 'cod_banco', ''), descricao = api.x ->> 'descricao', agencia = nullif(api.x ->> 'agencia', ''),
           conta = nullif(api.x ->> 'conta', ''), conta_contabil = nullif(api.x ->> 'conta_contabil', ''),
           tipo_conta = (api.x ->> 'tipo_conta')::smallint, considera_saldo_erp = coalesce((api.x ->> 'considera_saldo')::boolean, false),
           inativa_erp = coalesce((api.x ->> 'inativa')::boolean, false), sincronizada_em = now(), sumiu_em = null
      from api
     where c.empresa_id = p_empresa and c.cod_conta_bancaria = api.cod
    returning c.id
  )
  select count(*) into v_atualizadas from upd;

  insert into fin_contas_bancarias (empresa_id, cod_conta_bancaria, cod_banco, descricao, agencia, conta, conta_contabil, tipo_conta,
                                    considera_saldo_erp, inativa_erp, entra_no_caixa)
  select p_empresa, x ->> 'cod_conta_bancaria', nullif(x ->> 'cod_banco', ''), x ->> 'descricao', nullif(x ->> 'agencia', ''),
         nullif(x ->> 'conta', ''), nullif(x ->> 'conta_contabil', ''), (x ->> 'tipo_conta')::smallint,
         coalesce((x ->> 'considera_saldo')::boolean, false), coalesce((x ->> 'inativa')::boolean, false), coalesce((x ->> 'entra_no_caixa')::boolean, false)
    from jsonb_array_elements(p_contas) as x
   where coalesce(trim(x ->> 'cod_conta_bancaria'), '') <> ''
     and not exists (select 1 from fin_contas_bancarias c where c.empresa_id = p_empresa and c.cod_conta_bancaria = x ->> 'cod_conta_bancaria')
  on conflict (empresa_id, cod_conta_bancaria) do nothing;
  get diagnostics v_novas = row_count;

  -- Lista vazia = provável falha da API: não marca nada como sumido.
  if jsonb_array_length(p_contas) > 0 then
    update fin_contas_bancarias set sumiu_em = now()
     where empresa_id = p_empresa and sumiu_em is null
       and cod_conta_bancaria not in (select x ->> 'cod_conta_bancaria' from jsonb_array_elements(p_contas) as x where x ->> 'cod_conta_bancaria' is not null);
    get diagnostics v_sumiram = row_count;
  else
    v_sumiram := 0;
  end if;
  return jsonb_build_object('novas', v_novas, 'atualizadas', v_atualizadas, 'sumiram', v_sumiram);
end $$;
revoke all on function fin_sincronizar_contas(uuid, jsonb) from public, anon, authenticated;
grant execute on function fin_sincronizar_contas(uuid, jsonb) to service_role;

-- Gestor decide se a conta soma no caixa.
create function fin_definir_conta_caixa(p_conta uuid, p_entra boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'gestor') then
    raise exception 'Somente gestor do Financeiro (ou acima) define quais contas entram no caixa.';
  end if;
  update fin_contas_bancarias set entra_no_caixa = coalesce(p_entra, false), entra_no_caixa_alterado_por = auth.uid(), entra_no_caixa_alterado_em = now()
   where id = p_conta;
  if not found then
    raise exception 'Conta bancária não encontrada.';
  end if;
  return jsonb_build_object('id', p_conta, 'entra_no_caixa', coalesce(p_entra, false));
end $$;
revoke all on function fin_definir_conta_caixa(uuid, boolean) from public, anon;
grant execute on function fin_definir_conta_caixa(uuid, boolean) to authenticated;

-- 2) Saldos conciliados (um ativo por conta e data; correção substitui, nunca apaga) --
create table fin_saldos_bancarios (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references fin_contas_bancarias(id),
  empresa_id uuid not null references empresas(id),
  data date not null,
  saldo numeric(14,2) not null,                          -- pode ser negativo (cheque especial)
  origem text not null default 'digitado' check (origem in ('digitado', 'importado', 'api')),
  registrado_por uuid references perfis(id),
  registrado_em timestamptz not null default now(),
  substituido_em timestamptz,
  substituido_por uuid references perfis(id)
);
create unique index uq_fin_saldo_ativo on fin_saldos_bancarios (conta_id, data) where substituido_em is null;
create index idx_fin_saldos_empresa_data on fin_saldos_bancarios (empresa_id, data desc) where substituido_em is null;
comment on table fin_saldos_bancarios is 'Saldo bancário conciliado por conta e data. Correção = registro novo; o anterior fica substituído (prova).';

create function fn_fin_saldo_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.substituido_em is not null then
      raise exception 'Este saldo já foi substituído.';
    end if;
    if (to_jsonb(new) - 'substituido_em' - 'substituido_por') <> (to_jsonb(old) - 'substituido_em' - 'substituido_por') then
      raise exception 'Saldos registrados são imutáveis; registre um novo para corrigir.';
    end if;
  end if;
  return new;
end $$;
create trigger trg_fin_saldos_regras before update on fin_saldos_bancarios for each row execute function fn_fin_saldo_regras();
create trigger trg_fin_saldos_sem_delete before delete on fin_saldos_bancarios for each row execute function fn_bloquear_delete();
create trigger trg_aud_fin_saldos after insert or update on fin_saldos_bancarios for each row execute function fn_auditoria();

alter table fin_saldos_bancarios enable row level security;
create policy fin_saldos_ler on fin_saldos_bancarios for select to authenticated using (tem_acesso_area('financeiro'));

-- Registrar os saldos de um dia, em lote. p_saldos: [{"conta_id": uuid, "saldo": 1234.56}, ...]. Saldo igual ao ativo = ignora.
create function fin_registrar_saldos(p_empresa uuid, p_data date, p_saldos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  x jsonb;
  v_conta uuid;
  v_saldo numeric;
  v_atual numeric;
  v_gravados int := 0;
  v_iguais int := 0;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) registra saldos bancários.';
  end if;
  if p_data is null or p_data > v_hoje or p_data < v_hoje - 60 then
    raise exception 'A data do saldo deve ser hoje ou até 60 dias atrás.';
  end if;
  if jsonb_typeof(p_saldos) <> 'array' or jsonb_array_length(p_saldos) = 0 then
    raise exception 'Informe pelo menos um saldo.';
  end if;
  if jsonb_array_length(p_saldos) > 100 then
    raise exception 'No máximo 100 contas por vez.';
  end if;

  for x in select * from jsonb_array_elements(p_saldos) loop
    begin
      v_conta := (x ->> 'conta_id')::uuid;
      v_saldo := round((x ->> 'saldo')::numeric, 2);
    exception when others then
      raise exception 'Saldo inválido na lista.';
    end;
    if v_saldo is null or abs(v_saldo) > 1000000000 then
      raise exception 'Saldo inválido na lista.';
    end if;
    if not exists (select 1 from fin_contas_bancarias where id = v_conta and empresa_id = p_empresa) then
      raise exception 'Uma das contas não é desta empresa.';
    end if;

    select saldo into v_atual from fin_saldos_bancarios where conta_id = v_conta and data = p_data and substituido_em is null for update;
    if found and v_atual = v_saldo then
      v_iguais := v_iguais + 1;
      continue;
    end if;
    update fin_saldos_bancarios set substituido_em = now(), substituido_por = auth.uid()
     where conta_id = v_conta and data = p_data and substituido_em is null;
    insert into fin_saldos_bancarios (conta_id, empresa_id, data, saldo, origem, registrado_por)
    values (v_conta, p_empresa, p_data, v_saldo, 'digitado', auth.uid());
    v_gravados := v_gravados + 1;
  end loop;

  -- Saldos de hoje completos (todas as contas que entram no caixa): conclui a pendência do dia.
  if p_data = v_hoje and not exists (
    select 1 from fin_contas_bancarias c
     where c.empresa_id = p_empresa and c.entra_no_caixa and c.sumiu_em is null
       and not exists (select 1 from fin_saldos_bancarios s where s.conta_id = c.id and s.data = v_hoje and s.substituido_em is null)
  ) then
    update pendencias set status = 'concluida', concluido_em = now(), concluido_por = auth.uid()
     where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'empresas' and referencia_id = p_empresa
       and titulo like 'Registrar saldos bancários de %' and status in ('aberta', 'em_andamento');
  end if;
  return jsonb_build_object('gravados', v_gravados, 'iguais', v_iguais);
end $$;
revoke all on function fin_registrar_saldos(uuid, date, jsonb) from public, anon;
grant execute on function fin_registrar_saldos(uuid, date, jsonb) to authenticated;

-- 3) Último saldo de cada conta (até hoje) ---------------------------------
create view fin_vw_saldo_atual with (security_invoker = true) as
select c.id, c.empresa_id, c.cod_conta_bancaria, c.cod_banco, c.descricao, c.agencia, c.conta, c.tipo_conta, c.considera_saldo_erp,
       c.inativa_erp, c.entra_no_caixa, c.sumiu_em, c.sincronizada_em,
       s.id as saldo_id, s.saldo, s.data as data_saldo, s.registrado_em, p.nome as registrado_por_nome
  from fin_contas_bancarias c
  left join lateral (
    select s.* from fin_saldos_bancarios s
     where s.conta_id = c.id and s.substituido_em is null and s.data <= (now() at time zone 'America/Cuiaba')::date
     order by s.data desc limit 1
  ) s on true
  left join perfis p on p.id = s.registrado_por;

-- 4) Composição do caixa gravada na autorização ----------------------------
-- O check antigo (caixa >= 0) sai: a soma dos saldos pode ser negativa (o caixa digitado continua recusando negativo).
alter table cap_autorizacoes drop constraint if exists cap_autorizacoes_caixa_disponivel_check;

create table cap_autorizacao_caixa (
  id uuid primary key default gen_random_uuid(),
  autorizacao_id uuid not null references cap_autorizacoes(id),
  tipo text not null check (tipo in ('saldo', 'adicional')),
  conta_id uuid references fin_contas_bancarias(id),
  saldo_id uuid references fin_saldos_bancarios(id),     -- nulo = conta sem saldo registrado (contou R$ 0,00)
  descricao text not null,
  data_saldo date,
  valor numeric(14,2) not null,
  ordem int not null default 0,
  criado_por uuid references perfis(id),
  criado_em timestamptz not null default now(),
  substituida_em timestamptz,                            -- recomposição em rascunho; nunca delete
  check ((tipo = 'saldo' and conta_id is not null) or (tipo = 'adicional' and conta_id is null and valor > 0 and length(trim(descricao)) between 3 and 200))
);
create index idx_cap_caixa_autorizacao on cap_autorizacao_caixa (autorizacao_id) where substituida_em is null;
comment on table cap_autorizacao_caixa is 'Composição do caixa disponível de uma autorização: saldo de cada conta (no momento) + adicionais do dia. Só muda em rascunho; a anterior fica substituída.';

create function fn_cap_caixa_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status cap_status_autorizacao;
begin
  select status into v_status from cap_autorizacoes where id = coalesce(new.autorizacao_id, old.autorizacao_id);
  if v_status is distinct from 'rascunho' then
    raise exception 'A composição do caixa só muda enquanto a autorização é rascunho.';
  end if;
  if tg_op = 'UPDATE' then
    if old.substituida_em is not null or (to_jsonb(new) - 'substituida_em') <> (to_jsonb(old) - 'substituida_em') then
      raise exception 'A composição do caixa é imutável; recomponha para trocar.';
    end if;
  end if;
  return new;
end $$;
create trigger trg_cap_caixa_regras before insert or update on cap_autorizacao_caixa for each row execute function fn_cap_caixa_regras();
create trigger trg_cap_caixa_sem_delete before delete on cap_autorizacao_caixa for each row execute function fn_bloquear_delete();
create trigger trg_aud_cap_caixa after insert or update on cap_autorizacao_caixa for each row execute function fn_auditoria();

alter table cap_autorizacao_caixa enable row level security;
create policy cap_caixa_ler on cap_autorizacao_caixa for select to authenticated using (tem_acesso_area('financeiro'));

-- 5) Aplicar a composição ---------------------------------------------------
-- p_composicao: {"contas": [uuid...], "adicionais": [{"descricao": "...", "valor": 123.45}]}. Os saldos são lidos AQUI (último
-- saldo ativo até hoje), nunca vêm da tela. Composição vazia = sem caixa (nulo). Devolve o caixa gravado.
create function cap_aplicar_composicao_caixa(p_id uuid, p_composicao jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_status cap_status_autorizacao;
  v_empresa uuid;
  v_codigo text;
  v_contas uuid[];
  v_adic jsonb;
  v_validas int;
  v_total numeric(14,2);
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  a jsonb;
  v_desc text;
  v_valor numeric;
  v_ordem int := 0;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) define o caixa disponível.';
  end if;
  if p_composicao is null or jsonb_typeof(p_composicao) <> 'object' then
    raise exception 'Composição do caixa inválida.';
  end if;
  select status, empresa_id, codigo into v_status, v_empresa, v_codigo from cap_autorizacoes where id = p_id for update;
  if v_status is null then
    raise exception 'Autorização não encontrada.';
  end if;
  if v_status <> 'rascunho' then
    raise exception 'O caixa disponível só pode ser alterado enquanto a autorização % é rascunho.', v_codigo;
  end if;

  begin
    select coalesce(array_agg(distinct x::uuid), '{}') into v_contas
      from jsonb_array_elements_text(coalesce(p_composicao -> 'contas', '[]'::jsonb)) as x;
  exception when others then
    raise exception 'Lista de contas inválida.';
  end;
  if cardinality(v_contas) > 50 then
    raise exception 'No máximo 50 contas.';
  end if;
  select count(*) into v_validas from fin_contas_bancarias where id = any(v_contas) and empresa_id = v_empresa;
  if v_validas <> cardinality(v_contas) then
    raise exception 'Uma das contas não é da empresa desta autorização.';
  end if;
  v_adic := coalesce(p_composicao -> 'adicionais', '[]'::jsonb);
  if jsonb_typeof(v_adic) <> 'array' or jsonb_array_length(v_adic) > 30 then
    raise exception 'Valores adicionais inválidos (no máximo 30).';
  end if;

  update cap_autorizacao_caixa set substituida_em = now() where autorizacao_id = p_id and substituida_em is null;

  insert into cap_autorizacao_caixa (autorizacao_id, tipo, conta_id, saldo_id, descricao, data_saldo, valor, ordem, criado_por)
  select p_id, 'saldo', c.id, s.id,
         concat_ws(' · ', c.descricao, 'ag. ' || nullif(c.agencia, ''), 'c/c ' || nullif(c.conta, '')),
         s.data, coalesce(s.saldo, 0), row_number() over (order by c.descricao, c.cod_conta_bancaria), auth.uid()
    from fin_contas_bancarias c
    left join lateral (
      select s.id, s.data, s.saldo from fin_saldos_bancarios s
       where s.conta_id = c.id and s.substituido_em is null and s.data <= v_hoje order by s.data desc limit 1
    ) s on true
   where c.id = any(v_contas);
  v_ordem := cardinality(v_contas);

  for a in select * from jsonb_array_elements(v_adic) loop
    v_desc := trim(coalesce(a ->> 'descricao', ''));
    begin
      v_valor := round((a ->> 'valor')::numeric, 2);
    exception when others then
      raise exception 'Valor adicional inválido.';
    end;
    if length(v_desc) < 3 or length(v_desc) > 200 then
      raise exception 'Descreva cada valor adicional (3 a 200 caracteres).';
    end if;
    if v_valor is null or v_valor <= 0 or v_valor > 100000000 then
      raise exception 'Valor adicional inválido: informe um valor maior que zero.';
    end if;
    v_ordem := v_ordem + 1;
    insert into cap_autorizacao_caixa (autorizacao_id, tipo, descricao, valor, ordem, criado_por)
    values (p_id, 'adicional', v_desc, v_valor, v_ordem, auth.uid());
  end loop;

  if v_ordem = 0 then
    v_total := null;
  else
    select sum(valor) into v_total from cap_autorizacao_caixa where autorizacao_id = p_id and substituida_em is null;
  end if;
  update cap_autorizacoes set caixa_disponivel = v_total where id = p_id;
  return v_total;
end $$;
revoke all on function cap_aplicar_composicao_caixa(uuid, jsonb) from public, anon;
grant execute on function cap_aplicar_composicao_caixa(uuid, jsonb) to authenticated;

-- Tela: recompor o caixa de um rascunho (substitui o uso de cap_definir_caixa).
create function cap_definir_composicao_caixa(p_id uuid, p_composicao jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  return jsonb_build_object('caixa_disponivel', cap_aplicar_composicao_caixa(p_id, p_composicao));
end $$;
revoke all on function cap_definir_composicao_caixa(uuid, jsonb) from public, anon;
grant execute on function cap_definir_composicao_caixa(uuid, jsonb) to authenticated;

-- Caixa digitado (cap_definir_caixa, ainda aceito por compatibilidade) invalida a composição gravada.
create or replace function cap_definir_caixa(p_id uuid, p_caixa numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode alterar o caixa.';
  end if;
  if p_caixa is not null and (p_caixa < 0 or p_caixa > 1000000000) then
    raise exception 'Caixa disponível inválido.';
  end if;
  update cap_autorizacoes set caixa_disponivel = p_caixa where id = p_id and status = 'rascunho';
  if not found then
    raise exception 'Autorização não encontrada ou já não está em rascunho (ou você não tem acesso a ela).';
  end if;
  update cap_autorizacao_caixa set substituida_em = now() where autorizacao_id = p_id and substituida_em is null;
  return jsonb_build_object('caixa_disponivel', p_caixa);
end $$;

-- cap_criar_autorizacao e cap_montar_rascunho ganham p_composicao (aplicada antes de autorizar, na mesma transação).
drop function cap_montar_rascunho(uuid, uuid[], numeric, text, jsonb, date);
drop function cap_criar_autorizacao(uuid, uuid[], text, date, boolean, numeric);

create function cap_criar_autorizacao(p_empresa uuid, p_lancamentos uuid[], p_observacao text default null, p_data date default null,
                                      p_autorizar boolean default false, p_caixa numeric default null, p_composicao jsonb default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_numero int;
  v_codigo text;
  v_data date;
  v_id uuid;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_itens int;
  v_tot_t numeric(14,2);
  v_tot_a numeric(14,2);
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode montar uma autorização de pagamento.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_lancamentos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    if p_autorizar then
      raise exception 'Marque pelo menos um item.';
    end if;
    v_ids := '{}'::uuid[];
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'Uma autorização aceita no máximo 500 itens (marcados: %).', cardinality(v_ids);
  end if;
  if not exists (select 1 from empresas where id = p_empresa and ativa) then
    raise exception 'Empresa inválida.';
  end if;
  v_data := coalesce(p_data, v_hoje);
  if v_data < v_hoje - 30 or v_data > v_hoje + 30 then
    raise exception 'A data do pagamento deve ficar até 30 dias antes ou depois de hoje.';
  end if;
  if p_caixa is not null and (p_caixa < 0 or p_caixa > 1000000000) then
    raise exception 'Caixa disponível inválido.';
  end if;

  lock table cap_autorizacoes in share row exclusive mode;
  select coalesce(max(numero), 0) + 1 into v_numero from cap_autorizacoes;
  v_codigo := cap_codigo_para_data(v_data);
  insert into cap_autorizacoes (numero, codigo, empresa_id, data, observacao, caixa_disponivel)
  values (v_numero, v_codigo, p_empresa, v_data, nullif(trim(p_observacao), ''), p_caixa)
  returning id into v_id;

  perform cap_adicionar_itens(v_id, v_ids);
  if p_composicao is not null then
    perform cap_aplicar_composicao_caixa(v_id, p_composicao);
  end if;

  select count(*), coalesce(sum(valor) filter (where tipo = 'titulo'), 0), coalesce(sum(valor) filter (where tipo = 'antecipacao'), 0)
    into v_itens, v_tot_t, v_tot_a from cap_autorizacao_itens where autorizacao_id = v_id and removido_em is null;

  if p_autorizar then
    perform cap_autorizar(v_id);
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'codigo', v_codigo, 'itens', v_itens, 'total_titulos', v_tot_t, 'total_antecipacoes', v_tot_a,
                            'caixa_disponivel', (select caixa_disponivel from cap_autorizacoes where id = v_id),
                            'status', (select status from cap_autorizacoes where id = v_id));
end $$;
revoke all on function cap_criar_autorizacao(uuid, uuid[], text, date, boolean, numeric, jsonb) from public, anon;
grant execute on function cap_criar_autorizacao(uuid, uuid[], text, date, boolean, numeric, jsonb) to authenticated;

create function cap_montar_rascunho(p_empresa uuid, p_lancamentos uuid[], p_caixa numeric default null, p_observacao text default null,
                                    p_extra jsonb default null, p_data date default null, p_composicao jsonb default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_criado boolean := false;
  v_ids uuid[];
  r record;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode montar uma autorização de pagamento.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_lancamentos) as x;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  lock table cap_autorizacoes in share row exclusive mode;
  select id into v_id from cap_autorizacoes where empresa_id = p_empresa and status = 'rascunho' order by numero desc limit 1 for update;
  if v_id is null then
    v_id := (cap_criar_autorizacao(p_empresa, '{}'::uuid[], p_observacao, p_data, false, p_caixa) ->> 'id')::uuid;
    v_criado := true;
  else
    if p_caixa is not null then
      perform cap_definir_caixa(v_id, p_caixa);
    end if;
    if p_observacao is not null then
      update cap_autorizacoes set observacao = nullif(trim(p_observacao), '') where id = v_id;
    end if;
  end if;

  if p_composicao is not null then
    perform cap_aplicar_composicao_caixa(v_id, p_composicao);
  end if;

  if cardinality(v_ids) > 0 then
    perform cap_adicionar_itens(v_id, v_ids);
  end if;

  if p_extra is not null and jsonb_typeof(p_extra) = 'object' then
    perform cap_incluir_extra(v_id, p_extra ->> 'descricao', p_extra ->> 'favorecido', (p_extra ->> 'valor')::numeric);
  end if;

  select id, codigo, itens, extras, total, total_extras, caixa_disponivel, observacao into r from cap_vw_autorizacoes where id = v_id;
  return jsonb_build_object('id', r.id, 'codigo', r.codigo, 'criado', v_criado, 'itens', r.itens, 'extras', r.extras, 'total', r.total,
                            'total_extras', r.total_extras, 'caixa_disponivel', r.caixa_disponivel, 'observacao', r.observacao);
end $$;
revoke all on function cap_montar_rascunho(uuid, uuid[], numeric, text, jsonb, date, jsonb) from public, anon;
grant execute on function cap_montar_rascunho(uuid, uuid[], numeric, text, jsonb, date, jsonb) to authenticated;

-- 6) View das autorizações: + composição do caixa (mesma definição da 0168, colunas novas no fim) --
create or replace view cap_vw_autorizacoes with (security_invoker = true) as
select a.*, e.nome_curto as empresa_nome, e.razao_social as empresa_razao_social, e.cnpj as empresa_cnpj,
       pc.nome as criado_por_nome, pa.nome as autorizada_por_nome, pk.nome as cancelada_por_nome, ps.nome as slack_enviada_por_nome,
       px.nome as excluida_por_nome,
       coalesce(i.itens, 0)::int as itens, coalesce(i.titulos, 0)::int as titulos, coalesce(i.antecipacoes, 0)::int as antecipacoes,
       coalesce(i.total_titulos, 0)::numeric(14,2) as total_titulos, coalesce(i.total_antecipacoes, 0)::numeric(14,2) as total_antecipacoes,
       coalesce(x.extras, 0)::int as extras, coalesce(x.total_extras, 0)::numeric(14,2) as total_extras,
       (coalesce(i.total, 0) + coalesce(x.total_extras, 0))::numeric(14,2) as total, coalesce(i.baixados, 0)::int as baixados,
       coalesce(i.confirmados, 0)::int as confirmados,
       case when a.caixa_disponivel is null then null
            else greatest(coalesce(i.total, 0) + coalesce(x.total_extras, 0) - a.caixa_disponivel, 0)::numeric(14,2) end as excedente,
       (coalesce(i.conferidos, 0) + coalesce(x.conferidos, 0))::int as conferidos,
       (coalesce(i.divergentes, 0) + coalesce(x.divergentes, 0))::int as divergentes,
       (coalesce(i.total_conferido, 0) + coalesce(x.total_conferido, 0))::numeric(14,2) as total_conferido,
       coalesce(i.nao_pagos, 0)::int as nao_pagos,
       coalesce(i.total_nao_pago, 0)::numeric(14,2) as total_nao_pago,
       k.composicao as caixa_composicao,
       k.composto_em as caixa_composto_em
  from cap_autorizacoes a
  join empresas e on e.id = a.empresa_id
  left join perfis pc on pc.id = a.criado_por
  left join perfis pa on pa.id = a.autorizada_por
  left join perfis pk on pk.id = a.cancelada_por
  left join perfis ps on ps.id = a.slack_enviada_por
  left join perfis px on px.id = a.excluida_por
  left join lateral (
    select count(*) as itens,
           count(*) filter (where tipo = 'titulo') as titulos,
           count(*) filter (where tipo = 'antecipacao') as antecipacoes,
           sum(valor) filter (where tipo = 'titulo') as total_titulos,
           sum(valor) filter (where tipo = 'antecipacao') as total_antecipacoes,
           sum(valor) as total,
           count(*) filter (where baixado_consistem_em is not null and conferencia_banco is distinct from 'nao_pago') as baixados,
           -- confirmado no Consistem e ainda não baixado (depois da baixa a confirmação já cumpriu o papel)
           count(*) filter (where confirmado_consistem_em is not null and baixado_consistem_em is null) as confirmados,
           count(*) filter (where conferencia_banco = 'conferido') as conferidos,
           count(*) filter (where conferencia_banco = 'divergente') as divergentes,
           sum(valor) filter (where conferencia_banco = 'conferido') as total_conferido,
           count(*) filter (where conferencia_banco = 'nao_pago') as nao_pagos,
           sum(valor) filter (where conferencia_banco = 'nao_pago') as total_nao_pago
      from cap_autorizacao_itens where autorizacao_id = a.id and removido_em is null
  ) i on true
  left join lateral (
    select count(*) as extras, sum(valor) as total_extras,
           count(*) filter (where conferencia_banco = 'conferido') as conferidos,
           count(*) filter (where conferencia_banco = 'divergente') as divergentes,
           sum(valor) filter (where conferencia_banco = 'conferido') as total_conferido
      from cap_autorizacao_extras where autorizacao_id = a.id and removido_em is null
  ) x on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('tipo', c.tipo, 'conta_id', c.conta_id, 'descricao', c.descricao, 'data_saldo', c.data_saldo, 'valor', c.valor)
                     order by c.ordem) as composicao,
           max(c.criado_em) as composto_em
      from cap_autorizacao_caixa c where c.autorizacao_id = a.id and c.substituida_em is null
  ) k on true;

-- 7) Pendência diária "Registrar saldos bancários" -------------------------
-- Chamada pela sincronização do contas a pagar (a cada 30 min, dias úteis 07:00–18:45). Abre uma por empresa que tem conta
-- no caixa sem saldo de hoje; cancela as de dias anteriores (o saldo antigo já não serve para a autorização do dia).
create function fin_abrir_pendencias_saldos() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_agora timestamp := now() at time zone 'America/Cuiaba';
  v_hoje date := v_agora::date;
  v_abertas int;
begin
  if auth.uid() is not null then
    raise exception 'Somente a sincronização abre esta pendência.';
  end if;
  update pendencias set status = 'cancelada'
   where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'empresas' and titulo like 'Registrar saldos bancários de %'
     and status in ('aberta', 'em_andamento') and prazo < v_hoje;
  if extract(isodow from v_hoje) > 5 or extract(hour from v_agora) < 7 then
    return 0;
  end if;
  insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
  select 'financeiro.contas-pagar', e.id, 'Registrar saldos bancários de ' || to_char(v_hoje, 'DD/MM') || ' — ' || e.nome_curto,
         'Saldo conciliado de cada conta que entra no caixa: é o caixa disponível da autorização de pagamento do dia.',
         v_hoje, 'normal', 'empresas', e.id, '/financeiro/contas-pagar/saldos?empresa=' || e.id
    from empresas e
   where e.ativa
     and exists (select 1 from fin_contas_bancarias c
                  where c.empresa_id = e.id and c.entra_no_caixa and c.sumiu_em is null
                    and not exists (select 1 from fin_saldos_bancarios s where s.conta_id = c.id and s.data = v_hoje and s.substituido_em is null))
     and not exists (select 1 from pendencias p
                      where p.modulo = 'financeiro.contas-pagar' and p.referencia_tabela = 'empresas' and p.referencia_id = e.id
                        and p.titulo like 'Registrar saldos bancários de %' and p.prazo = v_hoje);
  get diagnostics v_abertas = row_count;
  return v_abertas;
end $$;
revoke all on function fin_abrir_pendencias_saldos() from public, anon, authenticated;
grant execute on function fin_abrir_pendencias_saldos() to service_role;
