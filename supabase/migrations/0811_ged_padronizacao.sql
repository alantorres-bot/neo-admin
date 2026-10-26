-- =========================================================
-- Neo Admin — 0811 GED: padronização de nomes (especificação 5.12). Só SUGESTÃO: nada é renomeado no Drive.
--
--  - ged_tipos: catálogo controlado de tipos documentais (espelha TIPOS_DOCUMENTO em _shared/ged.ts).
--  - ged_analises: uma linha por documento com a última análise (tipo, campos com evidência, nome sugerido, confiança) e a decisão
--    do admin (aprovar, editar, rejeitar). O TEXTO do arquivo não é gravado: só os campos derivados.
--  - Leitura só de quem lê a raiz do documento (ged_pode_ler_raiz = admin geral, 0809). Gravação só por função:
--    ged_gravar_analises (service role, Edge Function nucleo-ged-analisar) e ged_decidir_analise (admin geral, com auditoria = histórico).
--  - Análise de uma revisão nova reabre a sugestão; a decisão humana sobre a mesma revisão nunca é sobrescrita. Nunca há delete.
--  - Não toca na indexação (ged_indexacoes, trava, interruptor, agendamento).
-- =========================================================

create table ged_tipos (
  codigo text primary key check (codigo ~ '^[a-z_]+$'),
  nome text not null,
  rotulo text not null,
  ordem smallint not null default 0,
  ativo boolean not null default true
);
insert into ged_tipos (codigo, nome, rotulo, ordem) values
  ('contrato_venda', 'Contrato de venda', 'CONTRATO VENDA', 10), ('contrato_locacao', 'Contrato de locação', 'CONTRATO LOCACAO', 11),
  ('contrato_servico', 'Contrato de serviço', 'CONTRATO SERVICO', 12), ('contrato_assinado', 'Contrato assinado', 'CONTRATO ASSINADO', 13),
  ('aditamento', 'Aditamento', 'ADITAMENTO', 14), ('modelo_contrato', 'Modelo de contrato', 'MODELO CONTRATO', 15),
  ('proposta_comercial', 'Proposta comercial', 'PROPOSTA', 20), ('nf_venda', 'Nota fiscal de venda', 'NF VENDA', 30),
  ('nf_remessa', 'Nota fiscal de remessa', 'NF REMESSA', 31), ('nf_retorno', 'Nota fiscal de retorno', 'NF RETORNO', 32),
  ('fatura_locacao', 'Fatura de locação', 'FATURA LOCACAO', 33), ('medicao', 'Medição', 'MEDICAO', 34),
  ('carta_correcao', 'Carta de correção', 'CARTA CORRECAO', 35), ('difal', 'DIFAL', 'DIFAL', 36), ('boleto', 'Boleto', 'BOLETO', 37),
  ('comprovante', 'Comprovante', 'COMPROVANTE', 38), ('cartao_cnpj', 'Cartão CNPJ', 'CARTAO CNPJ', 40),
  ('qsa', 'Quadro de sócios (QSA)', 'QSA', 41), ('contrato_social', 'Contrato social', 'CONTRATO SOCIAL', 42),
  ('procuracao', 'Procuração', 'PROCURACAO', 43), ('documento_pessoal', 'Documento pessoal', 'DOCUMENTO PESSOAL', 44),
  ('inscricao_estadual', 'Inscrição estadual', 'INSCRICAO ESTADUAL', 45), ('termo_quitacao', 'Termo de quitação', 'TERMO QUITACAO', 46),
  ('projeto', 'Projeto', 'PROJETO', 50), ('outro', 'Outro', 'DOCUMENTO', 99);
alter table ged_tipos enable row level security;
revoke all on ged_tipos from anon, authenticated;
grant select on ged_tipos to authenticated;
create policy ged_tipos_ler on ged_tipos for select to authenticated using (eh_admin_geral());
create trigger trg_ged_tipos_sem_delete before delete on ged_tipos for each row execute function fn_bloquear_delete();

create table ged_analises (
  documento_id uuid primary key references ged_documentos(id),
  drive_revisao text,
  situacao text not null check (situacao in ('sugerida', 'sem_texto', 'nao_suportado', 'erro', 'aprovada', 'editada', 'rejeitada')),
  tipo text references ged_tipos(codigo),
  contraparte_id uuid references contrapartes(id),
  campos jsonb not null default '{}',
  nome_atual text not null,
  nome_sugerido text,
  nome_final text,
  confianca text check (confianca in ('alta', 'media', 'baixa')),
  metodo text check (metodo in ('metadados', 'texto')),
  justificativa text,
  erro text check (erro ~ '^[a-z_]+$'),
  analisada_em timestamptz not null default now(),
  decidido_por uuid references perfis(id),
  decidido_em timestamptz,
  motivo text
);
create index idx_ged_analises_situacao on ged_analises (situacao, confianca);
alter table ged_analises enable row level security;
revoke all on ged_analises from anon, authenticated;
grant select on ged_analises to authenticated;
create policy ged_analises_ler on ged_analises for select to authenticated
  using (exists (select 1 from ged_documentos d where d.id = documento_id and ged_pode_ler_raiz(d.raiz_id)));
create trigger trg_ged_analises_sem_delete before delete on ged_analises for each row execute function fn_bloquear_delete();

