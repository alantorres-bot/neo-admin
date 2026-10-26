-- GED — diagnóstico das rodadas de indexação (só leitura; nenhuma chamada ao Google; nada de nome, id ou link de arquivo).
-- Rodar: npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no -f scripts/ged-diagnostico.sql
-- Estado de cada rodada (as 20 mais recentes):
--   em_andamento  aberta e dona da trava há menos de 15 min
--   esquecida     aberta e dona da trava há 15 min ou mais: a função morreu; a próxima rodada a encerra como `interrompida` (0810)
--   orfa          aberta sem ser dona da trava: não grava nem conclui (0810)
--   interrompida  encerrada na recuperação da trava
--   falha         encerrada com outro código de erro (resumo.etapa diz em que etapa)
--   incompleta    sem erro, mas não leu tudo (prazo ou limite de itens): na carga inicial o token não foi gravado
--   concluida     sem erro e com a leitura completa
select r.iniciada_em at time zone 'America/Cuiaba' as iniciada, r.concluida_em at time zone 'America/Cuiaba' as concluida,
       pr.finalidade as raiz, r.tipo, r.agendada,
       case
         when r.concluida_em is null and t.por = r.id and t.tomada_em >= now() - interval '15 minutes' then 'em_andamento'
         when r.concluida_em is null and t.por = r.id then 'esquecida'
         when r.concluida_em is null then 'orfa'
         when r.erro = 'interrompida' then 'interrompida'
         when r.erro is not null then 'falha'
         when (r.resumo ->> 'completa') = 'false' then 'incompleta'
         else 'concluida'
       end as estado,
       r.erro, r.resumo ->> 'etapa' as etapa, (r.resumo ->> 'itens')::int as itens,
       (r.resumo ->> 'novos')::int as novos, (r.resumo ->> 'alterados')::int as alterados, (r.resumo ->> 'removidos')::int as removidos,
       (r.resumo ->> 'ignorados')::int as ignorados, (r.resumo ->> 'pastas')::int as pastas,
       round(extract(epoch from coalesce(r.concluida_em, now()) - r.iniciada_em)) as segundos
  from ged_indexacoes r
  join ged_pastas_raiz pr on pr.id = r.raiz_id
  cross join ged_trava t
 order by r.iniciada_em desc
 limit 20;

-- Consistência por raiz: ponto de continuação x rodadas x documentos. As três últimas colunas devem ser sempre `false`.
select pr.finalidade as raiz, pr.situacao, pr.page_token is not null as tem_ponto_de_continuacao,
       pr.indexada_em at time zone 'America/Cuiaba' as indexada, pr.reconciliada_em at time zone 'America/Cuiaba' as reconciliada,
       (select count(*) from ged_pastas p where p.raiz_id = pr.id) as pastas,
       (select count(*) from ged_documentos d where d.raiz_id = pr.id) as documentos,
       (select count(*) from ged_documentos d where d.raiz_id = pr.id and d.situacao = 'vigente') as vigentes,
       (select count(*) from ged_indexacoes r where r.raiz_id = pr.id and r.concluida_em is null) as rodadas_abertas,
       (pr.page_token is not null and not exists (select 1 from ged_pastas p where p.raiz_id = pr.id and p.profundidade = 0)) as token_sem_raiz_no_indice,
       (pr.page_token is null and exists (select 1 from ged_indexacoes r where r.raiz_id = pr.id and r.tipo = 'inicial'
                                            and r.erro is null and (r.resumo ->> 'completa') = 'true')) as carga_completa_sem_token,
       exists (select 1 from ged_documentos d left join ged_pastas p on p.id = d.pasta_id
                where d.raiz_id = pr.id and (p.id is null or p.raiz_id <> d.raiz_id)) as documento_fora_da_raiz
  from ged_pastas_raiz pr
 order by pr.finalidade;
