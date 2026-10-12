-- =========================================================
-- Neo Admin — 0131 Cartão de crédito: base (Fase 1)
-- Módulo Financeiro > Cartão de crédito: conciliação da fatura do cartão com os títulos do Contas a Pagar (espelho
-- cap_lancamentos, módulo Contas a pagar). Porta da skill "conciliacao-fatura-cartao" (Passo 15 do POP de fechamento de
-- fatura). Especificação: docs/modulos/financeiro-cartao.md.
--
-- 1) Módulo ativo no menu (rota /financeiro/cartao; permissão por ÁREA, como os demais do Financeiro).
-- 2) crt_cartoes: os cartões do grupo (Planilha Cartões: fechamento, vencimento, tipo de título do Consistem, leitor de PDF).
-- 3) crt_estabelecimentos: dicionário estabelecimento → categoria → conta de fluxo (cresce a cada fechamento).
-- 4) crt_faturas + crt_fatura_linhas: a fatura importada (cabeçalho e linhas de transação) — PROVA: imutável, nunca apagada,
--    só muda de status (importada → cancelada, com motivo). A conciliação é calculada na hora, sobre o espelho.
-- 5) Funções: crt_importar_fatura (recusa soma ≠ total), crt_cancelar_fatura, crt_salvar_cartao, crt_salvar_estabelecimento.
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('financeiro.cartao', 'financeiro', 'Cartão de crédito', true)
on conflict (codigo) do update set ativo = true, nome = excluded.nome;

