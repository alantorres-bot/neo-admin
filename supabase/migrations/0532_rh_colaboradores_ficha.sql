-- =========================================================
-- Neo Admin — 0532 RH/SST > Colaboradores: dados da Ficha Registro de Empregado
-- Decisão de 27/11/2026 (docs/modulos/rh-folha.md, regra 1): o RH sobe a ficha de registro (PDF do escritório) e o formulário
-- de novo colaborador abre preenchido (lib/modulos/rh/colaboradores/ficha-registro.ts). O PDF não é guardado.
--
-- 1) Colunas novas com os dados pessoais da ficha (nascimento, telefone, endereço, PIS, RG, CTPS, filiação). A tabela já tem
--    RLS da área RH e auditoria.
-- 2) rh_salvar_colaborador ganha função, admissão, salário e os dados pessoais. Eles só são gravados com p_dados_ficha = true
--    (o formulário novo sempre manda); chamadas antigas não mexem neles (nada se apaga no meio da publicação).
-- =========================================================

-- 1) Colunas -----------------------------------------------------------------------------------------------------------------------
alter table rh_colaboradores
  add column data_nascimento date,
  add column telefone text check (telefone ~ '^[0-9 ()+-]{8,20}$'),
  add column endereco text check (length(endereco) <= 200),
  add column pis text check (pis ~ '^\d{11}$'),
  add column rg text check (rg ~ '^[0-9A-Z.-]{3,20}$'),
  add column rg_orgao text check (length(rg_orgao) <= 20),
  add column rg_emissao date,
  add column ctps text check (ctps ~ '^\d{1,11}$'),
  add column ctps_serie text check (ctps_serie ~ '^\d{1,6}$'),
  add column ctps_uf text check (ctps_uf ~ '^[A-Z]{2}$'),
  add column nome_pai text check (length(nome_pai) <= 120),
  add column nome_mae text check (length(nome_mae) <= 120);
comment on column rh_colaboradores.pis is 'PIS/NIS (11 dígitos), da ficha de registro do escritório (0532), como os demais dados pessoais.';

-- 2) Gravar -----------------------------------------------------------------------------------------------------------------------
drop function rh_salvar_colaborador(uuid, uuid, text, text, text, text, text, text, text, boolean, text, boolean, numeric, numeric, int, text);

create function rh_salvar_colaborador(p_id uuid, p_empresa uuid, p_empregador text, p_cod_fornecedor text, p_nome text, p_cpf text,
                                      p_agencia text, p_conta text, p_forma_pagamento text, p_ativo boolean, p_observacao text,
                                      p_recebe_vt boolean, p_tarifa numeric, p_valor_fixo numeric, p_passagens_dia int,
                                      p_matricula_escritorio text default null,
                                      p_dados_ficha boolean default false, p_funcao text default null, p_data_admissao date default null,
                                      p_salario numeric default null, p_data_nascimento date default null, p_telefone text default null,
                                      p_endereco text default null, p_pis text default null, p_rg text default null, p_rg_orgao text default null,
                                      p_rg_emissao date default null, p_ctps text default null, p_ctps_serie text default null,
                                      p_ctps_uf text default null, p_nome_pai text default null, p_nome_mae text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_cod text := ltrim(trim(coalesce(p_cod_fornecedor, '')), '0');
  v_agencia text := nullif(upper(regexp_replace(coalesce(p_agencia, ''), '\s', '', 'g')), '');
  v_conta text := nullif(upper(regexp_replace(coalesce(p_conta, ''), '\s', '', 'g')), '');
  v_matricula text := nullif(ltrim(trim(coalesce(p_matricula_escritorio, '')), '0'), '');
  v_vt boolean := coalesce(p_recebe_vt, false);
  v_ficha boolean := coalesce(p_dados_ficha, false);
  v_pis text := nullif(regexp_replace(coalesce(p_pis, ''), '\D', '', 'g'), '');
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
  if v_ficha and p_salario is not null and p_salario <= 0 then
    raise exception 'O salário tem de ser maior que zero (ou fique vazio).';
  end if;
  if v_ficha and v_pis is not null and v_pis !~ '^\d{11}$' then
    raise exception 'PIS: 11 dígitos.';
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

  if v_ficha then
    update rh_colaboradores set
      funcao = nullif(upper(trim(coalesce(p_funcao, ''))), ''), data_admissao = p_data_admissao, salario = round(p_salario, 2),
      data_nascimento = p_data_nascimento, telefone = nullif(trim(coalesce(p_telefone, '')), ''), endereco = nullif(trim(coalesce(p_endereco, '')), ''),
      pis = v_pis, rg = nullif(upper(regexp_replace(coalesce(p_rg, ''), '\s', '', 'g')), ''), rg_orgao = nullif(upper(trim(coalesce(p_rg_orgao, ''))), ''),
      rg_emissao = p_rg_emissao, ctps = nullif(regexp_replace(coalesce(p_ctps, ''), '\D', '', 'g'), ''),
      ctps_serie = nullif(regexp_replace(coalesce(p_ctps_serie, ''), '\D', '', 'g'), ''), ctps_uf = nullif(upper(trim(coalesce(p_ctps_uf, ''))), ''),
      nome_pai = nullif(upper(trim(coalesce(p_nome_pai, ''))), ''), nome_mae = nullif(upper(trim(coalesce(p_nome_mae, ''))), '')
    where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function rh_salvar_colaborador(uuid, uuid, text, text, text, text, text, text, text, boolean, text, boolean, numeric, numeric, int, text,
  boolean, text, date, numeric, date, text, text, text, text, text, date, text, text, text, text, text) from public, anon;
