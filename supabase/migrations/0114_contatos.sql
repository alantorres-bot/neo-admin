-- =========================================================
-- Neo Admin — 0114 Contatos dos clientes
-- 1) contatos.telefone: número para LIGAR (fixo ou celular), além do WhatsApp (ex.: "Ligar para confirmar pagamento").
-- 2) contatos.criado_em / criado_por: quem cadastrou e quando, sem depender da auditoria (que só o admin geral lê).
-- 3) Finalidades já gravadas passam a minúsculas e sem acento ("Cobrança" -> "cobranca"): a régua compara texto exato e um
--    contato com finalidade escrita diferente era ignorado em silêncio. A tela passa a oferecer lista fechada.
-- 4) Índice único em contrapartes.codigo_erp: o mesmo código do Consistem não pode virar dois cadastros.
-- =========================================================

alter table contatos
  add column telefone varchar(20),
  add column criado_em timestamptz not null default now(),
  add column criado_por uuid references perfis(id) default auth.uid();

update contatos
   set finalidades = coalesce(
     (select array_agg(distinct translate(lower(trim(f)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))
        from unnest(finalidades) as f where trim(f) <> ''),
     '{}')
 where finalidades <> '{}';

create unique index uq_contrapartes_codigo_erp on contrapartes (codigo_erp) where codigo_erp is not null and codigo_erp <> '';
