-- =========================================================
-- Neo Admin — 0525 RH/SST > Bonificações: o líder lança a bonificação do mês pelo link (mesma linha do Ponto, 0517)
-- Especificação: docs/modulos/rh-bonificacoes.md.
--  - Um lote por setor (rh_pt_setores) × mês. O RH abre o lote; o link /bonificar/<chave> (64 hex, sem login) vai ao líder.
--  - O líder marca os funcionários ativos do departamento do setor e o percentual de cada um: 5, 10, 15 ou 20% do salário.
--    Ao enviar: nome digitado + IP + data/hora (é prova); o link fecha.
--  - O RH aprova (ou devolve com motivo); a aprovação vira um recibo Eventual por pessoa (rubrica bonificacao_producao)
--    gravado pelo app (rh_fp_gravar_recibo) e ligado ao item por rh_bo_marcar_recibo.
--  - Nada se apaga depois de aprovado; cancelar exige motivo (gestor). Pendências no núcleo (módulo rh.bonificacoes).
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('rh.bonificacoes', 'rh', 'Bonificações', true)
  on conflict (codigo) do update set ativo = true, nome = excluded.nome;

-- 1) Tabelas ---------------------------------------------------------------------------------------------------------------
create table rh_bo_lotes (
  id uuid primary key default gen_random_uuid(),
  setor_id uuid not null references rh_pt_setores(id),
  competencia date not null check (extract(day from competencia) = 1),
  status text not null default 'enviado' check (status in ('enviado', 'devolvido', 'preenchido', 'aprovado', 'cancelado')),
  chave text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  aberto_por uuid references perfis(id) default auth.uid(), aberto_em timestamptz not null default now(),
  preenchido_nome text, preenchido_ip text, preenchido_em timestamptz,
  devolvido_motivo text, devolvido_por uuid references perfis(id), devolvido_em timestamptz,
  aprovado_por uuid references perfis(id), aprovado_em timestamptz,
  cancelado_motivo text, cancelado_por uuid references perfis(id), cancelado_em timestamptz
);
comment on table rh_bo_lotes is 'Bonificação do mês por setor: o líder marca quem tem direito e o percentual pelo link /bonificar/<chave>; o RH aprova e lança na folha.';
create unique index uq_rh_bo_lotes_setor_mes on rh_bo_lotes (setor_id, competencia) where status <> 'cancelado';
create trigger trg_rh_bo_lotes_sem_delete before delete on rh_bo_lotes for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_bo_lotes after insert or update on rh_bo_lotes for each row execute function fn_auditoria();

create table rh_bo_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references rh_bo_lotes(id),
  colaborador_id uuid not null references rh_colaboradores(id),
  pct smallint not null check (pct in (5, 10, 15, 20)),
  recibo_id uuid references rh_fp_recibos(id),
  unique (lote_id, colaborador_id)
);
comment on table rh_bo_itens is 'Quem o líder marcou e o percentual (do salário). recibo_id = recibo Eventual gravado na folha depois da aprovação.';
create trigger trg_aud_rh_bo_itens after insert or update or delete on rh_bo_itens for each row execute function fn_auditoria();

alter table rh_bo_lotes enable row level security;
alter table rh_bo_itens enable row level security;
create policy rh_bo_lotes_ler on rh_bo_lotes for select to authenticated using (tem_acesso_area('rh'));
create policy rh_bo_itens_ler on rh_bo_itens for select to authenticated using (tem_acesso_area('rh'));
-- Sem insert/update/delete direto: tudo pelas funções abaixo.

-- 2) Pendências ------------------------------------------------------------------------------------------------------------
create function rh_bo_rotulo(p_lote uuid) returns text
language sql stable security definer set search_path = public as $$
  select s.nome || ' ' || to_char(l.competencia, 'MM/YYYY') from rh_bo_lotes l join rh_pt_setores s on s.id = l.setor_id where l.id = p_lote
$$;

