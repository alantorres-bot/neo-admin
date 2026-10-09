-- =========================================================
-- Neo Admin — 0006 Aplicativos externos (super painel)
-- O Neo Admin passa a ser a porta de entrada única do administrativo: além dos módulos nativos, o menu e a tela Início
-- mostram os aplicativos de outras áreas (Vigilância Fiscal, NEOControl, apps de Produção...), que continuam sendo
-- sistemas separados, com código, banco e login próprios. Aqui fica só o cadastro: nome, área, endereço e como abrir.
--
-- 1) `aplicativos`: um registro por app. `abrir` = 'embutido' (abre dentro do painel, em quadro) ou 'nova_aba'.
--    `icone` é o nome de um ícone da lista fixa do app (lib/nucleo/aplicativos.ts); vazio usa o ícone da área.
--    Nada é apagado: app que sai fica `ativo = false`.
-- 2) RLS: quem tem acesso à área (consulta ou acima) lê; só admin_geral grava. Auditado como as demais tabelas do núcleo.
-- 3) Área nova "Produção" (as outras já existem) e a carga inicial com os dois apps de hoje.
-- =========================================================

create table aplicativos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nome text not null check (length(trim(nome)) between 2 and 80),
  descricao text,
  area text not null references areas(codigo),
  url text not null check (url ~ '^https://'),
  abrir text not null default 'embutido' check (abrir in ('embutido', 'nova_aba')),
  icone text,
  ordem int not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table aplicativos enable row level security;
create policy aplicativos_ler on aplicativos for select to authenticated
  using (usuario_ativo() and tem_acesso_area(area));
create policy aplicativos_admin on aplicativos for all to authenticated
  using (eh_admin_geral()) with check (eh_admin_geral());

create trigger trg_aud_aplicativos after insert or update or delete on aplicativos for each row execute function fn_auditoria();

insert into areas (codigo, nome, sensivel, ordem) values ('producao', 'Produção', false, 7)
on conflict (codigo) do nothing;

insert into aplicativos (codigo, nome, descricao, area, url, abrir, icone, ordem) values
  ('vigilancia_fiscal', 'Vigilância Fiscal',
   'Conferência diária das notas de entrada e de saída, NFS-e tomadas e orientação de lançamento.',
   'fiscal', 'https://neo-fiscal-spark.lovable.app', 'embutido', 'file-text', 10),
  ('neocontrol', 'NEOControl',
   'EPIs e uniformes, conferência e transferência de matéria-prima, insumos e equipamentos.',
   'rh', 'https://protect-track.lovable.app', 'embutido', 'hard-hat', 10)
on conflict (codigo) do nothing;
