-- =========================================================
-- Neo Admin — 0136 Cartão de crédito, Fase 3: regra "fornecedor → cartão" lida do Neo Fiscal
-- Especificação: docs/modulos/financeiro-cartao.md (seção 5, regras 26 a 29).
--
-- O Neo Fiscal (outro sistema, outro banco) mantém, por fornecedor, qual cartão paga as compras e desde quando
-- (fornecedor_cartao, com vigência). O cadastro continua SÓ lá; aqui fica uma CÓPIA (espelho), atualizada pela Edge Function
-- crt-sincronizar-regras (botão "Atualizar do Neo Fiscal" e pg_cron diário às 07:15), que chama a função cartao-regras do
-- Neo Fiscal com o segredo compartilhado NEO_FISCAL_SEGREDO. Só a service role grava; quem tem a área lê.
-- A conciliação usa a regra para incluir na fatura o título de fornecedor pago no cartão mesmo sem a marca "CARTÃO" no
-- complemento, e para apontar título lançado no cartão errado.
-- =========================================================

create table crt_regras_fornecedor (
  id uuid primary key default gen_random_uuid(),
  cod_fornecedor text not null,                 -- codFornecedor do Consistem (o mesmo nos dois sistemas)
  cartao text not null,                         -- código do cartão (mesma nomenclatura: "ITAU PJ", "NUBANK PF"...)
  parcelas_padrao int not null default 1,
  vigencia_ini date not null,
  vigencia_fim date,                            -- nula = em aberto
  sincronizado_em timestamptz not null default now(),
  unique (cod_fornecedor, vigencia_ini)
);
comment on table crt_regras_fornecedor is 'Cópia da regra fornecedor → cartão do Neo Fiscal (fornecedor_cartao, com vigência). Cadastro só lá; atualizada pela Edge Function crt-sincronizar-regras.';
create index idx_crt_regras_fornecedor on crt_regras_fornecedor (cod_fornecedor, vigencia_ini);

alter table crt_regras_fornecedor enable row level security;
create policy crt_regras_ler on crt_regras_fornecedor for select to authenticated using (tem_acesso_area('financeiro'));
-- Sem política de escrita: só a service role (Edge Function) grava.

-- Agendamento diário (07:15 Cuiabá). URL e segredo do Vault do agendamento de Recebíveis, trocando o nome da função.
create or replace function crt_chamar_sincronizar_regras() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_segredo text;
  v_requisicao bigint;
begin
  select replace(decrypted_secret, 'rec-sincronizar-consistem', 'crt-sincronizar-regras') into v_url from vault.decrypted_secrets where name = 'rec_sincronizar_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'rec_sincronizar_segredo';
  if v_url is null or v_segredo is null then
    raise warning 'Sincronização das regras de cartão sem configuração: faltam rec_sincronizar_url e/ou rec_sincronizar_segredo no Vault.';
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sincronizacao-segredo', v_segredo),
    body := '{"acao":"sincronizar"}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_requisicao;
  return v_requisicao;
end $$;
revoke all on function crt_chamar_sincronizar_regras() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('crt-sincronizar-regras-diario', '15 11 * * *', 'select public.crt_chamar_sincronizar_regras()');
  end if;
end $$;
