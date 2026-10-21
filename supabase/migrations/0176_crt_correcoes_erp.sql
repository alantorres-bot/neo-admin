-- Cartão de crédito: CORREÇÕES pela API em títulos da fatura que o painel não criou (decisões do Alan, 21/10/2026, depois do
-- Nubank PF e do PicPay PF 10/2026). Regras 69 a 71 de docs/modulos/financeiro-cartao.md.
--   * cartao      — título casado à mão que cita OUTRO cartão (ex.: 245104/1 "CARTÃO SICREDI PJ — TQS" pago no PicPay): troca o
--                   nome do cartão no complemento, o banco/histórico para os do cartão certo e o vencimento para o da fatura;
--   * vencimento  — título conciliado com vencimento fora do da fatura e do dia do cartão (ex.: 28/10 no Nubank, que vence 27);
--   * conta_fluxo — título com conta de fluxo de caixa inativa (o Consistem recusa qualquer alteração nele, inclusive a troca
--                   do banco no fechamento).
-- Operador ou acima, só com o mês em conciliação, chave própria (começa ligada). O envio (Edge Function crt-corrigir-no-consistem)
-- lê o título antes, altera só os campos da correção, lê depois e confere. Tudo fica registrado em crt_correcoes_erp (prova).

-- 1) Chave --------------------------------------------------------------------------------------------------------------------
insert into configuracoes (chave, valor, descricao) values
  ('financeiro.cartao.corrigir_no_erp', 'true',
   'Cartão de crédito: correções pela API em títulos da fatura (trocar cartão, acertar vencimento, trocar conta de fluxo). Desligado = o painel só aponta.')
on conflict (chave) do nothing;

create function crt_corrigir_no_erp_ligado() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select valor from configuracoes where chave = 'financeiro.cartao.corrigir_no_erp'), 'false'::jsonb) = 'true'::jsonb
$$;

-- 2) Correções (prova) ----------------------------------------------------------------------------------------------------------
create type crt_tipo_correcao as enum ('cartao', 'vencimento', 'conta_fluxo');
create type crt_situacao_correcao as enum ('reservado', 'enviando', 'corrigido', 'erro');

create table crt_correcoes_erp (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references crt_faturas(id),
  ciclo_id uuid not null references crt_ciclos(id),
  cod_lancamento text not null check (cod_lancamento ~ '^\d{1,12}$'),
  num_documento text,
  tipo crt_tipo_correcao not null,
  alteracao jsonb not null,                                -- só os campos que o PUT grava (conferidos depois)
  situacao crt_situacao_correcao not null default 'reservado',
  antes jsonb,                                             -- detalhe do lançamento antes do PUT
  depois jsonb,                                            -- detalhe depois do PUT (conferência)
  resposta jsonb,
  erro text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  concluido_em timestamptz
);
comment on table crt_correcoes_erp is 'Correções feitas pelo painel em títulos da fatura do cartão no Consistem (cartão, vencimento, conta de fluxo): antes, depois e quem. Nunca apagadas.';
create unique index uq_crt_correcoes_erp_ativa on crt_correcoes_erp (cod_lancamento, tipo) where situacao in ('reservado', 'enviando');
create index idx_crt_correcoes_erp_ciclo on crt_correcoes_erp (ciclo_id);

create function fn_crt_correcao_regras() returns trigger language plpgsql as $$
begin
  if (new.fatura_id, new.ciclo_id, new.cod_lancamento, new.tipo, new.alteracao, new.criado_por, new.criado_em)
     is distinct from (old.fatura_id, old.ciclo_id, old.cod_lancamento, old.tipo, old.alteracao, old.criado_por, old.criado_em) then
    raise exception 'A correção é imutável (título, tipo, alteração, quem e quando).';
  end if;
  if old.situacao in ('corrigido', 'erro') then
    raise exception 'Esta correção já foi concluída.';
  end if;
  if new.situacao <> old.situacao and not (
       (old.situacao = 'reservado' and new.situacao in ('enviando', 'erro')) or
       (old.situacao = 'enviando' and new.situacao in ('corrigido', 'erro'))) then
    raise exception 'Mudança de situação inválida: % → %.', old.situacao, new.situacao;
  end if;
  return new;
end $$;
create trigger trg_crt_correcoes_erp_regras before update on crt_correcoes_erp for each row execute function fn_crt_correcao_regras();
create trigger trg_crt_correcoes_erp_sem_delete before delete on crt_correcoes_erp for each row execute function fn_bloquear_delete();
create trigger trg_aud_crt_correcoes_erp after insert or update on crt_correcoes_erp for each row execute function fn_auditoria();

alter table crt_correcoes_erp enable row level security;
create policy crt_correcoes_erp_ler on crt_correcoes_erp for select to authenticated using (tem_acesso_area('financeiro'));

create view crt_vw_correcoes_erp with (security_invoker = true) as
select c.*, p.nome as criado_por_nome
  from crt_correcoes_erp c
  left join perfis p on p.id = c.criado_por;

