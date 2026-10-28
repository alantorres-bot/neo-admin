-- =========================================================
-- Neo Admin — 0807 GED: agendamento da indexação (5.3.7 e 5.3.8), criado DESLIGADO
--
--  - A cada 30 minutos nos dias úteis, das 07h às 19h de Cuiabá (UTC-4): minutos 20 e 50, 11h–22h UTC (fora dos minutos das outras
--    sincronizações: 0/30, 15/45, 5/35).
--  - O job nasce INATIVO. Ligar exige as duas ações, nesta ordem, só depois da aprovação da A1a e do PENDENTE 12:
--      update configuracoes set valor = 'true' where chave = 'administrativo.ged.indexar';
--      select cron.alter_job((select jobid from cron.job where jobname = 'ged-indexar-30min'), active := true);
--  - Mesmo com o job ativo, ged_chamar_indexacao() não chama a função com o interruptor desligado (e a função, por sua vez, recusa
--    abrir rodada): três barreiras antes de qualquer chamada ao Google.
--  - URL e segredo do Vault, como com_chamar_sincronizacao() (0701): o mesmo segredo de agendamento das outras rotinas.
-- =========================================================

create or replace function ged_chamar_indexacao() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_segredo text;
  v_requisicao bigint;
begin
  if coalesce((select valor = 'true'::jsonb from configuracoes where chave = 'administrativo.ged.indexar'), false) is not true then
    return null;                                                       -- desligada: nem chama a função
  end if;
  select replace(decrypted_secret, 'rec-sincronizar-consistem', 'nucleo-ged-indexar') into v_url from vault.decrypted_secrets where name = 'rec_sincronizar_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'rec_sincronizar_segredo';
  if v_url is null or v_segredo is null then
    raise warning 'Indexação do GED sem configuração: faltam rec_sincronizar_url e/ou rec_sincronizar_segredo no Vault.';
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sincronizacao-segredo', v_segredo),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  ) into v_requisicao;
  return v_requisicao;
end $$;
revoke all on function ged_chamar_indexacao() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Mesmo nome = atualiza o existente (reaplicar não duplica). Nasce e volta inativo.
    perform cron.schedule('ged-indexar-30min', '20,50 11-22 * * 1-5', 'select public.ged_chamar_indexacao()');
    perform cron.alter_job((select jobid from cron.job where jobname = 'ged-indexar-30min'), active := false);
  end if;
end $$;
