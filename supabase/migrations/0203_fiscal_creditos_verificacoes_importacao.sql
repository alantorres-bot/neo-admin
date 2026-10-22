-- =========================================================
-- Neo Admin — 0203 FISCAL > Créditos tributários: verificações (conciliação), painel e importação de planilhas
-- Verificações: calculadas na hora (RLS de quem consulta), cada resultado diz a regra que falhou e os registros envolvidos.
-- Importação: as linhas ficam numa área de preparo (fis_imp_*) com erros e duplicidades; só entram na base definitiva com
-- confirmação explícita, uma a uma pelas MESMAS funções do cadastro manual (as regras valem igual).
-- =========================================================

-- 1) VERIFICAÇÕES ---------------------------------------------------------------------------------------------------------
create function fis_verificar(p_empresa uuid default null, p_ano int default null)
returns table (
  regra text, severidade text, titulo text, descricao text, chave text,
  empresa_id uuid, estabelecimento_id uuid, tributo_id uuid, competencia date,
  credito_id uuid, obrigacao_id uuid, periodo_id uuid, movimento_ids uuid[], valor numeric
)
language sql stable set search_path = public as $$
  with par as (
    select p_empresa emp, p_ano ano, fis_hoje() hoje
  ),
  cred as (
    select c.* from fis_creditos c, par where not c.arquivado and (par.emp is null or c.empresa_id = par.emp)
  ),
  mov as (
    select m.* from fis_movimentos m, par where (par.emp is null or m.empresa_id = par.emp)
      and (par.ano is null or extract(year from m.competencia) = par.ano)
  ),
  per as (
    select p.* from fis_periodos p, par where (par.emp is null or p.empresa_id = par.emp)
      and (par.ano is null or extract(year from p.competencia) = par.ano)
  ),
  obr as (
    select o.*, t.nome tipo_nome, t.exige_recibo, t.documentos_exigidos from fis_obrigacoes o join fis_tipos_obrigacao t on t.id = o.tipo_id, par
     where (par.emp is null or o.empresa_id = par.emp) and (par.ano is null or extract(year from o.competencia) = par.ano)
  ),
  docs as (
    select v.alvo, v.alvo_id, d.tipo from fis_documentos_vinculos v join fis_documentos d on d.id = v.documento_id
     where v.removido_em is null and d.situacao = 'vigente'
  )
  -- R01: transporte entre competências fechadas (saldo final congelado ≠ saldo inicial congelado do mês seguinte)
  select 'R01_TRANSPORTE', 'alta', 'Saldo final diferente do saldo inicial do mês seguinte',
         format('Competência %s fechou com saldo final %s, mas %s fechou com saldo inicial %s.', fis_mm(a.competencia),
                fis_brl((a.snapshot ->> 'saldo_final')::numeric), fis_mm(b.competencia), fis_brl((b.snapshot ->> 'saldo_inicial')::numeric)),
         'R01:' || b.id, a.empresa_id, a.estabelecimento_id, a.tributo_id, b.competencia, null::uuid, null::uuid, b.id, null::uuid[],
         (b.snapshot ->> 'saldo_inicial')::numeric - (a.snapshot ->> 'saldo_final')::numeric
    from per a join per b on b.estabelecimento_id = a.estabelecimento_id and b.tributo_id = a.tributo_id
                         and b.competencia = (a.competencia + interval '1 month')::date
   where a.status = 'fechado' and b.status = 'fechado'
     and (a.snapshot ->> 'saldo_final')::numeric <> (b.snapshot ->> 'saldo_inicial')::numeric
  union all
  -- R01b: competência fechada cujo saldo transportado mudou depois do fechamento
  select 'R01_RECONCILIAR', 'alta', 'Competência fechada precisa de reconciliação', coalesce(p.reconciliacao_motivo, 'Saldo transportado alterado após o fechamento.'),
         'R01b:' || p.id, p.empresa_id, p.estabelecimento_id, p.tributo_id, p.competencia, null, null, p.id, null, null
    from per p where p.status = 'fechado' and p.requer_reconciliacao
  union all
  -- R02: possíveis duplicidades (mesmo crédito, tipo, competência e valor; datas ou protocolos diferentes)
  select 'R02_DUPLICIDADE', 'media', 'Movimentações possivelmente duplicadas',
         format('%s lançamentos de %s no mesmo crédito, competência %s e valor %s (nºs %s).', count(*), min(m.tipo), fis_mm(m.competencia), fis_brl(m.valor),
                string_agg(m.numero::text, ', ' order by m.numero)),
         'R02:' || m.credito_id || ':' || m.tipo || ':' || m.competencia || ':' || m.valor, min(m.empresa_id::text)::uuid, min(m.estabelecimento_id::text)::uuid,
         min(m.tributo_id::text)::uuid, m.competencia, m.credito_id, null, null, array_agg(m.id order by m.numero), m.valor
    from mov m where m.status = 'efetivo' and m.tipo <> 'estorno' and not m.estornado
   group by m.credito_id, m.tipo, m.competencia, m.valor having count(*) > 1
  union all
  -- R03: crédito sem nenhum documento vigente vinculado
  select 'R03_SEM_DOCUMENTO', 'alta', 'Crédito sem origem documentada',
         format('Crédito %s (%s) não tem documento vigente vinculado.', c.codigo, fis_brl(c.valor_original)),
         'R03:' || c.id, c.empresa_id, c.estabelecimento_id, c.tributo_id, c.competencia_origem, c.id, null, null, null, c.valor_original
    from cred c where not exists (select 1 from docs d where d.alvo = 'credito' and d.alvo_id = c.id)
  union all
  -- R04a: saldo negativo em alguma competência (não deveria ocorrer: sinaliza dado legado ou importado fora das regras)
  select 'R04_SALDO_NEGATIVO', 'critica', 'Crédito utilizado acima do saldo',
         format('Crédito %s ficou com saldo %s na competência %s.', c.codigo, fis_brl(x.acum), fis_mm(x.competencia)),
         'R04a:' || c.id || ':' || x.competencia, c.empresa_id, c.estabelecimento_id, c.tributo_id, x.competencia, c.id, null, null, null, x.acum
    from cred c join lateral (
      select competencia, sum(sum(valor_assinado)) over (order by competencia) acum
        from fis_movimentos m where m.credito_id = c.id and m.status = 'efetivo' group by competencia
    ) x on x.acum < 0
  union all
  -- R04b: utilização/compensação efetiva em crédito que hoje não está validado
  select 'R04_SEM_VALIDACAO', 'alta', 'Crédito utilizado sem validação vigente',
         format('Crédito %s está "%s" e tem %s em utilizações/compensações não estornadas.', c.codigo, c.validacao, fis_brl(sum(m.valor))),
         'R04b:' || c.id, c.empresa_id, c.estabelecimento_id, c.tributo_id, null, c.id, null, null, array_agg(m.id), sum(m.valor)
    from cred c join mov m on m.credito_id = c.id
    join fis_tipos_movimento t on t.codigo = m.tipo
   where c.validacao <> 'validado' and m.status = 'efetivo' and not m.estornado and t.forma is not null
   group by c.id, c.codigo, c.validacao, c.empresa_id, c.estabelecimento_id, c.tributo_id
  union all
  -- R05: declaração transmitida sem recibo/protocolo vinculado
  select 'R05_SEM_RECIBO', 'alta', 'Declaração sem recibo',
         format('%s %s está "%s" sem recibo/protocolo vigente vinculado.', o.tipo_nome, fis_mm(o.competencia), o.status),
         'R05:' || o.id, o.empresa_id, o.estabelecimento_id, o.tributo_id, o.competencia, null, o.id, null, null, null
    from obr o where o.status in ('transmitida', 'entregue_conferida')
     and not exists (select 1 from docs d where d.alvo = 'obrigacao' and d.alvo_id = o.id and d.tipo in ('recibo_transmissao', 'protocolo'))
  union all
  -- R06: compensação sem protocolo
  select 'R06_COMPENSACAO_SEM_PROTOCOLO', 'alta', 'Compensação sem protocolo relacionado',
         format('Lançamento nº %s (%s, %s) sem número de protocolo/PER-DCOMP.', m.numero, fis_brl(m.valor), fis_mm(m.competencia)),
         'R06:' || m.id, m.empresa_id, m.estabelecimento_id, m.tributo_id, m.competencia, m.credito_id, null, null, array[m.id], m.valor
    from mov m where m.tipo = 'compensacao' and m.status = 'efetivo' and not m.estornado and m.protocolo is null
  union all
  -- R07: documentos exigidos pela categoria ainda não anexados
  select 'R07_DOCUMENTACAO_PENDENTE', 'media', 'Crédito com documentação pendente',
         format('Crédito %s: falta %s.', c.codigo, string_agg(td.nome, ', ' order by td.nome)),
         'R07:' || c.id, c.empresa_id, c.estabelecimento_id, c.tributo_id, c.competencia_origem, c.id, null, null, null, null
    from cred c join fis_categorias cat on cat.id = c.categoria_id
    cross join lateral unnest(cat.documentos_exigidos) d(tipo)
    join fis_tipos_documento td on td.codigo = d.tipo
   where not exists (select 1 from docs x where x.alvo = 'credito' and x.alvo_id = c.id and x.tipo = d.tipo)
   group by c.id, c.codigo, c.empresa_id, c.estabelecimento_id, c.tributo_id, c.competencia_origem
  union all
  -- R08: competência fechada com divergência aberta
  select 'R08_FECHADO_COM_DIVERGENCIA', 'alta', 'Período fechado com divergências não resolvidas',
         format('Competência %s fechada com %s divergência(s) aberta(s) (nºs %s).', fis_mm(p.competencia), count(d.id), string_agg(d.numero::text, ', ')),
         'R08:' || p.id, p.empresa_id, p.estabelecimento_id, p.tributo_id, p.competencia, null, null, p.id, null, sum(d.valor_diferenca)
    from per p join fis_divergencias d on d.status in ('aberta', 'em_analise')
         and (d.periodo_id = p.id or (d.estabelecimento_id = p.estabelecimento_id and d.tributo_id = p.tributo_id and d.competencia = p.competencia))
   where p.status = 'fechado'
   group by p.id, p.empresa_id, p.estabelecimento_id, p.tributo_id, p.competencia
  union all
  -- R09/R10: saldo calculado × saldo oficial e × saldo declarado
  select case when x.fonte = 'oficial' then 'R09_SALDO_OFICIAL' else 'R10_SALDO_DECLARADO' end,
         case when p.diferenca_justificativa is null then 'alta' else 'info' end,
         case when x.fonte = 'oficial' then 'Saldo calculado diferente da apuração oficial' else 'Saldo calculado diferente do declarado' end,
         format('Competência %s: calculado %s; %s %s; diferença %s.%s', fis_mm(p.competencia), fis_brl(calc.saldo),
                case when x.fonte = 'oficial' then 'oficial' else 'declarado' end, fis_brl(x.valor), fis_brl(calc.saldo - x.valor),
                case when p.diferenca_justificativa is not null then ' Justificada: ' || p.diferenca_justificativa else '' end),
         'R09:' || x.fonte || ':' || p.id, p.empresa_id, p.estabelecimento_id, p.tributo_id, p.competencia, null, null, p.id, null, calc.saldo - x.valor
    from per p
    cross join lateral (values ('oficial', p.saldo_oficial), ('declarado', p.saldo_declarado)) x(fonte, valor)
    cross join lateral (select coalesce(sum(a.saldo_final), 0) saldo from fis_apuracao(p.competencia, p.competencia, null, p.estabelecimento_id, p.tributo_id) a) calc
   where x.valor is not null and calc.saldo <> x.valor
  union all
  -- R11: prazo de aproveitamento vencido ou vencendo (90 dias) com saldo
  select 'R11_PRAZO_APROVEITAMENTO', case when s.data_limite_aproveitamento < par.hoje then 'alta' else 'media' end,
         case when s.data_limite_aproveitamento < par.hoje then 'Prazo de aproveitamento encerrado com saldo' else 'Prazo de aproveitamento próximo' end,
         format('Crédito %s tem saldo %s e prazo de aproveitamento em %s (parâmetro a validar com o contador).', s.codigo, fis_brl(s.saldo), to_char(s.data_limite_aproveitamento, 'DD/MM/YYYY')),
         'R11:' || s.id, s.empresa_id, s.estabelecimento_id, s.tributo_id, null, s.id, null, null, null, s.saldo
    from fis_creditos_saldos s, par
   where not s.arquivado and s.saldo > 0 and s.data_limite_aproveitamento is not null and s.data_limite_aproveitamento <= par.hoje + 90
     and (par.emp is null or s.empresa_id = par.emp)
  union all
  -- R12: obrigação atrasada
  select 'R12_OBRIGACAO_ATRASADA', 'alta', 'Obrigação atrasada',
         format('%s %s venceu em %s e está "%s".', o.tipo_nome, fis_mm(o.competencia), to_char(o.vencimento, 'DD/MM/YYYY'), o.status),
         'R12:' || o.id, o.empresa_id, o.estabelecimento_id, o.tributo_id, o.competencia, null, o.id, null, null, null
    from obr o, par where o.vencimento < par.hoje and o.status not in ('transmitida', 'entregue_conferida', 'retificada', 'dispensada')
  union all
  -- R13: vencimento a confirmar (sem regra validada)
  select 'R13_VENCIMENTO_A_CONFIRMAR', 'info', 'Vencimento a confirmar',
         format('%s %s: vencimento %s.', o.tipo_nome, fis_mm(o.competencia), coalesce('previsto em ' || to_char(o.vencimento, 'DD/MM/YYYY') || ' (não confirmado)', 'não cadastrado')),
         'R13:' || o.id, o.empresa_id, o.estabelecimento_id, o.tributo_id, o.competencia, null, o.id, null, null, null
    from obr o where not o.vencimento_confirmado and o.status not in ('transmitida', 'entregue_conferida', 'retificada', 'dispensada')
