-- =========================================================
-- Neo Admin — 0500 RH/SST > Vale-transporte: base (Fase A)
-- Apuração mensal do VT de Cuiabá, que hoje é feita na planilha "Vale Transporte - Cuiabá <ano>.xlsx".
-- Especificação: docs/modulos/rh-vale-transporte.md.
--
-- 1) Módulo ativo no menu (rota /rh/vale_transporte; permissão pela ÁREA rh, sensível: só vê quem recebe acesso).
-- 2) rh_vt_colaboradores: quem recebe VT. O código de fornecedor no Consistem é o "Nº" da planilha; nome e CPF vêm do
--    fornecedor no Consistem (Edge Function rh-vt-consultar-fornecedor). Agência e conta ficam só aqui e servem apenas
--    para o arquivo do BB (FOPAG). Não se apaga: desativa (auditoria guarda o antes/depois).
-- 3) rh_vt_salvar_colaborador: inclui/altera com validação (operador do RH ou acima).
-- As competências mensais (cálculo, aprovação, arquivo do BB) entram na Fase B.
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('rh.vale_transporte', 'rh', 'Vale-transporte', true)
on conflict (codigo) do update set ativo = true, nome = excluded.nome;

-- 2) Colaboradores ------------------------------------------------------------
create table rh_vt_colaboradores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),        -- empresa do Consistem onde está o fornecedor (e onde o título será lançado)
  empregador text not null,                                -- coluna EMPRESA da planilha: NEO SERVIÇOS, OESTE…
  cod_fornecedor text not null check (cod_fornecedor ~ '^\d{1,9}$'),   -- "Nº" da planilha = codFornecedor no Consistem
  nome text not null,
  cpf varchar(14) check (cpf ~ '^\d{3}\.\d{3}\.\d{3}-\d{2}$'),        -- com máscara
  agencia text check (agencia ~ '^\d{1,5}-?[0-9X]?$'),                  -- "2764-2"
  conta text check (conta ~ '^\d{1,12}-?[0-9X]?$'),                     -- "99149-X"
  forma_pagamento text not null default 'fopag' check (forma_pagamento in ('fopag', 'pix_neo_formas', 'pix_neo_servicos')),
  tarifa numeric(14,2) not null check (tarifa > 0),         -- VR. UNITÁRIO da passagem
  passagens_dia int not null default 2 check (passagens_dia between 1 and 8),
  ativo boolean not null default true,
  observacao text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_por uuid references perfis(id),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, cod_fornecedor)
);
comment on table rh_vt_colaboradores is 'Quem recebe vale-transporte: fornecedor no Consistem, CPF, conta (só para o arquivo do BB), forma de pagamento habitual, tarifa e passagens por dia.';
create unique index uq_rh_vt_colaboradores_cpf on rh_vt_colaboradores (cpf) where cpf is not null;
create trigger trg_rh_vt_colab_atualizado before update on rh_vt_colaboradores for each row execute function fn_atualizado_em();
create trigger trg_rh_vt_colab_sem_delete before delete on rh_vt_colaboradores for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_vt_colab after insert or update on rh_vt_colaboradores for each row execute function fn_auditoria();

alter table rh_vt_colaboradores enable row level security;
create policy rh_vt_colab_ler on rh_vt_colaboradores for select to authenticated using (tem_acesso_area('rh'));
create policy rh_vt_colab_inserir on rh_vt_colaboradores for insert to authenticated with check (tem_acesso_area('rh', 'operador'));
create policy rh_vt_colab_alterar on rh_vt_colaboradores for update to authenticated
  using (tem_acesso_area('rh', 'operador')) with check (tem_acesso_area('rh', 'operador'));

-- 3) Salvar ----------------------------------------------------------------------
-- p_id nulo = novo. Devolve o id. CPF chega já validado e com máscara (o app confere os dígitos verificadores).
create function rh_vt_salvar_colaborador(p_id uuid, p_empresa uuid, p_empregador text, p_cod_fornecedor text, p_nome text, p_cpf text,
                                         p_agencia text, p_conta text, p_forma_pagamento text, p_tarifa numeric, p_passagens_dia int,
                                         p_ativo boolean, p_observacao text)
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
  if p_tarifa is null or p_tarifa <= 0 then
    raise exception 'Informe o valor da passagem (tarifa).';
  end if;
  if exists (select 1 from rh_vt_colaboradores where empresa_id = p_empresa and cod_fornecedor = v_cod and id is distinct from p_id) then
    raise exception 'O fornecedor % já está cadastrado no vale-transporte.', v_cod;
  end if;
  if nullif(trim(p_cpf), '') is not null and exists (select 1 from rh_vt_colaboradores where cpf = trim(p_cpf) and id is distinct from p_id) then
    raise exception 'O CPF % já está cadastrado no vale-transporte.', trim(p_cpf);
  end if;

  if p_id is null then
    insert into rh_vt_colaboradores (empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento, tarifa, passagens_dia, ativo, observacao, atualizado_por)
    values (p_empresa, upper(trim(p_empregador)), v_cod, upper(trim(p_nome)), nullif(trim(p_cpf), ''), v_agencia, v_conta, p_forma_pagamento,
            round(p_tarifa, 2), coalesce(p_passagens_dia, 2), coalesce(p_ativo, true), nullif(trim(p_observacao), ''), auth.uid())
    returning id into v_id;
  else
    update rh_vt_colaboradores set
      empresa_id = p_empresa, empregador = upper(trim(p_empregador)), cod_fornecedor = v_cod, nome = upper(trim(p_nome)), cpf = nullif(trim(p_cpf), ''),
      agencia = v_agencia, conta = v_conta, forma_pagamento = p_forma_pagamento, tarifa = round(p_tarifa, 2),
      passagens_dia = coalesce(p_passagens_dia, 2), ativo = coalesce(p_ativo, true), observacao = nullif(trim(p_observacao), ''), atualizado_por = auth.uid()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Colaborador não encontrado.';
    end if;
  end if;
  return v_id;
end $$;
