-- =========================================================
-- Neo Admin — 0166 Contas a pagar e Contas a receber atualizados do Consistem a cada 30 minutos
-- Recebíveis: troca o job de hora em hora da 0104 (rec-sincronizar-consistem-horario).
-- Contas a pagar: troca o job diário das 07:30 da 0134 (cap-sincronizar-consistem-diario); fora dele só atualizava
-- pelo botão "Atualizar do Consistem".
-- Janela: segunda a sexta, 07:00–18:45 de Cuiabá (11:00–22:45 UTC; Cuiabá é UTC-4 e não tem horário de verão).
-- Mesmas funções e mesmo segredo do Vault: rec_chamar_sincronizacao() (0102) e cap_chamar_sincronizacao() (0134).
-- Para pausar: select cron.unschedule('rec-sincronizar-consistem-30min'); select cron.unschedule('cap-sincronizar-consistem-30min');
-- =========================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'rec-sincronizar-consistem-horario') then
      perform cron.unschedule('rec-sincronizar-consistem-horario');
    end if;
    if exists (select 1 from cron.job where jobname = 'cap-sincronizar-consistem-diario') then
      perform cron.unschedule('cap-sincronizar-consistem-diario');
    end if;
    -- Mesmo nome = atualiza o agendamento existente (pode reaplicar sem duplicar).
    perform cron.schedule('rec-sincronizar-consistem-30min', '0,30 11-22 * * 1-5', 'select public.rec_chamar_sincronizacao()');
    -- Contas a pagar 15 minutos depois, para as duas não baterem no Consistem ao mesmo tempo.
    perform cron.schedule('cap-sincronizar-consistem-30min', '15,45 11-22 * * 1-5', 'select public.cap_chamar_sincronizacao()');
  end if;
end $$;
