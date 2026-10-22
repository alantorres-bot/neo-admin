-- =========================================================
-- Neo Admin — 0201 FISCAL > Créditos tributários: obrigações, documentos, conciliação, tarefas e histórico de decisões
-- Decisões (22/10/2026):
--  - Obrigação só vira "transmitida" com data, número do recibo/protocolo e (se o tipo exige) o recibo anexado e vinculado.
--    Subir o arquivo da declaração NÃO muda a situação. "Entregue e conferida" exige outro usuário (revisor/contador/admin).
--  - Vencimentos não são presumidos: o tipo de obrigação só gera data se a regra estiver cadastrada; sem regra validada
--    pelo contador, o vencimento fica "a confirmar".
--  - Documentos em bucket privado próprio ('fiscal'); download só por URL assinada curta, depois de a aplicação conferir o
--    registro (RLS por empresa). Versão nova substitui a anterior, que fica no histórico; nada é apagado.
-- =========================================================

-- 1) OBRIGAÇÕES --------------------------------------------------------------------------------------------------------------
create table fis_tipos_obrigacao (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[A-Z0-9_]{2,30}$'),
  nome text not null,
  tributo_id uuid references fis_tributos(id),
  esfera text not null check (esfera in ('federal', 'estadual', 'municipal')),
  periodicidade text not null check (periodicidade in ('mensal', 'trimestral', 'anual', 'eventual')),
  dia_vencimento int check (dia_vencimento between 1 and 31),      -- nulo = sem regra cadastrada (vencimento a confirmar)
  meses_apos int not null default 1 check (meses_apos between 0 and 24),
  regra_vencimento_validada boolean not null default false,
  fonte_regra text,                                                  -- de onde veio a regra (informado pelo contador)
  exige_recibo boolean not null default true,
  documentos_exigidos text[] not null default '{recibo_transmissao}',
  descricao text,
  ativo boolean not null default true
);
comment on table fis_tipos_obrigacao is 'Tipos de obrigação acessória. A lista inicial é exemplo, não presume aplicabilidade; prazos sem regra cadastrada ficam a confirmar.';
create trigger trg_fis_tipos_obrigacao_sem_delete before delete on fis_tipos_obrigacao for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_tipos_obrigacao after insert or update on fis_tipos_obrigacao for each row execute function fn_auditoria();

insert into fis_tipos_obrigacao (codigo, nome, tributo_id, esfera, periodicidade, descricao) values
  ('EFD_CONTRIBUICOES', 'EFD-Contribuições', null, 'federal', 'mensal', 'Escrituração de PIS/Cofins (aplicabilidade e prazo a confirmar com o contador).'),
  ('EFD_ICMS_IPI', 'EFD ICMS/IPI', null, 'estadual', 'mensal', 'Escrituração fiscal digital de ICMS/IPI (aplicabilidade e prazo a confirmar).'),
  ('DCTFWEB', 'DCTFWeb', null, 'federal', 'mensal', 'Declaração de débitos e créditos tributários federais (aplicabilidade e prazo a confirmar).'),
  ('PERDCOMP', 'PER/DCOMP (pedido de restituição, ressarcimento ou compensação)', null, 'federal', 'eventual', 'Procedimento de compensação/restituição: protocolo obrigatório.'),
  ('APURACAO_ICMS', 'Apuração mensal de ICMS', (select id from fis_tributos where codigo = 'ICMS'), 'estadual', 'mensal', 'Fechamento da apuração (conferência interna).'),
  ('OUTRA', 'Outra obrigação (configurar)', null, 'federal', 'eventual', null);

create table fis_obrigacoes_aplicaveis (
  id uuid primary key default gen_random_uuid(),
  tipo_id uuid not null references fis_tipos_obrigacao(id),
  estabelecimento_id uuid not null references fis_estabelecimentos(id),
  responsavel_id uuid references perfis(id),
  contador_responsavel text,
  ativo boolean not null default true,
  unique (tipo_id, estabelecimento_id)
);
comment on table fis_obrigacoes_aplicaveis is 'Perfil tributário: quais obrigações se aplicam a cada estabelecimento (definido pelo usuário, nunca presumido).';
create trigger trg_aud_fis_obrigacoes_aplicaveis after insert or update or delete on fis_obrigacoes_aplicaveis for each row execute function fn_auditoria();

create type fis_status_obrigacao as enum (
  'nao_iniciada', 'em_preparacao', 'aguardando_documentos', 'em_revisao', 'aguardando_aprovacao', 'pronta_transmissao',
  'transmitida', 'entregue_conferida', 'retificada', 'dispensada');

