// Banco de teste: Postgres em memória (PGlite) com o mínimo do Supabase que as migrations usam.
// Roda as migrations reais de supabase/migrations/, então testa o SQL que vai para produção.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Linha de resultado de SQL ad hoc nos testes: as colunas variam de consulta para consulta.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Linha = Record<string, any>;

export type Nivel ="sem_acesso" | "consulta" | "operador" | "gestor" | "administrador";

const PREPARO_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create schema storage;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    encrypted_password text,
    raw_user_meta_data jsonb not null default '{}',
    raw_app_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false, file_size_limit bigint
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text, owner uuid
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language plpgsql as $$
  declare partes text[];
  begin
    partes := string_to_array(name, '/');
    return partes[1:array_length(partes, 1) - 1];
  end $$;
  grant all on storage.objects, storage.buckets to authenticated, service_role;

  -- como no Supabase: tudo que o dono cria em public nasce acessível aos papéis da API
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export async function criarBanco(opcoes: { ate?: string } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(PREPARO_SUPABASE);
  const pasta = join(process.cwd(), "supabase", "migrations");
  const arquivos = readdirSync(pasta).filter((f) => f.endsWith(".sql")).sort();
  for (const arquivo of arquivos) {
    if (opcoes.ate && arquivo > opcoes.ate) break;
    try {
      await db.exec(readFileSync(join(pasta, arquivo), "utf8"));
    } catch (e) {
      throw new Error(`Falha na migration ${arquivo}: ${(e as Error).message}`);
    }
  }
  return db;
}

/** Cria o usuário no Auth (o gatilho cria o perfil) e aplica as permissões por área. */
export async function novoUsuario(
  db: PGlite,
  email: string,
  permissoes: Record<string, Nivel> = {},
  opcoes: { ativo?: boolean; deveTrocarSenha?: boolean } = {},
): Promise<string> {
  const appMeta = JSON.stringify(opcoes.deveTrocarSenha ? { deve_trocar_senha: true } : {});
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, encrypted_password, raw_app_meta_data) values ($1, 'hash-inicial', $2) returning id`,
    [email, appMeta],
  );
  const id = r.rows[0].id;
  for (const [area, nivel] of Object.entries(permissoes)) {
    await db.query(`insert into permissoes (perfil_id, area, nivel) values ($1, $2, $3)`, [id, area, nivel]);
  }
  if (opcoes.ativo === false) await db.query(`update perfis set ativo = false where id = $1`, [id]);
  return id;
}

type Quem = string | "service" | "anon";

/** Executa `fn` com o papel e o usuário da API do Supabase (RLS valendo). */
export async function como<T>(db: PGlite, quem: Quem, fn: () => Promise<T>): Promise<T> {
  const papel = quem === "service" ? "service_role" : quem === "anon" ? "anon" : "authenticated";
  const sub = quem === "service" || quem === "anon" ? "" : quem;
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]);
  await db.exec(`set role ${papel}`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
