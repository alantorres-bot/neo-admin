-- =========================================================
-- Neo Admin — 0510 RH/SST: cadastro único de colaboradores (Folha, Fase F1)
-- O cadastro do vale-transporte (rh_vt_colaboradores, 0500/0501) vira o cadastro único do RH, usado pelo VT e pela Folha de
-- pagamento. Especificação: docs/modulos/rh-folha.md, regra 1.
--
-- 1) rh_vt_colaboradores → rh_colaboradores (mesmos registros, ids, auditoria e itens do VT; nada se perde).
--    Novos campos: recebe_vt (os 89 de hoje vieram do VT: true) e matricula_escritorio (código da pessoa no sistema do escritório
--    de contabilidade — o extrato usa esse código; a folha casa pelo CPF).
--    Tarifa/valor fixo só são exigidos de quem recebe VT.
-- 2) Módulo rh.colaboradores (RH > Colaboradores). A aba Colaboradores do VT passa a abrir esta tela.
-- 3) rh_salvar_colaborador substitui rh_vt_salvar_colaborador (mais recebe_vt e matrícula do escritório).
-- 4) O VT passa a considerar só "ativo e recebe VT" ao abrir o mês e ao atualizar do cadastro.
-- =========================================================

-- 1) Tabela -----------------------------------------------------------------------------------------------------------------
alter table rh_vt_colaboradores rename to rh_colaboradores;
alter index uq_rh_vt_colaboradores_cpf rename to uq_rh_colaboradores_cpf;
alter policy rh_vt_colab_ler on rh_colaboradores rename to rh_colab_ler;
alter policy rh_vt_colab_inserir on rh_colaboradores rename to rh_colab_inserir;
alter policy rh_vt_colab_alterar on rh_colaboradores rename to rh_colab_alterar;

alter table rh_colaboradores
  add column recebe_vt boolean not null default true,
  add column matricula_escritorio text check (matricula_escritorio ~ '^\d{1,9}$');
alter table rh_colaboradores drop constraint rh_vt_colab_tarifa_ou_fixo;
alter table rh_colaboradores add constraint rh_colab_vt_tarifa_ou_fixo check (not recebe_vt or tarifa is not null or valor_fixo is not null);
comment on table rh_colaboradores is 'Cadastro único do RH (VT e folha): fornecedor no Consistem (Nº), CPF, conta (só para o arquivo do BB), forma de pagamento habitual, empresa empregadora e, para quem recebe VT, tarifa/valor fixo e passagens por dia.';
comment on column rh_colaboradores.ativo is 'Trabalha na empresa. Para o VT vale ativo E recebe_vt.';
comment on column rh_colaboradores.matricula_escritorio is 'Código da pessoa no sistema do escritório de contabilidade (aparece no extrato e nos holerites).';

-- 2) Módulo --------------------------------------------------------------------------------------------------------------------
insert into modulos (codigo, area, nome, ativo) values ('rh.colaboradores', 'rh', 'Colaboradores', true)
on conflict (codigo) do update set ativo = true, nome = excluded.nome;

-- 3) Salvar ---------------------------------------------------------------------------------------------------------------------
drop function rh_vt_salvar_colaborador(uuid, uuid, text, text, text, text, text, text, text, numeric, int, boolean, text, numeric);

