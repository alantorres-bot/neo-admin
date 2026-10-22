-- DADOS FICTÍCIOS (prefixo [DEMO]) para a Central de Gestão no Supabase LOCAL. Nunca rodar em produção.
-- Carregado por scripts/local-sem-docker/central-demo.sh; pode rodar de novo (não duplica).
do $$
begin
  if exists (select 1 from perfis p where p.email like '%@neoformas.com.br' and p.email not like '%.teste@neoformas.com.br') then
    raise exception 'Este banco tem usuários reais: a carga de demonstração só roda no Supabase local.';
  end if;
end $$;

insert into permissoes (perfil_id, area, nivel)
select p.id, a.codigo, 'gestor' from perfis p cross join areas a where p.email = 'gestor.teste@neoformas.com.br'
on conflict (perfil_id, area) do nothing;
insert into permissoes (perfil_id, area, nivel)
select id, 'financeiro', 'operador' from perfis where email = 'operador.financeiro.teste@neoformas.com.br'
on conflict (perfil_id, area) do nothing;
insert into permissoes (perfil_id, area, nivel)
select id, 'fiscal', 'operador' from perfis where email = 'operador.fiscal.teste@neoformas.com.br'
on conflict (perfil_id, area) do nothing;

with u as (select (select id from perfis where email = 'operador.financeiro.teste@neoformas.com.br') fin,
                  (select id from perfis where email = 'operador.fiscal.teste@neoformas.com.br') fis),
     h as (select (now() at time zone 'America/Cuiaba')::date d),
     novas (modulo, titulo, descricao, prazo, criticidade, responsavel_id, origem, link) as (values
  ('financeiro.recebiveis', '[DEMO] Confirmar pagamento: Cliente Exemplo A', 'Ligar para o financeiro do cliente.', (select d from h) + 2, 'alta'::criticidade, (select fin from u), 'modulo', '/financeiro/recebiveis'),
  ('financeiro.recebiveis', '[DEMO] Anexar boleto: NF 1234 — Cliente Exemplo B', null, (select d from h) - 8, 'normal'::criticidade, (select fin from u), 'modulo', '/financeiro/recebiveis'),
  ('financeiro.recebiveis', '[DEMO] Cobrar D+5: Cliente Exemplo C', null, (select d from h), 'normal'::criticidade, null, 'modulo', '/financeiro/cobranca'),
  ('fiscal.creditos', '[DEMO] Fiscal: conferir arquivo enviado pelo contador', null, (select d from h) - 2, 'normal'::criticidade, (select fis from u), 'modulo', '/fiscal/creditos/tarefas'),
  ('administrativo.gestao', '[DEMO] Levantar contratos de locação vencendo em novembro', 'Tarefa manual de exemplo.', (select d from h) + 1, 'alta'::criticidade, null, 'manual', null),
  ('rh.folha', '[DEMO] Fechar folha do mês', null, (select d from h) + 10, 'normal'::criticidade, null, 'modulo', '/rh/folha'))
insert into pendencias (modulo, titulo, descricao, prazo, criticidade, responsavel_id, origem, link)
select n.* from novas n
 where not exists (select 1 from pendencias p where p.titulo = n.titulo and p.status in ('aberta', 'em_andamento'));

update pendencias set bloqueio_motivo = 'Aguardando o extrato do banco', bloqueada_em = now() - interval '3 days'
 where titulo = '[DEMO] Anexar boleto: NF 1234 — Cliente Exemplo B' and bloqueio_motivo is null;
update pendencias set aguarda_gestor_motivo = 'Autorizar desconto de 5% pedido pelo cliente'
 where titulo = '[DEMO] Confirmar pagamento: Cliente Exemplo A' and aguarda_gestor_motivo is null;
