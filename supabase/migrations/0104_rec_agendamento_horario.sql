-- =========================================================
-- Neo Admin — 0104 Sincronização de hora em hora em dias úteis
-- Substitui o job diário da 0102 (07:00 todos os dias) por uma execução por hora, de segunda a sexta, das
-- 08:00 às 18:00 de Cuiabá (12:00–22:00 UTC; Cuiabá é UTC-4 e não tem horário de verão). Assim o título da NF
-- recém-emitida entra na esteira em até uma hora. Mesma função e mesmo segredo da 0102.
-- Para pausar: select cron.unschedule('rec-sincronizar-consistem-horario');
-- =========================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'rec-sincronizar-consistem-diario') then
      perform cron.unschedule('rec-sincronizar-consistem-diario');
    end if;
    -- Mesmo nome = atualiza o agendamento existente (pode reaplicar sem duplicar).
    perform cron.schedule('rec-sincronizar-consistem-horario', '0 12-22 * * 1-5', 'select public.rec_chamar_sincronizacao()');
  end if;
end $$;
