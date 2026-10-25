-- GED — conferência antes da PRIMEIRA indexação (só leitura; nenhuma chamada ao Google).
-- Rodar: npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no -f scripts/ged-primeira-indexacao.sql
-- Tudo precisa vir `true` em `pronto`. Depois, e só com a aprovação da A1a e o PENDENTE 12 tratado:
--   1. update configuracoes set valor = 'true' where chave = 'administrativo.ged.indexar';
--   2. select public.ged_chamar_indexacao();      -- 1ª rodada manual (carga inicial das duas raízes)
--   3. conferir: select status_code, content from net._http_response order by id desc limit 1;
--               select tipo, concluida_em, resumo, erro from ged_indexacoes order by iniciada_em desc;
--   4. só com as duas rodadas `ok` e completas: select cron.alter_job((select jobid from cron.job where jobname = 'ged-indexar-30min'), active := true);
-- Para desligar a qualquer momento: update configuracoes set valor = 'false' where chave = 'administrativo.ged.indexar';
with c as (
  select
    (select valor = 'false'::jsonb from configuracoes where chave = 'administrativo.ged.indexar')        as interruptor_ainda_desligado,
    (select count(*) = 2 from ged_pastas_raiz where situacao = 'ativa')                                  as duas_raizes_ativas,
    (select count(*) = 0 from ged_pastas_raiz where page_token is not null)                              as sem_ponto_de_continuacao,
    (select tomada_em is null from ged_trava)                                                            as trava_livre,
    (select count(*) = 0 from ged_indexacoes where concluida_em is null)                                 as sem_rodada_aberta,
    (select desconectado_em is null and ultimo_erro is null and segredo_id is not null from ged_conexao) as conexao_ativa_sem_erro,
    (select count(*) = 2 from vault.decrypted_secrets where name in ('rec_sincronizar_url', 'rec_sincronizar_segredo')) as segredo_no_vault,
    -- O mesmo segredo serve às outras rotinas agendadas: resposta 200 recente = segredo aceito pelas Edge Functions.
    (select count(*) > 0 from net._http_response where status_code = 200 and created > now() - interval '7 days') as segredo_aceito_recentemente,
    (select coalesce(bool_and(not active), true) from cron.job where jobname = 'ged-indexar-30min')     as agendamento_inativo_ou_ausente
)
select c.*, interruptor_ainda_desligado and duas_raizes_ativas and sem_ponto_de_continuacao and trava_livre and sem_rodada_aberta
            and conexao_ativa_sem_erro and segredo_no_vault and segredo_aceito_recentemente and agendamento_inativo_ou_ausente as pronto
  from c;
