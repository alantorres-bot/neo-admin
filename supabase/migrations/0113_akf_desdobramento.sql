-- =========================================================
-- Neo Admin — 0113 Antecipação parcial na AKF (desdobramento do título)
-- Alguns títulos são antecipados só em parte na AKF e o Consistem não aceita desdobrar o título em Contas a Receber.
-- O desdobramento fica só aqui, por cima do título: `rec_titulos` continua igual ao Consistem (a sincronização reescreve
-- valor e vencimento dele), e cada antecipação parcial é um lançamento em `akf_desdobramentos` (valor e vencimento da parte
-- na AKF). A parte que fica com a Neo (disponível) é o valor do título menos a soma das partes ativas.
--  - akf_desdobramentos: um lançamento por antecipação parcial (vários por título). Sem exclusão: encerra-se com motivo.
--  - akf_vw_valor_restante: por título com parte ativa, o que está na AKF e o que resta com a Neo.
--  - akf_desdobrar_titulo() e akf_encerrar_desdobramento(): numa transação, com a RLS de quem chama, e registram a interação.
--  - Título encerrado em Recebíveis (pago, cancelado, renegociado) encerra as partes sozinho.
--  - akf_marcar_cedido() (0112) recusa marcar o título inteiro enquanto houver parte ativa.
-- =========================================================

create table akf_desdobramentos (
  id uuid primary key default gen_random_uuid(),
  titulo_id uuid not null references rec_titulos(id),
  valor numeric(14,2) not null check (valor > 0),
  vencimento date not null,                     -- vencimento da parte antecipada (o do borderô)
  data_operacao date not null default (now() at time zone 'America/Cuiaba')::date,
  observacao text,
  status text not null default 'ativo' check (status in ('ativo', 'encerrado')),
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  encerrado_por uuid references perfis(id),
  encerrado_em timestamptz,
  motivo_encerramento text,
  constraint encerramento_registrado check (status = 'ativo' or (encerrado_em is not null and motivo_encerramento is not null))
);
create index idx_akf_desdobramentos_titulo on akf_desdobramentos (titulo_id) where status = 'ativo';

alter table akf_desdobramentos enable row level security;
create policy akf_desdobramentos_ler on akf_desdobramentos for select to authenticated using (tem_acesso_area('financeiro'));
create policy akf_desdobramentos_inserir on akf_desdobramentos for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
create policy akf_desdobramentos_alterar on akf_desdobramentos for update to authenticated
  using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));
create trigger trg_akf_desdobramentos_sem_delete before delete on akf_desdobramentos for each row execute function fn_bloquear_delete();
create trigger trg_aud_akf_desdobramentos after insert or update or delete on akf_desdobramentos for each row execute function fn_auditoria();

-- O que está na AKF e o que resta com a Neo, por título. Só conta enquanto o título está aberto e NÃO foi cedido por inteiro
-- (se o título inteiro passa para a AKF, ele vira um item só e as partes deixam de contar).
create view akf_vw_valor_restante with (security_invoker = true) as
select t.id as titulo_id,
       t.valor as valor_titulo,
       sum(d.valor) as valor_akf,
       t.valor - sum(d.valor) as valor_restante,
       count(*)::int as partes
  from rec_titulos t
  join akf_desdobramentos d on d.titulo_id = t.id and d.status = 'ativo'
 where not t.cedido and t.estagio not in ('pago', 'renegociado', 'cancelado')
 group by t.id, t.valor;

