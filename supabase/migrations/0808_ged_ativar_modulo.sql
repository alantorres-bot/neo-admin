-- =========================================================
-- Neo Admin — 0808 GED: ativa o módulo administrativo.ged (atalho "Documentos" no trilho)
--
-- Só muda modulos.ativo. NÃO liga a indexação (administrativo.ged.indexar continua como está), não cria agendamento e não chama
-- nenhuma função. O atalho aparece só para quem lê alguma pasta-raiz ativa (ged_raizes / ged_pode_ler_raiz, 0804); o módulo não
-- entra no submenu do Administrativo (MODULOS_COM_ATALHO_PROPRIO, lib/nucleo/permissoes.ts).
-- Desfazer: update modulos set ativo = false where codigo = 'administrativo.ged';
-- =========================================================

update modulos set ativo = true where codigo = 'administrativo.ged';
