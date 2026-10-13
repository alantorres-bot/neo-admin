-- =========================================================
-- Neo Admin — 0157 Contas a pagar / Cartão: categoria do fornecedor no espelho (o título usa a categoria do fornecedor)
-- Especificação: docs/modulos/financeiro-cartao.md (regra 55).
--
-- O Consistem exige que a categoria do título seja a do fornecedor: ao alterar o 33626 na tela, recusou com "Categoria informada
-- diferente da categoria do documento!" (o painel tinha mandado 17, a do cartão; o fornecedor 1376 é 18). Decisão do Alan
-- (13/10/2026): o painel passa a usar a categoria do fornecedor. O espelho cap_fornecedores ganha cod_categoria (gravada pela
-- sincronização, que relê o cadastro a cada rodada, e pelo cadastro de fornecedor feito pelo painel).
-- =========================================================

alter table cap_fornecedores add column cod_categoria int;
comment on column cap_fornecedores.cod_categoria is 'codCategoria do fornecedor no Consistem: a categoria (categoriaDoc) dos títulos lançados contra ele.';

create or replace function crt_marcar_fornecedor_cadastrado(p_id uuid, p_cod text, p_resposta jsonb, p_usuario uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v crt_fornecedores_cadastrados;
  v_cod text := trim(p_cod);
begin
  select * into v from crt_fornecedores_cadastrados where id = p_id for update;
  update crt_fornecedores_cadastrados
     set situacao = 'cadastrado', cod_fornecedor = v_cod, resposta = coalesce(p_resposta, resposta), concluido_em = now(), erro = null,
         resolvido_por = case when p_motivo is null then resolvido_por else p_usuario end, motivo_resolucao = coalesce(p_motivo, motivo_resolucao)
   where id = p_id;
  insert into cap_fornecedores (empresa_id, cod_fornecedor, nome, nome_fantasia, ativo, visto_em, cod_categoria)
  values (v.empresa_id, v_cod, v.nome, v.payload ->> 'nomeFantasia', true, now(), (v.payload ->> 'codCategoria')::int)
  on conflict (empresa_id, cod_fornecedor) do update set nome = excluded.nome, nome_fantasia = excluded.nome_fantasia, ativo = true, visto_em = now(),
                                                         cod_categoria = excluded.cod_categoria;
  if v.estabelecimento_id is not null then
    update crt_estabelecimentos
       set lancamento_erp = coalesce(lancamento_erp, '{}'::jsonb) || jsonb_build_object('codFornecedor', v_cod::int)
     where id = v.estabelecimento_id;
  end if;
end $$;
revoke all on function crt_marcar_fornecedor_cadastrado(uuid, text, jsonb, uuid, text) from public, anon, authenticated;
