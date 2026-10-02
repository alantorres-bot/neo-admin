-- =========================================================
-- Neo Admin — 0004 NÚCLEO: BUCKET PRIVADO DE ANEXOS
-- Convenção do caminho do arquivo (a RLS depende dela):
--   <codigo_do_modulo>/<referencia_tabela>/<referencia_id>/<uuid>-<nome_arquivo>
--   ex.: financeiro.recebiveis/rec_titulos/<uuid>/<uuid>-boleto.pdf
-- Mesmas regras da tabela `anexos`: leitura a partir de consulta, envio a partir de
-- operador, na área do módulo. Sem update nem delete (anexo é prova).
-- Acesso sempre por URL assinada (bucket não é público).
-- =========================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 26214400)          -- 25 MB por arquivo
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy anexos_storage_ler on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and tem_acesso_modulo((storage.foldername(name))[1], 'consulta'));

create policy anexos_storage_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and tem_acesso_modulo((storage.foldername(name))[1], 'operador'));
