-- =========================================================
-- Neo Admin — 0158 Cobrança da Filial para o usuário restrito à unidade (Fase E)
-- A filial (Melina) cobra os clientes de Contagem: abas "A enviar", "Confirmar pagamento" e "Cobrar" da Cobrança e a consulta
-- da carteira (Recebíveis). Cuiabá continua vendo tudo. Para o restrito NÃO se abrem os módulos inteiros (pendências,
-- histórico e mensagens não separam unidade): cada liberação abaixo é RECORTADA pela unidade dele.
--  - tem_acesso_unidade(minimo): restrito, com acesso liberado e o nível que tem no Financeiro (permissoes).
--  - titulo_da_unidade(id): o título é da unidade do restrito.
--  - rec_titulos: o restrito ATUALIZA títulos da unidade, mas um gatilho só deixa mudar os campos da cobrança (estágio,
--    pausa da régua, linha digitável, boleto enviado, forma de pagamento, contestado). Assim as funções de cobrança que já
--    existem (security invoker) funcionam para ele sem reescrita, e valor, vencimento e cliente ficam fora do alcance.
--  - interacoes, pendencias, rec_promessas, akf_desdobramentos, rec_notas_saida: só o que é de título (ou cliente) da unidade.
--  - mensagens: só as que ele mesmo criou (rascunhos de cobrança e de boleto pelo Gmail dele).
--  - rec_reguas, rec_regua_marcos, modelos_mensagem (Recebíveis): leitura (a régua e os textos são parâmetros).
--  - rec_clientes_config: leitura dos clientes que ele vê; nova marca `confirmar_pagamento` (Contagem: só confirma quem tem a
--    marca; padrão desligado) gravada por rec_cliente_definir_confirmacao (Cuiabá ou o restrito, para cliente da unidade).
-- =========================================================

alter table rec_clientes_config add column confirmar_pagamento boolean;
comment on column rec_clientes_config.confirmar_pagamento is
  'Confirmar o pagamento antes do vencimento. Filial Contagem: só confirma quem tem true (padrão: não). Matriz: regra geral (valor mínimo).';

-- 1) Funções de apoio ---------------------------------------------------------------------------------------------------
create function tem_acesso_unidade(p_minimo nivel_acesso default 'consulta') returns boolean
language sql stable security definer set search_path = public as $$
  select unidade_restrita() is not null
     and acesso_liberado(auth.uid())
     and coalesce((select pe.nivel from permissoes pe where pe.perfil_id = auth.uid() and pe.area = 'financeiro'), 'sem_acesso') >= p_minimo;
$$;
revoke all on function tem_acesso_unidade(nivel_acesso) from public, anon;
grant execute on function tem_acesso_unidade(nivel_acesso) to authenticated, service_role;

create function titulo_da_unidade(p_titulo uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select unidade_restrita() is not null
     and exists (select 1 from rec_titulos where id = p_titulo and unidade = unidade_restrita());
$$;
revoke all on function titulo_da_unidade(uuid) from public, anon;
grant execute on function titulo_da_unidade(uuid) to authenticated, service_role;

-- 2) Títulos: atualizar só os campos da cobrança --------------------------------------------------------------------------
create policy rec_titulos_alterar_unidade on rec_titulos for update to authenticated
  using (unidade_restrita() is not null and unidade = unidade_restrita() and tem_acesso_unidade('operador'))
  with check (unidade_restrita() is not null and unidade = unidade_restrita() and tem_acesso_unidade('operador'));

create function fn_rec_titulos_campos_unidade() returns trigger language plpgsql as $$
declare
  -- Campos que a cobrança da filial muda (o resto do título é do Consistem e de Cuiabá).
  permitidos constant text[] := array['estagio', 'regua_pausada_ate', 'linha_digitavel', 'boleto_enviado_em', 'forma_pagamento',
                                      'contestado', 'atualizado_em', 'entrou_esteira_em',
                                      'unidade'];  -- unidade: coluna gerada (vem nula no BEFORE; ninguém a grava)
begin
  if unidade_restrita() is not null and (to_jsonb(new) - permitidos) <> (to_jsonb(old) - permitidos) then
    raise exception 'Pela filial só se alteram os dados da cobrança do título (estágio, régua, boleto e forma de pagamento).';
  end if;
  return new;
end $$;
-- "zz": roda depois dos outros gatilhos BEFORE (ex.: atualizado_em), enxergando o registro final.
create trigger trg_rec_titulos_zz_campos_unidade before update on rec_titulos for each row execute function fn_rec_titulos_campos_unidade();

-- 3) Histórico, pendências, promessas, partes da AKF e notas: só da unidade -------------------------------------------------
create policy interacoes_ler_unidade on interacoes for select to authenticated
  using (tem_acesso_unidade('consulta') and referencia_tabela = 'rec_titulos' and titulo_da_unidade(referencia_id));
create policy interacoes_inserir_unidade on interacoes for insert to authenticated
  with check (tem_acesso_unidade('operador') and usuario_id = auth.uid() and modulo = 'financeiro.recebiveis'
              and referencia_tabela = 'rec_titulos' and titulo_da_unidade(referencia_id));

