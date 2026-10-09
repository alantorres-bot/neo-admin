-- =========================================================
-- Neo Admin — 0121 Contas a pagar: base (Fase 1)
-- Módulo Financeiro > Contas a pagar: os títulos a pagar (tipo C) e as antecipações a fornecedor (tipo A) em aberto no
-- Consistem, juntos numa tela, para a diretoria montar a autorização de pagamento (Fase 2) e imprimir o relatório (Fase 3).
-- Especificação: docs/modulos/financeiro-contas-pagar.md.
--
-- Por que um ESPELHO e não leitura ao vivo: a API do Consistem (GET financeiro/v10/contasPagar) ignora o filtro `situacao`
-- e devolve a vida inteira (~27 mil lançamentos); "em aberto" = valorAtualizado > 0. A Edge Function cap-sincronizar-consistem
-- lê tudo, grava aqui só o que interessa (C, A e D com saldo) e marca `baixado_em` em quem sumiu dos abertos. A tela lê o banco.
--
-- 1) Módulo ativo no menu (rota /financeiro/contas-pagar; permissão continua sendo por ÁREA, como Recebíveis e Cobrança).
-- 2) Parâmetro: data de corte das antecipações (as anteriores são consideradas pagas fora do Neo Admin).
-- 3) cap_fornecedores: espelho do cadastro de fornecedores (a lista de títulos só traz o código).
-- 4) cap_lancamentos: espelho dos lançamentos. SEM gatilho de auditoria (milhares de linhas por rodada); a prova do módulo
--    são as autorizações (Fase 2). Só a service role (Edge Function) grava; quem tem a área lê.
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('financeiro.contas-pagar', 'financeiro', 'Contas a pagar', true)
on conflict (codigo) do update set ativo = true, nome = excluded.nome;

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.contas-pagar.antecipacoes_a_partir_de', 'null',
   'Antecipações a fornecedor com data de pagamento (ou emissão) anterior a esta data são consideradas pagas fora do Neo Admin e não entram na lista de autorização. Vazio = todas entram.')
on conflict (chave) do nothing;

-- 3) Fornecedores ------------------------------------------------
create table cap_fornecedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  cod_fornecedor text not null,             -- codFornecedor no Consistem
  nome text not null,
  nome_fantasia text,
  documento varchar(18),                    -- CPF/CNPJ formatado (null se inválido no ERP)
  ativo boolean not null default true,      -- situacao 1 = ativo
  contraparte_id uuid references contrapartes(id),   -- preenchido na Fase 4 (fornecedor como contraparte do núcleo)
  visto_em timestamptz not null default now(),
  unique (empresa_id, cod_fornecedor)
);

-- 4) Lançamentos (espelho) ----------------------------------------
create table cap_lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  cod_lancamento text not null,             -- codLancamento no Consistem
  tipo_lancamento char(1) not null check (tipo_lancamento in ('C', 'A', 'D')),  -- C título, A antecipação, D crédito do fornecedor
  cod_fornecedor text,
  num_documento text,
  categoria_doc text,
  cod_banco text,
  cod_historico text,
  complemento_historico text,
  data_emissao date,
  data_entrada date,
  data_vencimento date,                     -- nula na antecipação (a API manda "0")
  data_pagamento date,                      -- antecipação: data programada/efetiva (vem do detalhe lancamentoContasPagar/{id})
  valor_documento numeric(14,2) not null default 0,
  valor_original numeric(14,2),
  valor_atualizado numeric(14,2) not null default 0,   -- SALDO: a pagar (C) ou ainda não abatido por NF (A)
  cod_origem text,
  cod_portador text,                        -- detalhe
  cod_barras text,                          -- detalhe
  qrcode_pix text,                          -- detalhe
  detalhado_em timestamptz,                 -- quando o detalhe foi lido
  primeiro_visto_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  baixado_em date,                          -- deixou de estar em aberto no Consistem (sumiu da lista ou saldo zerou)
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, cod_lancamento)
);
create index idx_cap_lancamentos_abertos on cap_lancamentos (empresa_id, tipo_lancamento) where baixado_em is null;
create index idx_cap_lancamentos_vencimento on cap_lancamentos (data_vencimento) where baixado_em is null;
create index idx_cap_lancamentos_fornecedor on cap_lancamentos (empresa_id, cod_fornecedor) where baixado_em is null;

create trigger trg_cap_lancamentos_atualizado before update on cap_lancamentos for each row execute function fn_atualizado_em();

-- RLS: leitura para quem tem a área; nenhuma gravação pela API do usuário (só a service role da Edge Function).
alter table cap_fornecedores enable row level security;
alter table cap_lancamentos enable row level security;
create policy cap_fornecedores_ler on cap_fornecedores for select to authenticated using (tem_acesso_area('financeiro'));
create policy cap_lancamentos_ler on cap_lancamentos for select to authenticated using (tem_acesso_area('financeiro'));
