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

-- Fase 6: uma cobrança (aparece no módulo Cobrança da Central) e uma obrigação fiscal a vencer (publicada pelo Fiscal).
insert into pendencias (modulo, titulo, prazo)
select 'financeiro.recebiveis', 'Cobrar D+5: [DEMO] Cliente Exemplo C', (now() at time zone 'America/Cuiaba')::date
 where not exists (select 1 from pendencias where titulo = 'Cobrar D+5: [DEMO] Cliente Exemplo C' and status in ('aberta', 'em_andamento'));

do $$
declare
  v_empresa uuid;
  v_estab uuid;
  v_tipo uuid;
begin
  if to_regclass('public.fis_obrigacoes') is null then return; end if;
  select id into v_empresa from empresas where nome_curto = '[DEMO]';
  if v_empresa is null then
    insert into empresas (razao_social, nome_curto) values ('[DEMO] Empresa Exemplo Ltda', '[DEMO]') returning id into v_empresa;
  end if;
  select id into v_estab from fis_estabelecimentos where cnpj = '11222333000181';
  if v_estab is null then
    insert into fis_estabelecimentos (empresa_id, nome, cnpj, uf) values (v_empresa, '[DEMO] Matriz', '11222333000181', 'MT') returning id into v_estab;
  end if;
  select id into v_tipo from fis_tipos_obrigacao where codigo = 'DEMO_DCTF';
  if v_tipo is null then
    insert into fis_tipos_obrigacao (codigo, nome, esfera, periodicidade, dia_vencimento) values ('DEMO_DCTF', '[DEMO] DCTF', 'federal', 'mensal', 15) returning id into v_tipo;
  end if;
  insert into fis_obrigacoes (tipo_id, empresa_id, estabelecimento_id, competencia, vencimento, responsavel_id)
  select v_tipo, v_empresa, v_estab, date_trunc('month', now())::date, (now() at time zone 'America/Cuiaba')::date + 4,
         (select id from perfis where email = 'operador.fiscal.teste@neoformas.com.br')
  on conflict do nothing;
end $$;
