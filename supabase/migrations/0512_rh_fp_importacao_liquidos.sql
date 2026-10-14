-- =========================================================
-- Neo Admin — 0512 RH/SST > Folha de pagamento: importação da Relação Geral dos Líquidos (Fase F6)
-- O .xls do escritório (um por empresa e por cálculo) preenche a natureza correspondente da folha do mês: Folha Mensal → líquido,
-- 13º → 13º, Férias → férias/acréscimos. Cada pessoa é casada pelo código do escritório dentro da empresa empregadora; quem não
-- casar pode ser ligado pelo operador (o código fica gravado no cadastro para os meses seguintes).
-- Especificação: docs/modulos/rh-folha.md, seção 4 e regra 12.
--
-- 1) rh_fp_importacoes: registro de cada arquivo importado (prova: quem, quando, empresa, cálculo, total). Nunca apagado.
-- 2) rh_fp_importar_relacao: grava os valores (só mês aberto, operador), as ligações código → pessoa e o registro.
--    O app lê e confere o arquivo (soma = Total da Empresa); a função confere de novo que a soma das linhas é o total informado.
-- =========================================================

create table rh_fp_importacoes (
  id uuid primary key default gen_random_uuid(),
  competencia_id uuid not null references rh_fp_competencias(id),
  empregador text not null,
  cnpj text not null,
  calculo text not null,
  natureza text not null check (natureza in ('liquido', 'ferias_acrescimos', 'decimo_terceiro')),
  arquivo_nome text,
  pessoas int not null,
  total numeric(14,2) not null,
  aplicadas int not null,                 -- linhas da folha que receberam o valor
  ligadas int not null default 0,          -- códigos ligados à mão pelo operador
  sem_cadastro jsonb not null default '[]', -- [{codigo, nome, valor}] que ficaram de fora
  importado_por uuid references perfis(id) default auth.uid(),
  importado_em timestamptz not null default now()
);
comment on table rh_fp_importacoes is 'Arquivos do escritório (Relação Geral dos Líquidos) importados na folha do mês: empresa, cálculo, total e o que ficou de fora.';
create index idx_rh_fp_importacoes_comp on rh_fp_importacoes (competencia_id, importado_em desc);
create trigger trg_rh_fp_imp_sem_delete before delete on rh_fp_importacoes for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_fp_imp after insert on rh_fp_importacoes for each row execute function fn_auditoria();
alter table rh_fp_importacoes enable row level security;
create policy rh_fp_imp_ler on rh_fp_importacoes for select to authenticated using (tem_acesso_area('rh'));

-- p_linhas: [{item_id, valor}] casadas; p_ligacoes: [{item_id, codigo}] feitas à mão; p_sem_cadastro: [{codigo, nome, valor}].
create function rh_fp_importar_relacao(p_id uuid, p_empregador text, p_cnpj text, p_calculo text, p_natureza text, p_arquivo text,
                                       p_pessoas int, p_total numeric, p_linhas jsonb, p_ligacoes jsonb, p_sem_cadastro jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_n int;
  v_soma numeric;
  v_lig int := 0;
begin
  perform rh_exigir('operador');
  c := rh_fp_competencia_para(p_id, array['aberta']);
  if p_natureza not in ('liquido', 'ferias_acrescimos', 'decimo_terceiro') then raise exception 'Natureza inválida.'; end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then raise exception 'Nada para importar.'; end if;
  -- A soma de tudo (casadas + de fora) tem de ser o total do arquivo.
  select coalesce(sum((x->>'valor')::numeric), 0) into v_soma from jsonb_array_elements(p_linhas) x;
  select v_soma + coalesce(sum((x->>'valor')::numeric), 0) into v_soma from jsonb_array_elements(coalesce(p_sem_cadastro, '[]')) x;
  if round(v_soma, 2) <> round(p_total, 2) then
    raise exception 'A soma das linhas (R$ %) não bate com o total do arquivo (R$ %).', v_soma, p_total;
  end if;
  if exists (select 1 from jsonb_to_recordset(p_linhas) as x(item_id uuid, valor numeric)
              left join rh_fp_itens i on i.id = x.item_id and i.competencia_id = p_id
             where i.id is null or i.empregador <> p_empregador or x.valor < 0) then
    raise exception 'Há linhas que não são desta folha ou desta empresa; recarregue e importe de novo.';
  end if;

  -- Ligações feitas à mão: grava o código do escritório no cadastro e na foto do mês.
  if p_ligacoes is not null and jsonb_typeof(p_ligacoes) = 'array' then
    update rh_colaboradores k set matricula_escritorio = x.codigo
      from jsonb_to_recordset(p_ligacoes) as x(item_id uuid, codigo text), rh_fp_itens i
     where i.id = x.item_id and i.competencia_id = p_id and k.id = i.colaborador_id and x.codigo ~ '^\d{1,9}$';
    update rh_fp_itens i set matricula_escritorio = x.codigo, atualizado_por = auth.uid()
      from jsonb_to_recordset(p_ligacoes) as x(item_id uuid, codigo text)
     where i.id = x.item_id and i.competencia_id = p_id and x.codigo ~ '^\d{1,9}$';
    get diagnostics v_lig = row_count;
  end if;

  update rh_fp_itens i set
    liquido = case when p_natureza = 'liquido' then round(x.valor, 2) else i.liquido end,
    ferias_acrescimos = case when p_natureza = 'ferias_acrescimos' then round(x.valor, 2) else i.ferias_acrescimos end,
    decimo_terceiro = case when p_natureza = 'decimo_terceiro' then round(x.valor, 2) else i.decimo_terceiro end,
    atualizado_por = auth.uid()
    from jsonb_to_recordset(p_linhas) as x(item_id uuid, valor numeric)
   where i.id = x.item_id and i.competencia_id = p_id;
  get diagnostics v_n = row_count;

  insert into rh_fp_importacoes (competencia_id, empregador, cnpj, calculo, natureza, arquivo_nome, pessoas, total, aplicadas, ligadas, sem_cadastro)
  values (p_id, p_empregador, p_cnpj, p_calculo, p_natureza, nullif(trim(p_arquivo), ''), p_pessoas, round(p_total, 2), v_n, v_lig, coalesce(p_sem_cadastro, '[]'));
  return v_n;
end $$;
revoke all on function rh_fp_importar_relacao(uuid, text, text, text, text, text, int, numeric, jsonb, jsonb, jsonb) from public, anon;
