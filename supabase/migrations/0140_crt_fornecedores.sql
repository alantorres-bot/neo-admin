-- =========================================================
-- Neo Admin — 0140 Cartão de crédito: fornecedor "Outros" (classificação 3) por estabelecimento; marketplace casa pelo valor
-- Especificação: docs/modulos/financeiro-cartao.md (seção 5, regras 44 a 49).
--
-- Decisões do Alan (13/10/2026):
--   - fornecedor de estabelecimento de cartão é cadastrado no Consistem como classificação 3 ("Outros"): sem CNPJ, nome = a
--     descrição do estabelecimento, endereço igual para todos (Rua Canadá, 277, Santa Rosa, 78040-050, Cuiabá/MT — o mesmo de
--     19 dos 28 "Outros" existentes); categoria 17 e grupo 22 sugeridos, o operador pode trocar;
--   - marcas: ligar a um fornecedor que já existe ou cadastrar, na aba Estabelecimentos; genéricos (posto, restaurante...):
--     pela compra, no diálogo de lançar; gestor e operador cadastram;
--   - marketplace (Mercado Livre): as notas são de outros fornecedores (os vendedores) — não tem fornecedor próprio nem botão
--     Lançar; a conciliação casa pelo valor com o título da nota.
-- Cadastro: o painel reserva (crt_reservar_cadastro_fornecedor, que monta o corpo com o endereço da configuração), a Edge
-- Function crt-cadastrar-fornecedor envia uma vez (PUT cadastrosgerais/v10/fornecedor) e conclui. Nada é apagado.
-- =========================================================

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.cartao.fornecedor_outros',
   '{"endereco": "RUA CANADA", "numero": "277", "bairro": "SANTA ROSA", "cep": "78040050", "cidade": "CUIABA", "estado": "MT", "codCategoria": 17, "codGrupo": 22}',
   'Cartão de crédito: cadastro do fornecedor "Outros" (classificação 3) criado pelo painel — endereço fixo e categoria/grupo sugeridos.')
on conflict (chave) do nothing;

-- 1) Marketplace -----------------------------------------------------------------------------------------------------------
alter table crt_estabelecimentos add column marketplace boolean not null default false;
comment on column crt_estabelecimentos.marketplace is 'Marketplace (ex.: Mercado Livre): a nota é emitida pelo vendedor; sem fornecedor próprio nem lançamento pelo painel — casa pelo valor com o título da nota.';
update crt_estabelecimentos set marketplace = true where padrao in ('MERCADOLIVRE', 'MERCADO*MERCADOLIVRE', 'EBAZAR');

-- 2) Fornecedores cadastrados pelo painel (prova) ------------------------------------------------------------------------
create type crt_situacao_cadastro as enum ('reservado', 'enviando', 'cadastrado', 'erro');

create table crt_fornecedores_cadastrados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  nome text not null,
  payload jsonb not null,
  situacao crt_situacao_cadastro not null default 'reservado',
  cod_fornecedor text,
  resposta jsonb,
  erro text,
  estabelecimento_id uuid references crt_estabelecimentos(id),
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  concluido_em timestamptz,
  resolvido_por uuid references perfis(id),
  motivo_resolucao text
);
comment on table crt_fornecedores_cadastrados is 'Fornecedores "Outros" cadastrados pelo painel no Consistem: o que foi enviado, a resposta e o código criado. Nunca apagados.';
create unique index uq_crt_fornecedores_cadastrados_ativo on crt_fornecedores_cadastrados (empresa_id, crt_normalizar(nome))
  where situacao in ('reservado', 'enviando', 'cadastrado');

