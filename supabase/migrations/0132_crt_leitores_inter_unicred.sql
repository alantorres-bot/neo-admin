-- =========================================================
-- Neo Admin — 0132 Cartão de crédito: leitores Inter e Unicred (calibrados em 12/10/2026 com faturas reais, abertas com senha)
-- O cadastro de cartões ganha os leitores `inter` e `unicred`. Inter PF e PJ usam o mesmo leitor (layout do emissor);
-- Unicred PF usa o seu. Os demais continuam como estavam.
-- =========================================================
alter table crt_cartoes drop constraint if exists crt_cartoes_leitor_check;
alter table crt_cartoes add constraint crt_cartoes_leitor_check check (leitor in ('sicredi', 'picpay', 'inter', 'unicred', 'generico'));

update crt_cartoes set leitor = 'inter' where codigo in ('INTER PF', 'INTER PJ') and leitor = 'generico';
update crt_cartoes set leitor = 'unicred' where codigo = 'UNICRED PF' and leitor = 'generico';
