-- =========================================================
-- Neo Admin — 0170 Caixa automático pelos saldos bancários: DESLIGADO (decisão do Alan, 19/10/2026)
-- A API do Consistem não fornece o saldo; manter a função exigiria o financeiro digitar o saldo de cada conta todo dia.
-- O "Caixa disponível" da autorização volta a ser digitado (cap_definir_caixa / p_caixa). A sincronização deixa de trazer
-- as contas e de abrir a pendência diária.
-- Nada é apagado: as tabelas e funções da 0169 ficam (sem uso) para religar se a Consistem liberar o saldo pela API.
-- =========================================================

-- Pendências "Registrar saldos bancários" ainda abertas deixam de valer.
update pendencias set status = 'cancelada'
 where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'empresas' and titulo like 'Registrar saldos bancários de %'
   and status in ('aberta', 'em_andamento');

comment on table fin_contas_bancarias is 'DESLIGADA em 19/10/2026 (0170): espelho das contas bancárias do Consistem, sem uso. Ver 0169.';
comment on table fin_saldos_bancarios is 'DESLIGADA em 19/10/2026 (0170): saldos bancários digitados, sem uso. Ver 0169.';
comment on table cap_autorizacao_caixa is 'DESLIGADA em 19/10/2026 (0170): composição do caixa da autorização, sem uso; o caixa volta a ser digitado. Ver 0169.';
