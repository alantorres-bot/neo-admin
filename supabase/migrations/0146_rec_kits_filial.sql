-- =========================================================
-- Neo Admin — 0146 Faturamento da Filial Contagem, Fase A: o kit da fatura
-- Na Filial a NF é emitida no Syslock. Hoje a filial manda os PDFs por e-mail ("FATURAS MG - <MÊS> - EMAIL n"), Cuiabá implanta
-- no Consistem, devolve o boleto (e a carta de cessão, quando o título foi cedido à AKF) e a filial envia tudo ao cliente.
-- Aqui cada NF da filial vira um KIT:
--  - rec_kits: uma linha por NF (nº de 6 dígitos), com cliente, obra, período e se o cliente aceita boleto de factoring.
--    Estágio: recebida (a filial subiu NF/demonstrativo/comodato) → implantada (o título apareceu no Consistem)
--    → pronta (toda parcela com boleto — ou forma transferência — e carta de cessão se houver parcela cedida) → enviada.
--    Cancela-se com motivo (prova): sem exclusão.
--  - rec_kit_titulos: parcelas do Consistem ligadas ao kit. O título da filial é '4' + NF de 6 dígitos + parcela
--    ('4002323U' = NF 002323); a ligação é automática, nos dois sentidos (título que chega depois do kit e kit criado depois do título).
--  - Documentos no núcleo (anexos) com modulo 'financeiro.filial', referencia rec_kits, tipo nota_fatura | demonstrativo |
--    comodato | carta_cessao. O boleto continua na parcela (rec_titulos, tipo 'boleto'), como no restante da Cobrança.
--  - Pendências: "Implantar fatura da filial" (Cuiabá) fecha quando o título aparece; "Enviar kit ao cliente" abre quando fica pronto.
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('financeiro.filial', 'financeiro', 'Faturamento Filial', true)
on conflict (codigo) do update set ativo = true, nome = excluded.nome;

-- 1) NF da filial a partir do documento do título -----------------------------------------------------------------------
-- Mesma regra da unidade (0110): documento que começa com 400 é da Filial; a NF são os 6 dígitos depois do '4'.
create function rec_nota_filial(p_documento text) returns text
language sql immutable as $$
  select case when p_documento like '400%' and p_documento ~ '^4[0-9]{6}' then substr(p_documento, 2, 6) end;
$$;

-- 2) Tabelas -------------------------------------------------------------------------------------------------------------
create table rec_kits (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  unidade text not null default 'contagem' check (unidade = 'contagem'),
  nota_fiscal text not null check (nota_fiscal ~ '^[0-9]{6}$'),
  cliente_nome text not null check (btrim(cliente_nome) <> ''),
  obra text,
  periodo_inicio date,
  periodo_fim date,
  aceita_boleto_factoring boolean not null default true,
  estagio text not null default 'recebida' check (estagio in ('recebida', 'implantada', 'pronta', 'enviada', 'cancelada')),
  observacao text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  implantada_em timestamptz,
  pronta_em timestamptz,
  enviado_em timestamptz,
  enviado_por uuid references perfis(id),
  cancelada_em timestamptz,
  cancelada_por uuid references perfis(id),
  motivo_cancelamento text,
  constraint periodo_valido check (periodo_fim is null or periodo_inicio is null or periodo_fim >= periodo_inicio),
  constraint cancelamento_registrado check (estagio <> 'cancelada' or (cancelada_em is not null and motivo_cancelamento is not null))
);
-- Uma NF tem um kit vivo; um kit cancelado libera a NF para um novo.
create unique index uq_rec_kits_nota on rec_kits (empresa_id, nota_fiscal) where estagio <> 'cancelada';
create index idx_rec_kits_abertos on rec_kits (estagio) where estagio in ('recebida', 'implantada', 'pronta');

create table rec_kit_titulos (
  kit_id uuid not null references rec_kits(id),
  titulo_id uuid not null references rec_titulos(id) unique,
  ligado_em timestamptz not null default now(),
  primary key (kit_id, titulo_id)
);

alter table rec_kits enable row level security;
create policy rec_kits_ler on rec_kits for select to authenticated using (tem_acesso_area('financeiro'));
create policy rec_kits_inserir on rec_kits for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
create policy rec_kits_alterar on rec_kits for update to authenticated
  using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));
create trigger trg_rec_kits_sem_delete before delete on rec_kits for each row execute function fn_bloquear_delete();
create trigger trg_aud_rec_kits after insert or update or delete on rec_kits for each row execute function fn_auditoria();