-- Próximos documentos a analisar (vigentes sem análise da revisão atual), ou os ids pedidos. Traz a pasta, a pasta de 1º nível da
-- raiz (no dossiê, a do cliente) e os nomes já usados na pasta (atuais e sugeridos), para evitar colisão de nomes.
create function ged_proximos_para_analisar(p_limite integer, p_documentos uuid[]) returns table (
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
                      where z.pasta_id = a.pasta_id and y.nome_sugerido is not null)
    from alvo a
    join ged_pastas_raiz r on r.id = a.raiz_id
    join ged_pastas p on p.id = a.pasta_id;
$$;

-- Grava o lote da Edge Function. Decisão humana (aprovada/editada/rejeitada) da MESMA revisão é preservada; revisão nova reabre.
create function ged_gravar_analises(p_lote jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x jsonb;
  v_gravadas int := 0;
  v_preservadas int := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(p_lote, '[]')) loop
    if (x ->> 'situacao') not in ('sugerida', 'sem_texto', 'nao_suportado', 'erro') then
      raise exception 'ged:situacao_invalida';
    end if;
    if exists (select 1 from ged_analises a where a.documento_id = (x ->> 'documento_id')::uuid
                and a.situacao in ('aprovada', 'editada', 'rejeitada') and a.drive_revisao is not distinct from (x ->> 'drive_revisao')) then
      v_preservadas := v_preservadas + 1;
      continue;
    end if;
    insert into ged_analises (documento_id, drive_revisao, situacao, tipo, contraparte_id, campos, nome_atual, nome_sugerido, confianca,
                              metodo, justificativa, erro, analisada_em)
    values ((x ->> 'documento_id')::uuid, x ->> 'drive_revisao', x ->> 'situacao', x ->> 'tipo', (x ->> 'contraparte_id')::uuid,
            coalesce(x -> 'campos', '{}'), x ->> 'nome_atual', x ->> 'nome_sugerido', x ->> 'confianca', x ->> 'metodo',
            x ->> 'justificativa', x ->> 'erro', now())
    on conflict (documento_id) do update
       set drive_revisao = excluded.drive_revisao, situacao = excluded.situacao, tipo = excluded.tipo,
           contraparte_id = excluded.contraparte_id, campos = excluded.campos, nome_atual = excluded.nome_atual,
           nome_sugerido = excluded.nome_sugerido, confianca = excluded.confianca, metodo = excluded.metodo,
           justificativa = excluded.justificativa, erro = excluded.erro, analisada_em = now(),
           nome_final = null, decidido_por = null, decidido_em = null, motivo = null;
    v_gravadas := v_gravadas + 1;
  end loop;
  return jsonb_build_object('gravadas', v_gravadas, 'preservadas', v_preservadas);
end $$;

-- Decisão do admin geral: aprovar (nome sugerido), editar (nome digitado, já validado no app e conferido aqui) ou rejeitar (motivo).
-- Cada decisão vai para a auditoria (histórico). Nada é renomeado no Drive.
create function ged_decidir_analise(p_documento uuid, p_decisao text, p_nome text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a ged_analises%rowtype;
  v_situacao text;
  v_nome text;
begin
  if not eh_admin_geral() then
    raise exception 'ged:sem_permissao';
  end if;
  select * into a from ged_analises where documento_id = p_documento for update;
  if not found then
    raise exception 'ged:nao_encontrada';
  end if;
  if p_decisao = 'aprovar' then
    if a.nome_sugerido is null then raise exception 'ged:sem_sugestao'; end if;
    v_situacao := 'aprovada'; v_nome := a.nome_sugerido;
  elsif p_decisao = 'editar' then
    v_nome := btrim(coalesce(p_nome, ''));
    if v_nome = '' or length(v_nome) > 150 or v_nome ~ '[\\/:*?"<>|]' or v_nome ~ '[[:cntrl:]]' then raise exception 'ged:nome_invalido'; end if;
    v_situacao := 'editada';
  elsif p_decisao = 'rejeitar' then
    if coalesce(btrim(p_motivo), '') = '' then raise exception 'ged:motivo_obrigatorio'; end if;
    v_situacao := 'rejeitada'; v_nome := null;
  else
    raise exception 'ged:decisao_invalida';
  end if;
  update ged_analises set situacao = v_situacao, nome_final = v_nome, decidido_por = auth.uid(), decidido_em = now(),
                          motivo = nullif(btrim(coalesce(p_motivo, '')), '')
   where documento_id = p_documento;
  insert into auditoria (tabela, registro_id, acao, antes, depois, usuario_id)
  values ('ged_analises', p_documento, p_decisao,
          jsonb_build_object('situacao', a.situacao, 'nome_final', a.nome_final),
          jsonb_build_object('situacao', v_situacao, 'nome_final', v_nome, 'motivo', nullif(btrim(coalesce(p_motivo, '')), '')), auth.uid());
end $$;

revoke all on function ged_proximos_para_analisar(integer, uuid[]) from public, anon, authenticated, service_role;
revoke all on function ged_gravar_analises(jsonb) from public, anon, authenticated, service_role;
revoke all on function ged_decidir_analise(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function ged_proximos_para_analisar(integer, uuid[]) to service_role;
grant execute on function ged_gravar_analises(jsonb) to service_role;
grant execute on function ged_decidir_analise(uuid, text, text, text) to authenticated;
