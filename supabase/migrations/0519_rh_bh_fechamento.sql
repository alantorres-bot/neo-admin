-- =========================================================
-- Neo Admin — 0519 RH/SST > Banco de horas: regra nos dois sentidos e fechamento do ciclo
-- Decisões de 21/10/2026 (docs/modulos/rh-banco-horas.md):
--  - Horas a mais (crédito) não compensadas até o fim do ciclo de origem + 6 meses: a EMPRESA PAGA na folha daquele mês.
--  - Horas a menos (débito) não repostas no mesmo prazo: DESCONTO na folha daquele mês.
--  - O mais antigo primeiro, nos dois sentidos (hora a mais abate a hora a menos mais antiga e vice-versa), em ordem de data.
--  - Fechamento do ciclo (todo mês, depois do dia 25): a operadora emite (foto de quem vence até o dia 25), o gestor aprova, a
--    operadora envia ao escritório e marca "lançado na folha"; só então as horas saem do saldo (lançamentos no dia 25).
-- Substitui a view rh_bh_creditos (um sentido só) e o "pago na folha" manual (rh_bh_pagamentos, vazia).
-- =========================================================

drop view rh_bh_saldos;
drop view rh_bh_creditos;
drop function rh_bh_registrar_pagamento(uuid, int, date, text);
drop function rh_bh_cancelar_pagamento(uuid, text);

-- 1) Fechamento do ciclo ---------------------------------------------------------------------------------------------------
create table rh_bh_fechamentos (
  id uuid primary key default gen_random_uuid(),
  competencia date not null check (extract(day from competencia) = 1),   -- mês da folha; o ciclo fecha no dia 25 dele
  status text not null default 'emitido' check (status in ('emitido', 'devolvido', 'aprovado', 'enviado', 'lancado', 'cancelado')),
  emitido_por uuid references perfis(id) default auth.uid(), emitido_em timestamptz not null default now(),
  aprovado_por uuid references perfis(id), aprovado_em timestamptz,
  devolvido_por uuid references perfis(id), devolvido_em timestamptz, devolvido_motivo text,
  enviado_por uuid references perfis(id), enviado_em timestamptz,
  lancado_por uuid references perfis(id), lancado_em timestamptz,
  cancelado_por uuid references perfis(id), cancelado_em timestamptz, cancelado_motivo text,
  atualizado_em timestamptz not null default now()
);
comment on table rh_bh_fechamentos is 'Fechamento mensal do banco de horas: foto de quem a empresa paga e de quem é descontado na folha do mês (vencidos até o dia 25).';
create unique index uq_rh_bh_fechamento_competencia on rh_bh_fechamentos (competencia) where status not in ('cancelado', 'devolvido');
create trigger trg_rh_bh_fech_atualizado before update on rh_bh_fechamentos for each row execute function fn_atualizado_em();
create trigger trg_rh_bh_fech_sem_delete before delete on rh_bh_fechamentos for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_bh_fech after insert or update on rh_bh_fechamentos for each row execute function fn_auditoria();

create table rh_bh_fechamento_itens (
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null references rh_bh_fechamentos(id),
  pessoa_id uuid not null references rh_bh_pessoas(id),
  nome text not null,
  cpf text not null,
  setor text,
  pagar_min int not null default 0 check (pagar_min >= 0),          -- a empresa paga (horas a mais vencidas)
  descontar_min int not null default 0 check (descontar_min >= 0),  -- descontar (horas a menos vencidas)
  ciclos text,                                                       -- ciclos de origem, para conferência
  unique (fechamento_id, pessoa_id)
);
comment on table rh_bh_fechamento_itens is 'Foto do fechamento por pessoa (não muda depois de emitido).';
create trigger trg_rh_bh_fech_itens_sem_delete before delete on rh_bh_fechamento_itens for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_bh_fech_itens after insert on rh_bh_fechamento_itens for each row execute function fn_auditoria();