-- Pendência da unidade: a de um título da unidade, ou a de cliente com o sufixo " (Filial Contagem)" no título
-- (Cobrar D+n, Confirmar pagamento, Ligar…: a régua sempre marca a unidade no título).
create function pendencia_da_unidade(p_modulo text, p_tabela text, p_referencia uuid, p_titulo text) returns boolean
language sql stable security definer set search_path = public as $$
  select unidade_restrita() = 'contagem' and p_modulo = 'financeiro.recebiveis'
     and ((p_tabela = 'rec_titulos' and titulo_da_unidade(p_referencia))
          or (p_tabela = 'contrapartes' and p_titulo like '%(Filial Contagem)%'));
$$;
revoke all on function pendencia_da_unidade(text, text, uuid, text) from public, anon;
grant execute on function pendencia_da_unidade(text, text, uuid, text) to authenticated, service_role;

create policy pendencias_ler_unidade on pendencias for select to authenticated
  using (tem_acesso_unidade('consulta') and pendencia_da_unidade(modulo, referencia_tabela, referencia_id, titulo));
create policy pendencias_inserir_unidade on pendencias for insert to authenticated
  with check (tem_acesso_unidade('operador') and pendencia_da_unidade(modulo, referencia_tabela, referencia_id, titulo));
create policy pendencias_alterar_unidade on pendencias for update to authenticated
  using (tem_acesso_unidade('operador') and pendencia_da_unidade(modulo, referencia_tabela, referencia_id, titulo)
         and (responsavel_id = auth.uid() or responsavel_id is null))
  with check (tem_acesso_unidade('operador') and pendencia_da_unidade(modulo, referencia_tabela, referencia_id, titulo));

create policy rec_promessas_ler_unidade on rec_promessas for select to authenticated
  using (tem_acesso_unidade('consulta') and titulo_da_unidade(titulo_id));
create policy rec_promessas_inserir_unidade on rec_promessas for insert to authenticated
  with check (tem_acesso_unidade('operador') and titulo_da_unidade(titulo_id));
create policy rec_promessas_alterar_unidade on rec_promessas for update to authenticated
  using (tem_acesso_unidade('operador') and titulo_da_unidade(titulo_id))
  with check (tem_acesso_unidade('operador') and titulo_da_unidade(titulo_id));

create policy akf_desdobramentos_ler_unidade on akf_desdobramentos for select to authenticated
  using (tem_acesso_unidade('consulta') and titulo_da_unidade(titulo_id));

create policy rec_notas_saida_ler_unidade on rec_notas_saida for select to authenticated
  using (tem_acesso_unidade('consulta')
         and exists (select 1 from rec_titulos t where t.nota_saida_id = rec_notas_saida.id and t.unidade = unidade_restrita()));

-- 4) Mensagens: só as próprias ------------------------------------------------------------------------------------------
create policy mensagens_ler_unidade on mensagens for select to authenticated
  using (tem_acesso_unidade('consulta') and modulo = 'financeiro.recebiveis' and criado_por = auth.uid());
create policy mensagens_inserir_unidade on mensagens for insert to authenticated
  with check (tem_acesso_unidade('operador') and modulo = 'financeiro.recebiveis' and status = 'rascunho');
create policy mensagens_alterar_unidade on mensagens for update to authenticated
  using (tem_acesso_unidade('operador') and modulo = 'financeiro.recebiveis' and criado_por = auth.uid() and status in ('rascunho', 'aguardando_aprovacao'))
  with check (tem_acesso_unidade('operador') and modulo = 'financeiro.recebiveis' and criado_por = auth.uid());

-- 5) Parâmetros: régua, textos e configuração do cliente ----------------------------------------------------------------
create policy rec_reguas_ler_unidade on rec_reguas for select to authenticated using (tem_acesso_unidade('consulta'));
create policy rec_regua_marcos_ler_unidade on rec_regua_marcos for select to authenticated using (tem_acesso_unidade('consulta'));
create policy modelos_mensagem_ler_unidade on modelos_mensagem for select to authenticated
  using (tem_acesso_unidade('consulta') and modulo = 'financeiro.recebiveis');
create policy rec_clientes_config_ler_unidade on rec_clientes_config for select to authenticated
  using (tem_acesso_unidade('consulta') and exists (select 1 from contrapartes c where c.id = rec_clientes_config.contraparte_id));

-- 6) Marca "confirmar pagamento" do cliente --------------------------------------------------------------------------------
create function rec_cliente_definir_confirmacao(p_contraparte uuid, p_confirmar boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (tem_acesso_area('financeiro', 'operador')
          or (tem_acesso_unidade('operador')
              and exists (select 1 from rec_titulos t where t.contraparte_id = p_contraparte and t.unidade = unidade_restrita()))) then
    raise exception 'Somente operador do Financeiro (ou da filial, para cliente da filial) altera a confirmação do cliente.';
  end if;
  if not exists (select 1 from contrapartes where id = p_contraparte) then
    raise exception 'Cliente não encontrado.';
  end if;
  insert into rec_clientes_config (contraparte_id, confirmar_pagamento) values (p_contraparte, p_confirmar)
  on conflict (contraparte_id) do update set confirmar_pagamento = excluded.confirmar_pagamento;
end $$;
revoke all on function rec_cliente_definir_confirmacao(uuid, boolean) from public, anon;
grant execute on function rec_cliente_definir_confirmacao(uuid, boolean) to authenticated;
