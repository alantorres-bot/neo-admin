-- =========================================================
-- Neo Admin — 0809 GED: dentro do Neo Admin, só o admin geral lê o GED (decisão do responsável, 26/10/2026)
--
-- Os demais colaboradores continuam com o acesso que já têm DIRETAMENTE no Google Drive; nada muda no Drive.
-- ged_pode_ler_raiz passa a ser só eh_admin_geral(). Como ela é a regra única de leitura do GED (5.11.2), isso vale de uma vez para:
--   - a projeção ged_raizes() e ged_indexacoes_visiveis();
--   - a RLS de ged_pastas, ged_documentos e ged_documento_revisoes (API direta inclusive).
-- As áreas cadastradas nas raízes (dona, leitura, operação) e a trava da elaboração continuam gravadas e valendo no banco; só não
-- dão leitura enquanto esta decisão valer. Voltar à regra por área = recriar a função como na 0804.
-- Não liga a indexação, não cria agendamento e não toca na conexão nem nas raízes.
-- =========================================================

create or replace function ged_pode_ler_raiz(p_raiz uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select eh_admin_geral();
$$;
revoke all on function ged_pode_ler_raiz(uuid) from public, anon, authenticated, service_role;
grant execute on function ged_pode_ler_raiz(uuid) to authenticated;
