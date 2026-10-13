-- =========================================================
-- Neo Admin — 0142 Cartão de crédito: fornecedor "Outros" com inscrição estadual ISENTO e código IBGE
-- Especificação: docs/modulos/financeiro-cartao.md (regra 44).
--
-- O primeiro cadastro real (13/10/2026, UNIDAS) foi recusado pelo Consistem: tipo 3 exige cpfCnpj e inscEstadual. Os 25
-- "Outros" existentes seguem o mesmo padrão: cpfCnpj = o próprio código do fornecedor com 7 dígitos (ex.: 928 → 0000928),
-- inscEstadual = ISENTO e codIbge 5103403 (Cuiabá). A inscrição e o IBGE entram na configuração e no corpo montado pelo banco;
-- o código e o cpfCnpj são escolhidos pela Edge Function na hora do envio (próximo código livre, conferido no Consistem).
-- =========================================================

update configuracoes
   set valor = valor || '{"inscEstadual": "ISENTO", "codIbge": "5103403"}'::jsonb
 where chave = 'financeiro.cartao.fornecedor_outros';

create or replace function crt_reservar_cadastro_fornecedor(p_empresa uuid, p_nome text, p_categoria int, p_grupo int, p_estabelecimento uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb := (select valor from configuracoes where chave = 'financeiro.cartao.fornecedor_outros');
  v_nome text := upper(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'));
  v_existente text;
  v_payload jsonb;
  v_id uuid;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) cadastra fornecedor no Consistem.';
  end if;
  if not crt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (Configurações: financeiro.cartao.lancar_no_erp).';
  end if;
  if v_cfg is null or coalesce(v_cfg ->> 'endereco', '') = '' or coalesce(v_cfg ->> 'cep', '') = '' then
    raise exception 'Configure o endereço do fornecedor "Outros" (financeiro.cartao.fornecedor_outros).';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and codigo_erp is not null) then
    raise exception 'Empresa sem código do Consistem.';
  end if;
  if length(v_nome) < 2 or length(v_nome) > 60 then
    raise exception 'Informe o nome do fornecedor (2 a 60 caracteres).';
  end if;
  if p_categoria is null or p_categoria not between 1 and 99 or p_grupo is null or p_grupo not between 1 and 999 then
    raise exception 'Categoria (1 a 99) e grupo (1 a 999) do fornecedor.';
  end if;
  if p_estabelecimento is not null and exists (select 1 from crt_estabelecimentos where id = p_estabelecimento and marketplace) then
    raise exception 'Marketplace não tem fornecedor próprio: a nota é do vendedor e a conciliação casa pelo valor.';
  end if;
  select cod_fornecedor || ' · ' || nome into v_existente
    from cap_fornecedores
   where empresa_id = p_empresa and (crt_normalizar(nome) = crt_normalizar(v_nome) or crt_normalizar(coalesce(nome_fantasia, '')) = crt_normalizar(v_nome))
   limit 1;
  if v_existente is not null then
    raise exception 'Já existe fornecedor com esse nome no Consistem (%): use "Ligar".', v_existente;
  end if;
  v_payload := jsonb_build_object(
    'nome', v_nome, 'nomeFantasia', left(v_nome, 30), 'situacao', 1, 'classificacao', 3,
    'codCategoria', p_categoria, 'codGrupo', p_grupo,
    'endereco', left(v_cfg ->> 'endereco', 60), 'numero', left(v_cfg ->> 'numero', 5), 'bairro', left(v_cfg ->> 'bairro', 30),
    'cep', left(regexp_replace(v_cfg ->> 'cep', '\D', '', 'g'), 8), 'cidade', left(coalesce(v_cfg ->> 'cidade', ''), 60),
    'estado', left(coalesce(v_cfg ->> 'estado', ''), 2),
    'inscEstadual', left(coalesce(nullif(v_cfg ->> 'inscEstadual', ''), 'ISENTO'), 17),
    'codIbge', left(coalesce(v_cfg ->> 'codIbge', ''), 7));
  begin
    insert into crt_fornecedores_cadastrados (empresa_id, nome, payload, estabelecimento_id)
    values (p_empresa, v_nome, v_payload, p_estabelecimento)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Esse fornecedor já está sendo (ou já foi) cadastrado pelo painel.';
  end;
  return v_id;
end $$;

-- Próximo código de fornecedor livre no espelho (a Edge Function confere no Consistem antes de usar).
create function crt_proximo_codigo_fornecedor(p_empresa uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(max(cod_fornecedor::int), 0) + 1 from cap_fornecedores where empresa_id = p_empresa and cod_fornecedor ~ '^\d{1,6}$'
$$;
revoke all on function crt_proximo_codigo_fornecedor(uuid) from public, anon, authenticated;
grant execute on function crt_proximo_codigo_fornecedor(uuid) to service_role;