-- Normalização de texto para chaves (sem acento, maiúsculas, espaços colapsados). Sem depender da extensão unaccent.
create or replace function crt_normalizar(p text) returns text
language sql immutable strict as $$
  select regexp_replace(upper(translate(p,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g')
$$;

-- 2) Cartões ----------------------------------------------------------------
create table crt_cartoes (
  codigo text primary key,                                 -- "NUBANK PF": sem acento, maiúsculas; vai no complemento do título
  nome text not null,                                      -- "NUBANK PF", "ITAÚ PJ"
  banco text not null,                                     -- "Nubank", "Itaú": o que o leitor procura no complemento
  tipo_pessoa text not null check (tipo_pessoa in ('PF', 'PJ')),
  dia_fechamento int not null check (dia_fechamento between 1 and 31),
  dia_vencimento int not null check (dia_vencimento between 1 and 31),
  tipo_titulo int,                                         -- "Tipo de título" do Consistem (Planilha Cartões)
  leitor text not null default 'generico' check (leitor in ('sicredi', 'picpay', 'generico')),
  pasta_faturas text,                                      -- subpasta no Drive (só informativo)
  ativo boolean not null default true,
  observacao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references perfis(id)
);
comment on table crt_cartoes is 'Cartões de crédito do grupo: fechamento/vencimento (fonte: Planilha Cartões), tipo de título do Consistem e leitor de PDF.';
create trigger trg_crt_cartoes_atualizado before update on crt_cartoes for each row execute function fn_atualizado_em();
create trigger trg_aud_crt_cartoes after insert or update on crt_cartoes for each row execute function fn_auditoria();

-- Carga inicial = Planilha Cartões - Fechamento e Vencimento.xlsx (12/10/2026).
insert into crt_cartoes (codigo, nome, banco, tipo_pessoa, dia_fechamento, dia_vencimento, tipo_titulo, leitor, pasta_faturas) values
  ('INTER PF',   'INTER PF',   'Inter',   'PF', 20, 28, 8,  'generico', 'INTER PF'),
  ('INTER PJ',   'INTER PJ',   'Inter',   'PJ', 3,  10, 8,  'generico', 'INTER PJ'),
  ('ITAU PJ',    'ITAÚ PJ',    'Itaú',    'PJ', 10, 28, 10, 'generico', 'ITAÚ PJ'),
  ('NUBANK PF',  'NUBANK PF',  'Nubank',  'PF', 20, 27, 7,  'generico', 'NUBANK PF'),
  ('PICPAY PF',  'PICPAY PF',  'PicPay',  'PF', 15, 25, 75, 'picpay',   'PICPAY PF'),
  ('SICREDI PF', 'SICREDI PF', 'Sicredi', 'PF', 26, 10, 9,  'sicredi',  'SICREDI PF'),
  ('SICREDI PJ', 'SICREDI PJ', 'Sicredi', 'PJ', 10, 23, 9,  'sicredi',  'SICREDI PJ'),
  ('UNICRED PF', 'UNICRED PF', 'Unicred', 'PF', 10, 20, 73, 'generico', 'UNICRED PF');

-- 3) Dicionário de estabelecimentos ----------------------------------------
create table crt_estabelecimentos (
  id uuid primary key default gen_random_uuid(),
  padrao text not null unique,                             -- trecho normalizado procurado na descrição da fatura
  categoria text not null,
  conta_fluxo text,                                        -- "Descrição Conta" do Consistem; nula = [CONFERIR] (ex.: marketplaces)
  ativo boolean not null default true,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table crt_estabelecimentos is 'De/para estabelecimento → categoria → conta de fluxo de caixa para classificar o que falta lançar da fatura. Cresce a cada fechamento.';
create trigger trg_crt_estab_atualizado before update on crt_estabelecimentos for each row execute function fn_atualizado_em();
create trigger trg_aud_crt_estab after insert or update on crt_estabelecimentos for each row execute function fn_auditoria();

-- Carga = references/dicionario-estabelecimentos.csv da skill.
insert into crt_estabelecimentos (padrao, categoria, conta_fluxo) values
  ('NUVIAGENS', 'Passagens aéreas', 'Passagens'), ('EBW', 'Passagens aéreas', 'Passagens'), ('LATAM', 'Passagens aéreas', 'Passagens'),
  ('GOL', 'Passagens aéreas', 'Passagens'), ('AZUL', 'Passagens aéreas', 'Passagens'), ('DECOLAR', 'Passagens aéreas', 'Passagens'),
  ('HOTEIS.COM', 'Hospedagem', 'Hospedagens'), ('BOOKING', 'Hospedagem', 'Hospedagens'), ('AIRBNB', 'Hospedagem', 'Hospedagens'),
  ('HOTEL', 'Hospedagem', 'Hospedagens'), ('POUSADA', 'Hospedagem', 'Hospedagens'),
  ('NUTAG', 'Pedágio', 'Viagens e Lobby'), ('SEM PARAR', 'Pedágio', 'Viagens e Lobby'), ('CONECTCAR', 'Pedágio', 'Viagens e Lobby'), ('VELOE', 'Pedágio', 'Viagens e Lobby'),
  ('CLICKUP', 'Assinaturas e software', 'Softwares e Licenças'), ('ANTHROPIC', 'Assinaturas e software', 'Softwares e Licenças'),
  ('CLAUDE', 'Assinaturas e software', 'Softwares e Licenças'), ('OPENAI', 'Assinaturas e software', 'Softwares e Licenças'),
  ('CHATGPT', 'Assinaturas e software', 'Softwares e Licenças'), ('D4SIGN', 'Assinaturas e software', 'Softwares e Licenças'),
  ('GOOGLE', 'Assinaturas e software', 'Softwares e Licenças'), ('MICROSOFT', 'Assinaturas e software', 'Softwares e Licenças'),
  ('MERCADOLIVRE', 'Marketplace', null), ('MERCADO*MERCADOLIVRE', 'Marketplace', null), ('EBAZAR', 'Marketplace', null), ('AMAZON', 'Marketplace', null),
  ('LOCALIZA', 'Locação de veículos', null), ('MOVIDA', 'Locação de veículos', null), ('UNIDAS', 'Locação de veículos', null), ('LOCADORA', 'Locação de veículos', null),
  ('UBER', 'Transporte e aplicativos', null), ('99APP', 'Transporte e aplicativos', null),
  ('IFOOD', 'Alimentação', null), ('RESTAURANTE', 'Alimentação', null), ('PADARIA', 'Alimentação', null), ('SUPERMERCADO', 'Alimentação', null),
  ('POSTO', 'Combustível', null), ('IPIRANGA', 'Combustível', null), ('SHELL', 'Combustível', null), ('PETROBRAS', 'Combustível', null),
  ('ESTACIONAMENTO', 'Estacionamento', null), ('CORREIOS', 'Postagem e frete', null);

-- 4) Faturas importadas (prova) ---------------------------------------------
create table crt_faturas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  cartao text not null references crt_cartoes(codigo),
  vencimento date not null,                                -- vencimento EFETIVO impresso na fatura
  total_informado numeric(14,2) not null check (total_informado >= 0),
  soma_linhas numeric(14,2) not null,                      -- soma das linhas não descartadas (= total, conferido na importação)
  linhas_lidas int not null,
  linhas_descartadas int not null default 0,
  leitor text not null,
  arquivo_nome text,
  observacao text,
  status text not null default 'importada' check (status in ('importada', 'cancelada')),
  importado_por uuid references perfis(id) default auth.uid(),
  importado_em timestamptz not null default now(),
  cancelado_por uuid references perfis(id),
  cancelado_em timestamptz,
  motivo_cancelamento text
);
comment on table crt_faturas is 'Fatura de cartão importada (cabeçalho). Prova: imutável; só muda para cancelada, com motivo. A conciliação é calculada na hora sobre cap_lancamentos.';
create unique index uq_crt_fatura_ciclo on crt_faturas (empresa_id, cartao, vencimento) where status = 'importada';
create index idx_crt_faturas_cartao on crt_faturas (cartao, vencimento desc);

