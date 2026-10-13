-- =========================================================
-- Neo Admin — 0149 Faturamento da Filial: relatório de implantação (CCFT040)
-- Cuiabá implanta cada fatura da filial na rotina CCFT040 (POP "Implantação de Faturas de Locação"). O relatório da remessa
-- traz, por NF, tudo o que se digita lá. Aqui ficam os dados que vêm da nota e o que é fixo pelo POP:
--  - rec_kits.data_emissao e cliente_documento (lidos do PDF do Syslock) e cliente_codigo_erp (código do cliente no Consistem):
--    preenchido pelo CNPJ quando o cliente já tem título (contrapartes) ou pela consulta ao Consistem (Edge Function
--    rec-filial-cliente-erp). cliente_conferido_em: quando foi conferido; conferido e sem código = não cadastrado no Consistem.
--  - rec_kit_registrar ganha p_emissao e p_cliente_documento.
--  - rec_kit_definir_cliente_erp(): grava o resultado da consulta (ou correção manual).
--  - financeiro.filial.implantacao: campos fixos do POP (tipo de nota, representante, condição de venda, produto,
--    classificação fiscal, PIS e COFINS), configuráveis para quando o POP mudar.
-- =========================================================

alter table rec_kits
  add column data_emissao date,
  add column cliente_documento text,
  add column cliente_codigo_erp text,
  add column cliente_conferido_em timestamptz;

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.filial.implantacao',
   '{"rotina": "CCFT040 — Implantação de Notas Fiscais – Antiga", "tipo_nota": "12 — FAT LOCAÇÃO", "representante": "5 — LUCAS DE MOURA SILVA", "condicao_venda": "1", "produto": "2.09.002.0024 — LOCAÇÃO DE BENS MÓVEIS", "classificacao_fiscal": "11837 — OUTRAS", "pis": "1,65%", "cofins": "7,60%"}',
   'Campos fixos da implantação das faturas da Filial Contagem no Consistem (POP "Implantação de Faturas de Locação").')
on conflict (chave) do nothing;

drop function rec_kit_registrar(text, text, boolean, text, date, date, uuid, uuid, jsonb);
create function rec_kit_registrar(
  p_nota text, p_cliente text, p_aceita_boleto_factoring boolean,
  p_obra text default null, p_periodo_inicio date default null, p_periodo_fim date default null, p_empresa uuid default null,
  p_remessa uuid default null, p_parcelas jsonb default null,
  p_emissao date default null, p_cliente_documento text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_digitos text := regexp_replace(coalesce(p_nota, ''), '[^0-9]', '', 'g');
  v_nota text := case when length(v_digitos) between 1 and 6 then lpad(v_digitos, 6, '0') end;
  v_empresa uuid := p_empresa;
  v_parcelas jsonb := rec_parcelas_informadas_validas(p_parcelas);
  v_id uuid;
  v_estagio text;
  v_documento text := nullif(btrim(p_cliente_documento), '');
  v_codigo text;
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima registra faturas da filial.';
  end if;
  if v_nota is null or v_nota = '000000' then
    raise exception 'Número de NF inválido: "%".', p_nota;
  end if;
  if btrim(coalesce(p_cliente, '')) = '' then
    raise exception 'Informe o cliente da NF %.', v_nota;
  end if;
  if p_remessa is not null then
    select empresa_id into v_empresa from rec_remessas where id = p_remessa;
    if v_empresa is null then
      raise exception 'Remessa não encontrada.';
    end if;
  elsif v_empresa is null then
    select (array_agg(id))[1] into v_empresa from empresas where ativa and codigo_erp is not null having count(*) = 1;
    if v_empresa is null then
      raise exception 'Não foi possível identificar a empresa da filial; informe a empresa.';
    end if;
  end if;

  -- Código do cliente no Consistem: pelo CNPJ/CPF, quando o cliente já tem título (contrapartes vem da sincronização).
  if v_documento is not null then
    select codigo_erp into v_codigo from contrapartes where documento = v_documento and codigo_erp is not null order by ativo desc limit 1;
  end if;

  select id, estagio into v_id, v_estagio from rec_kits where empresa_id = v_empresa and nota_fiscal = v_nota and estagio <> 'cancelada';
  if v_id is null then
    insert into rec_kits (empresa_id, nota_fiscal, cliente_nome, obra, periodo_inicio, periodo_fim, aceita_boleto_factoring, parcelas_informadas,
                          data_emissao, cliente_documento, cliente_codigo_erp, cliente_conferido_em)
    values (v_empresa, v_nota, btrim(p_cliente), nullif(btrim(p_obra), ''), p_periodo_inicio, p_periodo_fim, coalesce(p_aceita_boleto_factoring, true), v_parcelas,
            p_emissao, v_documento, v_codigo, case when v_codigo is not null then now() end)
    returning id into v_id;
    select estagio into v_estagio from rec_kits where id = v_id; -- o gatilho já ligou títulos que existiam
  elsif v_estagio <> 'enviada' then
    update rec_kits
       set cliente_nome = btrim(p_cliente), obra = coalesce(nullif(btrim(p_obra), ''), obra),
           periodo_inicio = coalesce(p_periodo_inicio, periodo_inicio), periodo_fim = coalesce(p_periodo_fim, periodo_fim),
           aceita_boleto_factoring = coalesce(p_aceita_boleto_factoring, aceita_boleto_factoring),
           parcelas_informadas = case when jsonb_array_length(v_parcelas) > 0 then v_parcelas else parcelas_informadas end,
           data_emissao = coalesce(p_emissao, data_emissao),
           cliente_documento = coalesce(v_documento, cliente_documento),
           cliente_codigo_erp = coalesce(v_codigo, cliente_codigo_erp),
           cliente_conferido_em = case when v_codigo is not null then now() else cliente_conferido_em end
     where id = v_id;
  end if;

  if p_remessa is not null then
    insert into rec_remessa_kits (remessa_id, kit_id) values (p_remessa, v_id) on conflict do nothing;
  elsif v_estagio = 'recebida' then
    insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    values ('financeiro.filial', v_empresa, format('Implantar fatura da filial: NF %s — %s', v_nota, btrim(p_cliente)),
            case when coalesce(p_aceita_boleto_factoring, true) then 'Implantar no Consistem e emitir o boleto.'
                 else 'Implantar no Consistem. Cliente NÃO aceita boleto de factoring.' end,
            (now() at time zone 'America/Cuiaba')::date, 'normal', 'rec_kits', v_id, '/financeiro/filial/' || v_id)
    on conflict (modulo, referencia_tabela, referencia_id, titulo) where status in ('aberta', 'em_andamento') do nothing;
  end if;
  return v_id;
end $$;
revoke all on function rec_kit_registrar(text, text, boolean, text, date, date, uuid, uuid, jsonb, date, text) from public, anon;
grant execute on function rec_kit_registrar(text, text, boolean, text, date, date, uuid, uuid, jsonb, date, text) to authenticated;

-- Resultado da consulta do cliente no Consistem (ou correção manual). Código nulo = conferido e não cadastrado.
create function rec_kit_definir_cliente_erp(p_kit uuid, p_codigo text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro ou acima.';
  end if;
  update rec_kits set cliente_codigo_erp = nullif(btrim(p_codigo), ''), cliente_conferido_em = now()
   where id = p_kit and estagio not in ('enviada', 'cancelada');
  if not found then
    raise exception 'Kit não encontrado, enviado ou cancelado.';
  end if;
end $$;
revoke all on function rec_kit_definir_cliente_erp(uuid, text) from public, anon;
grant execute on function rec_kit_definir_cliente_erp(uuid, text) to authenticated;