create table fis_obrigacoes (
  id uuid primary key default gen_random_uuid(),
  tipo_id uuid not null references fis_tipos_obrigacao(id),
  tributo_id uuid references fis_tributos(id),
  empresa_id uuid not null references empresas(id),
  estabelecimento_id uuid not null references fis_estabelecimentos(id),
  competencia date not null check (extract(day from competencia) = 1),
  vencimento date,
  vencimento_confirmado boolean not null default false,
  vencimento_fonte text,
  responsavel_id uuid references perfis(id),
  contador_responsavel text,
  status fis_status_obrigacao not null default 'nao_iniciada',
  data_preparacao date,
  data_revisao date,
  data_transmissao date,
  numero_recibo text,
  transmitida_por uuid references perfis(id),
  conferida_por uuid references perfis(id),
  conferida_em timestamptz,
  justificativa_dispensa text,
  retificadora_de uuid references fis_obrigacoes(id),
  observacoes text,
  ficticio boolean not null default false,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (status not in ('transmitida', 'entregue_conferida', 'retificada') or (data_transmissao is not null and numero_recibo is not null)),
  check (status <> 'dispensada' or justificativa_dispensa is not null)
);
create unique index uq_fis_obrigacoes on fis_obrigacoes (tipo_id, estabelecimento_id, competencia) where retificadora_de is null;
create unique index uq_fis_obrigacoes_retificadora on fis_obrigacoes (retificadora_de) where retificadora_de is not null;
create index idx_fis_obrigacoes_venc on fis_obrigacoes (vencimento) where status not in ('transmitida', 'entregue_conferida', 'retificada', 'dispensada');
create trigger trg_fis_obrigacoes_atualizado before update on fis_obrigacoes for each row execute function fn_atualizado_em();
create trigger trg_fis_obrigacoes_sem_delete before delete on fis_obrigacoes for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_obrigacoes after insert or update on fis_obrigacoes for each row execute function fn_auditoria();

create table fis_obrigacoes_eventos (
  id uuid primary key default gen_random_uuid(),
  obrigacao_id uuid not null references fis_obrigacoes(id),
  de fis_status_obrigacao,
  para fis_status_obrigacao not null,
  observacao text,
  usuario_id uuid references perfis(id) default auth.uid(),
  em timestamptz not null default now()
);
create trigger trg_fis_obrigacoes_eventos_imutavel before update or delete on fis_obrigacoes_eventos for each row execute function fn_bloquear_alteracao();

-- 2) DOCUMENTOS -------------------------------------------------------------------------------------------------------------
create table fis_documentos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null references fis_tipos_documento(codigo),
  titulo text not null check (length(trim(titulo)) >= 3),
  empresa_id uuid not null references empresas(id),
  estabelecimento_id uuid references fis_estabelecimentos(id),
  tributo_id uuid references fis_tributos(id),
  competencia date check (extract(day from competencia) = 1),
  observacoes text,
  arquivo_path text unique,                             -- bucket 'fiscal'; nulo só em documento fictício de demonstração
  nome_arquivo text,
  mime text,
  tamanho_bytes bigint check (tamanho_bytes between 1 and 20971520),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  versao int not null default 1 check (versao >= 1),
  raiz_id uuid references fis_documentos(id),           -- primeira versão (nulo na própria primeira versão)
  substitui_id uuid unique references fis_documentos(id),
  motivo_substituicao text,
  situacao text not null default 'vigente' check (situacao in ('vigente', 'substituido', 'arquivado')),
  ficticio boolean not null default false,
  enviado_por uuid references perfis(id) default auth.uid(),
  enviado_em timestamptz not null default now(),
  check (arquivo_path is not null or ficticio),
  check ((substitui_id is null) = (versao = 1))
);
comment on table fis_documentos is 'Repositório documental fiscal (privado). Salvar um arquivo aqui NÃO significa que foi transmitido a órgão público.';
create index idx_fis_documentos_empresa on fis_documentos (empresa_id, competencia);
create trigger trg_fis_documentos_sem_delete before delete on fis_documentos for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_documentos after insert or update on fis_documentos for each row execute function fn_auditoria();
create function fis_documentos_imutavel() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['situacao']) is distinct from (to_jsonb(old) - array['situacao']) then
    raise exception 'Documento enviado não muda: envie uma nova versão.';
  end if;
  if old.situacao <> 'vigente' and new.situacao <> old.situacao then
    raise exception 'Documento substituído ou arquivado não volta a ser vigente.';
  end if;
  return new;
end $$;
create trigger trg_fis_documentos_imutavel before update on fis_documentos for each row execute function fis_documentos_imutavel();

