-- =========================================================
-- Neo Admin — 0148 Faturamento da Filial: remessa e aviso a Cuiabá
-- Os arquivos não vão mais por e-mail: a filial sobe as notas no Neo Admin e manda a Cuiabá só um AVISO (e-mail aberto
-- pronto no programa de e-mail dela) com a relação NF, cliente, vencimento e valor e o link da remessa. Cuiabá entra na
-- remessa, baixa as notas e implanta no Consistem; a sincronização liga o título ao kit pela NF (0146).
--  - rec_remessas: cada envio em lote (nº sequencial, quem, quando, quando o aviso foi aberto). Sem exclusão.
--  - rec_remessa_kits: kits de cada remessa (uma NF pode voltar em outra remessa para completar documentos).
--  - rec_kits.parcelas_informadas: vencimento e valor de cada parcela como estão na nota (lidos do PDF e conferidos
--    pela filial). Servem para o aviso e para comparar com o título quando ele chegar do Consistem.
--  - Pendência por REMESSA ("Implantar remessa nº N da filial"), não mais por NF; fecha quando todas as NFs dela
--    estiverem implantadas.
--  - financeiro.filial.aviso_destinatarios: quem recebe o aviso (hoje os mesmos do e-mail da filial).
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.filial.aviso_destinatarios', '["rodrigofelicio@neoformas.com.br","admcuiaba@neoformas.com.br","daline.alves@neoformas.com.br"]',
   'E-mails de Cuiabá que recebem o aviso de remessa de faturas da Filial Contagem.')
on conflict (chave) do nothing;

-- 1) Tabelas -------------------------------------------------------------------------------------------------------------
create sequence rec_remessas_numero_seq;

create table rec_remessas (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique default nextval('rec_remessas_numero_seq'),
  empresa_id uuid not null references empresas(id),
  unidade text not null default 'contagem' check (unidade = 'contagem'),
  observacao text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  aviso_aberto_em timestamptz,
  aviso_aberto_por uuid references perfis(id)
);
alter sequence rec_remessas_numero_seq owned by rec_remessas.numero;

create table rec_remessa_kits (
  remessa_id uuid not null references rec_remessas(id),
  kit_id uuid not null references rec_kits(id),
  primary key (remessa_id, kit_id)
);
create index idx_rec_remessa_kits_kit on rec_remessa_kits (kit_id);

alter table rec_kits add column parcelas_informadas jsonb not null default '[]'
  check (jsonb_typeof(parcelas_informadas) = 'array');

alter table rec_remessas enable row level security;
create policy rec_remessas_ler on rec_remessas for select to authenticated using (tem_acesso_area('financeiro'));
create policy rec_remessas_inserir on rec_remessas for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
create trigger trg_rec_remessas_sem_delete before delete on rec_remessas for each row execute function fn_bloquear_delete();
create trigger trg_aud_rec_remessas after insert or update or delete on rec_remessas for each row execute function fn_auditoria();

alter table rec_remessa_kits enable row level security;
create policy rec_remessa_kits_ler on rec_remessa_kits for select to authenticated using (tem_acesso_area('financeiro'));
create policy rec_remessa_kits_inserir on rec_remessa_kits for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
create trigger trg_rec_remessa_kits_sem_delete before delete on rec_remessa_kits for each row execute function fn_bloquear_delete();
create trigger trg_aud_rec_remessa_kits after insert or update or delete on rec_remessa_kits for each row execute function fn_auditoria();