$$;

-- 2) PAINEL -----------------------------------------------------------------------------------------------------------------
-- Indicadores e séries com os filtros do dashboard (RLS de quem consulta). Nada é estimado: só o que está no banco.
create function fis_painel(p jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_ano int := coalesce(nullif(p ->> 'ano', '')::int, extract(year from fis_hoje())::int);
  v_mes int := nullif(p ->> 'mes', '')::int;
  v_emp uuid := nullif(p ->> 'empresa_id', '')::uuid;
  v_estab uuid := nullif(p ->> 'estabelecimento_id', '')::uuid;
  v_trib uuid := nullif(p ->> 'tributo_id', '')::uuid;
  v_valid text := nullif(p ->> 'validacao', '');
  v_sobr text := nullif(p ->> 'status_obrigacao', '');
  v_ini date := make_date(v_ano, 1, 1);
  v_fim date := make_date(v_ano, 12, 1);
  v_ref date;
  v_hoje date := fis_hoje();
  r jsonb := '{}'::jsonb;
begin
  -- mês de referência dos saldos: o escolhido; senão dezembro (ou o mês atual, no ano corrente)
  v_ref := case when v_mes is not null then make_date(v_ano, v_mes, 1)
                when v_ano = extract(year from v_hoje) then date_trunc('month', v_hoje)::date else v_fim end;

  -- Créditos (situação atual)
  select r || jsonb_build_object('creditos', jsonb_build_object(
    'quantidade', count(*) filter (where not arquivado),
    -- registrado = entradas efetivas no razão (saldo inicial, apurado, reconhecido); validado + pendente + contestado/rejeitado = registrado
    'registrado', coalesce(sum(entradas) filter (where not arquivado), 0),
    'validado', coalesce(sum(entradas) filter (where not arquivado and validacao = 'validado'), 0),
    'pendente_validacao', coalesce(sum(entradas + pendente_entrada) filter (where not arquivado and validacao in ('pendente', 'em_analise')), 0),
    'contestado_rejeitado', coalesce(sum(entradas) filter (where not arquivado and validacao in ('contestado', 'rejeitado')), 0),
    'saldo_registrado', coalesce(sum(saldo) filter (where not arquivado), 0),
    'disponivel', coalesce(sum(saldo_disponivel), 0),
    'utilizado_total', coalesce(sum(utilizado), 0),
    'compensado_total', coalesce(sum(compensado), 0),
    'baixado_total', coalesce(sum(baixado), 0),
    'pendentes_aprovacao', coalesce(sum(pendentes), 0)))
  into r
  from fis_creditos_saldos s
  where (v_emp is null or s.empresa_id = v_emp) and (v_estab is null or s.estabelecimento_id = v_estab)
    and (v_trib is null or s.tributo_id = v_trib) and (v_valid is null or s.validacao::text = v_valid);

  -- Exercício, séries mensais, distribuição por tributo e evolução anual (uma leitura da apuração)
  with ap as (
    select a.*, c.validacao::text validacao
      from fis_apuracao(make_date(v_ano - 4, 1, 1), v_fim, v_emp, v_estab, v_trib) a
      join fis_creditos c on c.id = a.credito_id
     where (v_valid is null or c.validacao::text = v_valid)
  )
  select r || jsonb_build_object(
    'exercicio', (select jsonb_build_object(
        -- saldo inicial do exercício = saldo transportado de dezembro anterior + implantações de janeiro
        'saldo_inicial', coalesce(sum(saldo_inicial) filter (where competencia = v_ini), 0),
        'saldo_final', coalesce(sum(saldo_final) filter (where competencia = v_ref), 0),
        'gerado_ano', coalesce(sum(gerado + reconhecido) filter (where competencia between v_ini and v_fim), 0),
        'utilizado_ano', coalesce(sum(utilizado + compensado) filter (where competencia between v_ini and v_fim), 0),
        'utilizado_periodo', coalesce(sum(utilizado) filter (where competencia between v_ini and v_fim and (v_mes is null or competencia = v_ref)), 0),
        'compensado_periodo', coalesce(sum(compensado) filter (where competencia between v_ini and v_fim and (v_mes is null or competencia = v_ref)), 0),
        'baixado_periodo', coalesce(sum(baixado) filter (where competencia between v_ini and v_fim and (v_mes is null or competencia = v_ref)), 0),
        'referencia', v_ref) from ap),
    'mensal', (select coalesce(jsonb_agg(jsonb_build_object('competencia', g, 'saldo', s, 'gerado', ge, 'utilizado', ut) order by g), '[]'::jsonb) from (
        select g::date g, coalesce(sum(a.saldo_final), 0) s, coalesce(sum(a.gerado + a.reconhecido + a.ajustes_positivos + a.transferido_entrada), 0) ge,
               coalesce(sum(a.utilizado + a.compensado + a.baixado + a.ajustes_negativos + a.transferido_saida), 0) ut
          from generate_series(v_ini, v_fim, interval '1 month') g left join ap a on a.competencia = g::date
         group by g) x),
    'por_tributo', (select coalesce(jsonb_agg(jsonb_build_object('tributo_id', tributo_id, 'codigo', codigo, 'saldo', s) order by s desc), '[]'::jsonb) from (
        select a.tributo_id, t.codigo, sum(a.saldo_final) s from ap a join fis_tributos t on t.id = a.tributo_id
         where a.competencia = v_ref group by a.tributo_id, t.codigo having sum(a.saldo_final) <> 0) x),
    'anual', (select coalesce(jsonb_agg(jsonb_build_object('ano', y, 'saldo', s, 'disponivel', d) order by y), '[]'::jsonb) from (
        select y, coalesce(sum(a.saldo_final), 0) s, coalesce(sum(a.saldo_final) filter (where a.validacao = 'validado'), 0) d
          from generate_series(v_ano - 4, v_ano) y
          left join ap a on a.competencia = case when y = v_ano then v_ref else make_date(y, 12, 1) end
         group by y) x))
  into r;

  -- Obrigações
  select r || jsonb_build_object('obrigacoes', jsonb_build_object(
    'pendentes', count(*) filter (where status not in ('transmitida', 'entregue_conferida', 'retificada', 'dispensada')),
    'proximas', count(*) filter (where status not in ('transmitida', 'entregue_conferida', 'retificada', 'dispensada') and vencimento between v_hoje and v_hoje + 7),
    'atrasadas', count(*) filter (where status not in ('transmitida', 'entregue_conferida', 'retificada', 'dispensada') and vencimento < v_hoje),
    'aguardando_conferencia', count(*) filter (where status = 'transmitida'),
    'vencimento_a_confirmar', count(*) filter (where not vencimento_confirmado and status not in ('transmitida', 'entregue_conferida', 'retificada', 'dispensada')),
    'por_status', coalesce((select jsonb_object_agg(st, n) from (select status::text st, count(*) n from fis_obrigacoes o2
        where (v_emp is null or o2.empresa_id = v_emp) and (v_estab is null or o2.estabelecimento_id = v_estab)
          and (v_trib is null or o2.tributo_id = v_trib) and extract(year from o2.competencia) = v_ano
          and (v_mes is null or o2.competencia = v_ref) and (v_sobr is null or o2.status::text = v_sobr) group by status) z), '{}'::jsonb)))
  into r from fis_obrigacoes o
  where (v_emp is null or o.empresa_id = v_emp) and (v_estab is null or o.estabelecimento_id = v_estab) and (v_trib is null or o.tributo_id = v_trib)
    and extract(year from o.competencia) = v_ano and (v_mes is null or o.competencia = v_ref) and (v_sobr is null or o.status::text = v_sobr);

  -- Documentos pendentes e divergências
  select r || jsonb_build_object('alertas', coalesce(jsonb_object_agg(regra, n), '{}'::jsonb))
  into r from (select regra, count(*) n from fis_verificar(v_emp, v_ano) v
                where (v_estab is null or v.estabelecimento_id = v_estab) and (v_trib is null or v.tributo_id = v_trib) group by regra) x;
  select r || jsonb_build_object('divergencias', jsonb_build_object('abertas', count(*), 'valor', coalesce(sum(abs(valor_diferenca)), 0)))
  into r from fis_divergencias d
  where d.status in ('aberta', 'em_analise') and (v_emp is null or d.empresa_id = v_emp) and (v_estab is null or d.estabelecimento_id = v_estab)
    and (v_trib is null or d.tributo_id = v_trib);
  select r || jsonb_build_object('solicitacoes_documento', count(*)) into r from fis_tarefas t
   where t.tipo = 'solicitacao_documento' and t.status in ('aberta', 'em_andamento') and (v_emp is null or t.empresa_id = v_emp);
  return r;
end $$;

-- 3) IMPORTAÇÃO ---------------------------------------------------------------------------------------------------------------
create table fis_imp_lotes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('creditos', 'movimentos')),
  arquivo_nome text not null,
  mapeamento jsonb not null,
  status text not null default 'validado' check (status in ('validado', 'confirmado', 'descartado')),
  total int not null default 0,
  validas int not null default 0,
  com_erro int not null default 0,
  duplicadas int not null default 0,
  importadas int,
  rejeitadas int,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  confirmado_por uuid references perfis(id),
  confirmado_em timestamptz
);
create trigger trg_fis_imp_lotes_sem_delete before delete on fis_imp_lotes for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_imp_lotes after insert or update on fis_imp_lotes for each row execute function fn_auditoria();

