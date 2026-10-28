-- 0812 — GED padronização: na reanálise, o documento colidia com a própria sugestão anterior e ganhava " (2)".
-- Os nomes já usados na pasta deixam de incluir as sugestões dos documentos do próprio lote (a função recalcula e soma as novas).
-- Corpo igual ao da 0811, exceto a condição `y.documento_id <> all (...)`.

create or replace function ged_proximos_para_analisar(p_limite integer, p_documentos uuid[]) returns table (
  documento_id uuid, drive_id text, nome text, extensao text, tamanho_bytes bigint, drive_revisao text, finalidade text,
  pasta text, pasta_nivel1 text, nomes_na_pasta text[])
language sql stable security definer set search_path = public as $$
  with alvo as (
    select d.* from ged_documentos d
      join ged_pastas_raiz r on r.id = d.raiz_id and r.situacao = 'ativa'
      left join ged_analises a on a.documento_id = d.id
     where d.situacao = 'vigente'
       and (case when p_documentos is null then a.documento_id is null or a.drive_revisao is distinct from d.drive_revisao
                 else d.id = any (p_documentos) end)
     order by d.alterado_no_drive_em desc nulls last, d.id
     limit least(greatest(coalesce(p_limite, 20), 1), 20)
  )
  select a.id, a.drive_id, a.nome, a.extensao, a.tamanho_bytes, a.drive_revisao, r.finalidade, p.nome,
         (with recursive sobe as (
            select pp.drive_id, pp.mae_drive_id, pp.profundidade, pp.nome from ged_pastas pp where pp.id = a.pasta_id
            union all
            select m.drive_id, m.mae_drive_id, m.profundidade, m.nome from ged_pastas m join sobe s on m.drive_id = s.mae_drive_id
             where s.profundidade > 1)
          select nome from sobe where profundidade = 1 limit 1),
         array(select x.nome from ged_documentos x where x.pasta_id = a.pasta_id and x.situacao = 'vigente'
               union select y.nome_sugerido from ged_analises y join ged_documentos z on z.id = y.documento_id
                      where z.pasta_id = a.pasta_id and y.nome_sugerido is not null
                        and y.documento_id <> all (array(select id from alvo)))
    from alvo a
    join ged_pastas_raiz r on r.id = a.raiz_id
    join ged_pastas p on p.id = a.pasta_id;
$$;