-- 2) Lançamentos na folha (substitui rh_bh_pagamentos, vazia) -------------------------------------------------------------
alter table rh_bh_pagamentos rename to rh_bh_lancamentos_folha;
alter table rh_bh_lancamentos_folha
  add column tipo text not null default 'pago' check (tipo in ('pago', 'descontado')),
  add column fechamento_id uuid references rh_bh_fechamentos(id);
alter table rh_bh_lancamentos_folha alter column tipo drop default;
comment on table rh_bh_lancamentos_folha is 'Horas acertadas na folha pelo fechamento (pago = empresa pagou horas a mais; descontado = horas a menos descontadas). Entram na conta no dia 25 da competência.';

alter table rh_bh_fechamentos enable row level security;
alter table rh_bh_fechamento_itens enable row level security;
create policy rh_bh_fech_ler on rh_bh_fechamentos for select to authenticated using (tem_acesso_area('rh'));
create policy rh_bh_fech_itens_ler on rh_bh_fechamento_itens for select to authenticated using (tem_acesso_area('rh'));

-- 3) Cálculo nos dois sentidos (espelho em TS: lib/modulos/rh/banco-horas/modulo.ts, emAberto) ---------------------------------
-- Itens em aberto da pessoa: +1 = horas a folgar (a empresa deve), −1 = horas a repor (o funcionário deve).
create function rh_bh_em_aberto(p_pessoa uuid) returns table (data date, sinal int, restante int, vencimento date)
language plpgsql stable set search_path = public as $$
declare
  v_inicio date := rh_bh_param('inicio')::date;
  v_validade int := rh_bh_param('validade_meses')::int;
  d date[] := '{}'; s int[] := '{}'; r int[] := '{}';
  e record;
  v_sinal int; v_resto int; v_usado int; i int;
begin
  for e in
    select m.data dt, m.positivo_min - m.negativo_min valor, 0 ordem from rh_bh_movimentos m
     where m.pessoa_id = p_pessoa and m.data >= v_inicio and m.positivo_min <> m.negativo_min
    union all
    select (l.competencia + interval '24 days')::date, case l.tipo when 'pago' then -l.minutos else l.minutos end, 1 from rh_bh_lancamentos_folha l
     where l.pessoa_id = p_pessoa and l.cancelado_em is null
    order by 1, 3
  loop
    v_sinal := sign(e.valor); v_resto := abs(e.valor);
    i := 1;
    while v_resto > 0 and i <= coalesce(array_length(d, 1), 0) loop
      if s[i] <> v_sinal and r[i] > 0 then
        v_usado := least(r[i], v_resto);
        r[i] := r[i] - v_usado;
        v_resto := v_resto - v_usado;
      end if;
      i := i + 1;
    end loop;
    if v_resto > 0 then
      d := d || e.dt; s := s || v_sinal; r := r || v_resto;
    end if;
  end loop;
  for i in 1 .. coalesce(array_length(d, 1), 0) loop
    if r[i] > 0 then
      data := d[i]; sinal := s[i]; restante := r[i]; vencimento := rh_bh_vencimento(d[i], v_validade);
      return next;
    end if;
  end loop;
end $$;

create view rh_bh_aberto with (security_invoker = true) as
  select p.id pessoa_id, a.data, a.sinal, a.restante, a.vencimento from rh_bh_pessoas p cross join lateral rh_bh_em_aberto(p.id) a;

