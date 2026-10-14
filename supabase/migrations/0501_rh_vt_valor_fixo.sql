-- =========================================================
-- Neo Admin — 0501 RH/SST > Vale-transporte: valor fixo mensal (Fase A)
-- Na planilha há quem receba um VALOR TOTAL fixo no mês, sem dias nem tarifa (ex.: R$ 800,00). Decisão do Alan em 14/10/2026:
-- campo opcional "valor fixo mensal" no cadastro, que substitui o cálculo por dias (regra 3 de docs/modulos/rh-vale-transporte.md).
-- Com valor fixo, a tarifa fica opcional; sem ele, a tarifa continua obrigatória.
-- =========================================================

alter table rh_vt_colaboradores add column valor_fixo numeric(14,2) check (valor_fixo > 0);
alter table rh_vt_colaboradores alter column tarifa drop not null;
alter table rh_vt_colaboradores add constraint rh_vt_colab_tarifa_ou_fixo check (tarifa is not null or valor_fixo is not null);
comment on column rh_vt_colaboradores.valor_fixo is 'Valor fixo do VT no mês; quando preenchido substitui (dias − faltas + extras) × passagens × tarifa.';

drop function rh_vt_salvar_colaborador(uuid, uuid, text, text, text, text, text, text, text, numeric, int, boolean, text);

-- p_id nulo = novo. Devolve o id. CPF chega já validado e com máscara (o app confere os dígitos verificadores).
create function rh_vt_salvar_colaborador(p_id uuid, p_empresa uuid, p_empregador text, p_cod_fornecedor text, p_nome text, p_cpf text,
                                         p_agencia text, p_conta text, p_forma_pagamento text, p_tarifa numeric, p_passagens_dia int,
                                         p_ativo boolean, p_observacao text, p_valor_fixo numeric default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_cod text := ltrim(trim(coalesce(p_cod_fornecedor, '')), '0');
  v_agencia text := nullif(upper(regexp_replace(coalesce(p_agencia, ''), '\s', '', 'g')), '');
  v_conta text := nullif(upper(regexp_replace(coalesce(p_conta, ''), '\s', '', 'g')), '');
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('rh', 'operador') then
    raise exception 'Somente operador do RH (ou acima) pode alterar o cadastro do vale-transporte.';
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
  if p_valor_fixo is not null and p_valor_fixo <= 0 then
    raise exception 'O valor fixo mensal tem de ser maior que zero (ou fique vazio).';
  end if;
  if p_valor_fixo is null and (p_tarifa is null or p_tarifa <= 0) then
    raise exception 'Informe o valor da passagem (tarifa) ou o valor fixo mensal.';
  end if;
  if p_tarifa is not null and p_tarifa <= 0 then
    raise exception 'O valor da passagem tem de ser maior que zero (ou fique vazio, com valor fixo).';
  end if;
  if exists (select 1 from rh_vt_colaboradores where empresa_id = p_empresa and cod_fornecedor = v_cod and id is distinct from p_id) then
    raise exception 'O fornecedor % já está cadastrado no vale-transporte.', v_cod;
  end if;
  if nullif(trim(p_cpf), '') is not null and exists (select 1 from rh_vt_colaboradores where cpf = trim(p_cpf) and id is distinct from p_id) then
    raise exception 'O CPF % já está cadastrado no vale-transporte.', trim(p_cpf);
  end if;

  if p_id is null then
    insert into rh_vt_colaboradores (empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento, tarifa, valor_fixo, passagens_dia, ativo, observacao, atualizado_por)
    values (p_empresa, upper(trim(p_empregador)), v_cod, upper(trim(p_nome)), nullif(trim(p_cpf), ''), v_agencia, v_conta, p_forma_pagamento,
            round(p_tarifa, 2), round(p_valor_fixo, 2), coalesce(p_passagens_dia, 2), coalesce(p_ativo, true), nullif(trim(p_observacao), ''), auth.uid())
    returning id into v_id;
  else
    update rh_vt_colaboradores set
      empresa_id = p_empresa, empregador = upper(trim(p_empregador)), cod_fornecedor = v_cod, nome = upper(trim(p_nome)), cpf = nullif(trim(p_cpf), ''),
      agencia = v_agencia, conta = v_conta, forma_pagamento = p_forma_pagamento, tarifa = round(p_tarifa, 2), valor_fixo = round(p_valor_fixo, 2),
      passagens_dia = coalesce(p_passagens_dia, 2), ativo = coalesce(p_ativo, true), observacao = nullif(trim(p_observacao), ''), atualizado_por = auth.uid()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Colaborador não encontrado.';
    end if;
  end if;
  return v_id;
end $$;
