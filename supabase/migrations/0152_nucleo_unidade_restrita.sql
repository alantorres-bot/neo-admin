-- =========================================================
-- Neo Admin — 0152 Usuário restrito a uma unidade (Faturamento Filial, Fase D)
-- A Filial Contagem (Melina) usa o Neo Admin só para o Faturamento Filial: não vê a carteira da Matriz, contas a pagar,
-- cartão, AKF nem outras áreas. Regra:
--  - perfis.unidade_restrita ('contagem' ou nulo). Só o admin geral altera (política perfis_alterar); admin geral não é restrito.
--  - nivel_area(): usuário restrito tem 'sem_acesso' em TODAS as áreas -> todas as políticas por área (rec_*, cap_*, crt_*,
--    akf_*, fiscal...) já o barram, sem reescrevê-las.
--  - tem_acesso_modulo(): para o restrito, só 'financeiro.filial', com o nível que ele tem na área do módulo (permissoes).
--    Pendências, anexos e Storage do módulo usam essa função; para os demais usuários nada muda.
--  - Tabelas e funções do Faturamento Filial passam a checar o MÓDULO (financeiro.filial) em vez da área; para quem não é
--    restrito é a mesma coisa (o módulo é da área Financeiro).
--  - rec_titulos: o restrito lê só os títulos da sua unidade (as parcelas ligadas aos kits). Contrapartes: só as que têm
--    título na unidade; não cadastra nem altera contraparte nem contato.
-- =========================================================

alter table perfis add column unidade_restrita text check (unidade_restrita in ('contagem'));
alter table perfis add constraint perfis_admin_sem_restricao check (not (admin_geral and unidade_restrita is not null));

create function unidade_restrita() returns text
language sql stable security definer set search_path = public as $$
  select unidade_restrita from perfis where id = auth.uid();
$$;

-- 1) Nível por área: o restrito não tem área nenhuma -------------------------------------------------------------------
create or replace function nivel_area(p_area text) returns nivel_acesso
language sql stable security definer set search_path = public as $$
  select case
    when eh_admin_geral() then 'administrador'::nivel_acesso
    when not acesso_liberado(auth.uid()) then 'sem_acesso'::nivel_acesso
    when unidade_restrita() is not null then 'sem_acesso'::nivel_acesso
    else coalesce((select pe.nivel from permissoes pe where pe.perfil_id = auth.uid() and pe.area = p_area), 'sem_acesso')
  end;
$$;

-- 2) Acesso por módulo: o restrito só no Faturamento Filial ------------------------------------------------------------
create or replace function tem_acesso_modulo(p_modulo text, p_minimo nivel_acesso default 'consulta') returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when unidade_restrita() is null then tem_acesso_area(area_do_modulo(p_modulo), p_minimo)
    else p_modulo = 'financeiro.filial'
         and acesso_liberado(auth.uid())
         and coalesce((select pe.nivel from permissoes pe where pe.perfil_id = auth.uid() and pe.area = area_do_modulo(p_modulo)), 'sem_acesso') >= p_minimo
  end;
$$;

-- 3) Tabelas do Faturamento Filial: checagem pelo módulo ---------------------------------------------------------------
drop policy rec_kits_ler on rec_kits;
drop policy rec_kits_inserir on rec_kits;
drop policy rec_kits_alterar on rec_kits;
create policy rec_kits_ler on rec_kits for select to authenticated using (tem_acesso_modulo('financeiro.filial'));
create policy rec_kits_inserir on rec_kits for insert to authenticated with check (tem_acesso_modulo('financeiro.filial', 'operador'));
create policy rec_kits_alterar on rec_kits for update to authenticated
  using (tem_acesso_modulo('financeiro.filial', 'operador')) with check (tem_acesso_modulo('financeiro.filial', 'operador'));

drop policy rec_kit_titulos_ler on rec_kit_titulos;
create policy rec_kit_titulos_ler on rec_kit_titulos for select to authenticated using (tem_acesso_modulo('financeiro.filial'));

drop policy rec_remessas_ler on rec_remessas;
drop policy rec_remessas_inserir on rec_remessas;
create policy rec_remessas_ler on rec_remessas for select to authenticated using (tem_acesso_modulo('financeiro.filial'));
create policy rec_remessas_inserir on rec_remessas for insert to authenticated with check (tem_acesso_modulo('financeiro.filial', 'operador'));

