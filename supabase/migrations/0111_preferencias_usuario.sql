-- =========================================================
-- Neo Admin — 0111 Preferências por usuário
-- Pequenas escolhas de cada pessoa que devem valer em qualquer computador (ex.: ocultar vencidos há mais de 90 dias na
-- Carteira). Cada usuário só enxerga e grava as próprias; a chave é um texto livre (convenção: 'modulo.preferencia') e o
-- valor é JSON. Não guarda dado de negócio: por isso não tem auditoria.
-- =========================================================

create table preferencias_usuario (
  perfil_id uuid not null references perfis(id) on delete cascade,
  chave text not null check (length(chave) between 1 and 100),
  valor jsonb not null,
  atualizado_em timestamptz not null default now(),
  primary key (perfil_id, chave)
);

alter table preferencias_usuario enable row level security;

create policy preferencias_ler on preferencias_usuario for select to authenticated
  using (perfil_id = auth.uid() and usuario_ativo());
create policy preferencias_inserir on preferencias_usuario for insert to authenticated
  with check (perfil_id = auth.uid() and usuario_ativo());
create policy preferencias_alterar on preferencias_usuario for update to authenticated
  using (perfil_id = auth.uid() and usuario_ativo()) with check (perfil_id = auth.uid() and usuario_ativo());
-- Sem política de exclusão: desligar uma preferência é gravar o valor `false` (ou o padrão).

create trigger trg_preferencias_atualizado before update on preferencias_usuario for each row execute function fn_atualizado_em();