create function rh_salvar_colaborador(p_id uuid, p_empresa uuid, p_empregador text, p_cod_fornecedor text, p_nome text, p_cpf text,
                                      p_agencia text, p_conta text, p_forma_pagamento text, p_ativo boolean, p_observacao text,
                                      p_recebe_vt boolean, p_tarifa numeric, p_valor_fixo numeric, p_passagens_dia int,
                                      p_matricula_escritorio text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_cod text := ltrim(trim(coalesce(p_cod_fornecedor, '')), '0');
  v_agencia text := nullif(upper(regexp_replace(coalesce(p_agencia, ''), '\s', '', 'g')), '');
  v_conta text := nullif(upper(regexp_replace(coalesce(p_conta, ''), '\s', '', 'g')), '');
  v_matricula text := nullif(ltrim(trim(coalesce(p_matricula_escritorio, '')), '0'), '');
  v_vt boolean := coalesce(p_recebe_vt, false);
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('rh', 'operador') then
    raise exception 'Somente operador do RH (ou acima) pode alterar o cadastro de colaboradores.';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and ativa) then
    raise exception 'Empresa inválida.';
  end if;
  if v_cod !~ '^\d{1,9}$' then
    raise exception 'Informe o código de fornecedor do Consistem (número).';
  end if;
  if coalesce(trim(p_nome), '') = '' or coalesce(trim(p_empregador), '') = '' then
    raise exception 'Informe o nome e a empresa empregadora.';
  end if;
  if v_matricula is not null and v_matricula !~ '^\d{1,9}$' then
    raise exception 'Matrícula do escritório: só números.';
  end if;
  if p_valor_fixo is not null and p_valor_fixo <= 0 then
    raise exception 'O valor fixo mensal tem de ser maior que zero (ou fique vazio).';
  end if;
  if p_tarifa is not null and p_tarifa <= 0 then
    raise exception 'O valor da passagem tem de ser maior que zero (ou fique vazio).';
  end if;
  if v_vt and p_valor_fixo is null and p_tarifa is null then
    raise exception 'Quem recebe VT precisa do valor da passagem (tarifa) ou do valor fixo mensal.';
  end if;
  if exists (select 1 from rh_colaboradores where empresa_id = p_empresa and cod_fornecedor = v_cod and id is distinct from p_id) then
    raise exception 'O fornecedor % já está cadastrado.', v_cod;
  end if;
  if nullif(trim(p_cpf), '') is not null and exists (select 1 from rh_colaboradores where cpf = trim(p_cpf) and id is distinct from p_id) then
    raise exception 'O CPF % já está cadastrado.', trim(p_cpf);
  end if;

  if p_id is null then
    insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento, ativo, observacao,
                                  recebe_vt, tarifa, valor_fixo, passagens_dia, matricula_escritorio, atualizado_por)
    values (p_empresa, upper(trim(p_empregador)), v_cod, upper(trim(p_nome)), nullif(trim(p_cpf), ''), v_agencia, v_conta, p_forma_pagamento,
            coalesce(p_ativo, true), nullif(trim(p_observacao), ''), v_vt, round(p_tarifa, 2), round(p_valor_fixo, 2), coalesce(p_passagens_dia, 2),
            v_matricula, auth.uid())
    returning id into v_id;
  else
    update rh_colaboradores set
      empresa_id = p_empresa, empregador = upper(trim(p_empregador)), cod_fornecedor = v_cod, nome = upper(trim(p_nome)), cpf = nullif(trim(p_cpf), ''),
      agencia = v_agencia, conta = v_conta, forma_pagamento = p_forma_pagamento, ativo = coalesce(p_ativo, true), observacao = nullif(trim(p_observacao), ''),
      recebe_vt = v_vt, tarifa = round(p_tarifa, 2), valor_fixo = round(p_valor_fixo, 2), passagens_dia = coalesce(p_passagens_dia, 2),
      matricula_escritorio = v_matricula, atualizado_por = auth.uid()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Colaborador não encontrado.';
    end if;
  end if;
  return v_id;
end $$;

-- 4) VT: só quem está ativo E recebe VT ------------------------------------------------------------------------------------------
create or replace function rh_vt_abrir_competencia(p_competencia date, p_dias_uteis int) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_pag date := rh_vt_ultimo_dia_util((v_comp - interval '1 month')::date);
  v_id uuid;