create table crt_fatura_linhas (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references crt_faturas(id),
  ordem int not null,
  pagina int,
  data_compra date,
  descricao text not null,
  valor numeric(14,2) not null,                            -- negativo = estorno/crédito
  parcela_num int,
  parcela_total int,
  descartada boolean not null default false,               -- pagamento da fatura anterior, saldo, total: fora do cruzamento
  motivo_descarte text,
  texto_origem text,
  unique (fatura_id, ordem)
);
comment on table crt_fatura_linhas is 'Linhas de transação da fatura importada, como lidas do arquivo. Imutáveis.';

-- Regras da fatura: ao inserir, quem/quando; depois só a transição importada → cancelada (com motivo); o resto é imutável.
create function fn_crt_fatura_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.status := 'importada'; new.importado_por := auth.uid(); new.importado_em := now();
      new.cancelado_por := null; new.cancelado_em := null; new.motivo_cancelamento := null;
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'status' - 'cancelado_por' - 'cancelado_em' - 'motivo_cancelamento' - 'observacao')
     <> (to_jsonb(old) - 'status' - 'cancelado_por' - 'cancelado_em' - 'motivo_cancelamento' - 'observacao') then
    raise exception 'A fatura importada é imutável: cancele-a (com motivo) e importe de novo.';
  end if;
  if old.status = 'cancelada' then
    raise exception 'A fatura já está cancelada e não pode mais ser alterada.';
  end if;
  if new.status = 'cancelada' then
    if coalesce(trim(new.motivo_cancelamento), '') = '' then
      raise exception 'Informe o motivo do cancelamento.';
    end if;
    if auth.uid() is not null then
      if not tem_acesso_area('financeiro', 'gestor') and old.importado_por is distinct from auth.uid() then
        raise exception 'Só gestor do Financeiro cancela a fatura (ou quem a importou).';
      end if;
      new.cancelado_por := auth.uid();
    end if;
    new.cancelado_em := now();
  else
    new.cancelado_por := old.cancelado_por; new.cancelado_em := old.cancelado_em; new.motivo_cancelamento := old.motivo_cancelamento;
  end if;
  return new;
end $$;
create trigger trg_crt_faturas_regras before insert or update on crt_faturas for each row execute function fn_crt_fatura_regras();
create trigger trg_crt_faturas_sem_delete before delete on crt_faturas for each row execute function fn_bloquear_delete();
create trigger trg_aud_crt_faturas after insert or update on crt_faturas for each row execute function fn_auditoria();

create function fn_crt_linha_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'As linhas da fatura importada são imutáveis; cancele a fatura e importe de novo.';
end $$;
create trigger trg_crt_linhas_imutavel before update on crt_fatura_linhas for each row execute function fn_crt_linha_imutavel();
create trigger trg_crt_linhas_sem_delete before delete on crt_fatura_linhas for each row execute function fn_bloquear_delete();

-- 5) RLS ---------------------------------------------------------------------
alter table crt_cartoes enable row level security;
alter table crt_estabelecimentos enable row level security;
alter table crt_faturas enable row level security;
alter table crt_fatura_linhas enable row level security;

create policy crt_cartoes_ler on crt_cartoes for select to authenticated using (tem_acesso_area('financeiro'));
create policy crt_cartoes_inserir on crt_cartoes for insert to authenticated with check (tem_acesso_area('financeiro', 'gestor'));
create policy crt_cartoes_alterar on crt_cartoes for update to authenticated using (tem_acesso_area('financeiro', 'gestor')) with check (tem_acesso_area('financeiro', 'gestor'));

create policy crt_estab_ler on crt_estabelecimentos for select to authenticated using (tem_acesso_area('financeiro'));
create policy crt_estab_inserir on crt_estabelecimentos for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
create policy crt_estab_alterar on crt_estabelecimentos for update to authenticated using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));