-- Situação por pessoa hoje: saldo; a pagar e a descontar (vencidos, vão para o fechamento); a folgar e a repor (vencendo no aviso).
create view rh_bh_saldos with (security_invoker = true) as
with par as (select rh_bh_param('aviso_dias')::int aviso, rh_bh_param('limite_negativo_min')::int limite, (now() at time zone 'America/Cuiaba')::date hoje),
a as (select * from rh_bh_aberto)
select p.id pessoa_id, p.nome, p.cpf, p.setor_id, p.colaborador_id, p.saldo_controlid_min, p.saldo_em,
       coalesce((select sum(a.sinal * a.restante) from a where a.pessoa_id = p.id), 0)::int saldo_min,
       coalesce((select sum(a.restante) from a where a.pessoa_id = p.id and a.sinal = 1 and a.vencimento < par.hoje), 0)::int pagar_min,
       coalesce((select sum(a.restante) from a where a.pessoa_id = p.id and a.sinal = -1 and a.vencimento < par.hoje), 0)::int descontar_min,
       coalesce((select sum(a.restante) from a where a.pessoa_id = p.id and a.sinal = 1 and a.vencimento between par.hoje and par.hoje + par.aviso), 0)::int folgar_min,
       coalesce((select sum(a.restante) from a where a.pessoa_id = p.id and a.sinal = -1 and a.vencimento between par.hoje and par.hoje + par.aviso), 0)::int repor_min,
       (select min(a.vencimento) from a where a.pessoa_id = p.id and a.vencimento >= par.hoje) proximo_vencimento,
       par.limite limite_negativo_min
  from rh_bh_pessoas p cross join par;

-- 4) Fechamento: emitir, aprovar, devolver, enviar, lançar, cancelar ----------------------------------------------------------
create function rh_bh_fechamento_para(p_id uuid, p_status text[]) returns rh_bh_fechamentos
language plpgsql security definer set search_path = public as $$
declare
  f rh_bh_fechamentos;
begin
  select * into f from rh_bh_fechamentos where id = p_id for update;
  if f.id is null then raise exception 'Fechamento não encontrado.'; end if;
  if not (f.status = any (p_status)) then
    raise exception 'O fechamento de % está "%"; esta ação não vale nessa situação.', to_char(f.competencia, 'MM/YYYY'), f.status;
  end if;
  return f;
end $$;
revoke all on function rh_bh_fechamento_para(uuid, text[]) from public, anon, authenticated;

