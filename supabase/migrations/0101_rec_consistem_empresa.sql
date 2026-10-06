-- =========================================================
-- Neo Admin — 0101 Consistem: código da empresa no ERP
-- A sincronização de contas a receber (Edge Function rec-sincronizar-consistem) chama a API do
-- Consistem uma vez por empresa, com o header `empresa: <código>`. Este campo liga a empresa do
-- Neo Admin ao código dela no Consistem. Sem código, a empresa não entra na sincronização.
-- =========================================================

alter table empresas add column codigo_erp text;
create unique index uq_empresas_codigo_erp on empresas (codigo_erp) where codigo_erp is not null;

-- Neo Formas = empresa 1 no Consistem (mesmo valor já usado pelo gestor-akf e pelo NEOControl).
update empresas set codigo_erp = '1' where cnpj = '17.209.767/0001-28' and codigo_erp is null;