-- 2) Parcelas informadas: [{ "vencimento": "aaaa-mm-dd", "valor": 1234.56 }, ...] -------------------------------------------
create function rec_parcelas_informadas_validas(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  e jsonb;
  saida jsonb := '[]';
begin
  if p is null then
    return '[]';
  end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 24 then
    raise exception 'Parcelas inválidas.';
  end if;
  for e in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object' or (e ->> 'vencimento') !~ '^\d{4}-\d{2}-\d{2}$'
       or (e ->> 'valor') is null or (e ->> 'valor')::numeric <= 0 then
      raise exception 'Cada parcela precisa de vencimento e valor maior que zero.';
    end if;
    saida := saida || jsonb_build_object('vencimento', ((e ->> 'vencimento')::date)::text, 'valor', round((e ->> 'valor')::numeric, 2));
  end loop;
  return (select coalesce(jsonb_agg(x order by x ->> 'vencimento'), '[]') from jsonb_array_elements(saida) x);
end $$;

-- 3) Criar a remessa -------------------------------------------------------------------------------------------------------
create function rec_remessa_criar(p_observacao text default null, p_empresa uuid default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_empresa uuid := p_empresa;
  r rec_remessas%rowtype;
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima registra remessas da filial.';
  end if;
  if v_empresa is null then
    select (array_agg(id))[1] into v_empresa from empresas where ativa and codigo_erp is not null having count(*) = 1;
    if v_empresa is null then
      raise exception 'Não foi possível identificar a empresa da filial; informe a empresa.';
    end if;
  end if;
  insert into rec_remessas (empresa_id, observacao) values (v_empresa, nullif(btrim(p_observacao), '')) returning * into r;
  return jsonb_build_object('id', r.id, 'numero', r.numero);
end $$;
revoke all on function rec_remessa_criar(text, uuid) from public, anon;
grant execute on function rec_remessa_criar(text, uuid) to authenticated;

-- 4) Registrar o kit (nova assinatura: remessa e parcelas informadas) ------------------------------------------------------
-- Com remessa, a pendência de implantação é da remessa (aberta em rec_remessa_concluir); sem remessa, segue por NF (0146).
drop function rec_kit_registrar(text, text, boolean, text, date, date, uuid);
create function rec_kit_registrar(
  p_nota text, p_cliente text, p_aceita_boleto_factoring boolean,
  p_obra text default null, p_periodo_inicio date default null, p_periodo_fim date default null, p_empresa uuid default null,
  p_remessa uuid default null, p_parcelas jsonb default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_digitos text := regexp_replace(coalesce(p_nota, ''), '[^0-9]', '', 'g');
  v_nota text := case when length(v_digitos) between 1 and 6 then lpad(v_digitos, 6, '0') end;
  v_empresa uuid := p_empresa;
  v_parcelas jsonb := rec_parcelas_informadas_validas(p_parcelas);
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
  if p_remessa is not null then
    select empresa_id into v_empresa from rec_remessas where id = p_remessa;
    if v_empresa is null then
      raise exception 'Remessa não encontrada.';
    end if;
  elsif v_empresa is null then
    select (array_agg(id))[1] into v_empresa from empresas where ativa and codigo_erp is not null having count(*) = 1;
    if v_empresa is null then
      raise exception 'Não foi possível identificar a empresa da filial; informe a empresa.';
    end if;
  end if;

  select id, estagio into v_id, v_estagio from rec_kits where empresa_id = v_empresa and nota_fiscal = v_nota and estagio <> 'cancelada';
  if v_id is null then
    insert into rec_kits (empresa_id, nota_fiscal, cliente_nome, obra, periodo_inicio, periodo_fim, aceita_boleto_factoring, parcelas_informadas)
    values (v_empresa, v_nota, btrim(p_cliente), nullif(btrim(p_obra), ''), p_periodo_inicio, p_periodo_fim, coalesce(p_aceita_boleto_factoring, true), v_parcelas)
    returning id into v_id;
    select estagio into v_estagio from rec_kits where id = v_id; -- o gatilho já ligou títulos que existiam
  elsif v_estagio <> 'enviada' then
    update rec_kits
       set cliente_nome = btrim(p_cliente), obra = coalesce(nullif(btrim(p_obra), ''), obra),
           periodo_inicio = coalesce(p_periodo_inicio, periodo_inicio), periodo_fim = coalesce(p_periodo_fim, periodo_fim),
           aceita_boleto_factoring = coalesce(p_aceita_boleto_factoring, aceita_boleto_factoring),
           parcelas_informadas = case when jsonb_array_length(v_parcelas) > 0 then v_parcelas else parcelas_informadas end
     where id = v_id;
  end if;

  if p_remessa is not null then
    insert into rec_remessa_kits (remessa_id, kit_id) values (p_remessa, v_id) on conflict do nothing;
  elsif v_estagio = 'recebida' then
    insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    values ('financeiro.filial', v_empresa, format('Implantar fatura da filial: NF %s — %s', v_nota, btrim(p_cliente)),
            case when coalesce(p_aceita_boleto_factoring, true) then 'Implantar no Consistem e emitir o boleto.'
                 else 'Implantar no Consistem. Cliente NÃO aceita boleto de factoring.' end,
            (now() at time zone 'America/Cuiaba')::date, 'normal', 'rec_kits', v_id, '/financeiro/filial/' || v_id)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  end if;
  return v_id;
end $$;
revoke all on function rec_kit_registrar(text, text, boolean, text, date, date, uuid, uuid, jsonb) from public, anon;
grant execute on function rec_kit_registrar(text, text, boolean, text, date, date, uuid, uuid, jsonb) to authenticated;

-- 5) Pendência da remessa ------------------------------------------------------------------------------------------------
-- Fecha a remessa depois de registrados os kits: abre "Implantar remessa nº N" se alguma NF ainda não está no Consistem.
create function rec_remessa_concluir(p_remessa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  r rec_remessas%rowtype;
  v_total int;
  v_faltam int;
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima registra remessas da filial.';
  end if;
  select * into r from rec_remessas where id = p_remessa;
  if not found then
    raise exception 'Remessa não encontrada.';
  end if;
  select count(*), count(*) filter (where k.estagio = 'recebida') into v_total, v_faltam
    from rec_remessa_kits rk join rec_kits k on k.id = rk.kit_id where rk.remessa_id = p_remessa and k.estagio <> 'cancelada';
  if v_total = 0 then
    raise exception 'A remessa nº % não tem faturas.', r.numero;
  end if;
  if v_faltam > 0 then
    insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    values ('financeiro.filial', r.empresa_id, format('Implantar remessa nº %s da filial (%s %s)', r.numero, v_faltam, case when v_faltam = 1 then 'NF' else 'NFs' end),
            'Baixar as notas da remessa, implantar no Consistem e emitir os boletos. A ligação com o título é automática.',
            (now() at time zone 'America/Cuiaba')::date, 'normal', 'rec_remessas', p_remessa, '/financeiro/filial/remessas/' || r.numero)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  end if;
  return v_faltam;
end $$;
revoke all on function rec_remessa_concluir(uuid) from public, anon;
grant execute on function rec_remessa_concluir(uuid) to authenticated;

-- Quando o kit sai de "recebida", fecha a pendência das remessas em que todas as NFs já estão implantadas.
create function fn_rec_kits_remessa_implantada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update pendencias p set status = 'concluida'
   where p.modulo = 'financeiro.filial' and p.referencia_tabela = 'rec_remessas' and p.status in ('aberta', 'em_andamento')
     and p.titulo like 'Implantar remessa%'
     and p.referencia_id in (select remessa_id from rec_remessa_kits where kit_id = new.id)
     and not exists (
       select 1 from rec_remessa_kits rk join rec_kits k on k.id = rk.kit_id
        where rk.remessa_id = p.referencia_id and k.estagio = 'recebida');
  return null;
end $$;
create trigger trg_rec_kits_remessa_implantada after update of estagio on rec_kits
  for each row when (old.estagio = 'recebida' and new.estagio <> 'recebida') execute function fn_rec_kits_remessa_implantada();

-- 6) Aviso aberto (o botão "Abrir e-mail para Cuiabá" registra quando e quem) ------------------------------------------
create function rec_remessa_marcar_aviso(p_remessa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima.';
  end if;
  update rec_remessas set aviso_aberto_em = now(), aviso_aberto_por = auth.uid() where id = p_remessa;
end $$;
revoke all on function rec_remessa_marcar_aviso(uuid) from public, anon;
grant execute on function rec_remessa_marcar_aviso(uuid) to authenticated;

-- 7) View das remessas ---------------------------------------------------------------------------------------------------
create view rec_vw_remessas with (security_invoker = true) as
select r.id, r.numero, r.empresa_id, r.observacao, r.criado_em, r.aviso_aberto_em, p.nome as criado_por_nome,
       count(k.id)::int as kits,
       count(k.id) filter (where k.estagio = 'recebida')::int as aguardando_implantacao,
       count(k.id) filter (where k.estagio in ('pronta', 'enviada'))::int as prontas
  from rec_remessas r
  left join perfis p on p.id = r.criado_por
  left join rec_remessa_kits rk on rk.remessa_id = r.id
  left join rec_kits k on k.id = rk.kit_id and k.estagio <> 'cancelada'
 group by r.id, p.nome;