create function fn_crt_fornecedor_cadastrado_regras() returns trigger language plpgsql as $$
begin
  if (new.empresa_id, new.nome, new.payload, new.estabelecimento_id, new.criado_por, new.criado_em)
     is distinct from (old.empresa_id, old.nome, old.payload, old.estabelecimento_id, old.criado_por, old.criado_em) then
    raise exception 'O cadastro enviado ao Consistem é imutável.';
  end if;
  if new.situacao <> old.situacao and not (
       (old.situacao = 'reservado' and new.situacao in ('enviando', 'erro')) or
       (old.situacao = 'enviando' and new.situacao in ('cadastrado', 'erro'))) then
    raise exception 'Mudança de situação inválida: % → %.', old.situacao, new.situacao;
  end if;
  if old.situacao in ('cadastrado', 'erro') then
    raise exception 'Este cadastro já foi concluído (%).', old.situacao;
  end if;
  if new.situacao = 'cadastrado' and coalesce(trim(new.cod_fornecedor), '') = '' then
    raise exception 'Cadastrado exige o código do fornecedor no Consistem.';
  end if;
  return new;
end $$;
create trigger trg_crt_fornecedores_cadastrados_regras before update on crt_fornecedores_cadastrados for each row execute function fn_crt_fornecedor_cadastrado_regras();
create trigger trg_crt_fornecedores_cadastrados_sem_delete before delete on crt_fornecedores_cadastrados for each row execute function fn_bloquear_delete();
create trigger trg_aud_crt_fornecedores_cadastrados after insert or update on crt_fornecedores_cadastrados for each row execute function fn_auditoria();
alter table crt_fornecedores_cadastrados enable row level security;
create policy crt_fornecedores_cadastrados_ler on crt_fornecedores_cadastrados for select to authenticated using (tem_acesso_area('financeiro'));

-- 3) Reservar (painel; operador ou acima) ----------------------------------------------------------------------------------
create function crt_reservar_cadastro_fornecedor(p_empresa uuid, p_nome text, p_categoria int, p_grupo int, p_estabelecimento uuid default null) returns uuid
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
    'estado', left(coalesce(v_cfg ->> 'estado', ''), 2));
  begin
    insert into crt_fornecedores_cadastrados (empresa_id, nome, payload, estabelecimento_id)
    values (p_empresa, v_nome, v_payload, p_estabelecimento)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Esse fornecedor já está sendo (ou já foi) cadastrado pelo painel.';
  end;
  return v_id;
end $$;
revoke all on function crt_reservar_cadastro_fornecedor(uuid, text, int, int, uuid) from public, anon;
grant execute on function crt_reservar_cadastro_fornecedor(uuid, text, int, int, uuid) to authenticated;

-- 4) Envio (Edge Function, service role) ------------------------------------------------------------------------------------
create function crt_iniciar_cadastro_fornecedor(p_id uuid) returns crt_fornecedores_cadastrados
language plpgsql security definer set search_path = public as $$
declare
  v crt_fornecedores_cadastrados;
begin
  update crt_fornecedores_cadastrados set situacao = 'enviando', enviado_em = now() where id = p_id and situacao = 'reservado' returning * into v;
  if v.id is null then
    raise exception 'Cadastro não encontrado ou já enviado.';
  end if;
  return v;
end $$;
revoke all on function crt_iniciar_cadastro_fornecedor(uuid) from public, anon, authenticated;
grant execute on function crt_iniciar_cadastro_fornecedor(uuid) to service_role;

