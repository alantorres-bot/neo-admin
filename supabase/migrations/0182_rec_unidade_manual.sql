-- =========================================================
-- Neo Admin — 0182 Unidade do título corrigível pelo gestor
-- A unidade é calculada pelo documento (começa com 400 = Filial Contagem, 0110), mas a Matriz também tem NFs na série 2 do
-- Consistem com o mesmo formato: o 4000482U (NF 482, Canopus, 23/10/2026) é da Matriz e caiu na Filial, sumindo da Carteira
-- da Matriz, da confirmação e das filas de Cuiabá. A regra continua; o gestor do Financeiro corrige a exceção na ficha do título.
--   - rec_titulos.unidade_manual: a correção (vazia = vale a regra). A sincronização não toca nela, então a correção vale para sempre.
--   - rec_titulos.unidade: continua calculada (as políticas da filial dependem dela), agora coalesce(unidade_manual, regra).
--   - rec_definir_unidade(): gestor+, motivo obrigatório, interação no histórico; a auditoria guarda antes/depois.
-- O usuário restrito à unidade não muda unidade_manual (o gatilho da 0158 só libera os campos da cobrança).
-- =========================================================

alter table rec_titulos add column unidade_manual text check (unidade_manual in ('matriz', 'contagem'));

-- Postgres 17: troca a expressão sem recriar a coluna (as políticas e a view que a usam continuam valendo).
alter table rec_titulos alter column unidade set expression as
  (coalesce(unidade_manual, case when documento like '400%' then 'contagem' else 'matriz' end));

create function rec_definir_unidade(p_titulo uuid, p_unidade text, p_motivo text)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_t record;
  v_regra text;
  v_alterados int;
  v_rotulo constant jsonb := '{"matriz": "Matriz", "contagem": "Filial Contagem"}';
begin
  if not tem_acesso_area('financeiro', 'gestor') then
    raise exception 'Somente o gestor do Financeiro pode corrigir a unidade do título.';
  end if;
  if p_unidade not in ('matriz', 'contagem') then
    raise exception 'Unidade inválida.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo da correção.';
  end if;

  select id, contraparte_id, documento, unidade, estagio into v_t from rec_titulos where id = p_titulo for update;
  if not found then
    raise exception 'Título não encontrado (ou você não tem acesso a ele).';
  end if;
  if v_t.unidade = p_unidade then
    raise exception 'O título % já é da unidade %.', v_t.documento, v_rotulo ->> p_unidade;
  end if;
  if exists (select 1 from rec_kit_titulos where titulo_id = p_titulo) then
    raise exception 'O título % está ligado a um kit da Filial: cancele o kit antes de mudar a unidade.', v_t.documento;
  end if;

  v_regra := case when v_t.documento like '400%' then 'contagem' else 'matriz' end;
  -- Igual à regra = sem correção: o título volta a seguir o documento.
  update rec_titulos set unidade_manual = nullif(p_unidade, v_regra) where id = p_titulo;
  get diagnostics v_alterados = row_count;
  if v_alterados <> 1 then
    raise exception 'Você não tem permissão para alterar este título.';
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  values ('financeiro.recebiveis', v_t.contraparte_id, 'rec_titulos', p_titulo, 'interno', 'unidade_alterada',
          format('Unidade corrigida: %s → %s. %s', v_rotulo ->> v_t.unidade, v_rotulo ->> p_unidade, trim(p_motivo)), auth.uid());

  return jsonb_build_object('titulo', v_t.documento, 'de', v_t.unidade, 'para', p_unidade);
end $$;
revoke all on function rec_definir_unidade(uuid, text, text) from public, anon;
grant execute on function rec_definir_unidade(uuid, text, text) to authenticated;
