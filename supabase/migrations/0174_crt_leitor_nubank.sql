-- =========================================================
-- Neo Admin — 0174 Cartão de crédito: leitor Nubank (calibrado em 20/10/2026 com a fatura PF de 10/2026, PDF sem senha)
-- O cadastro de cartões ganha o leitor `nubank`; o NUBANK PF passa a usá-lo. Os demais continuam como estavam.
-- =========================================================
alter table crt_cartoes drop constraint if exists crt_cartoes_leitor_check;
alter table crt_cartoes add constraint crt_cartoes_leitor_check check (leitor in ('sicredi', 'picpay', 'inter', 'unicred', 'nubank', 'generico'));

update crt_cartoes set leitor = 'nubank' where codigo = 'NUBANK PF' and leitor = 'generico';