-- A ligação só é gravada pelas funções abaixo (security definer): o usuário só lê.
alter table rec_kit_titulos enable row level security;
create policy rec_kit_titulos_ler on rec_kit_titulos for select to authenticated using (tem_acesso_area('financeiro'));
create trigger trg_rec_kit_titulos_sem_delete before delete on rec_kit_titulos for each row execute function fn_bloquear_delete();
create trigger trg_aud_rec_kit_titulos after insert or update or delete on rec_kit_titulos for each row execute function fn_auditoria();

-- NF, empresa e autor não mudam; o estágio só muda pelas funções do kit (ou para cancelada, com motivo); kit enviado ou cancelado é fixo.
create function fn_rec_kits_regras() returns trigger language plpgsql as $$
begin
  if new.empresa_id <> old.empresa_id or new.nota_fiscal <> old.nota_fiscal or new.unidade <> old.unidade
     or new.criado_por is distinct from old.criado_por or new.criado_em <> old.criado_em then
    raise exception 'NF, empresa e autor do kit não mudam; cancele o kit e registre outro.';
  end if;
  if old.estagio in ('enviada', 'cancelada') then
    raise exception 'O kit da NF % está %; não pode mais ser alterado.', old.nota_fiscal, case old.estagio when 'enviada' then 'enviado' else 'cancelado' end;
  end if;
  if new.estagio <> old.estagio and new.estagio <> 'cancelada' and coalesce(current_setting('neo.rec_kit_estagio', true), '') <> 'on' then
    raise exception 'O estágio do kit é calculado pelo sistema.';
  end if;
  return new;
end $$;
create trigger trg_rec_kits_regras before update on rec_kits for each row execute function fn_rec_kits_regras();

