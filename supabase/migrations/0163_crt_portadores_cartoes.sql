-- =========================================================
-- Neo Admin — 0163 Cartão de crédito: códigos de banco/portador da fatura por cartão (regra 56)
-- Fonte: planilha "PORTADORES CARTÕES.xlsx" do Alan (Pesquisa de Portadores do Consistem, 13/10/2026).
-- =========================================================
update crt_cartoes c
   set portador_fatura = v.portador
  from (values ('ITAU PJ', 990), ('NUBANK PF', 991), ('SICREDI PJ', 992), ('INTER PF', 993),
               ('UNICRED PF', 994), ('SICREDI PF', 995), ('PICPAY PF', 996), ('INTER PJ', 997)) as v(codigo, portador)
 where c.codigo = v.codigo;
