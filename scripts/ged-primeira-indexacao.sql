-- GED — conferência antes de ligar o interruptor e antes de cada rodada manual (só leitura; nenhuma chamada ao Google).
-- Rodar: npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no -f scripts/ged-primeira-indexacao.sql
-- Passos e critérios: docs/GED_PRIMEIRA_INDEXACAO.md. `pronto` precisa vir `true`, e ainda:
--  - o SEGREDO não é conferido aqui (o banco não enxerga SINCRONIZACAO_SEGREDO): `node scripts/ged-conferir-segredo.mjs --ref <ref>`
--    precisa dizer IGUAL. Resposta 200 de outra rotina não prova nada (algumas usam outro segredo; o pg_net guarda só 6 h);
--  - `interruptor_ainda_desligado` só vale antes do bloco C (depois de ligar, é `false` de propósito e fica fora do `pronto`);
--  - `raizes_sem_ponto_de_continuacao` é informativo: 2 na primeira rodada; depois de uma carga parcial, a raiz já carregada tem token.
-- Rodada `esquecida` (aberta, trava com 15 min ou mais) NÃO bloqueia: a próxima chamada a encerra como `interrompida` (0810).
-- Bloqueiam: rodada em andamento (trava com menos de 15 min) e rodada órfã (aberta sem ser dona da trava: investigar).
with c as (
  select
    (select valor = 'false'::jsonb from configuracoes where chave = 'administrativo.ged.indexar')        as interruptor_ainda_desligado,
    (select count(*) = 2 from ged_pastas_raiz where situacao = 'ativa')                                  as duas_raizes_ativas,
    (select count(*) from ged_pastas_raiz where situacao = 'ativa' and page_token is null)               as raizes_sem_ponto_de_continuacao,
    (select tomada_em is null or tomada_em < now() - interval '15 minutes' from ged_trava)              as nenhuma_rodada_em_andamento,
    not exists (select 1 from ged_indexacoes i, ged_trava t where i.concluida_em is null and t.por is distinct from i.id)
                                                                                                         as nenhuma_rodada_orfa,
    (select desconectado_em is null and ultimo_erro is null and segredo_id is not null from ged_conexao) as conexao_ativa_sem_erro,
    (select count(*) = 2 from vault.decrypted_secrets where name in ('rec_sincronizar_url', 'rec_sincronizar_segredo')) as url_e_segredo_no_vault,
    (select coalesce(bool_and(not active), true) from cron.job where jobname = 'ged-indexar-30min')     as agendamento_inativo_ou_ausente
)
select c.*, duas_raizes_ativas and nenhuma_rodada_em_andamento and nenhuma_rodada_orfa and conexao_ativa_sem_erro
            and url_e_segredo_no_vault and agendamento_inativo_ou_ausente as pronto
  from c;