create table fis_documentos_vinculos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references fis_documentos(id),
  alvo text not null check (alvo in ('credito', 'movimento', 'obrigacao', 'periodo', 'divergencia', 'tarefa')),
  alvo_id uuid not null,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  removido_por uuid references perfis(id),
  removido_em timestamptz,
  removido_motivo text
);
create unique index uq_fis_documentos_vinculos on fis_documentos_vinculos (documento_id, alvo, alvo_id) where removido_em is null;
create index idx_fis_documentos_vinculos_alvo on fis_documentos_vinculos (alvo, alvo_id) where removido_em is null;
create trigger trg_fis_documentos_vinculos_sem_delete before delete on fis_documentos_vinculos for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_documentos_vinculos after insert or update on fis_documentos_vinculos for each row execute function fn_auditoria();

-- Documentos vigentes ligados a um alvo (com o tipo).
create function fis_docs_do_alvo(p_alvo text, p_id uuid) returns table (documento_id uuid, tipo text)
language sql stable security definer set search_path = public as $$
  select d.id, d.tipo from fis_documentos_vinculos v join fis_documentos d on d.id = v.documento_id
   where v.alvo = p_alvo and v.alvo_id = p_id and v.removido_em is null and d.situacao = 'vigente'
$$;
revoke all on function fis_docs_do_alvo(text, uuid) from public, anon, authenticated;

-- Bucket privado do módulo. Caminho: fiscal.creditos/<empresa_id>/<uuid>-<nome>
insert into storage.buckets (id, name, public, file_size_limit)
values ('fiscal', 'fiscal', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Ler: só o arquivo de um documento que o usuário enxerga (a subconsulta passa pela RLS de fis_documentos).
create policy fiscal_storage_ler on storage.objects for select to authenticated
  using (bucket_id = 'fiscal' and exists (select 1 from fis_documentos d where d.arquivo_path = storage.objects.name));
-- Enviar: quem lança, na pasta de uma empresa do seu escopo. Sem update nem delete (documento é prova).
create policy fiscal_storage_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'fiscal' and (storage.foldername(name))[1] = 'fiscal.creditos'
              and fis_pode('lancar', nullif((storage.foldername(name))[2], '')::uuid));

-- 3) CONCILIAÇÃO: DIVERGÊNCIAS ---------------------------------------------------------------------------------------------
create sequence fis_divergencias_numero;
create table fis_divergencias (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null unique default nextval('fis_divergencias_numero'),
  empresa_id uuid not null references empresas(id),
  estabelecimento_id uuid references fis_estabelecimentos(id),
  tributo_id uuid references fis_tributos(id),
  competencia date check (extract(day from competencia) = 1),
  credito_id uuid references fis_creditos(id),
  periodo_id uuid references fis_periodos(id),
  obrigacao_id uuid references fis_obrigacoes(id),
  regra text,                                           -- código da verificação que a originou (nulo = manual)
  chave_regra text,
  fonte_comparada text check (fonte_comparada in ('apuracao_oficial', 'declaracao', 'periodo_anterior', 'perdcomp', 'erp', 'outro')),
  valor_interno numeric(14,2),
  valor_externo numeric(14,2),
  valor_diferenca numeric(14,2) not null default 0,
  motivo text not null check (length(trim(motivo)) >= 5),
  providencia text,
  responsavel_id uuid references perfis(id),
  prazo_interno date,
  status text not null default 'aberta' check (status in ('aberta', 'em_analise', 'justificada', 'resolvida', 'cancelada')),
  resolucao text,
  resolvido_por uuid references perfis(id),
  resolvido_em timestamptz,
  ficticio boolean not null default false,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  check (status not in ('justificada', 'resolvida', 'cancelada') or resolucao is not null)
);
create unique index uq_fis_divergencias_regra on fis_divergencias (regra, chave_regra)
  where regra is not null and status in ('aberta', 'em_analise');
create trigger trg_fis_divergencias_sem_delete before delete on fis_divergencias for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_divergencias after insert or update on fis_divergencias for each row execute function fn_auditoria();

