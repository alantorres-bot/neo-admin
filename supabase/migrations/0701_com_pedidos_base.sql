-- =========================================================
-- Neo Admin — 0701 Comercial / Pedidos: espelho da carteira de pedidos (Fase 1)
-- Especificação: docs/modulos/comercial-pedidos.md.
--
-- A Edge Function com-pedidos-sincronizar lê a API Comercial do Consistem (só leitura) e grava aqui:
--   com_pedidos         pedidoVendaResumido (nomes já vêm) + detalhe pedidoVenda/{id} (itens, antecipado, portador)
--   com_pedido_itens    itens do pedido (quantidades pedida, faturada, cancelada)
--   com_notas           NFs de cada pedido (notaFiscalSaidaPedido/{codPedido})
--   com_nota_parcelas   títulos de cada NF (notaFiscalSaida/{chaveAcesso}/titulo): parcelas, vencimento e pagamento
--   com_sincronizacoes  histórico das rodadas
-- É ESPELHO: sem gatilho de auditoria e sem gravação pelo usuário (só a service role da Edge Function grava).
-- A prova continua no Consistem. Leitura: quem tem acesso ao módulo (área Comercial).
--
-- Agendamento: a cada 30 min nos dias úteis, 07:05–18:35 de Cuiabá (11:05–22:35 UTC), defasado de Recebíveis (:00/:30)
-- e Contas a pagar (:15/:45). Usa o mesmo segredo do Vault das outras sincronizações (rec_sincronizar_url/segredo).
-- Para pausar: select cron.unschedule('com-pedidos-sincronizar-30min');
-- =========================================================

create table com_pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  cod_pedido text not null,                 -- codPedido no Consistem
  situacao text not null,                   -- 0 Digitado … 9 Cancelado (texto, como vem da API)
  cod_cliente text,
  nome_cliente text,
  contraparte_id uuid references contrapartes(id),   -- cliente no núcleo (pelo código do Consistem), quando existe
  cod_representante text,
  nome_representante text,
  cod_tipo_nf text,
  desc_tipo_nf text,
  cod_cond_venda text,
  desc_cond_venda text,
  data_emissao date,
  data_digitacao date,
  data_prev_fat date,                       -- previsão de faturamento
  data_ultimo_fat date,
  valor_total numeric(14,2) not null default 0,
  valor_faturado numeric(14,2) not null default 0,
  valor_saldo numeric(14,2) not null default 0,       -- a faturar
  valor_cancelado numeric(14,2) not null default 0,
  valor_bloqueado numeric(14,2) not null default 0,
  valor_antecipado numeric(14,2),                     -- adiantamento do cliente informado no pedido (detalhe)
  cod_portador text,                                  -- detalhe
  observacao text,                                    -- detalhe (observacaoPedido)
  assinatura text,                          -- resumo do que muda (situação/valores/previsão): diferente = reler detalhe e NFs
  detalhado_em timestamptz,                 -- quando o detalhe (itens) foi lido
  notas_lidas_em timestamptz,               -- quando as NFs do pedido foram lidas
  primeiro_visto_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, cod_pedido)
);
create index idx_com_pedidos_abertos on com_pedidos (empresa_id, data_prev_fat) where valor_saldo > 0 and situacao <> '9';
create index idx_com_pedidos_representante on com_pedidos (empresa_id, cod_representante);
create trigger trg_com_pedidos_atualizado before update on com_pedidos for each row execute function fn_atualizado_em();

create table com_pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references com_pedidos(id) on delete cascade,
  item integer not null,                    -- itemPedido
  cod_produto text,
  qtd_pedida numeric(14,3) not null default 0,
  qtd_faturada numeric(14,3) not null default 0,
  qtd_cancelada numeric(14,3) not null default 0,
  preco_unitario numeric(14,4),
  unique (pedido_id, item)
);

create table com_notas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references com_pedidos(id) on delete cascade,
  nota text not null,                       -- número da NF, sem zeros à esquerda
  serie text not null default '',
  chave_acesso varchar(44),
  situacao text,                            -- 1 Gerada, 2 Emitida, 3 Cancelada
  cod_tipo_nota text,
  data_emissao date,
  data_hora_saida timestamptz,
  valor_total numeric(14,2),
  qtd_volumes numeric(14,3),
  sem_titulos boolean not null default false,          -- a API respondeu "Títulos não encontrados" (NF não gera duplicata)
  parcelas_lidas_em timestamptz,
  visto_em timestamptz not null default now(),
  unique (pedido_id, nota, serie)
);
create index idx_com_notas_chave on com_notas (chave_acesso) where chave_acesso is not null;

create table com_nota_parcelas (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references com_notas(id) on delete cascade,
  cod_titulo text not null,
  data_emissao date,
  data_vencimento date,
  data_pagamento date,
  valor numeric(14,2) not null default 0,
  valor_juros numeric(14,2),
  valor_desconto numeric(14,2),
  cod_portador text,
  visto_em timestamptz not null default now(),
  unique (nota_id, cod_titulo)
);

create table com_sincronizacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz,
  agendada boolean not null default false,
  usuario_id uuid references perfis(id),
  resumo jsonb,
  erro text
);
create index idx_com_sincronizacoes_recentes on com_sincronizacoes (iniciada_em desc);

alter table com_pedidos enable row level security;
alter table com_pedido_itens enable row level security;
alter table com_notas enable row level security;
alter table com_nota_parcelas enable row level security;
alter table com_sincronizacoes enable row level security;
create policy com_pedidos_ler on com_pedidos for select to authenticated using (tem_acesso_modulo('comercial.pedidos'));
create policy com_pedido_itens_ler on com_pedido_itens for select to authenticated using (tem_acesso_modulo('comercial.pedidos'));
create policy com_notas_ler on com_notas for select to authenticated using (tem_acesso_modulo('comercial.pedidos'));
create policy com_nota_parcelas_ler on com_nota_parcelas for select to authenticated using (tem_acesso_modulo('comercial.pedidos'));
create policy com_sincronizacoes_ler on com_sincronizacoes for select to authenticated using (tem_acesso_modulo('comercial.pedidos'));

-- Agendamento --------------------------------------------------------------------------------------------------------
-- Quem executa é o job (usuário postgres). A URL sai da de Recebíveis (mesmo projeto), como em cap_chamar_sincronizacao().
create or replace function com_chamar_sincronizacao() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_segredo text;
  v_requisicao bigint;
begin
  select replace(decrypted_secret, 'rec-sincronizar-consistem', 'com-pedidos-sincronizar') into v_url from vault.decrypted_secrets where name = 'rec_sincronizar_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'rec_sincronizar_segredo';
  if v_url is null or v_segredo is null then
    raise warning 'Sincronização dos pedidos sem configuração: faltam rec_sincronizar_url e/ou rec_sincronizar_segredo no Vault.';
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sincronizacao-segredo', v_segredo),
    body := '{"acao":"sincronizar"}'::jsonb,
    timeout_milliseconds := 150000
  ) into v_requisicao;
  return v_requisicao;
end $$;
revoke all on function com_chamar_sincronizacao() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Mesmo nome = atualiza o agendamento existente (pode reaplicar sem duplicar).
    perform cron.schedule('com-pedidos-sincronizar-30min', '5,35 11-22 * * 1-5', 'select public.com_chamar_sincronizacao()');
  end if;
end $$;