create function rh_bo_pendencia(p_lote uuid, p_titulo text, p_descricao text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into pendencias (modulo, titulo, descricao, criticidade, referencia_tabela, referencia_id, link)
  values ('rh.bonificacoes', p_titulo || ' — ' || rh_bo_rotulo(p_lote), p_descricao, 'normal', 'rh_bo_lotes', p_lote, '/rh/bonificacoes/lote/' || p_lote)
  on conflict do nothing;
end $$;

create function rh_bo_encerrar(p_lote uuid, p_prefixo text, p_status status_pendencia) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pendencias set status = p_status, concluido_em = case when p_status = 'concluida' then now() else concluido_em end
   where modulo = 'rh.bonificacoes' and referencia_tabela = 'rh_bo_lotes' and referencia_id = p_lote
     and (p_prefixo is null or titulo like p_prefixo || '%') and status in ('aberta', 'em_andamento');
end $$;
revoke all on function rh_bo_rotulo(uuid) from public, anon;
revoke all on function rh_bo_pendencia(uuid, text, text) from public, anon, authenticated;
revoke all on function rh_bo_encerrar(uuid, text, status_pendencia) from public, anon, authenticated;

-- Lote travado na situação esperada (ou erro claro).
create function rh_bo_lote_para(p_lote uuid, p_status text[]) returns rh_bo_lotes
language plpgsql security definer set search_path = public as $$
declare
  l rh_bo_lotes;
begin
  select * into l from rh_bo_lotes where id = p_lote for update;
  if l.id is null then raise exception 'Lote de bonificação não encontrado.'; end if;
  if l.status <> all (p_status) then raise exception 'Não é possível: o lote está "%".', l.status; end if;
  return l;
end $$;
revoke all on function rh_bo_lote_para(uuid, text[]) from public, anon, authenticated;

-- Funcionários ativos do departamento do setor (o casamento é pelo nome, como no Banco de horas, 0520).
create function rh_bo_pessoas_do_setor(p_setor uuid) returns setof rh_colaboradores
language sql stable security definer set search_path = public as $$
  select c.* from rh_colaboradores c join rh_pt_setores s on s.id = p_setor
   where c.ativo and rh_chave_setor(c.departamento) = rh_chave_setor(s.nome)
$$;
revoke all on function rh_bo_pessoas_do_setor(uuid) from public, anon, authenticated;

-- 3) RH ----------------------------------------------------------------------------------------------------------------------
create function rh_bo_abrir_lote(p_setor uuid, p_competencia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform rh_exigir('operador');
  if not exists (select 1 from rh_pt_setores where id = p_setor and ativo) then raise exception 'Setor não encontrado ou inativo.'; end if;
  if exists (select 1 from rh_bo_lotes where setor_id = p_setor and competencia = date_trunc('month', p_competencia)::date and status <> 'cancelado') then
    raise exception 'Já existe lote de bonificação deste setor neste mês.';
  end if;
  insert into rh_bo_lotes (setor_id, competencia) values (p_setor, date_trunc('month', p_competencia)::date) returning id into v_id;
  perform rh_bo_pendencia(v_id, 'Aguardando líder', 'Link da bonificação aberto: mandar ao líder e aguardar o lançamento.');
  return v_id;
end $$;

create function rh_bo_devolver(p_lote uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('operador');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da devolução.'; end if;
  perform rh_bo_lote_para(p_lote, array['preenchido']);
  update rh_bo_lotes set status = 'devolvido', devolvido_motivo = trim(p_motivo), devolvido_por = auth.uid(), devolvido_em = now() where id = p_lote;
  perform rh_bo_encerrar(p_lote, 'Aprovar bonificação', 'cancelada');
  perform rh_bo_pendencia(p_lote, 'Aguardando líder', 'Devolvido ao líder: ' || trim(p_motivo));
end $$;

create function rh_bo_cancelar(p_lote uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  perform rh_bo_lote_para(p_lote, array['enviado', 'devolvido', 'preenchido']);
  update rh_bo_lotes set status = 'cancelado', cancelado_motivo = trim(p_motivo), cancelado_por = auth.uid(), cancelado_em = now() where id = p_lote;
  perform rh_bo_encerrar(p_lote, null, 'cancelada');
end $$;

-- Aprova: exige salário de todos os marcados (a bonificação é % do salário). Os recibos são gravados em seguida pelo app.
create function rh_bo_aprovar(p_lote uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sem text;
begin
  perform rh_exigir('operador');
  perform rh_bo_lote_para(p_lote, array['preenchido']);
  select string_agg(c.nome, ', ' order by c.nome) into v_sem
    from rh_bo_itens i join rh_colaboradores c on c.id = i.colaborador_id where i.lote_id = p_lote and coalesce(c.salario, 0) <= 0;
  if v_sem is not null then raise exception 'Sem salário no cadastro: %. Preencha em Colaboradores antes de aprovar.', v_sem; end if;
  update rh_bo_lotes set status = 'aprovado', aprovado_por = auth.uid(), aprovado_em = now() where id = p_lote;
  perform rh_bo_encerrar(p_lote, 'Aprovar bonificação', 'concluida');
end $$;

create function rh_bo_marcar_recibo(p_item uuid, p_recibo uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('operador');
  update rh_bo_itens i set recibo_id = p_recibo
    from rh_bo_lotes l, rh_fp_recibos r
   where i.id = p_item and l.id = i.lote_id and l.status = 'aprovado' and i.recibo_id is null
     and r.id = p_recibo and r.colaborador_id = i.colaborador_id and r.competencia = l.competencia and not r.cancelado;
  if not found then raise exception 'Item não encontrado, já lançado, ou recibo de outra pessoa/mês.'; end if;
end $$;

revoke all on function rh_bo_abrir_lote(uuid, date) from public, anon;
revoke all on function rh_bo_devolver(uuid, text) from public, anon;
revoke all on function rh_bo_cancelar(uuid, text) from public, anon;
revoke all on function rh_bo_aprovar(uuid) from public, anon;
revoke all on function rh_bo_marcar_recibo(uuid, uuid) from public, anon;

-- 4) Link público --------------------------------------------------------------------------------------------------------------
-- O lote pela chave. Os funcionários (nome e função; sem salário — LGPD) só vêm enquanto o lote está com o líder.
create function rh_bo_link_lote(p_chave text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l rh_bo_lotes;
begin
  if p_chave is null or p_chave !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into l from rh_bo_lotes where chave = p_chave and status <> 'cancelado';
  if l.id is null then return null; end if;
  return jsonb_build_object(
    'setor', (select nome from rh_pt_setores where id = l.setor_id), 'competencia', l.competencia, 'status', l.status,
    'devolvido_motivo', case when l.status = 'devolvido' then l.devolvido_motivo end,
    'preenchido_em', l.preenchido_em, 'preenchido_nome', l.preenchido_nome,
    'pessoas', case when l.status in ('enviado', 'devolvido') then coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'funcao', c.funcao, 'pct', i.pct) order by c.nome)
        from rh_bo_pessoas_do_setor(l.setor_id) c left join rh_bo_itens i on i.lote_id = l.id and i.colaborador_id = c.id), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- Envia o lançamento do líder (substitui o anterior, se devolvido). p_itens: [{colaborador_id, pct}]; lista vazia = ninguém tem direito.
create function rh_bo_link_salvar(p_chave text, p_itens jsonb, p_nome text, p_ip text) returns int
language plpgsql security definer set search_path = public as $$
declare
  l rh_bo_lotes;
  v_n int;
begin
  if p_chave is null or p_chave !~ '^[0-9a-f]{64}$' then raise exception 'Link inválido.'; end if;
  select * into l from rh_bo_lotes where chave = p_chave for update;
  if l.id is null or l.status = 'cancelado' then raise exception 'Link inválido.'; end if;
  if l.status not in ('enviado', 'devolvido') then raise exception 'A bonificação já foi enviada ao RH. Se precisar mudar algo, fale com o RH.'; end if;
  if length(coalesce(trim(p_nome), '')) < 3 then raise exception 'Informe o seu nome para enviar.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 500 then raise exception 'Lançamento inválido.'; end if;
  if exists (select 1 from jsonb_to_recordset(p_itens) as x(colaborador_id uuid, pct int)
              where x.pct is null or x.pct not in (5, 10, 15, 20)
                 or x.colaborador_id not in (select id from rh_bo_pessoas_do_setor(l.setor_id))) then
    raise exception 'Há funcionário fora do setor ou percentual inválido (use 5, 10, 15 ou 20%%).';
  end if;
  if (select count(distinct x.colaborador_id) from jsonb_to_recordset(p_itens) as x(colaborador_id uuid)) <> jsonb_array_length(p_itens) then
    raise exception 'Funcionário repetido no lançamento.';
  end if;
  delete from rh_bo_itens where lote_id = l.id;   -- ainda não aprovado; a auditoria guarda o que havia
  insert into rh_bo_itens (lote_id, colaborador_id, pct) select l.id, x.colaborador_id, x.pct from jsonb_to_recordset(p_itens) as x(colaborador_id uuid, pct int);
  get diagnostics v_n = row_count;
  update rh_bo_lotes set status = 'preenchido', preenchido_nome = left(trim(p_nome), 120), preenchido_ip = left(p_ip, 60), preenchido_em = now() where id = l.id;
  perform rh_bo_encerrar(l.id, 'Aguardando líder', 'concluida');
  perform rh_bo_pendencia(l.id, 'Aprovar bonificação', 'O líder (' || left(trim(p_nome), 120) || ') lançou ' || v_n || ' bonificação(ões): conferir e aprovar.');
  return v_n;
end $$;

revoke all on function rh_bo_link_lote(text) from public;
revoke all on function rh_bo_link_salvar(text, jsonb, text, text) from public;
grant execute on function rh_bo_link_lote(text) to anon, authenticated;
grant execute on function rh_bo_link_salvar(text, jsonb, text, text) to anon, authenticated;