-- Antecipar uma parte do título -------------------------------------------------------------------------------------
create function akf_desdobrar_titulo(
  p_titulo uuid, p_valor numeric, p_vencimento date, p_data_operacao date default null, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_titulo record;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_ja numeric;
  v_id uuid;
  v_restante numeric;
  v_texto text;
begin
  if p_valor is null or p_valor <= 0 then
    raise exception 'Informe o valor antecipado.';
  end if;
  if p_valor <> round(p_valor, 2) then
    raise exception 'O valor antecipado tem no máximo 2 casas decimais.';
  end if;
  if p_vencimento is null then
    raise exception 'Informe o vencimento da parte antecipada.';
  end if;
  if p_data_operacao is not null and p_data_operacao > v_hoje then
    raise exception 'A data da operação não pode ser futura.';
  end if;

  select id, documento, parcela, valor, emissao, estagio, cedido, contraparte_id into v_titulo from rec_titulos where id = p_titulo;
  if not found then
    raise exception 'Título não encontrado (ou você não tem acesso a ele).';
  end if;
  if v_titulo.estagio in ('pago', 'renegociado', 'cancelado') then
    raise exception 'O título já está encerrado.';
  end if;
  if v_titulo.cedido then
    raise exception 'O título inteiro já está na AKF: não há parte para antecipar.';
  end if;
  if v_titulo.emissao is not null and p_vencimento < v_titulo.emissao then
    raise exception 'O vencimento da parte não pode ser anterior à emissão do título.';
  end if;
  if p_vencimento > v_hoje + 1095 then
    raise exception 'O vencimento da parte está longe demais (mais de 3 anos).';
  end if;

  select coalesce(sum(valor), 0) into v_ja from akf_desdobramentos where titulo_id = p_titulo and status = 'ativo';
  v_restante := v_titulo.valor - v_ja - p_valor;
  if v_restante <= 0 then
    raise exception 'O valor antecipado (somado às partes já antecipadas) precisa ser menor que o do título. Para antecipar o título inteiro, use "Marcar como na AKF".';
  end if;

  insert into akf_desdobramentos (titulo_id, valor, vencimento, data_operacao, observacao)
  values (p_titulo, p_valor, p_vencimento, coalesce(p_data_operacao, v_hoje), nullif(trim(coalesce(p_descricao, '')), ''))
  returning id into v_id;

  v_texto := 'Antecipação parcial na AKF: R$ ' || translate(to_char(p_valor, 'FM999,999,999,990.00'), ',.', '.,') || ' com vencimento em ' || to_char(p_vencimento, 'DD/MM/YYYY')
    || '. Restante com a Neo: R$ ' || translate(to_char(v_restante, 'FM999,999,999,990.00'), ',.', '.,') || '.';
  if nullif(trim(coalesce(p_descricao, '')), '') is not null then
    v_texto := v_texto || ' ' || trim(p_descricao);
  end if;
  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  values ('financeiro.akf', v_titulo.contraparte_id, 'rec_titulos', p_titulo, 'interno', 'akf_desdobramento', v_texto, auth.uid());

  return jsonb_build_object('id', v_id, 'restante', v_restante);
end $$;

-- Encerrar uma parte (recompra, liquidação ou lançamento errado) -------------------------------------------------------
create function akf_encerrar_desdobramento(p_id uuid, p_motivo text)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_d record;
  v_contraparte uuid;
  v_atualizados int;
begin
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo do encerramento.';
  end if;
  select id, titulo_id, valor, vencimento, status into v_d from akf_desdobramentos where id = p_id;
  if not found then
    raise exception 'Antecipação parcial não encontrada (ou você não tem acesso a ela).';
  end if;
  if v_d.status <> 'ativo' then
    raise exception 'Esta antecipação parcial já está encerrada.';
  end if;

  update akf_desdobramentos
     set status = 'encerrado', encerrado_por = auth.uid(), encerrado_em = now(), motivo_encerramento = trim(p_motivo)
   where id = p_id and status = 'ativo';
  get diagnostics v_atualizados = row_count;
  if v_atualizados <> 1 then
    raise exception 'Você não tem permissão para encerrar (é preciso ser operador do Financeiro).';
  end if;

  select contraparte_id into v_contraparte from rec_titulos where id = v_d.titulo_id;
  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  values ('financeiro.akf', v_contraparte, 'rec_titulos', v_d.titulo_id, 'interno', 'akf_desdobramento_encerrado',
          'Antecipação parcial de R$ ' || translate(to_char(v_d.valor, 'FM999,999,999,990.00'), ',.', '.,') || ' (vencimento ' || to_char(v_d.vencimento, 'DD/MM/YYYY') || ') encerrada. ' || trim(p_motivo), auth.uid());
  return jsonb_build_object('id', p_id);
end $$;

-- Título encerrado em Recebíveis encerra as partes ------------------------------------------------------------------
create function fn_akf_encerrar_partes_do_titulo() returns trigger language plpgsql as $$
begin
  if new.estagio in ('pago', 'renegociado', 'cancelado') and old.estagio not in ('pago', 'renegociado', 'cancelado') then
    update akf_desdobramentos
       set status = 'encerrado', encerrado_em = now(), motivo_encerramento = 'Título encerrado em Recebíveis (' || new.estagio || ').'
     where titulo_id = new.id and status = 'ativo';
  end if;
  return new;
end $$;
create trigger trg_rec_titulos_encerra_partes after update of estagio on rec_titulos
  for each row execute function fn_akf_encerrar_partes_do_titulo();

-- Marcar o título INTEIRO como na AKF exige encerrar as partes antes (0112 + essa regra) ------------------------------
create or replace function akf_marcar_cedido(p_titulos uuid[], p_cedido boolean, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_qtd int;
  v_atualizados int;
  v_texto text;
begin
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos um título.';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'No máximo 100 títulos de uma vez.';
  end if;

  select count(*) into v_qtd from rec_titulos
   where id = any(v_ids) and estagio not in ('pago', 'renegociado', 'cancelado');
  if v_qtd <> cardinality(v_ids) then
    raise exception 'Algum título já está encerrado (ou você não tem acesso a ele).';
  end if;
  if p_cedido and exists (select 1 from akf_desdobramentos where titulo_id = any(v_ids) and status = 'ativo') then
    raise exception 'Algum título tem antecipação parcial ativa: encerre as partes antes de marcar o título inteiro como na AKF.';
  end if;

  update rec_titulos set cedido = p_cedido where id = any(v_ids) and cedido is distinct from p_cedido;
  get diagnostics v_atualizados = row_count;
  -- A RLS esconde (e não altera) o que a pessoa não pode mexer: se algum título não ficou no estado pedido, é falta de permissão.
  if (select count(*) from rec_titulos where id = any(v_ids) and cedido = p_cedido) <> cardinality(v_ids) then
    raise exception 'Você não tem permissão para marcar títulos (é preciso ser operador do Financeiro).';
  end if;

  v_texto := case when p_cedido then 'Marcado como cedido à AKF.' else 'Retirado da AKF (deixou de ser cedido).' end;
  if nullif(trim(coalesce(p_descricao, '')), '') is not null then
    v_texto := v_texto || ' ' || trim(p_descricao);
  end if;
  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.akf', t.contraparte_id, 'rec_titulos', t.id, 'interno',
         case when p_cedido then 'akf_cessao' else 'akf_retirada' end, v_texto, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  return jsonb_build_object('titulos', cardinality(v_ids), 'alterados', v_atualizados);
end $$;

revoke all on function akf_desdobrar_titulo(uuid, numeric, date, date, text) from public, anon;
grant execute on function akf_desdobrar_titulo(uuid, numeric, date, date, text) to authenticated;
revoke all on function akf_encerrar_desdobramento(uuid, text) from public, anon;
grant execute on function akf_encerrar_desdobramento(uuid, text) to authenticated;