drop policy rec_remessa_kits_ler on rec_remessa_kits;
drop policy rec_remessa_kits_inserir on rec_remessa_kits;
create policy rec_remessa_kits_ler on rec_remessa_kits for select to authenticated using (tem_acesso_modulo('financeiro.filial'));
create policy rec_remessa_kits_inserir on rec_remessa_kits for insert to authenticated with check (tem_acesso_modulo('financeiro.filial', 'operador'));

-- 4) Títulos e clientes da unidade --------------------------------------------------------------------------------------
create policy rec_titulos_ler_unidade on rec_titulos for select to authenticated
  using (unidade_restrita() is not null and unidade = unidade_restrita() and tem_acesso_modulo('financeiro.filial'));

drop policy contrapartes_ler on contrapartes;
create policy contrapartes_ler on contrapartes for select to authenticated
  using (tem_acesso_alguma_area('consulta')
         and (not ('colaborador'::tipo_contraparte = any (tipos)) or tem_acesso_area('rh', 'consulta'))
         and (unidade_restrita() is null
              or exists (select 1 from rec_titulos t where t.contraparte_id = contrapartes.id and t.unidade = unidade_restrita())));
drop policy contrapartes_inserir on contrapartes;
create policy contrapartes_inserir on contrapartes for insert to authenticated
  with check (unidade_restrita() is null and tem_acesso_alguma_area('operador')
              and (not ('colaborador'::tipo_contraparte = any (tipos)) or tem_acesso_area('rh', 'operador')));
drop policy contrapartes_alterar on contrapartes;
create policy contrapartes_alterar on contrapartes for update to authenticated
  using (unidade_restrita() is null and tem_acesso_alguma_area('operador')
         and (not ('colaborador'::tipo_contraparte = any (tipos)) or tem_acesso_area('rh', 'operador')))
  with check (unidade_restrita() is null and tem_acesso_alguma_area('operador')
              and (not ('colaborador'::tipo_contraparte = any (tipos)) or tem_acesso_area('rh', 'operador')));
drop policy contatos_inserir on contatos;
create policy contatos_inserir on contatos for insert to authenticated
  with check (unidade_restrita() is null and tem_acesso_alguma_area('operador')
              and exists (select 1 from contrapartes c where c.id = contatos.contraparte_id
                          and (not ('colaborador'::tipo_contraparte = any (c.tipos)) or tem_acesso_area('rh', 'operador'))));
drop policy contatos_alterar on contatos;
create policy contatos_alterar on contatos for update to authenticated
  using (unidade_restrita() is null and tem_acesso_alguma_area('operador')
         and exists (select 1 from contrapartes c where c.id = contatos.contraparte_id
                     and (not ('colaborador'::tipo_contraparte = any (c.tipos)) or tem_acesso_area('rh', 'operador'))))
  with check (unidade_restrita() is null and tem_acesso_alguma_area('operador')
              and exists (select 1 from contrapartes c where c.id = contatos.contraparte_id
                          and (not ('colaborador'::tipo_contraparte = any (c.tipos)) or tem_acesso_area('rh', 'operador'))));

-- Boleto das parcelas da unidade (para o kit e o e-mail ao cliente): o anexo é do módulo Recebíveis, que o restrito não vê.
-- Lê só boleto de título da sua unidade (a subconsulta passa pela RLS de rec_titulos); o arquivo, só se o registro for visível.
create policy anexos_ler_boleto_unidade on anexos for select to authenticated
  using (unidade_restrita() is not null and referencia_tabela = 'rec_titulos' and tipo = 'boleto'
         and exists (select 1 from rec_titulos t where t.id = anexos.referencia_id and t.unidade = unidade_restrita()));
create policy anexos_storage_ler_unidade on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and unidade_restrita() is not null
         and exists (select 1 from anexos a where a.arquivo_path = storage.objects.name));