create policy crt_faturas_ler on crt_faturas for select to authenticated using (tem_acesso_area('financeiro'));
create policy crt_faturas_inserir on crt_faturas for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
create policy crt_faturas_alterar on crt_faturas for update to authenticated using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));

create policy crt_linhas_ler on crt_fatura_linhas for select to authenticated using (tem_acesso_area('financeiro'));
create policy crt_linhas_inserir on crt_fatura_linhas for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
-- Sem update nem delete: gatilhos bloqueiam e não há política.

-- 6) View das faturas (nomes) -------------------------------------------------
create view crt_vw_faturas with (security_invoker = true) as
select f.*, e.nome_curto as empresa_nome, c.nome as cartao_nome, c.banco as cartao_banco, pi.nome as importado_por_nome, pc.nome as cancelado_por_nome
  from crt_faturas f
  join empresas e on e.id = f.empresa_id
  join crt_cartoes c on c.codigo = f.cartao
  left join perfis pi on pi.id = f.importado_por
  left join perfis pc on pc.id = f.cancelado_por;

-- 7) Funções ----------------------------------------------------------------
-- Importa a fatura (cabeçalho + linhas numa transação). Operador ou acima. Recusa soma das linhas ≠ total informado
-- (extração incompleta gera conciliação falsa) e ciclo já importado (cancele antes).
-- p_linhas: [{ordem, pagina, data_compra, descricao, valor, parcela_num, parcela_total, descartada, motivo_descarte, texto_origem}]
create function crt_importar_fatura(p_empresa uuid, p_cartao text, p_vencimento date, p_total numeric, p_leitor text, p_arquivo text, p_linhas jsonb, p_observacao text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_n int;
  v_descartadas int;
  v_soma numeric(14,2);
  v_existente uuid;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode importar a fatura.';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and ativa) then
    raise exception 'Empresa inválida.';
  end if;
  if not exists (select 1 from crt_cartoes where codigo = p_cartao and ativo) then
    raise exception 'Cartão % não existe ou está inativo.', p_cartao;
  end if;
  if p_vencimento is null then
    raise exception 'Informe o vencimento efetivo da fatura.';
  end if;
  if p_total is null or p_total < 0 then
    raise exception 'Informe o total da fatura conforme o documento do emissor.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'A fatura não tem linhas de transação.';
  end if;
  if jsonb_array_length(p_linhas) > 2000 then
    raise exception 'A fatura tem linhas demais (limite 2000).';
  end if;
  select id into v_existente from crt_faturas where empresa_id = p_empresa and cartao = p_cartao and vencimento = p_vencimento and status = 'importada';
  if v_existente is not null then
    raise exception 'A fatura % com vencimento em % já foi importada. Cancele-a (com motivo) antes de importar outra.', p_cartao, to_char(p_vencimento, 'DD/MM/YYYY');
  end if;

  select count(*), count(*) filter (where coalesce((l->>'descartada')::boolean, false)),
         coalesce(sum((l->>'valor')::numeric) filter (where not coalesce((l->>'descartada')::boolean, false)), 0)
    into v_n, v_descartadas, v_soma
    from jsonb_array_elements(p_linhas) l;
  if v_soma <> round(p_total, 2) then
    raise exception 'A soma das linhas lidas (R$ %) não bate com o total informado (R$ %): a leitura está incompleta ou o total está errado.',
      to_char(v_soma, 'FM999G999G990D00'), to_char(round(p_total, 2), 'FM999G999G990D00');
  end if;

  insert into crt_faturas (empresa_id, cartao, vencimento, total_informado, soma_linhas, linhas_lidas, linhas_descartadas, leitor, arquivo_nome, observacao)
  values (p_empresa, p_cartao, p_vencimento, round(p_total, 2), v_soma, v_n, v_descartadas, coalesce(p_leitor, 'generico'), p_arquivo, nullif(trim(p_observacao), ''))
  returning id into v_id;

  insert into crt_fatura_linhas (fatura_id, ordem, pagina, data_compra, descricao, valor, parcela_num, parcela_total, descartada, motivo_descarte, texto_origem)
  select v_id, coalesce((l->>'ordem')::int, n::int), (l->>'pagina')::int, nullif(l->>'data_compra', '')::date,
         coalesce(nullif(trim(l->>'descricao'), ''), '(sem descrição)'), round((l->>'valor')::numeric, 2),
         (l->>'parcela_num')::int, (l->>'parcela_total')::int, coalesce((l->>'descartada')::boolean, false), l->>'motivo_descarte', l->>'texto_origem'
    from jsonb_array_elements(p_linhas) with ordinality as t(l, n);
  return v_id;
end $$;
revoke all on function crt_importar_fatura(uuid, text, date, numeric, text, text, jsonb, text) from public, anon;
grant execute on function crt_importar_fatura(uuid, text, date, numeric, text, text, jsonb, text) to authenticated;

-- Cancela a fatura importada (gestor, ou quem importou), com motivo. Nunca delete.
create function crt_cancelar_fatura(p_id uuid, p_motivo text) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_n int;
begin
  update crt_faturas set status = 'cancelada', motivo_cancelamento = nullif(trim(p_motivo), '') where id = p_id and status = 'importada';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Fatura não encontrada ou já cancelada (ou você não tem acesso a ela).';
  end if;
end $$;
revoke all on function crt_cancelar_fatura(uuid, text) from public, anon;
grant execute on function crt_cancelar_fatura(uuid, text) to authenticated;

-- Cadastro de cartões (gestor): cria ou altera.
create function crt_salvar_cartao(p_codigo text, p_nome text, p_banco text, p_tipo_pessoa text, p_dia_fechamento int, p_dia_vencimento int,
                                  p_tipo_titulo int, p_leitor text, p_pasta_faturas text, p_ativo boolean, p_observacao text)
returns text
language plpgsql security invoker set search_path = public as $$
declare
  v_codigo text := crt_normalizar(trim(p_codigo));
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'gestor') then
    raise exception 'Somente gestor do Financeiro (ou acima) pode alterar o cadastro de cartões.';
  end if;
  if coalesce(v_codigo, '') = '' or length(v_codigo) > 30 then
    raise exception 'Informe o código do cartão (ex.: NUBANK PF).';
  end if;
  if coalesce(trim(p_nome), '') = '' or coalesce(trim(p_banco), '') = '' then
    raise exception 'Informe o nome e o banco do cartão.';
  end if;
  insert into crt_cartoes (codigo, nome, banco, tipo_pessoa, dia_fechamento, dia_vencimento, tipo_titulo, leitor, pasta_faturas, ativo, observacao, atualizado_por)
  values (v_codigo, trim(p_nome), trim(p_banco), p_tipo_pessoa, p_dia_fechamento, p_dia_vencimento, p_tipo_titulo, coalesce(p_leitor, 'generico'),
          nullif(trim(p_pasta_faturas), ''), coalesce(p_ativo, true), nullif(trim(p_observacao), ''), auth.uid())
  on conflict (codigo) do update set
    nome = excluded.nome, banco = excluded.banco, tipo_pessoa = excluded.tipo_pessoa, dia_fechamento = excluded.dia_fechamento,
    dia_vencimento = excluded.dia_vencimento, tipo_titulo = excluded.tipo_titulo, leitor = excluded.leitor, pasta_faturas = excluded.pasta_faturas,
    ativo = excluded.ativo, observacao = excluded.observacao, atualizado_por = auth.uid();
  return v_codigo;
