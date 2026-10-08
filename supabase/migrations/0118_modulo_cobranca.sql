-- Cobrança (menu Financeiro > Cobrança): o trabalho do contas a receber (boletos a anexar e enviar, confirmar pagamento, cobrar,
-- baixas a conferir) sai de Recebíveis e ganha módulo próprio. A rota sai do código do módulo (/financeiro/cobranca) e a permissão
-- continua sendo por ÁREA (Financeiro): quem já acessa Recebíveis acessa Cobrança. Idempotente.
insert into modulos (codigo, area, nome, ativo) values ('financeiro.cobranca', 'financeiro', 'Cobrança', true)
on conflict (codigo) do update set ativo = true, nome = excluded.nome;
