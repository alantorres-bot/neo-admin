-- Contas a pagar: título com o principal pago no Consistem e só juros/multa no saldo conta como baixado.
-- A listagem da API devolve valorAtualizado = juros não baixados (ex.: custas de cartório lançadas nos juros); o valorPago só vem
-- no detalhe. A sincronização lê o detalhe uma vez por saldo e guarda aqui (27/10/2026: 652 títulos, R$ 484 mil de juros).

alter table cap_lancamentos
  add column pago_conferido_saldo numeric(14,2),
  add column quitado_saldo numeric(14,2);

comment on column cap_lancamentos.pago_conferido_saldo is
  'Saldo da API quando o detalhe (valorPago) foi lido; saldo diferente = ler de novo.';
comment on column cap_lancamentos.quitado_saldo is
  'Título C com o principal pago: o saldo (juros/multa) que restava. Enquanto a API devolver esse mesmo saldo, conta como baixado.';
