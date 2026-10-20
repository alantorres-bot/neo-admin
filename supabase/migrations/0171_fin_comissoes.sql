-- =========================================================
-- Neo Admin — 0171 Financeiro / Comissões: fechamento mensal (Fase 1)
-- Especificação: docs/modulos/financeiro-comissoes.md.
--
-- Fluxo do mês (regra 11): abrir o fechamento → importar a planilha de créditos da CCCCI010 → buscar os títulos pagos
-- do mês (Edge Function fin-comissoes-titulos-pagos) → conferir (incluir/excluir com motivo, tipo, lançamentos manuais e
-- antecipações) → fechar (gestor). Fechado não muda nem é apagado (regra 4 do projeto); o mesmo recebimento nunca é
-- pago duas vezes ao mesmo representante (índice único entre os fechados).
--
-- Toda gravação passa por funções (security definer) que conferem nível e situação; as tabelas só têm leitura pela RLS.
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('financeiro.comissoes', 'financeiro', 'Comissões', true)
on conflict (codigo) do update set ativo = true, nome = excluded.nome;

-- Representantes comissionados ---------------------------------------------------------------------------------------
create table fin_com_representantes (
  id uuid primary key default gen_random_uuid(),
  cod_representante text not null unique,   -- código do representante no Consistem
  nome text not null,
  perc_venda numeric(6,3) not null check (perc_venda >= 0 and perc_venda <= 100),
  perc_locacao numeric(6,3) not null check (perc_locacao >= 0 and perc_locacao <= 100),
  recebe_de text[] not null default '{}',  -- representantes cujas vendas geram comissão para este (o próprio incluído)
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
create trigger trg_fin_com_rep_atualizado before update on fin_com_representantes for each row execute function fn_atualizado_em();
create trigger trg_aud_fin_com_rep after insert or update or delete on fin_com_representantes for each row execute function fn_auditoria();

-- Percentuais das planilhas "Comissões <Nome> - 2026.xlsx", confirmados pelo Alan em 19/10/2026. O Fernando é superior
-- do Heitor e recebe também pelas vendas dele (regra 8).
insert into fin_com_representantes (cod_representante, nome, perc_venda, perc_locacao, recebe_de) values
  ('3', 'Fernando Grassmann', 1.5, 3, '{3,7}'),
  ('7', 'Heitor Selerges', 1, 1, '{7}')
on conflict (cod_representante) do nothing;

-- Fechamentos (um por mês) -------------------------------------------------------------------------------------------
create table fin_com_fechamentos (
  id uuid primary key default gen_random_uuid(),
  competencia date not null unique check (extract(day from competencia) = 1),   -- 1º dia do mês de referência
  status text not null default 'em_conferencia' check (status in ('em_conferencia', 'fechado')),
  creditos_arquivo text,
  creditos_importados_em timestamptz,
  titulos_buscados_em timestamptz,
  z_sem_credito jsonb not null default '[]',   -- títulos Z pagos sem crédito na CCCCI010 (alerta da última busca)
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  fechado_por uuid references perfis(id),
  fechado_em timestamptz
);
create trigger trg_aud_fin_com_fech after insert or update on fin_com_fechamentos for each row execute function fn_auditoria();
create trigger trg_fin_com_fech_sem_delete before delete on fin_com_fechamentos for each row execute function fn_bloquear_delete();

-- Créditos de cliente da CCCCI010 (planilha do mês) ------------------------------------------------------------------
create table fin_com_creditos (
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null references fin_com_fechamentos(id),
  linha integer,                            -- linha da planilha
  data date not null,
  cod_cliente text not null,
  nome_cliente text,
  valor numeric(14,2) not null,
  cod_titulo_z text,                        -- título Z que este crédito lastreia (cruzamento da última busca)
  cod_representante_sugerido text           -- crédito sem Z (adiantamento): representante sugerido pelo cliente
);
create index idx_fin_com_creditos_fech on fin_com_creditos (fechamento_id);
create trigger trg_aud_fin_com_cred after insert or update or delete on fin_com_creditos for each row execute function fn_auditoria();

-- Linhas do fechamento -----------------------------------------------------------------------------------------------
create table fin_com_linhas (
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null references fin_com_fechamentos(id),
  cod_representante text not null,          -- quem recebe
  cod_representante_venda text,             -- de quem é a venda
  chave text not null,                      -- "T:<título>", "C:<data>:<cliente>:<centavos>", "M:<uuid>" (manual) ou "A:<uuid>" (antecipação)
  origem text not null check (origem in ('titulo', 'credito', 'manual', 'antecipacao')),
  cod_titulo text,
  cod_cliente text,
  nome_cliente text,
  nota_fiscal text,
  data_pagamento date,
  tipo_baixa text,
  tipo text not null default 'venda' check (tipo in ('venda', 'locacao')),
  valor_base numeric(14,2) not null default 0,
  percentual numeric(6,3) not null default 0,
  valor_comissao numeric(14,2) not null default 0,   -- antecipação: valor já pago ao representante (abate do total)
  valor_consistem numeric(14,2),            -- comissão registrada no Consistem (conferência)
  incluida boolean not null default true,
  motivo text,                              -- obrigatório ao excluir
  observacao text,
  fechada boolean not null default false,
  atualizado_por uuid references perfis(id),
  atualizado_em timestamptz not null default now(),
  unique (fechamento_id, cod_representante, chave)
);
create index idx_fin_com_linhas_fech on fin_com_linhas (fechamento_id, cod_representante);
-- Um recebimento é pago uma vez só ao mesmo representante (regra 6).
create unique index uq_fin_com_linhas_paga on fin_com_linhas (cod_representante, chave)
  where fechada and incluida and origem in ('titulo', 'credito');
create trigger trg_fin_com_linhas_atualizado before update on fin_com_linhas for each row execute function fn_atualizado_em();
create trigger trg_aud_fin_com_linhas after insert or update or delete on fin_com_linhas for each row execute function fn_auditoria();

-- Fechado não muda: créditos e linhas de um fechamento fechado ficam congelados.
create or replace function fn_fin_com_trava() returns trigger
language plpgsql set search_path = public as $$
declare v_status text; v_fech uuid;
begin
  if tg_op = 'DELETE' then v_fech := old.fechamento_id; else v_fech := new.fechamento_id; end if;
  select status into v_status from fin_com_fechamentos where id = v_fech;
  if v_status = 'fechado' then
    -- Única mudança aceita depois de fechado: o próprio fechamento marcando as linhas como fechadas.
    if tg_table_name = 'fin_com_linhas' and tg_op = 'UPDATE' then
      if old.fechada = false and new.fechada = true then return new; end if;
    end if;
    raise exception 'O fechamento deste mês já foi fechado; não pode mais ser alterado.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger trg_fin_com_creditos_trava before insert or update or delete on fin_com_creditos for each row execute function fn_fin_com_trava();
create trigger trg_fin_com_linhas_trava before insert or update or delete on fin_com_linhas for each row execute function fn_fin_com_trava();

alter table fin_com_representantes enable row level security;
alter table fin_com_fechamentos enable row level security;
alter table fin_com_creditos enable row level security;
alter table fin_com_linhas enable row level security;
create policy fin_com_rep_ler on fin_com_representantes for select to authenticated using (tem_acesso_modulo('financeiro.comissoes'));
create policy fin_com_fech_ler on fin_com_fechamentos for select to authenticated using (tem_acesso_modulo('financeiro.comissoes'));
create policy fin_com_cred_ler on fin_com_creditos for select to authenticated using (tem_acesso_modulo('financeiro.comissoes'));
create policy fin_com_linhas_ler on fin_com_linhas for select to authenticated using (tem_acesso_modulo('financeiro.comissoes'));

-- Funções de gravação ------------------------------------------------------------------------------------------------
create or replace function fin_com_exigir(p_nivel nivel_acesso) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not tem_acesso_modulo('financeiro.comissoes', p_nivel) then
    raise exception 'Somente % do Financeiro (ou acima) pode fazer isso nas comissões.', p_nivel;
  end if;
end $$;

/** Fechamento em conferência (senão, erro claro). */
create or replace function fin_com_em_conferencia(p_id uuid) returns fin_com_fechamentos
language plpgsql stable security definer set search_path = public as $$
declare f fin_com_fechamentos;
begin
  select * into f from fin_com_fechamentos where id = p_id;
  if f.id is null then raise exception 'Fechamento não encontrado.'; end if;
  if f.status <> 'em_conferencia' then raise exception 'O fechamento de % já foi fechado.', to_char(f.competencia, 'MM/YYYY'); end if;
  return f;
end $$;

create or replace function fin_com_abrir(p_competencia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform fin_com_exigir('operador');
  if p_competencia is null or p_competencia > date_trunc('month', now() at time zone 'America/Cuiaba')::date then
    raise exception 'Escolha um mês que já começou.';
  end if;
  insert into fin_com_fechamentos (competencia, criado_por) values (date_trunc('month', p_competencia)::date, auth.uid())
  on conflict (competencia) do nothing returning id into v_id;
  if v_id is null then select id into v_id from fin_com_fechamentos where competencia = date_trunc('month', p_competencia)::date; end if;
  return v_id;
end $$;

/** Substitui os créditos do mês pelos da planilha (data, código do cliente, nome, valor). */
create or replace function fin_com_importar_creditos(p_id uuid, p_arquivo text, p_creditos jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform fin_com_exigir('operador');
  perform fin_com_em_conferencia(p_id);
  if p_creditos is null or jsonb_typeof(p_creditos) <> 'array' then raise exception 'Planilha sem linhas.'; end if;
  delete from fin_com_creditos where fechamento_id = p_id;
  insert into fin_com_creditos (fechamento_id, linha, data, cod_cliente, nome_cliente, valor)
  select p_id, x.linha, x.data, x.cod_cliente, x.nome_cliente, x.valor
  from jsonb_to_recordset(p_creditos) as x(linha integer, data date, cod_cliente text, nome_cliente text, valor numeric);
  get diagnostics v_n = row_count;
  update fin_com_fechamentos set creditos_arquivo = left(p_arquivo, 200), creditos_importados_em = now() where id = p_id;
  return v_n;
end $$;

/**
 * Grava a proposta calculada no app (lib/modulos/financeiro/comissoes/regras.ts). As linhas automáticas (título e
 * crédito) são atualizadas pela mesma chave, mantendo o que já foi decidido na conferência (incluída/excluída, motivo e
 * tipo trocado à mão); as que saíram da proposta são removidas (a auditoria guarda). Manuais e antecipações não mudam.
 * Marca nos créditos o Z que lastreiam e o representante sugerido.
 */
create or replace function fin_com_gravar_proposta(p_id uuid, p_linhas jsonb, p_creditos jsonb, p_z_sem_credito jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform fin_com_exigir('operador');
  perform fin_com_em_conferencia(p_id);
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then raise exception 'Proposta inválida.'; end if;

  delete from fin_com_linhas l where l.fechamento_id = p_id and l.origem in ('titulo', 'credito')
    and not exists (select 1 from jsonb_to_recordset(p_linhas) as x(cod_representante text, chave text)
                    where x.cod_representante = l.cod_representante and x.chave = l.chave);

  insert into fin_com_linhas as l (fechamento_id, cod_representante, cod_representante_venda, chave, origem, cod_titulo, cod_cliente, nome_cliente,
    nota_fiscal, data_pagamento, tipo_baixa, tipo, valor_base, percentual, valor_comissao, valor_consistem, observacao)
  select p_id, x.cod_representante, x.cod_representante_venda, x.chave, x.origem, x.cod_titulo, x.cod_cliente, x.nome_cliente,
    x.nota_fiscal, x.data_pagamento, x.tipo_baixa, x.tipo, x.valor_base, x.percentual, x.valor_comissao, x.valor_consistem, x.observacao
  from jsonb_to_recordset(p_linhas) as x(cod_representante text, cod_representante_venda text, chave text, origem text, cod_titulo text,
    cod_cliente text, nome_cliente text, nota_fiscal text, data_pagamento date, tipo_baixa text, tipo text, valor_base numeric,
    percentual numeric, valor_comissao numeric, valor_consistem numeric, observacao text)
  where x.origem in ('titulo', 'credito')
  on conflict (fechamento_id, cod_representante, chave) do update set
    cod_representante_venda = excluded.cod_representante_venda, cod_titulo = excluded.cod_titulo, cod_cliente = excluded.cod_cliente,
    nome_cliente = excluded.nome_cliente, nota_fiscal = excluded.nota_fiscal, data_pagamento = excluded.data_pagamento,
    tipo_baixa = excluded.tipo_baixa, valor_base = excluded.valor_base, valor_consistem = excluded.valor_consistem, observacao = excluded.observacao,
    -- tipo e percentual trocados à mão (atualizado_por preenchido) ficam; senão vale o da proposta
    tipo = case when l.atualizado_por is null then excluded.tipo else l.tipo end,
    percentual = case when l.atualizado_por is null then excluded.percentual else l.percentual end,
    valor_comissao = round(excluded.valor_base * (case when l.atualizado_por is null then excluded.percentual else l.percentual end) / 100, 2);
  get diagnostics v_n = row_count;

  update fin_com_creditos c set cod_titulo_z = x.cod_titulo_z, cod_representante_sugerido = x.cod_representante_sugerido
  from jsonb_to_recordset(coalesce(p_creditos, '[]')) as x(id uuid, cod_titulo_z text, cod_representante_sugerido text)
  where c.id = x.id and c.fechamento_id = p_id;
  update fin_com_fechamentos set titulos_buscados_em = now(), z_sem_credito = coalesce(p_z_sem_credito, '[]') where id = p_id;
  return v_n;
end $$;

/** Incluir/excluir (motivo obrigatório ao excluir) e trocar o tipo (refaz o percentual pelo cadastro do representante). */
create or replace function fin_com_ajustar_linha(p_linha uuid, p_incluida boolean, p_motivo text, p_tipo text) returns void
language plpgsql security definer set search_path = public as $$
declare l fin_com_linhas; r fin_com_representantes; v_perc numeric;
begin
  perform fin_com_exigir('operador');
  select * into l from fin_com_linhas where id = p_linha;
  if l.id is null then raise exception 'Linha não encontrada.'; end if;
  perform fin_com_em_conferencia(l.fechamento_id);
  if not p_incluida and coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo para excluir a linha.'; end if;
  if p_tipo not in ('venda', 'locacao') then raise exception 'Tipo inválido.'; end if;
  v_perc := l.percentual;
  if l.origem in ('titulo', 'credito', 'manual') and p_tipo <> l.tipo then
    select * into r from fin_com_representantes where cod_representante = l.cod_representante;
    v_perc := case when p_tipo = 'locacao' then r.perc_locacao else r.perc_venda end;
  end if;
  update fin_com_linhas set incluida = p_incluida, motivo = nullif(trim(p_motivo), ''), tipo = p_tipo, percentual = v_perc,
    valor_comissao = case when origem = 'antecipacao' then valor_comissao else round(valor_base * v_perc / 100, 2) end,
    atualizado_por = auth.uid()
  where id = p_linha;
end $$;

/**
 * Lançamento manual (comissão sobre um valor-base: contrato, título fora da regra) ou antecipação já paga ao
 * representante (valor que abate o total). Para tirar, exclua a linha com motivo (fica registrada).
 */
create or replace function fin_com_lancar(p_id uuid, p_representante text, p_origem text, p_data date, p_descricao text,
  p_valor numeric, p_tipo text default 'venda', p_cod_titulo text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r fin_com_representantes; v_id uuid := gen_random_uuid(); v_perc numeric;
begin
  perform fin_com_exigir('operador');
  perform fin_com_em_conferencia(p_id);
  select * into r from fin_com_representantes where cod_representante = p_representante;
  if r.id is null then raise exception 'Representante não cadastrado nas comissões.'; end if;
  if p_origem not in ('manual', 'antecipacao') then raise exception 'Tipo de lançamento inválido.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if coalesce(trim(p_descricao), '') = '' then raise exception 'Informe a descrição do lançamento.'; end if;
  if p_tipo not in ('venda', 'locacao') then raise exception 'Tipo inválido.'; end if;
  v_perc := case when p_origem = 'antecipacao' then 0 when p_tipo = 'locacao' then r.perc_locacao else r.perc_venda end;
  insert into fin_com_linhas (id, fechamento_id, cod_representante, cod_representante_venda, chave, origem, cod_titulo, data_pagamento,
    tipo, valor_base, percentual, valor_comissao, observacao, atualizado_por)
  values (v_id, p_id, p_representante, p_representante, (case when p_origem = 'antecipacao' then 'A:' else 'M:' end) || v_id, p_origem,
    nullif(trim(p_cod_titulo), ''), p_data, p_tipo, p_valor, v_perc,
    case when p_origem = 'antecipacao' then round(p_valor, 2) else round(p_valor * v_perc / 100, 2) end, trim(p_descricao), auth.uid());
  return v_id;
end $$;

/** Fecha o mês (gestor): congela créditos e linhas. O índice único impede pagar de novo um recebimento já pago. */
create or replace function fin_com_fechar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fin_com_exigir('gestor');
  perform fin_com_em_conferencia(p_id);
  if not exists (select 1 from fin_com_linhas where fechamento_id = p_id) then raise exception 'Não há linhas para fechar.'; end if;
  begin
    update fin_com_linhas set fechada = true where fechamento_id = p_id;
  exception when unique_violation then
    raise exception 'Há recebimento já pago em outro fechamento a este representante. Exclua a linha repetida antes de fechar.';
  end;
  update fin_com_fechamentos set status = 'fechado', fechado_por = auth.uid(), fechado_em = now() where id = p_id;
end $$;

/** Cadastro do representante (gestor). */
create or replace function fin_com_salvar_representante(p_cod text, p_nome text, p_perc_venda numeric, p_perc_locacao numeric,
  p_recebe_de text[], p_ativo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fin_com_exigir('gestor');
  if coalesce(trim(p_cod), '') = '' or coalesce(trim(p_nome), '') = '' then raise exception 'Informe o código e o nome do representante.'; end if;
  insert into fin_com_representantes (cod_representante, nome, perc_venda, perc_locacao, recebe_de, ativo)
  values (trim(p_cod), trim(p_nome), p_perc_venda, p_perc_locacao,
    (select array_agg(distinct trim(x)) from unnest(coalesce(p_recebe_de, '{}') || array[trim(p_cod)]) as x where trim(x) <> ''), p_ativo)
  on conflict (cod_representante) do update set nome = excluded.nome, perc_venda = excluded.perc_venda, perc_locacao = excluded.perc_locacao,
    recebe_de = excluded.recebe_de, ativo = excluded.ativo;
end $$;

revoke all on function fin_com_exigir(nivel_acesso), fin_com_em_conferencia(uuid), fin_com_abrir(date), fin_com_importar_creditos(uuid, text, jsonb),
  fin_com_gravar_proposta(uuid, jsonb, jsonb, jsonb), fin_com_ajustar_linha(uuid, boolean, text, text),
  fin_com_lancar(uuid, text, text, date, text, numeric, text, text), fin_com_fechar(uuid),
  fin_com_salvar_representante(text, text, numeric, numeric, text[], boolean) from public, anon;
grant execute on function fin_com_abrir(date), fin_com_importar_creditos(uuid, text, jsonb), fin_com_gravar_proposta(uuid, jsonb, jsonb, jsonb),
  fin_com_ajustar_linha(uuid, boolean, text, text), fin_com_lancar(uuid, text, text, date, text, numeric, text, text), fin_com_fechar(uuid),
  fin_com_salvar_representante(text, text, numeric, numeric, text[], boolean) to authenticated;