-- 4) TAREFAS, COMENTÁRIOS E DECISÕES ---------------------------------------------------------------------------------------
create table fis_tarefas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('tarefa', 'solicitacao_documento', 'revisao_apuracao', 'aprovacao')),
  titulo text not null check (length(trim(titulo)) >= 3),
  descricao text,
  empresa_id uuid references empresas(id),
  alvo text check (alvo in ('credito', 'movimento', 'obrigacao', 'periodo', 'divergencia', 'documento')),
  alvo_id uuid,
  tipo_documento_solicitado text references fis_tipos_documento(codigo),
  responsavel_id uuid references perfis(id),
  solicitante_id uuid references perfis(id) default auth.uid(),
  prazo date,
  status text not null default 'aberta' check (status in ('aberta', 'em_andamento', 'concluida', 'cancelada')),
  resposta text,
  concluida_por uuid references perfis(id),
  concluida_em timestamptz,
  ficticio boolean not null default false,
  criado_em timestamptz not null default now(),
  check ((alvo is null) = (alvo_id is null))
);
create index idx_fis_tarefas_resp on fis_tarefas (responsavel_id, status);
create trigger trg_fis_tarefas_sem_delete before delete on fis_tarefas for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_tarefas after insert or update on fis_tarefas for each row execute function fn_auditoria();

create table fis_comentarios (
  id uuid primary key default gen_random_uuid(),
  alvo text not null check (alvo in ('credito', 'movimento', 'obrigacao', 'periodo', 'divergencia', 'documento', 'tarefa')),
  alvo_id uuid not null,
  empresa_id uuid references empresas(id),
  texto text not null check (length(trim(texto)) between 1 and 4000),
  autor_id uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now()
);
create index idx_fis_comentarios_alvo on fis_comentarios (alvo, alvo_id);
create trigger trg_fis_comentarios_imutavel before update or delete on fis_comentarios for each row execute function fn_bloquear_alteracao();

create table fis_decisoes (
  id bigserial primary key,
  alvo text not null,
  alvo_id uuid not null,
  empresa_id uuid references empresas(id),
  decisao text not null,
  justificativa text,
  dados jsonb,
  usuario_id uuid references perfis(id) default auth.uid(),
  em timestamptz not null default now()
);
comment on table fis_decisoes is 'Histórico de decisões (validações, aprovações, rejeições, fechamentos, reaberturas, dispensas): quem, quando, o quê e por quê.';
create index idx_fis_decisoes_alvo on fis_decisoes (alvo, alvo_id);
create trigger trg_fis_decisoes_imutavel before update or delete on fis_decisoes for each row execute function fn_bloquear_alteracao();

create function fis_registrar_decisao(p_alvo text, p_id uuid, p_empresa uuid, p_decisao text, p_justificativa text, p_dados jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into fis_decisoes (alvo, alvo_id, empresa_id, decisao, justificativa, dados) values (p_alvo, p_id, p_empresa, p_decisao, nullif(trim(p_justificativa), ''), p_dados)
$$;
revoke all on function fis_registrar_decisao(text, uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- 5) RLS ------------------------------------------------------------------------------------------------------------------------
alter table fis_tipos_obrigacao enable row level security;
alter table fis_obrigacoes_aplicaveis enable row level security;
alter table fis_obrigacoes enable row level security;
alter table fis_obrigacoes_eventos enable row level security;
alter table fis_documentos enable row level security;
alter table fis_documentos_vinculos enable row level security;
alter table fis_divergencias enable row level security;
alter table fis_tarefas enable row level security;
alter table fis_comentarios enable row level security;
alter table fis_decisoes enable row level security;

create policy fis_tipos_obrigacao_ler on fis_tipos_obrigacao for select to authenticated using (fis_pode('ler'));
create policy fis_obrigacoes_aplicaveis_ler on fis_obrigacoes_aplicaveis for select to authenticated
  using (exists (select 1 from fis_estabelecimentos e where e.id = estabelecimento_id));
create policy fis_obrigacoes_ler on fis_obrigacoes for select to authenticated using (fis_pode('ler', empresa_id));
create policy fis_obrigacoes_eventos_ler on fis_obrigacoes_eventos for select to authenticated
  using (exists (select 1 from fis_obrigacoes o where o.id = obrigacao_id));
create policy fis_documentos_ler on fis_documentos for select to authenticated using (fis_pode('ler', empresa_id));
create policy fis_documentos_vinculos_ler on fis_documentos_vinculos for select to authenticated
  using (exists (select 1 from fis_documentos d where d.id = documento_id));
create policy fis_divergencias_ler on fis_divergencias for select to authenticated using (fis_pode('ler', empresa_id));
create policy fis_tarefas_ler on fis_tarefas for select to authenticated
  using (fis_pode('ler', empresa_id) and (empresa_id is not null or fis_pode('ler')));
create policy fis_comentarios_ler on fis_comentarios for select to authenticated using (fis_pode('ler', empresa_id));
create policy fis_decisoes_ler on fis_decisoes for select to authenticated using (fis_pode('ler', empresa_id));