-- Cadastrado: grava no espelho (aparece na hora) e na sugestão do estabelecimento (uso interno).
create function crt_marcar_fornecedor_cadastrado(p_id uuid, p_cod text, p_resposta jsonb, p_usuario uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_fornecedores_cadastrados;
  v_cod text := trim(p_cod);
begin
  select * into v from crt_fornecedores_cadastrados where id = p_id for update;
  update crt_fornecedores_cadastrados
     set situacao = 'cadastrado', cod_fornecedor = v_cod, resposta = coalesce(p_resposta, resposta), concluido_em = now(), erro = null,
         resolvido_por = case when p_motivo is null then resolvido_por else p_usuario end, motivo_resolucao = coalesce(p_motivo, motivo_resolucao)
   where id = p_id;
  insert into cap_fornecedores (empresa_id, cod_fornecedor, nome, nome_fantasia, ativo, visto_em)
  values (v.empresa_id, v_cod, v.nome, v.payload ->> 'nomeFantasia', true, now())
  on conflict (empresa_id, cod_fornecedor) do update set nome = excluded.nome, nome_fantasia = excluded.nome_fantasia, ativo = true, visto_em = now();
  if v.estabelecimento_id is not null then
    update crt_estabelecimentos
       set lancamento_erp = coalesce(lancamento_erp, '{}'::jsonb) || jsonb_build_object('codFornecedor', v_cod::int)
     where id = v.estabelecimento_id;
  end if;
end $$;
revoke all on function crt_marcar_fornecedor_cadastrado(uuid, text, jsonb, uuid, text) from public, anon, authenticated;

create function crt_concluir_cadastro_fornecedor(p_id uuid, p_cod text, p_resposta jsonb, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from crt_fornecedores_cadastrados where id = p_id and situacao = 'enviando') then
    raise exception 'Cadastro não está em envio.';
  end if;
  if coalesce(trim(p_cod), '') ~ '^\d{1,6}$' then
    perform crt_marcar_fornecedor_cadastrado(p_id, p_cod, p_resposta, null, null);
  else
    update crt_fornecedores_cadastrados set situacao = 'erro', resposta = p_resposta, erro = coalesce(nullif(trim(p_erro), ''), 'Erro sem mensagem.'), concluido_em = now()
     where id = p_id;
  end if;
end $$;
revoke all on function crt_concluir_cadastro_fornecedor(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function crt_concluir_cadastro_fornecedor(uuid, text, jsonb, text) to service_role;

-- 5) Resolver à mão um cadastro sem resposta (operador ou acima) -----------------------------------------------------------
create function crt_resolver_cadastro_fornecedor(p_id uuid, p_cod text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_fornecedores_cadastrados;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) resolve cadastros no Consistem.';
  end if;
  if coalesce(length(trim(p_motivo)), 0) < 3 then
    raise exception 'Informe o que foi conferido no Consistem.';
  end if;
  select * into v from crt_fornecedores_cadastrados where id = p_id for update;
  if v.id is null or v.situacao not in ('reservado', 'enviando') then
    raise exception 'Só um cadastro sem resposta pode ser resolvido à mão.';
  end if;
  if coalesce(trim(p_cod), '') <> '' then
    if trim(p_cod) !~ '^\d{1,6}$' then
      raise exception 'Informe o código do fornecedor no Consistem (só números).';
    end if;
    if v.situacao = 'reservado' then
      update crt_fornecedores_cadastrados set situacao = 'enviando' where id = p_id;
    end if;
    perform crt_marcar_fornecedor_cadastrado(p_id, trim(p_cod), null, auth.uid(), trim(p_motivo));
  else
    update crt_fornecedores_cadastrados set situacao = 'erro', erro = 'Não foi criado no Consistem (conferido à mão).', concluido_em = now(),
           resolvido_por = auth.uid(), motivo_resolucao = trim(p_motivo)
     where id = p_id;
  end if;
end $$;
revoke all on function crt_resolver_cadastro_fornecedor(uuid, text, text) from public, anon;
grant execute on function crt_resolver_cadastro_fornecedor(uuid, text, text) to authenticated;

-- 6) Ligar um estabelecimento a um fornecedor existente (operador ou acima) ----------------------------------------------
create function crt_ligar_fornecedor(p_estabelecimento uuid, p_cod_fornecedor text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) liga fornecedor ao estabelecimento.';
  end if;
  if coalesce(trim(p_cod_fornecedor), '') !~ '^\d{1,6}$' then
    raise exception 'Código de fornecedor inválido.';
  end if;
  if exists (select 1 from crt_estabelecimentos where id = p_estabelecimento and marketplace) then
    raise exception 'Marketplace não tem fornecedor próprio: a nota é do vendedor e a conciliação casa pelo valor.';
  end if;
  update crt_estabelecimentos
     set lancamento_erp = coalesce(lancamento_erp, '{}'::jsonb) || jsonb_build_object('codFornecedor', trim(p_cod_fornecedor)::int)
   where id = p_estabelecimento;
  if not found then
    raise exception 'Estabelecimento não encontrado.';
  end if;
end $$;
revoke all on function crt_ligar_fornecedor(uuid, text) from public, anon;
grant execute on function crt_ligar_fornecedor(uuid, text) to authenticated;
