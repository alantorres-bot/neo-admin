-- GED — conferência do agendamento da indexação (só leitura).
-- Antes da 0807: job ausente. Depois da 0807: presente e INATIVO. Depois do bloco E do procedimento: ativo.
-- Rodar: npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no -f scripts/ged-verificar-agendamento.sql
select
  (select count(*) from cron.job where jobname = 'ged-indexar-30min')                                   as jobs_ged,
  (select active from cron.job where jobname = 'ged-indexar-30min')                                     as ativo,
  -- '20,50 11-22 * * 1-5' em UTC (o pg_cron usa UTC) = 07h20 a 18h50 em Cuiabá (UTC-4, sem horário de verão), dias úteis.
  (select schedule from cron.job where jobname = 'ged-indexar-30min')                                   as horario_utc,
  (select command from cron.job where jobname = 'ged-indexar-30min')                                    as comando,
  (select username from cron.job where jobname = 'ged-indexar-30min')                                   as executa_como,
  to_regprocedure('public.ged_chamar_indexacao()') is not null                                           as funcao_chamadora,
  case when to_regprocedure('public.ged_chamar_indexacao()') is null then null
       else not (has_function_privilege('anon', 'public.ged_chamar_indexacao()', 'execute')
              or has_function_privilege('authenticated', 'public.ged_chamar_indexacao()', 'execute')
              or has_function_privilege('service_role', 'public.ged_chamar_indexacao()', 'execute')) end as chamadora_fechada_a_usuarios,
  (select valor::text from configuracoes where chave = 'administrativo.ged.indexar')                    as interruptor,
  (select string_agg(x.status || ' ' || to_char(x.start_time at time zone 'America/Cuiaba', 'DD/MM HH24:MI'), '; ' order by x.start_time desc)
     from (select d.status, d.start_time from cron.job_run_details d join cron.job j on j.jobid = d.jobid
            where j.jobname = 'ged-indexar-30min' order by d.start_time desc limit 5) x)                as ultimas_execucoes_do_job;
