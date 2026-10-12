-- =========================================================
-- Neo Admin — 0135 Cartão de crédito, Fase 2b: decisões por item da conciliação
-- Especificação: docs/modulos/financeiro-cartao.md (seção 5, regras 20 a 25).
--
-- A conciliação automática deixa itens que só uma pessoa resolve: o par anuidade/crédito de anuidade com descrições diferentes,
-- o estorno já abatido num título, a compra lançada pelo total quando a fatura cobra a parcela, a categoria errada. Cada decisão
-- fica registrada aqui, ligada à fatura, às linhas da fatura (id) e aos títulos do Consistem (código do lançamento):
--   classificar  troca categoria/conta de fluxo de uma linha a lançar (opcional: grava no dicionário)
--   justificar   a linha (ou o título sem linha) não gera título novo — com motivo; deixa de ser pendente
--   casar        liga linhas a títulos à mão; a diferença vira ajuste justificado no quadro
--   compensar    liga linhas da fatura que somam zero (ex.: anuidade + crédito da anuidade)
--   observar     observação livre
-- Nada é apagado: desfazer grava quem, quando e o motivo. Mês fechado ou pago não aceita decisão nova nem desfazer.
-- =========================================================

create type crt_tipo_decisao as enum ('classificar', 'justificar', 'casar', 'compensar', 'observar');

create table crt_decisoes (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references crt_faturas(id),
  tipo crt_tipo_decisao not null,
  linhas uuid[] not null default '{}',            -- crt_fatura_linhas.id
  titulos text[] not null default '{}',           -- código do lançamento no Consistem (cod_lancamento)
  categoria text,
  conta_fluxo text,
  motivo text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  desfeito_por uuid references perfis(id),
  desfeito_em timestamptz,
  motivo_desfazer text
);
comment on table crt_decisoes is 'Decisões de uma pessoa sobre itens da conciliação do cartão (classificar, justificar, casar, compensar, observar). Nunca apagadas: desfazer grava quem, quando e o motivo.';
create index idx_crt_decisoes_fatura on crt_decisoes (fatura_id) where desfeito_em is null;

create function fn_crt_decisao_regras() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'desfeito_por' - 'desfeito_em' - 'motivo_desfazer') <> (to_jsonb(old) - 'desfeito_por' - 'desfeito_em' - 'motivo_desfazer') then
    raise exception 'A decisão é imutável; desfaça-a (com motivo) e registre outra.';
  end if;
  if old.desfeito_em is not null then
    raise exception 'Esta decisão já foi desfeita.';
  end if;
  return new;
end $$;
create trigger trg_crt_decisoes_regras before update on crt_decisoes for each row execute function fn_crt_decisao_regras();
create trigger trg_crt_decisoes_sem_delete before delete on crt_decisoes for each row execute function fn_bloquear_delete();
create trigger trg_aud_crt_decisoes after insert or update on crt_decisoes for each row execute function fn_auditoria();

alter table crt_decisoes enable row level security;
create policy crt_decisoes_ler on crt_decisoes for select to authenticated using (tem_acesso_area('financeiro'));

create view crt_vw_decisoes with (security_invoker = true) as
select d.*, pc.nome as criado_por_nome, pd.nome as desfeito_por_nome
  from crt_decisoes d
  left join perfis pc on pc.id = d.criado_por
  left join perfis pd on pd.id = d.desfeito_por;

-- A fatura aceita decisões? (importada, e o mês não está fechado nem pago)
create function crt_fatura_editavel(p_fatura uuid) returns crt_faturas
language plpgsql stable security definer set search_path = public as $$
declare
  v_fatura crt_faturas;
  v_situacao crt_situacao_ciclo;
begin
  select * into v_fatura from crt_faturas where id = p_fatura;
  if v_fatura.id is null or v_fatura.status <> 'importada' then
    raise exception 'Fatura não encontrada ou cancelada.';
  end if;
  select situacao into v_situacao from crt_ciclos where id = v_fatura.ciclo_id;
  if v_situacao in ('fechada', 'paga') then
    raise exception 'O mês desta fatura está %: reabra o mês para mudar as decisões.', v_situacao;
  end if;
  return v_fatura;
end $$;
revoke all on function crt_fatura_editavel(uuid) from public, anon, authenticated;