end $$;
revoke all on function crt_salvar_cartao(text, text, text, text, int, int, int, text, text, boolean, text) from public, anon;
grant execute on function crt_salvar_cartao(text, text, text, text, int, int, int, text, text, boolean, text) to authenticated;

-- Dicionário (operador): cria ou altera pelo padrão normalizado.
create function crt_salvar_estabelecimento(p_padrao text, p_categoria text, p_conta_fluxo text, p_ativo boolean default true)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_padrao text := crt_normalizar(trim(p_padrao));
  v_id uuid;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode alterar o dicionário de estabelecimentos.';
  end if;
  if coalesce(v_padrao, '') = '' or length(v_padrao) < 2 or length(v_padrao) > 60 then
    raise exception 'Informe o trecho do estabelecimento como aparece na fatura (2 a 60 caracteres).';
  end if;
  if coalesce(trim(p_categoria), '') = '' then
    raise exception 'Informe a categoria.';
  end if;
  insert into crt_estabelecimentos (padrao, categoria, conta_fluxo, ativo)
  values (v_padrao, trim(p_categoria), nullif(trim(p_conta_fluxo), ''), coalesce(p_ativo, true))
  on conflict (padrao) do update set categoria = excluded.categoria, conta_fluxo = excluded.conta_fluxo, ativo = excluded.ativo
  returning id into v_id;
  return v_id;
end $$;
revoke all on function crt_salvar_estabelecimento(text, text, text, boolean) from public, anon;
grant execute on function crt_salvar_estabelecimento(text, text, text, boolean) to authenticated;