-- 3) Reservar (operador; o painel já conferiu que o título é elegível) -------------------------------------------------------
create function crt_reservar_correcao(p_fatura uuid, p_cod text, p_num_documento text, p_tipo crt_tipo_correcao, p_alteracao jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fatura crt_faturas;
  v_situacao crt_situacao_ciclo;
  v_comp text;
  v_outro text;
  v_id uuid;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) corrige títulos no Consistem.';
  end if;
  if not crt_corrigir_no_erp_ligado() then
    raise exception 'As correções no Consistem estão desligadas (Configurações: financeiro.cartao.corrigir_no_erp).';
  end if;
  v_fatura := crt_fatura_editavel(p_fatura);
  select situacao into v_situacao from crt_ciclos where id = v_fatura.ciclo_id;
  if v_fatura.ciclo_id is null or v_situacao is distinct from 'em_conciliacao' then
    raise exception 'Só se corrigem títulos de uma fatura com o mês em conciliação.';
  end if;
  if coalesce(p_cod, '') !~ '^\d{1,12}$' then
    raise exception 'Código de lançamento inválido.';
  end if;
  if jsonb_typeof(p_alteracao) is distinct from 'object' then
    raise exception 'Alteração inválida.';
  end if;
  case p_tipo
    when 'vencimento' then
      if (select array_agg(k order by k) from jsonb_object_keys(p_alteracao) k) <> array['dataVencimento']
         or coalesce(p_alteracao ->> 'dataVencimento', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Acertar vencimento altera só a data de vencimento (AAAA-MM-DD).';
      end if;
    when 'conta_fluxo' then
      if (select array_agg(k order by k) from jsonb_object_keys(p_alteracao) k) <> array['contaFluxoCaixa', 'grupoContaFluxoCaixa'] then
        raise exception 'Trocar a conta de fluxo altera só o grupo e a conta.';
      end if;
      if not exists (select 1 from cap_contas_fluxo where grupo = (p_alteracao ->> 'grupoContaFluxoCaixa')::int
                                                     and item = (p_alteracao ->> 'contaFluxoCaixa')::int and ativa) then
        raise exception 'A conta de fluxo %/% não existe ou está inativa.', p_alteracao ->> 'grupoContaFluxoCaixa', p_alteracao ->> 'contaFluxoCaixa';
      end if;
    when 'cartao' then
      if exists (select 1 from jsonb_object_keys(p_alteracao) k where k not in ('complementoHistorico', 'dataVencimento', 'codPortador', 'codHistorico')) then
        raise exception 'Trocar o cartão altera só o complemento, o vencimento, o banco e o histórico.';
      end if;
      v_comp := p_alteracao ->> 'complementoHistorico';
      if coalesce(length(v_comp), 0) = 0 or length(v_comp) > 60 then
        raise exception 'O complemento novo precisa ter de 1 a 60 caracteres.';
      end if;
      -- Título que está no fechamento vigente de um mês FECHADO ou PAGO de outro cartão: não mexe (reabra aquele mês).
      select c.cartao || ' ' || to_char(c.competencia, 'MM/YYYY') into v_outro
        from crt_fechamentos f join crt_ciclos c on c.id = f.ciclo_id
       where f.reaberto_em is null and c.situacao in ('fechada', 'paga') and c.id <> v_fatura.ciclo_id
         and jsonb_path_exists(f.resultado, '$.resultado.conciliados[*] ? (@.titulo.codLancamento == $c || exists(@.titulosExtras[*] ? (@.codLancamento == $c)))',
                               jsonb_build_object('c', p_cod))
       limit 1;
      if v_outro is not null then
        raise exception 'O título % está no fechamento do % (mês fechado ou pago): reabra aquele mês ou corrija à mão.', p_cod, v_outro;
      end if;
  end case;
  begin
    insert into crt_correcoes_erp (fatura_id, ciclo_id, cod_lancamento, num_documento, tipo, alteracao)
    values (p_fatura, v_fatura.ciclo_id, p_cod, nullif(trim(p_num_documento), ''), p_tipo, p_alteracao)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já há uma correção deste tipo em andamento para o título %.', p_cod;
  end;
  return v_id;
end $$;
revoke all on function crt_reservar_correcao(uuid, text, text, crt_tipo_correcao, jsonb) from public, anon;
grant execute on function crt_reservar_correcao(uuid, text, text, crt_tipo_correcao, jsonb) to authenticated;

-- 4) Envio (Edge Function, service role) --------------------------------------------------------------------------------------
create function crt_iniciar_correcao(p_id uuid) returns crt_correcoes_erp
language plpgsql security definer set search_path = public as $$
declare
  v crt_correcoes_erp;
begin
  update crt_correcoes_erp set situacao = 'enviando', enviado_em = now() where id = p_id and situacao = 'reservado' returning * into v;
  if v.id is null then raise exception 'A correção não está reservada.'; end if;
  return v;
end $$;

create function crt_concluir_correcao(p_id uuid, p_corrigido boolean, p_antes jsonb, p_depois jsonb, p_resposta jsonb, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update crt_correcoes_erp
     set situacao = case when p_corrigido then 'corrigido'::crt_situacao_correcao else 'erro'::crt_situacao_correcao end,
         antes = p_antes, depois = p_depois, resposta = p_resposta,
         erro = case when p_corrigido then null else coalesce(nullif(trim(p_erro), ''), 'Erro não informado.') end,
         concluido_em = now()
   where id = p_id and situacao in ('reservado', 'enviando');
  if not found then raise exception 'A correção não está em envio.'; end if;
end $$;
revoke all on function crt_iniciar_correcao(uuid) from public, anon, authenticated;
revoke all on function crt_concluir_correcao(uuid, boolean, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function crt_iniciar_correcao(uuid) to service_role;
grant execute on function crt_concluir_correcao(uuid, boolean, jsonb, jsonb, jsonb, text) to service_role;