-- Registrar uma decisão (operador ou acima). Devolve o id.
create function crt_registrar_decisao(p_fatura uuid, p_tipo crt_tipo_decisao, p_linhas uuid[], p_titulos text[], p_categoria text default null,
                                      p_conta_fluxo text default null, p_motivo text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fatura crt_faturas;
  v_linhas uuid[] := coalesce((select array_agg(distinct x) from unnest(p_linhas) x), '{}');
  v_titulos text[] := coalesce((select array_agg(distinct trim(x)) from unnest(p_titulos) x where trim(x) <> ''), '{}');
  v_validas int;
  v_soma numeric;
  v_conflito text;
  v_id uuid;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) registra decisões na conciliação.';
  end if;
  v_fatura := crt_fatura_editavel(p_fatura);

  select count(*), coalesce(sum(valor), 0) into v_validas, v_soma
    from crt_fatura_linhas where fatura_id = p_fatura and id = any(v_linhas) and not descartada;
  if v_validas <> cardinality(v_linhas) then
    raise exception 'Uma das linhas não é desta fatura (ou é linha descartada).';
  end if;

  case p_tipo
    when 'classificar' then
      if cardinality(v_linhas) <> 1 or cardinality(v_titulos) <> 0 then
        raise exception 'Classificar vale para uma linha da fatura.';
      end if;
      if coalesce(trim(p_categoria), '') = '' and coalesce(trim(p_conta_fluxo), '') = '' then
        raise exception 'Informe a categoria e/ou a conta de fluxo.';
      end if;
      -- A classificação nova substitui a anterior da mesma linha.
      update crt_decisoes set desfeito_por = auth.uid(), desfeito_em = now(), motivo_desfazer = 'Substituída por nova classificação'
       where fatura_id = p_fatura and tipo = 'classificar' and desfeito_em is null and linhas && v_linhas;
    when 'justificar' then
      if cardinality(v_linhas) + cardinality(v_titulos) <> 1 then
        raise exception 'Justificar vale para uma linha da fatura ou um título sem linha.';
      end if;
    when 'casar' then
      if cardinality(v_linhas) = 0 or cardinality(v_titulos) = 0 then
        raise exception 'Casar à mão liga pelo menos uma linha da fatura a pelo menos um título.';
      end if;
    when 'compensar' then
      if cardinality(v_linhas) < 2 or cardinality(v_titulos) <> 0 then
        raise exception 'Compensar liga duas ou mais linhas da fatura.';
      end if;
      if v_soma <> 0 then
        raise exception 'As linhas escolhidas somam R$ %: só se compensam linhas que somam zero.', to_char(v_soma, 'FM999G999G990D00');
      end if;
    when 'observar' then
      if cardinality(v_linhas) + cardinality(v_titulos) <> 1 then
        raise exception 'A observação vale para uma linha da fatura ou um título.';
      end if;
  end case;

  if p_tipo in ('justificar', 'casar', 'compensar') then
    if coalesce(length(trim(p_motivo)), 0) < 3 then
      raise exception 'Informe o motivo da decisão.';
    end if;
    -- Uma linha (ou título) só pode estar numa decisão de justificar/casar/compensar ativa.
    select coalesce(
      (select 'a linha ' || l.descricao from crt_decisoes d join crt_fatura_linhas l on l.id = any(d.linhas)
        where d.fatura_id = p_fatura and d.desfeito_em is null and d.tipo in ('justificar', 'casar', 'compensar') and l.id = any(v_linhas) limit 1),
      (select 'o título ' || t from crt_decisoes d, unnest(d.titulos) t
        where d.fatura_id = p_fatura and d.desfeito_em is null and d.tipo in ('justificar', 'casar') and t = any(v_titulos) limit 1))
      into v_conflito;
    if v_conflito is not null then
      raise exception 'Já existe decisão para %: desfaça-a antes.', v_conflito;
    end if;
  end if;

  insert into crt_decisoes (fatura_id, tipo, linhas, titulos, categoria, conta_fluxo, motivo)
  values (p_fatura, p_tipo, v_linhas, v_titulos, nullif(trim(p_categoria), ''), nullif(trim(p_conta_fluxo), ''), nullif(trim(p_motivo), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function crt_registrar_decisao(uuid, crt_tipo_decisao, uuid[], text[], text, text, text) from public, anon;
grant execute on function crt_registrar_decisao(uuid, crt_tipo_decisao, uuid[], text[], text, text, text) to authenticated;

-- Desfazer (operador ou acima), com motivo.
create function crt_desfazer_decisao(p_decisao uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_fatura uuid;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) desfaz decisões na conciliação.';
  end if;
  if coalesce(length(trim(p_motivo)), 0) < 3 then
    raise exception 'Informe o motivo para desfazer.';
  end if;
  select fatura_id into v_fatura from crt_decisoes where id = p_decisao and desfeito_em is null;
  if v_fatura is null then
    raise exception 'Decisão não encontrada ou já desfeita.';
  end if;
  perform crt_fatura_editavel(v_fatura);
  update crt_decisoes set desfeito_por = auth.uid(), desfeito_em = now(), motivo_desfazer = trim(p_motivo) where id = p_decisao;
end $$;
revoke all on function crt_desfazer_decisao(uuid, text) from public, anon;
grant execute on function crt_desfazer_decisao(uuid, text) to authenticated;