begin
  perform rh_vt_exigir('operador');
  if p_dias_uteis is null or p_dias_uteis not between 0 and 31 then
    raise exception 'Informe os dias úteis do mês (0 a 31).';
  end if;
  if exists (select 1 from rh_vt_competencias where competencia = v_comp) then
    raise exception 'O VT de % já foi aberto.', rh_vt_rotulo_mes(v_comp);
  end if;
  insert into rh_vt_competencias (competencia, dias_uteis_padrao, data_pagamento, prazo_fechamento)
  values (v_comp, p_dias_uteis, v_pag, rh_vt_voltar_dias_uteis(v_pag, 2))
  returning id into v_id;
  insert into rh_vt_itens (competencia_id, colaborador_id, empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento,
                           tarifa, valor_fixo, passagens_dia, dias_uteis, atualizado_por)
  select v_id, c.id, c.empresa_id, c.empregador, c.cod_fornecedor, c.nome, c.cpf, c.agencia, c.conta, c.forma_pagamento,
         c.tarifa, c.valor_fixo, c.passagens_dia, p_dias_uteis, auth.uid()
    from rh_colaboradores c where c.ativo and c.recebe_vt;
  perform rh_vt_abrir_pendencia(v_id, 'Fechar VT de ' || rh_vt_rotulo_mes(v_comp),
    'Lançar faltas, atestados, extras, férias e abatimentos e enviar para aprovação.', rh_vt_voltar_dias_uteis(v_pag, 2));
  update pendencias set referencia_id = v_id, link = '/rh/vale_transporte/mes/' || v_id
   where modulo = 'rh.vale_transporte' and titulo = 'Fechar VT de ' || rh_vt_rotulo_mes(v_comp) and status in ('aberta', 'em_andamento');
  return v_id;
end $$;

create or replace function rh_vt_atualizar_do_cadastro(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
  v_atu int; v_inc int; v_des int;
begin
  perform rh_vt_exigir('operador');
  c := rh_vt_competencia_para(p_id, array['aberta']);
  update rh_vt_itens i set empresa_id = k.empresa_id, empregador = k.empregador, cod_fornecedor = k.cod_fornecedor, nome = k.nome, cpf = k.cpf,
         agencia = k.agencia, conta = k.conta, tarifa = k.tarifa, valor_fixo = k.valor_fixo, passagens_dia = k.passagens_dia, atualizado_por = auth.uid()
    from rh_colaboradores k
   where i.competencia_id = p_id and k.id = i.colaborador_id and k.ativo and k.recebe_vt
     and (i.empresa_id, i.empregador, i.cod_fornecedor, i.nome, i.cpf, i.agencia, i.conta, i.tarifa, i.valor_fixo, i.passagens_dia)
         is distinct from (k.empresa_id, k.empregador, k.cod_fornecedor, k.nome, k.cpf, k.agencia, k.conta, k.tarifa, k.valor_fixo, k.passagens_dia);
  get diagnostics v_atu = row_count;
  insert into rh_vt_itens (competencia_id, colaborador_id, empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento,
                           tarifa, valor_fixo, passagens_dia, dias_uteis, atualizado_por)
  select p_id, k.id, k.empresa_id, k.empregador, k.cod_fornecedor, k.nome, k.cpf, k.agencia, k.conta, k.forma_pagamento,
         k.tarifa, k.valor_fixo, k.passagens_dia, c.dias_uteis_padrao, auth.uid()
    from rh_colaboradores k
   where k.ativo and k.recebe_vt and not exists (select 1 from rh_vt_itens i where i.competencia_id = p_id and i.colaborador_id = k.id);
  get diagnostics v_inc = row_count;
  update rh_vt_itens i set sem_vt = true, sem_vt_motivo = case when k.ativo then 'Não recebe VT no cadastro' else 'Desativado no cadastro' end,
         atualizado_por = auth.uid()
    from rh_colaboradores k
   where i.competencia_id = p_id and k.id = i.colaborador_id and not (k.ativo and k.recebe_vt) and not i.sem_vt;
  get diagnostics v_des = row_count;
  return jsonb_build_object('atualizados', v_atu, 'incluidos', v_inc, 'desativados', v_des);
end $$;