create table fis_imp_linhas (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references fis_imp_lotes(id),
  linha int not null,
  empresa_id uuid references empresas(id),
  dados jsonb not null,
  erros text[] not null default '{}',
  status text not null check (status in ('valida', 'erro', 'duplicada', 'importada', 'rejeitada')),
  registro_id uuid,
  mensagem text,
  unique (lote_id, linha)
);
create trigger trg_fis_imp_linhas_sem_delete before delete on fis_imp_linhas for each row execute function fn_bloquear_delete();

alter table fis_imp_lotes enable row level security;
alter table fis_imp_linhas enable row level security;
create policy fis_imp_lotes_ler on fis_imp_lotes for select to authenticated using (fis_pode('lancar'));
create policy fis_imp_linhas_ler on fis_imp_linhas for select to authenticated
  using (fis_pode('lancar', empresa_id) and exists (select 1 from fis_imp_lotes l where l.id = lote_id));

-- Prepara o lote: a aplicação já normalizou formatos (datas ISO, valores com ponto) e mandou os erros de formato de cada
-- linha; aqui entram as consultas aos cadastros, o escopo da empresa e as duplicidades (no arquivo e na base).
create function fis_imp_preparar(p_tipo text, p_arquivo text, p_mapeamento jsonb, p_linhas jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_lote uuid;
  x jsonb;
  v_erros text[];
  v_d jsonb;
  e fis_estabelecimentos;
  v_trib uuid; v_cat fis_categorias; c fis_creditos; t fis_tipos_movimento;
  v_chave text;
  v_chaves text[] := '{}';
  v_dup boolean;
  v_status text;
begin
  perform fis_exigir('lancar');
  if p_tipo not in ('creditos', 'movimentos') then raise exception 'Tipo de importação inválido.'; end if;
  if jsonb_array_length(coalesce(p_linhas, '[]'::jsonb)) = 0 then raise exception 'A planilha não tem linhas.'; end if;
  if jsonb_array_length(p_linhas) > 5000 then raise exception 'Máximo de 5.000 linhas por importação.'; end if;
  insert into fis_imp_lotes (tipo, arquivo_nome, mapeamento) values (p_tipo, left(p_arquivo, 200), coalesce(p_mapeamento, '{}'::jsonb)) returning id into v_lote;

  for x in select * from jsonb_array_elements(p_linhas) loop
    v_erros := coalesce(array(select jsonb_array_elements_text(x -> 'erros')), '{}');
    v_d := x -> 'dados';
    v_dup := false;
    e := null; c := null; v_cat := null; t := null; v_trib := null; v_chave := null;
    if p_tipo = 'creditos' then
      select * into e from fis_estabelecimentos where cnpj = v_d ->> 'cnpj_estabelecimento';
      if e.id is null then v_erros := array_append(v_erros, 'Estabelecimento (CNPJ) não cadastrado.'::text);
      elsif not fis_pode('lancar', e.empresa_id) then v_erros := array_append(v_erros, 'Sem permissão para a empresa deste estabelecimento.'::text); e := null;
      end if;
      select id into v_trib from fis_tributos where codigo = upper(v_d ->> 'tributo') and ativo;
      if v_trib is null then v_erros := array_append(v_erros, ('Tributo "' || coalesce(v_d ->> 'tributo', '') || '" não cadastrado.')::text); end if;
      select * into v_cat from fis_categorias where codigo = upper(v_d ->> 'categoria') and ativo;
      if v_cat.id is null then v_erros := array_append(v_erros, ('Categoria "' || coalesce(v_d ->> 'categoria', '') || '" não cadastrada.')::text);
      elsif v_cat.tributo_id is not null and v_cat.tributo_id is distinct from v_trib then v_erros := array_append(v_erros, 'Categoria de outro tributo.'::text);
      elsif v_cat.exige_processo and nullif(v_d ->> 'numero_processo', '') is null then v_erros := array_append(v_erros, 'A categoria exige o número do processo.'::text);
      end if;
      if nullif(v_d ->> 'origem', '') is not null and not exists (select 1 from fis_origens where codigo = v_d ->> 'origem') then
        v_erros := array_append(v_erros, ('Origem "' || (v_d ->> 'origem') || '" não cadastrada.')::text);
      end if;
      if e.id is not null and v_trib is not null and v_cat.id is not null and cardinality(v_erros) = 0 then
        v_chave := concat_ws('|', e.id, v_trib, v_cat.id, coalesce(nullif(v_d ->> 'origem', ''), 'importacao_planilha'), v_d ->> 'competencia_origem',
                             (v_d ->> 'valor_original')::numeric, coalesce(v_d ->> 'numero_processo', ''));
        v_dup := v_chave = any (v_chaves) or exists (
          select 1 from fis_creditos k where not k.arquivado and k.estabelecimento_id = e.id and k.tributo_id = v_trib and k.categoria_id = v_cat.id
             and k.origem = coalesce(nullif(v_d ->> 'origem', ''), 'importacao_planilha') and k.competencia_origem = (v_d ->> 'competencia_origem')::date
             and k.valor_original = (v_d ->> 'valor_original')::numeric and coalesce(k.numero_processo, '') = coalesce(v_d ->> 'numero_processo', ''));
        v_d := v_d || jsonb_build_object('estabelecimento_id', e.id, 'tributo_id', v_trib, 'categoria_id', v_cat.id,
                                         'origem', coalesce(nullif(v_d ->> 'origem', ''), 'importacao_planilha'));
      end if;
    else
      select * into c from fis_creditos where codigo = upper(v_d ->> 'codigo_credito');
      if c.id is null then v_erros := array_append(v_erros, ('Crédito "' || coalesce(v_d ->> 'codigo_credito', '') || '" não encontrado.')::text);
      elsif not fis_pode('lancar', c.empresa_id) then v_erros := array_append(v_erros, 'Sem permissão para a empresa do crédito.'::text); c := null;
      elsif c.arquivado then v_erros := array_append(v_erros, 'Crédito arquivado.'::text);
      end if;
      select * into t from fis_tipos_movimento where codigo = lower(v_d ->> 'tipo') and ativo;
      if t.codigo is null then v_erros := array_append(v_erros, ('Tipo "' || coalesce(v_d ->> 'tipo', '') || '" não cadastrado.')::text);
      elsif t.codigo in ('estorno', 'saldo_inicial', 'transferencia_saida', 'transferencia_entrada') then
        v_erros := array_append(v_erros, 'Estorno, saldo inicial e transferência não são importados (use as rotinas próprias).'::text);
      elsif t.exige_protocolo and nullif(v_d ->> 'protocolo', '') is null then v_erros := array_append(v_erros, 'Este tipo exige o protocolo.'::text);
      end if;
      if c.id is not null and t.codigo is not null and cardinality(v_erros) = 0 then
        v_chave := concat_ws('|', c.id, t.codigo, v_d ->> 'competencia', v_d ->> 'data', (v_d ->> 'valor')::numeric, coalesce(v_d ->> 'protocolo', ''));
        v_dup := v_chave = any (v_chaves) or exists (
          select 1 from fis_movimentos m where m.credito_id = c.id and m.tipo = t.codigo and m.competencia = (v_d ->> 'competencia')::date
             and m.data = (v_d ->> 'data')::date and m.valor = (v_d ->> 'valor')::numeric and coalesce(m.protocolo, '') = coalesce(v_d ->> 'protocolo', '')
             and not m.estornado and m.status <> 'rejeitado' and m.tipo <> 'estorno');
        v_d := v_d || jsonb_build_object('credito_id', c.id, 'tipo', t.codigo);
      end if;
    end if;
    if v_chave is not null then v_chaves := v_chaves || v_chave; end if;
    v_status := case when cardinality(v_erros) > 0 then 'erro' when v_dup then 'duplicada' else 'valida' end;
    insert into fis_imp_linhas (lote_id, linha, empresa_id, dados, erros, status)
    values (v_lote, (x ->> 'linha')::int, coalesce(e.empresa_id, c.empresa_id), v_d,
            case when v_dup then array_append(v_erros, 'Duplicada (no arquivo ou já cadastrada).') else v_erros end, v_status);
  end loop;
  update fis_imp_lotes set total = (select count(*) from fis_imp_linhas where lote_id = v_lote),
         validas = (select count(*) from fis_imp_linhas where lote_id = v_lote and status = 'valida'),
         com_erro = (select count(*) from fis_imp_linhas where lote_id = v_lote and status = 'erro'),
         duplicadas = (select count(*) from fis_imp_linhas where lote_id = v_lote and status = 'duplicada')
   where id = v_lote;
  return v_lote;
end $$;

-- Confirma: importa as linhas válidas pelas funções do cadastro (cada linha com as regras de sempre, em ordem cronológica);
-- a linha que falhar fica "rejeitada" com o motivo, sem desfazer as demais.
create function fis_imp_confirmar(p_lote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l fis_imp_lotes; x fis_imp_linhas; v_id uuid; v_ok int := 0; v_rej int := 0;
begin
  select * into l from fis_imp_lotes where id = p_lote for update;
  if l.id is null then raise exception 'Lote não encontrado.'; end if;
  perform fis_exigir('lancar');
  if l.status <> 'validado' then raise exception 'Este lote já foi % .', l.status; end if;
  for x in select * from fis_imp_linhas where lote_id = l.id and status = 'valida'
            order by (dados ->> case when l.tipo = 'creditos' then 'competencia_origem' else 'competencia' end), dados ->> 'data', linha loop
    begin
      if l.tipo = 'creditos' then
        v_id := fis_credito_criar(x.dados || jsonb_build_object('importacao_lote_id', l.id, 'origem_registro', 'importacao'));
      else
        v_id := fis_movimento_registrar(x.dados || jsonb_build_object('origem_registro', 'importacao'));
      end if;
      update fis_imp_linhas set status = 'importada', registro_id = v_id where id = x.id;
      v_ok := v_ok + 1;
    exception when others then
      update fis_imp_linhas set status = 'rejeitada', mensagem = sqlerrm where id = x.id;
      v_rej := v_rej + 1;
    end;
  end loop;
  update fis_imp_lotes set status = 'confirmado', confirmado_por = auth.uid(), confirmado_em = now(), importadas = v_ok, rejeitadas = v_rej where id = l.id;
  insert into importacoes (modulo, tipo, arquivo, mapeamento, linhas_novas, linhas_divergentes)
  values ('fiscal.creditos', l.tipo, l.arquivo_nome, l.mapeamento, v_ok, v_rej + l.com_erro + l.duplicadas);
  return jsonb_build_object('importadas', v_ok, 'rejeitadas', v_rej, 'com_erro', l.com_erro, 'duplicadas', l.duplicadas);
end $$;

create function fis_imp_descartar(p_lote uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fis_exigir('lancar');
  update fis_imp_lotes set status = 'descartado' where id = p_lote and status = 'validado';
  if not found then raise exception 'Lote não encontrado ou já processado.'; end if;
end $$;

-- 4) PRIVILÉGIOS (mesma regra da 0202, para as funções novas) -----------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'fis\_%' and p.prorettype <> 'trigger'::regtype loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname in ('fis_periodo_garantir', 'fis_mov_inserir', 'fis_registrar_decisao', 'fis_docs_do_alvo', 'fis_apuracao_chave',
                     'fis_periodo_obter', 'fis_alvo_empresa', 'fis_saldo_minimo_apos', 'fis_vencimento_pela_regra') then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