-- 5) Funções do Faturamento Filial: checagem pelo módulo -----------------------------------------------------------------
create or replace function rec_kit_registrar(
  p_nota text, p_cliente text, p_aceita_boleto_factoring boolean,
  p_obra text default null, p_periodo_inicio date default null, p_periodo_fim date default null, p_empresa uuid default null,
  p_remessa uuid default null, p_parcelas jsonb default null,
  p_emissao date default null, p_cliente_documento text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_digitos text := regexp_replace(coalesce(p_nota, ''), '[^0-9]', '', 'g');
  v_nota text := case when length(v_digitos) between 1 and 6 then lpad(v_digitos, 6, '0') end;
  v_empresa uuid := p_empresa;
  v_parcelas jsonb := rec_parcelas_informadas_validas(p_parcelas);
  v_id uuid;
  v_estagio text;
  v_documento text := nullif(btrim(p_cliente_documento), '');
  v_codigo text;
begin
  if not tem_acesso_modulo('financeiro.filial', 'operador') then
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

  -- Código do cliente no Consistem: pelo CNPJ/CPF, quando o cliente já tem título (contrapartes vem da sincronização).
  if v_documento is not null then
    select codigo_erp into v_codigo from contrapartes where documento = v_documento and codigo_erp is not null order by ativo desc limit 1;
  end if;

  select id, estagio into v_id, v_estagio from rec_kits where empresa_id = v_empresa and nota_fiscal = v_nota and estagio <> 'cancelada';
  if v_id is null then
    insert into rec_kits (empresa_id, nota_fiscal, cliente_nome, obra, periodo_inicio, periodo_fim, aceita_boleto_factoring, parcelas_informadas,
                          data_emissao, cliente_documento, cliente_codigo_erp, cliente_conferido_em)
    values (v_empresa, v_nota, btrim(p_cliente), nullif(btrim(p_obra), ''), p_periodo_inicio, p_periodo_fim, coalesce(p_aceita_boleto_factoring, true), v_parcelas,
            p_emissao, v_documento, v_codigo, case when v_codigo is not null then now() end)
    returning id into v_id;
    select estagio into v_estagio from rec_kits where id = v_id; -- o gatilho já ligou títulos que existiam
  elsif v_estagio <> 'enviada' then
    update rec_kits
       set cliente_nome = btrim(p_cliente), obra = coalesce(nullif(btrim(p_obra), ''), obra),
           periodo_inicio = coalesce(p_periodo_inicio, periodo_inicio), periodo_fim = coalesce(p_periodo_fim, periodo_fim),
           aceita_boleto_factoring = coalesce(p_aceita_boleto_factoring, aceita_boleto_factoring),
           parcelas_informadas = case when jsonb_array_length(v_parcelas) > 0 then v_parcelas else parcelas_informadas end,
           data_emissao = coalesce(p_emissao, data_emissao),
           cliente_documento = coalesce(v_documento, cliente_documento),
           cliente_codigo_erp = coalesce(v_codigo, cliente_codigo_erp),
           cliente_conferido_em = case when v_codigo is not null then now() else cliente_conferido_em end
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

create or replace function rec_kit_cancelar(p_kit uuid, p_motivo text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not tem_acesso_modulo('financeiro.filial', 'operador') then
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

create or replace function rec_remessa_criar(p_observacao text default null, p_empresa uuid default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_empresa uuid := p_empresa;
  r rec_remessas%rowtype;
begin
  if not tem_acesso_modulo('financeiro.filial', 'operador') then
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

create or replace function rec_remessa_concluir(p_remessa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  r rec_remessas%rowtype;
  v_total int;
  v_faltam int;
begin
  if not tem_acesso_modulo('financeiro.filial', 'operador') then
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

create or replace function rec_remessa_marcar_aviso(p_remessa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tem_acesso_modulo('financeiro.filial', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima.';
  end if;
  update rec_remessas set aviso_aberto_em = now(), aviso_aberto_por = auth.uid() where id = p_remessa;
end $$;

create or replace function rec_kit_definir_cliente_erp(p_kit uuid, p_codigo text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not tem_acesso_modulo('financeiro.filial', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima.';
  end if;
  update rec_kits set cliente_codigo_erp = nullif(btrim(p_codigo), ''), cliente_conferido_em = now()
   where id = p_kit and estagio not in ('enviada', 'cancelada');
  if not found then
    raise exception 'Kit não encontrado, enviado ou cancelado.';
  end if;
end $$;