-- 3) Estágio do kit --------------------------------------------------------------------------------------------------------
create function rec_kit_atualizar_estagio(p_kit uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  k rec_kits%rowtype;
  v_titulos int;
  v_sem_boleto int;
  v_cedido boolean;
  v_carta boolean;
  v_novo text;
  v_titulo_pend text;
begin
  select * into k from rec_kits where id = p_kit for update;
  if not found or k.estagio in ('enviada', 'cancelada') then
    return k.estagio;
  end if;

  select count(*),
         count(*) filter (where t.forma_pagamento is distinct from 'transferencia' and not exists (
           select 1 from anexos a where a.referencia_tabela = 'rec_titulos' and a.referencia_id = t.id and a.tipo = 'boleto')),
         coalesce(bool_or(t.cedido), false)
    into v_titulos, v_sem_boleto, v_cedido
    from rec_kit_titulos kt join rec_titulos t on t.id = kt.titulo_id
   where kt.kit_id = p_kit and t.estagio not in ('cancelado', 'renegociado');
  v_carta := exists (select 1 from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = p_kit and a.tipo = 'carta_cessao');

  v_novo := case
    when v_titulos = 0 then 'recebida'
    when v_sem_boleto = 0 and (not v_cedido or v_carta) then 'pronta'
    else 'implantada' end;

  if v_novo <> k.estagio then
    perform set_config('neo.rec_kit_estagio', 'on', true);
    update rec_kits
       set estagio = v_novo,
           implantada_em = case when v_novo in ('implantada', 'pronta') then coalesce(implantada_em, now()) else implantada_em end,
           pronta_em = case when v_novo = 'pronta' then now() else null end
     where id = p_kit;
    perform set_config('neo.rec_kit_estagio', '', true);
  end if;

  -- Pendências do kit (núcleo): a de implantar fecha quando há título; a de enviar existe só enquanto pronto.
  if v_novo <> 'recebida' then
    update pendencias set status = 'concluida'
     where modulo = 'financeiro.filial' and referencia_tabela = 'rec_kits' and referencia_id = p_kit
       and titulo like 'Implantar fatura da filial%' and status in ('aberta', 'em_andamento');
  end if;
  v_titulo_pend := format('Enviar kit ao cliente: NF %s — %s', k.nota_fiscal, k.cliente_nome);
  if v_novo = 'pronta' then
    insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    values ('financeiro.filial', k.empresa_id, v_titulo_pend,
            'NF, demonstrativo, comodato e boleto prontos. Gere o rascunho do e-mail e envie ao cliente.',
            (now() at time zone 'America/Cuiaba')::date, 'alta', 'rec_kits', p_kit, '/financeiro/filial/' || p_kit)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  else
    update pendencias set status = 'cancelada'
     where modulo = 'financeiro.filial' and referencia_tabela = 'rec_kits' and referencia_id = p_kit
       and titulo like 'Enviar kit ao cliente%' and status in ('aberta', 'em_andamento');
  end if;
  return v_novo;
end $$;
revoke all on function rec_kit_atualizar_estagio(uuid) from public, anon;
grant execute on function rec_kit_atualizar_estagio(uuid) to authenticated, service_role;

-- 4) Ligação título ↔ kit (automática) ---------------------------------------------------------------------------------
create function rec_kit_ligar_titulos(p_kit uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  insert into rec_kit_titulos (kit_id, titulo_id)
  select k.id, t.id
    from rec_kits k
    join rec_titulos t on t.empresa_id = k.empresa_id and rec_nota_filial(t.documento) = k.nota_fiscal
   where k.id = p_kit and k.estagio <> 'cancelada'
     and not exists (select 1 from rec_kit_titulos x where x.titulo_id = t.id)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  perform rec_kit_atualizar_estagio(p_kit);
  return v_n;
end $$;
revoke all on function rec_kit_ligar_titulos(uuid) from public, anon, authenticated;

create function fn_rec_kits_ligar_novo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform rec_kit_ligar_titulos(new.id);
  return null;
end $$;
create trigger trg_rec_kits_ligar after insert on rec_kits for each row execute function fn_rec_kits_ligar_novo();

-- Título da filial que chega (ou muda o que conta para o kit): liga ao kit da NF e recalcula.
create function fn_rec_titulos_kit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kit uuid;
begin
  select kit_id into v_kit from rec_kit_titulos where titulo_id = new.id;
  if v_kit is null then
    select id into v_kit from rec_kits
     where empresa_id = new.empresa_id and nota_fiscal = rec_nota_filial(new.documento) and estagio <> 'cancelada';
    if v_kit is null then
      return null;
    end if;
    insert into rec_kit_titulos (kit_id, titulo_id) values (v_kit, new.id) on conflict do nothing;
  end if;
  perform rec_kit_atualizar_estagio(v_kit);
  return null;
end $$;
create trigger trg_rec_titulos_kit_novo after insert on rec_titulos
  for each row when (new.documento like '400%') execute function fn_rec_titulos_kit();
create trigger trg_rec_titulos_kit_alterado after update of forma_pagamento, cedido, estagio on rec_titulos
  for each row when (new.documento like '400%') execute function fn_rec_titulos_kit();

-- Boleto (na parcela) ou carta de cessão (no kit) anexados: recalcula o kit.
create function fn_anexos_kit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kit uuid;
begin
  if new.referencia_tabela = 'rec_kits' then
    v_kit := new.referencia_id;
  else
    select kit_id into v_kit from rec_kit_titulos where titulo_id = new.referencia_id;
  end if;
  if v_kit is not null then
    perform rec_kit_atualizar_estagio(v_kit);
  end if;
  return null;
end $$;
create trigger trg_anexos_kit after insert on anexos
  for each row when (new.referencia_tabela in ('rec_kits', 'rec_titulos')) execute function fn_anexos_kit();

-- 5) Registrar e cancelar --------------------------------------------------------------------------------------------------
-- Registra (ou reabre para completar) o kit da NF e abre a pendência de implantação para Cuiabá. Kit já existente:
-- atualiza cliente, obra, período e factoring e devolve o mesmo id (caso "faltou anexar a 2350").
create function rec_kit_registrar(
  p_nota text, p_cliente text, p_aceita_boleto_factoring boolean,
  p_obra text default null, p_periodo_inicio date default null, p_periodo_fim date default null, p_empresa uuid default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_digitos text := regexp_replace(coalesce(p_nota, ''), '[^0-9]', '', 'g');
  v_nota text := case when length(v_digitos) between 1 and 6 then lpad(v_digitos, 6, '0') end;
  v_empresa uuid := p_empresa;
  v_id uuid;
  v_estagio text;
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima registra faturas da filial.';
  end if;
  if v_nota is null or v_nota = '000000' then
    raise exception 'Número de NF inválido: "%".', p_nota;
  end if;
  if btrim(coalesce(p_cliente, '')) = '' then
    raise exception 'Informe o cliente da NF %.', v_nota;
  end if;
  if v_empresa is null then
    select (array_agg(id))[1] into v_empresa from empresas where ativa and codigo_erp is not null having count(*) = 1;
    if v_empresa is null then
      raise exception 'Não foi possível identificar a empresa da filial; informe a empresa.';
    end if;
  end if;

  select id, estagio into v_id, v_estagio from rec_kits where empresa_id = v_empresa and nota_fiscal = v_nota and estagio <> 'cancelada';
  if v_id is null then
    insert into rec_kits (empresa_id, nota_fiscal, cliente_nome, obra, periodo_inicio, periodo_fim, aceita_boleto_factoring)
    values (v_empresa, v_nota, btrim(p_cliente), nullif(btrim(p_obra), ''), p_periodo_inicio, p_periodo_fim, coalesce(p_aceita_boleto_factoring, true))
    returning id into v_id;
    select estagio into v_estagio from rec_kits where id = v_id; -- o gatilho já ligou títulos que existiam
  elsif v_estagio <> 'enviada' then
    update rec_kits
       set cliente_nome = btrim(p_cliente), obra = coalesce(nullif(btrim(p_obra), ''), obra),
           periodo_inicio = coalesce(p_periodo_inicio, periodo_inicio), periodo_fim = coalesce(p_periodo_fim, periodo_fim),
           aceita_boleto_factoring = coalesce(p_aceita_boleto_factoring, aceita_boleto_factoring)
     where id = v_id;
  end if;

  if v_estagio = 'recebida' then
    insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    values ('financeiro.filial', v_empresa, format('Implantar fatura da filial: NF %s — %s', v_nota, btrim(p_cliente)),
            case when coalesce(p_aceita_boleto_factoring, true) then 'Implantar no Consistem e emitir o boleto.'
                 else 'Implantar no Consistem. Cliente NÃO aceita boleto de factoring.' end,
            (now() at time zone 'America/Cuiaba')::date, 'normal', 'rec_kits', v_id, '/financeiro/filial/' || v_id)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  end if;
  return v_id;
end $$;
revoke all on function rec_kit_registrar(text, text, boolean, text, date, date, uuid) from public, anon;
grant execute on function rec_kit_registrar(text, text, boolean, text, date, date, uuid) to authenticated;

create function rec_kit_cancelar(p_kit uuid, p_motivo text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima cancela kits.';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  update rec_kits set estagio = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(), motivo_cancelamento = btrim(p_motivo)
   where id = p_kit and estagio not in ('enviada', 'cancelada');
  if not found then
    raise exception 'Kit não encontrado, já enviado ou já cancelado.';
  end if;
  update pendencias set status = 'cancelada'
   where modulo = 'financeiro.filial' and referencia_tabela = 'rec_kits' and referencia_id = p_kit and status in ('aberta', 'em_andamento');
end $$;
revoke all on function rec_kit_cancelar(uuid, text) from public, anon;
grant execute on function rec_kit_cancelar(uuid, text) to authenticated;

-- 6) View da lista -------------------------------------------------------------------------------------------------------
create view rec_vw_kits with (security_invoker = true) as
select k.id, k.empresa_id, k.unidade, k.nota_fiscal, k.cliente_nome, k.obra, k.periodo_inicio, k.periodo_fim, k.aceita_boleto_factoring,
       k.estagio, k.observacao, k.criado_em, k.implantada_em, k.pronta_em, k.enviado_em, k.cancelada_em, k.motivo_cancelamento,
       p.nome as criado_por_nome,
       t.parcelas, t.valor_total, t.primeiro_vencimento, t.cedido, t.contraparte_id,
       coalesce(t.boletos, 0) as boletos,
       (select count(*)::int from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = k.id and a.tipo = 'nota_fatura') as notas,
       (select count(*)::int from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = k.id and a.tipo = 'demonstrativo') as demonstrativos,
       (select count(*)::int from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = k.id and a.tipo = 'comodato') as comodatos,
       (select count(*)::int from anexos a where a.referencia_tabela = 'rec_kits' and a.referencia_id = k.id and a.tipo = 'carta_cessao') as cartas
  from rec_kits k
  left join perfis p on p.id = k.criado_por
  left join lateral (
    select count(*)::int as parcelas, sum(x.valor) as valor_total, min(x.vencimento) as primeiro_vencimento,
           coalesce(bool_or(x.cedido), false) as cedido, (array_agg(x.contraparte_id))[1] as contraparte_id,
           count(*) filter (where exists (select 1 from anexos a where a.referencia_tabela = 'rec_titulos' and a.referencia_id = x.id and a.tipo = 'boleto'))::int as boletos
      from rec_kit_titulos kt join rec_titulos x on x.id = kt.titulo_id
     where kt.kit_id = k.id and x.estagio not in ('cancelado', 'renegociado')
  ) t on true;
