-- =========================================================
-- Neo Admin — 0703 Comissões passa do Financeiro para o Comercial (Alan, 20/10/2026)
-- Especificação: docs/modulos/comercial-comissoes.md.
--
-- O módulo muda de código ('financeiro.comissoes' → 'comercial.comissoes', rota /comercial/comissoes) e de área: o
-- acesso passa a ser pela permissão da área Comercial. As tabelas continuam com o prefixo fin_com_ (renomear tabela
-- com registros de prova e auditoria não traz ganho); só as regras de acesso que citam o código mudam.
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('comercial.comissoes', 'comercial', 'Comissões', true)
on conflict (codigo) do update set area = excluded.area, nome = excluded.nome, ativo = true;

-- Registros do núcleo que apontam para o código antigo passam para o novo.
update pendencias set modulo = 'comercial.comissoes' where modulo = 'financeiro.comissoes';
update anexos set modulo = 'comercial.comissoes' where modulo = 'financeiro.comissoes';
update modelos_mensagem set modulo = 'comercial.comissoes' where modulo = 'financeiro.comissoes';
update mensagens set modulo = 'comercial.comissoes' where modulo = 'financeiro.comissoes';
update interacoes set modulo = 'comercial.comissoes' where modulo = 'financeiro.comissoes';
update importacoes set modulo = 'comercial.comissoes' where modulo = 'financeiro.comissoes';
update importacao_modelos set modulo = 'comercial.comissoes' where modulo = 'financeiro.comissoes';
delete from modulos where codigo = 'financeiro.comissoes';

-- Leitura pela RLS.
drop policy fin_com_rep_ler on fin_com_representantes;
drop policy fin_com_fech_ler on fin_com_fechamentos;
drop policy fin_com_cred_ler on fin_com_creditos;
drop policy fin_com_linhas_ler on fin_com_linhas;
drop policy fin_com_reab_ler on fin_com_reaberturas;
create policy fin_com_rep_ler on fin_com_representantes for select to authenticated using (tem_acesso_modulo('comercial.comissoes'));
create policy fin_com_fech_ler on fin_com_fechamentos for select to authenticated using (tem_acesso_modulo('comercial.comissoes'));
create policy fin_com_cred_ler on fin_com_creditos for select to authenticated using (tem_acesso_modulo('comercial.comissoes'));
create policy fin_com_linhas_ler on fin_com_linhas for select to authenticated using (tem_acesso_modulo('comercial.comissoes'));
create policy fin_com_reab_ler on fin_com_reaberturas for select to authenticated using (tem_acesso_modulo('comercial.comissoes'));

-- Gravação: todas as funções conferem o nível por aqui.
create or replace function fin_com_exigir(p_nivel nivel_acesso) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not tem_acesso_modulo('comercial.comissoes', p_nivel) then
    raise exception 'Somente % do Comercial (ou acima) pode fazer isso nas comissões.', p_nivel;
  end if;
end $$;
