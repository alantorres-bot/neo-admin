-- SOMENTE DESENVOLVIMENTO LOCAL: papéis e esquemas mínimos do Supabase num Postgres comum (antes de subir o Auth e as migrations).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login password 'auth' noinherit;
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login password 'auth' createrole superuser;
create schema auth authorization supabase_auth_admin;
create schema storage;
create schema extensions;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now(), metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare partes text[]; begin partes := string_to_array(name, '/'); return partes[1:array_length(partes, 1) - 1]; end $$;
grant all on storage.objects, storage.buckets to authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
