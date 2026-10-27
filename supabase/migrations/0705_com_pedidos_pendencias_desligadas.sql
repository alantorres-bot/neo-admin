-- =========================================================
-- Neo Admin — 0705 COMERCIAL/PEDIDOS: PENDÊNCIAS AUTOMÁTICAS DESLIGADAS (pedido do Alan, 27/10/2026)
-- As regras de "Pedido com previsão vencida" e "MDF-e não encerrado" ainda não estão bem calibradas e misturam a Fila.
-- A sincronização continua (carteira, notas, MDF-e); só deixa de publicar essas pendências enquanto o interruptor
-- estiver false. As abertas são canceladas (nunca apagadas). Religar: valor 'true' (a próxima sincronização recria).
-- =========================================================
insert into configuracoes (chave, valor, descricao) values
  ('comercial.pedidos.pendencias', 'false',
   'Publicar as pendências automáticas de Pedidos (previsão vencida e MDF-e não encerrado) na Fila do dia.')
on conflict (chave) do update set valor = excluded.valor;

update pendencias set status = 'cancelada'
 where modulo = 'comercial.pedidos'
   and titulo in ('Pedido com previsão vencida', 'MDF-e não encerrado')
   and status in ('aberta', 'em_andamento');