-- Foto de quem vence até o dia 25 da competência: horas a mais (a empresa paga) e a menos (descontar).
create function rh_bh_emitir_fechamento(p_competencia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_corte date := (date_trunc('month', p_competencia) + interval '24 days')::date;
  v_ultimo date;
  v_id uuid;
begin
  perform rh_exigir('operador');
  if exists (select 1 from rh_bh_fechamentos where competencia = v_comp and status not in ('cancelado', 'devolvido')) then
    raise exception 'O fechamento de % já foi emitido.', to_char(v_comp, 'MM/YYYY');
  end if;
  select max(data) into v_ultimo from rh_bh_movimentos;
  if v_ultimo is null or v_ultimo < v_corte then
    raise exception 'Importe antes o CSV do Control iD até %: os dados vão só até %.', to_char(v_corte, 'DD/MM/YYYY'), coalesce(to_char(v_ultimo, 'DD/MM/YYYY'), 'nenhum dia');
  end if;
  insert into rh_bh_fechamentos (competencia) values (v_comp) returning id into v_id;
  insert into rh_bh_fechamento_itens (fechamento_id, pessoa_id, nome, cpf, setor, pagar_min, descontar_min, ciclos)
  select v_id, p.id, p.nome, p.cpf, s.nome,
         coalesce(sum(a.restante) filter (where a.sinal = 1), 0), coalesce(sum(a.restante) filter (where a.sinal = -1), 0),
         string_agg(distinct to_char(rh_bh_fim_ciclo(a.data), 'MM/YYYY'), ', ')
    from rh_bh_aberto a join rh_bh_pessoas p on p.id = a.pessoa_id left join rh_pt_setores s on s.id = p.setor_id
   where a.vencimento <= v_corte
   group by p.id, p.nome, p.cpf, s.nome;
  perform rh_bh_atualizar_pendencias();
  return v_id;
end $$;

create function rh_bh_aprovar_fechamento(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  perform rh_bh_fechamento_para(p_id, array['emitido']);
  update rh_bh_fechamentos set status = 'aprovado', aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
  perform rh_bh_atualizar_pendencias();
end $$;

-- Devolvido: a operadora corrige (ex.: importa o que faltava) e emite de novo; o devolvido fica como registro.
create function rh_bh_devolver_fechamento(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da devolução.'; end if;
  perform rh_bh_fechamento_para(p_id, array['emitido', 'aprovado']);
  update rh_bh_fechamentos set status = 'devolvido', devolvido_por = auth.uid(), devolvido_em = now(), devolvido_motivo = trim(p_motivo) where id = p_id;
  perform rh_bh_atualizar_pendencias();
end $$;

create function rh_bh_marcar_enviado(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('operador');
  perform rh_bh_fechamento_para(p_id, array['aprovado']);
  update rh_bh_fechamentos set status = 'enviado', enviado_por = auth.uid(), enviado_em = now() where id = p_id;
  perform rh_bh_atualizar_pendencias();
end $$;

-- Lançado na folha: as horas da foto saem do saldo (pago / descontado no dia 25 da competência).
create function rh_bh_marcar_lancado(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  f rh_bh_fechamentos;
begin
  perform rh_exigir('operador');
  f := rh_bh_fechamento_para(p_id, array['enviado']);
  insert into rh_bh_lancamentos_folha (pessoa_id, tipo, minutos, competencia, fechamento_id, observacao)
  select pessoa_id, 'pago', pagar_min, f.competencia, f.id, 'Fechamento ' || to_char(f.competencia, 'MM/YYYY') from rh_bh_fechamento_itens where fechamento_id = p_id and pagar_min > 0
  union all
  select pessoa_id, 'descontado', descontar_min, f.competencia, f.id, 'Fechamento ' || to_char(f.competencia, 'MM/YYYY') from rh_bh_fechamento_itens where fechamento_id = p_id and descontar_min > 0;
  update rh_bh_fechamentos set status = 'lancado', lancado_por = auth.uid(), lancado_em = now() where id = p_id;
  perform rh_bh_atualizar_pendencias();
end $$;

-- Cancelar (gestor, com motivo): se já lançado, os lançamentos na folha também ficam cancelados e as horas voltam ao saldo.
create function rh_bh_cancelar_fechamento(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  perform rh_bh_fechamento_para(p_id, array['emitido', 'aprovado', 'enviado', 'lancado']);
  update rh_bh_lancamentos_folha set cancelado_por = auth.uid(), cancelado_em = now(), cancelado_motivo = 'Fechamento cancelado: ' || trim(p_motivo)
   where fechamento_id = p_id and cancelado_em is null;
  update rh_bh_fechamentos set status = 'cancelado', cancelado_por = auth.uid(), cancelado_em = now(), cancelado_motivo = trim(p_motivo) where id = p_id;
  perform rh_bh_atualizar_pendencias();
end $$;

-- 5) Pendências -------------------------------------------------------------------------------------------------------------------
create or replace function rh_bh_atualizar_pendencias() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_desejadas text[] := '{}';
  r record;
  v_titulo text;
begin
  -- vencendo no aviso, por setor: folgar (horas a mais) ou repor (horas a menos) até o vencimento
  for r in select s.setor_id, coalesce(t.nome, 'sem setor') setor, min(s.proximo_vencimento) venc, count(*) pessoas
             from rh_bh_saldos s left join rh_pt_setores t on t.id = s.setor_id where s.folgar_min > 0 or s.repor_min > 0 group by s.setor_id, t.nome loop
    v_titulo := 'Banco de horas vencendo — ' || r.setor || ' (' || to_char(r.venc, 'DD/MM/YYYY') || ')';
    v_desejadas := v_desejadas || v_titulo;
    perform rh_bh_abrir_pendencia(v_titulo, r.pessoas || ' pessoa(s) precisam folgar ou repor horas até o vencimento: avisar o líder (botão "E-mail ao líder").',
            r.venc, case when r.venc <= v_hoje + 7 then 'critica'::criticidade else 'alta'::criticidade end,
            case when r.setor_id is not null then 'rh_pt_setores' end, r.setor_id, '/rh/banco_horas/saldos');
    if auth.uid() is null and r.venc <= v_hoje + 7 then
      update pendencias set criticidade = 'critica' where modulo = 'rh.banco_horas' and titulo = v_titulo and status in ('aberta', 'em_andamento');
    end if;
  end loop;
  -- negativo abaixo do limite
  for r in select pessoa_id, nome from rh_bh_saldos where saldo_min < -limite_negativo_min loop
    v_titulo := 'Banco negativo — ' || r.nome;
    v_desejadas := v_desejadas || v_titulo;
    perform rh_bh_abrir_pendencia(v_titulo, 'Saldo do banco de horas abaixo do limite: combinar a reposição com o líder.', null, 'normal', 'rh_bh_pessoas', r.pessoa_id, '/rh/banco_horas/pessoa/' || r.pessoa_id);
  end loop;
  -- fechamento a emitir: há horas vencidas (a pagar ou a descontar) de um mês sem fechamento em andamento
  for r in select distinct date_trunc('month', a.vencimento)::date comp from rh_bh_aberto a
            where a.vencimento < v_hoje
              and not exists (select 1 from rh_bh_fechamentos f where f.competencia = date_trunc('month', a.vencimento)::date and f.status not in ('cancelado', 'devolvido')) loop
    v_titulo := 'Emitir fechamento do banco de horas — ' || to_char(r.comp, 'MM/YYYY');
    v_desejadas := v_desejadas || v_titulo;
    perform rh_bh_abrir_pendencia(v_titulo, 'Venceram horas no dia 25: importar o CSV até o dia 25 e emitir o fechamento (a empresa paga / descontar na folha).',
            (r.comp + interval '1 month' + interval '1 day')::date, 'alta', null, null, '/rh/banco_horas/fechamentos');
  end loop;
  -- passos do fechamento em andamento
  for r in select id, competencia, status from rh_bh_fechamentos where status in ('emitido', 'aprovado', 'enviado') loop
    v_titulo := case r.status when 'emitido' then 'Aprovar fechamento do banco de horas — ' when 'aprovado' then 'Enviar ao escritório o fechamento do banco de horas — '
                else 'Marcar lançado na folha o banco de horas — ' end || to_char(r.competencia, 'MM/YYYY');
    v_desejadas := v_desejadas || v_titulo;
    perform rh_bh_abrir_pendencia(v_titulo, case r.status when 'emitido' then 'Gestor do RH: conferir e aprovar o fechamento.'
              when 'aprovado' then 'Enviar o relatório do fechamento ao escritório contábil junto com o ponto e marcar "Enviado".'
              else 'Depois que o escritório lançar na folha, marcar "Lançado na folha".' end,
            (r.competencia + interval '1 month' + interval '4 days')::date, 'alta', 'rh_bh_fechamentos', r.id, '/rh/banco_horas/fechamentos/' || r.id);
  end loop;
  update pendencias set status = 'concluida', concluido_em = now()
   where modulo = 'rh.banco_horas' and status in ('aberta', 'em_andamento') and not (titulo = any (v_desejadas));
end $$;
revoke all on function rh_bh_atualizar_pendencias() from public, anon, authenticated;
select rh_bh_atualizar_pendencias();

revoke all on function rh_bh_em_aberto(uuid) from public, anon;
revoke all on function rh_bh_emitir_fechamento(date) from public, anon;
revoke all on function rh_bh_aprovar_fechamento(uuid) from public, anon;
revoke all on function rh_bh_devolver_fechamento(uuid, text) from public, anon;
revoke all on function rh_bh_marcar_enviado(uuid) from public, anon;
revoke all on function rh_bh_marcar_lancado(uuid) from public, anon;
revoke all on function rh_bh_cancelar_fechamento(uuid, text) from public, anon;
