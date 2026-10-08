-- =========================================================
-- Neo Admin — 0120 Regra de cobrança editável, Fase 2 (marcos da régua e textos)
-- Os marcos D+1, D+5 e D+10, seus canais e seus textos estavam cravados no código. Agora ficam em `rec_regua_marcos` (régua
-- 'Padrao', acao 'cobranca') e o gestor do Financeiro (ou acima) os edita na tela Cobrança > Regra de cobrança.
-- As sementes reproduzem EXATAMENTE o comportamento anterior (mesmos dias, canais e textos): publicar esta migration não muda nada
-- até alguém editar. O sistema continua sem enviar nada: a régua só abre tarefas com o texto pronto.
--
-- 1) `rec_regua_marcos` ganha ativo, descrição e os textos (WhatsApp, assunto e corpo do e-mail). O nome do marco é sempre
--    `D+<dias>` (liga a pendência "Cobrar D+5: ..." e o histórico "Cobrança D+5 enviada"), por isso não há coluna de nome.
--    Marco removido fica `ativo = false` (nada é apagado); o mesmo número de dias volta a ficar ativo se for recriado.
-- 2) RLS: leitura para quem tem a área Financeiro; escrita só pela função (security definer) e auditada.
-- 3) Variáveis dos textos: {saudacao} {cliente} {parcelas} {demonstrativo} {total} {total_atualizado} {data} {multa_pct}
--    {juros_pct} {marco} {marco_dias} e {pl:texto se uma parcela|texto se várias}. Qualquer outra recusa o salvamento.
-- 4) rec_salvar_regua passa a aceitar também os marcos (p_marcos) e devolve um resumo; marco removido ou com outro número de
--    dias cancela as pendências "Cobrar D+<dias>" abertas dele (o histórico fica).
-- 5) rec_registrar_cobranca deixa de fixar o marco em (1, 5, 10): vale qualquer marco ativo da régua.
-- =========================================================

alter table rec_regua_marcos
  add column ativo boolean not null default true,
  add column descricao text,
  add column texto_whatsapp text,
  add column assunto_email text,
  add column corpo_email text,
  add column atualizado_em timestamptz not null default now(),
  add column atualizado_por uuid references perfis(id);

create policy rec_reguas_ler on rec_reguas for select to authenticated using (tem_acesso_area('financeiro'));
create policy rec_regua_marcos_ler on rec_regua_marcos for select to authenticated using (tem_acesso_area('financeiro'));

create trigger trg_aud_rec_reguas after insert or update or delete on rec_reguas for each row execute function fn_auditoria();
create trigger trg_aud_rec_regua_marcos after insert or update or delete on rec_regua_marcos for each row execute function fn_auditoria();

-- Sementes: a régua que já funcionava ---------------------------------------------------------------------------------
insert into rec_regua_marcos (regua_id, dia_relativo, acao, canais, descricao, texto_whatsapp, assunto_email, corpo_email)
select r.id, 1, 'cobranca', '{email,whatsapp}', 'Lembrete cordial de vencimento',
$t$
{saudacao} Aqui é do Financeiro da Neo Formas.

Identificamos que {pl:a parcela abaixo, já vencida, ainda não consta como paga|as parcelas abaixo, já vencidas, ainda não constam como pagas}:

{parcelas}

Se o pagamento já foi feito, pedimos a gentileza de nos enviar o comprovante para darmos a baixa. Se precisar da segunda via do boleto ou dos dados para PIX/transferência, é só avisar que enviamos na hora.

Obrigado!
$t$,
'Lembrete de vencimento — {cliente}',
$t$
{saudacao}

Identificamos que {pl:a parcela abaixo, já vencida, ainda não consta como paga|as parcelas abaixo, já vencidas, ainda não constam como pagas}:

{parcelas}

Se o pagamento já foi realizado, pedimos a gentileza de nos enviar o comprovante para darmos a baixa. Caso precise da segunda via do boleto, é só nos avisar.

Atenciosamente,
$t$
from rec_reguas r where r.nome = 'Padrao'
on conflict (regua_id, dia_relativo, acao) do nothing;

insert into rec_regua_marcos (regua_id, dia_relativo, acao, canais, descricao, texto_whatsapp, assunto_email, corpo_email)
select r.id, 5, 'cobranca', '{whatsapp}', 'Segundo aviso, pedindo previsão de pagamento',
$t$
{saudacao} Aqui é do Financeiro da Neo Formas.

Voltamos a falar sobre {pl:a parcela abaixo, ainda em aberto|as parcelas abaixo, ainda em aberto}:

{parcelas}

Você consegue nos informar a previsão de pagamento? Se houver algum impedimento, nos conte para encontrarmos uma solução juntos. Se o pagamento já foi feito, envie o comprovante, por favor.

Ficamos à disposição. Obrigado!
$t$,
null, null
from rec_reguas r where r.nome = 'Padrao'
on conflict (regua_id, dia_relativo, acao) do nothing;

insert into rec_regua_marcos (regua_id, dia_relativo, acao, canais, descricao, texto_whatsapp, assunto_email, corpo_email)
select r.id, 10, 'cobranca', '{email}', 'Cobrança formal com demonstrativo de encargos', null,
'Cobrança de títulos vencidos — {cliente}',
$t$
{saudacao}

Até esta data não localizamos o pagamento {pl:do título abaixo|dos títulos abaixo}, {pl:vencido|vencidos} há mais de {marco_dias} dias. O demonstrativo atualizado em {data} é o seguinte:

{demonstrativo}

Total atualizado: {total_atualizado}.

Os encargos seguem a multa de {multa_pct}% e os juros de {juros_pct}% ao mês, calculados por dia de atraso.

Pedimos que o pagamento seja regularizado ou que nos informe a previsão. Se já foi efetuado, envie o comprovante para darmos a baixa. Estamos à disposição para esclarecer qualquer ponto.

Atenciosamente,
$t$
from rec_reguas r where r.nome = 'Padrao'
on conflict (regua_id, dia_relativo, acao) do nothing;

-- Os textos acima começam e terminam com quebra de linha (aspas de dólar): tira, para ficarem iguais aos do código.
update rec_regua_marcos
   set texto_whatsapp = btrim(texto_whatsapp, E'\n'), corpo_email = btrim(corpo_email, E'\n')
 where acao = 'cobranca';

-- Variáveis inválidas de um texto (lista vazia = texto válido) ---------------------------------------------------------
create function rec_variaveis_invalidas(p_texto text) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct m.g[1]), '{}'::text[])
    from regexp_matches(regexp_replace(coalesce(p_texto, ''), '\{pl:[^{}|]*\|[^{}|]*\}', '', 'g'), '\{[^{}]*\}', 'g') as m(g)
   where substring(m.g[1] from 2 for length(m.g[1]) - 2) <> all (array[
     'saudacao', 'cliente', 'parcelas', 'demonstrativo', 'total', 'total_atualizado', 'data', 'multa_pct', 'juros_pct', 'marco', 'marco_dias']);
$$;
revoke all on function rec_variaveis_invalidas(text) from public, anon;
grant execute on function rec_variaveis_invalidas(text) to authenticated;

-- rec_salvar_regua: parâmetros (0119) + marcos --------------------------------------------------------------------------
drop function rec_salvar_regua(jsonb);

create function rec_salvar_regua(p_parametros jsonb default null, p_marcos jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prefixo constant text := 'financeiro.recebiveis.';
  v_chave text;
  v_valor jsonb;
  v_numero numeric;
  v_nome text;
  v_regua uuid;
  v_m jsonb;
  v_dias int;
  v_vistos int[] := '{}';
  v_antigos int[];
  v_canais text[];
  v_whats text;
  v_assunto text;
  v_corpo text;
  v_descricao text;
  v_ruins text[];
  v_cancel int := 0;
  v_n int;
begin
  if auth.uid() is null or not usuario_ativo() or nivel_area('financeiro') < 'gestor'::nivel_acesso then
    raise exception 'Somente gestor do Financeiro ou acima pode alterar a regra de cobrança.';
  end if;
  if p_parametros is null and p_marcos is null then
    raise exception 'Nenhum parâmetro informado.';
  end if;
  if p_parametros is not null and (jsonb_typeof(p_parametros) <> 'object' or p_parametros = '{}'::jsonb) then
    raise exception 'Nenhum parâmetro informado.';
  end if;
  if p_marcos is not null and jsonb_typeof(p_marcos) <> 'array' then
    raise exception 'A lista de marcos é inválida.';
  end if;

  -- 1) valida os parâmetros (mesmas regras da 0119)
  if p_parametros is not null then
    for v_chave, v_valor in select key, value from jsonb_each(p_parametros) loop
      if v_chave in (v_prefixo || 'esteira_a_partir_de', v_prefixo || 'regua_a_partir_de') then
        if jsonb_typeof(v_valor) = 'null' then
          continue;
        end if;
        if jsonb_typeof(v_valor) <> 'string' or (v_valor #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'Data inválida (use aaaa-mm-dd).';
        end if;
        begin
          perform (v_valor #>> '{}')::date;
        exception when others then
          raise exception 'Data inválida (use aaaa-mm-dd).';
        end;
      elsif v_chave = v_prefixo || 'confirmacao_valor_minimo' then
        if jsonb_typeof(v_valor) <> 'number' then raise exception 'O valor mínimo da confirmação deve ser um número em reais.'; end if;
        v_numero := (v_valor #>> '{}')::numeric;
        if v_numero <= 0 or v_numero > 100000000 then raise exception 'O valor mínimo da confirmação deve ser maior que zero.'; end if;
      elsif v_chave in (v_prefixo || 'janela_anexar_boleto_dias', v_prefixo || 'janela_confirmacao_dias', v_prefixo || 'prazo_contato_antes_dias', v_prefixo || 'trava_pendencias_cobranca') then
        if jsonb_typeof(v_valor) <> 'number' or (v_valor #>> '{}')::numeric <> trunc((v_valor #>> '{}')::numeric) then
          raise exception 'Informe um número inteiro de dias.';
        end if;
        v_numero := (v_valor #>> '{}')::numeric;
        if v_chave = v_prefixo || 'janela_anexar_boleto_dias' and (v_numero < 1 or v_numero > 365) then raise exception 'A janela do boleto deve ficar entre 1 e 365 dias.'; end if;
        if v_chave = v_prefixo || 'janela_confirmacao_dias' and (v_numero < 1 or v_numero > 60) then raise exception 'A janela da confirmação deve ficar entre 1 e 60 dias.'; end if;
        if v_chave = v_prefixo || 'prazo_contato_antes_dias' and (v_numero < 0 or v_numero > 30) then raise exception 'O prazo do contato deve ficar entre 0 e 30 dias antes do vencimento.'; end if;
        if v_chave = v_prefixo || 'trava_pendencias_cobranca' and (v_numero < 1 or v_numero > 500) then raise exception 'A trava de cobranças deve ficar entre 1 e 500.'; end if;
      else
        raise exception 'Parâmetro não permitido: %.', v_chave;
      end if;
    end loop;
  end if;

  -- 2) valida os marcos
  if p_marcos is not null then
    if jsonb_array_length(p_marcos) > 6 then
      raise exception 'No máximo 6 marcos.';
    end if;
    for v_m in select value from jsonb_array_elements(p_marcos) loop
      if jsonb_typeof(v_m) <> 'object' then raise exception 'A lista de marcos é inválida.'; end if;
      if jsonb_typeof(v_m -> 'dias') is distinct from 'number' or (v_m ->> 'dias')::numeric <> trunc((v_m ->> 'dias')::numeric)
         or (v_m ->> 'dias')::numeric < 1 or (v_m ->> 'dias')::numeric > 365 then
        raise exception 'Os dias de atraso de cada marco devem ficar entre 1 e 365.';
      end if;
      v_dias := (v_m ->> 'dias')::int;
      if v_dias = any (v_vistos) then
        raise exception 'Dois marcos com % de atraso: cada marco precisa de um número de dias diferente.', v_dias || case when v_dias = 1 then ' dia' else ' dias' end;
      end if;
      v_vistos := v_vistos || v_dias;

      if jsonb_typeof(v_m -> 'canais') is distinct from 'array' then
        raise exception 'D+%: escolha pelo menos um canal (e-mail ou WhatsApp).', v_dias;
      end if;
      select coalesce(array_agg(distinct x), '{}') into v_canais from jsonb_array_elements_text(v_m -> 'canais') as x;
      if cardinality(v_canais) = 0 then raise exception 'D+%: escolha pelo menos um canal (e-mail ou WhatsApp).', v_dias; end if;
      if exists (select 1 from unnest(v_canais) c where c not in ('email', 'whatsapp')) then raise exception 'D+%: canal inválido.', v_dias; end if;

      v_descricao := btrim(coalesce(v_m ->> 'descricao', ''));
      if char_length(v_descricao) < 3 or char_length(v_descricao) > 120 then raise exception 'D+%: descreva o marco em 3 a 120 caracteres.', v_dias; end if;

      v_whats := btrim(coalesce(v_m ->> 'texto_whatsapp', ''), E' \n\r\t');
      v_assunto := btrim(coalesce(v_m ->> 'assunto_email', ''), E' \n\r\t');
      v_corpo := btrim(coalesce(v_m ->> 'corpo_email', ''), E' \n\r\t');
      if 'whatsapp' = any (v_canais) and v_whats = '' then raise exception 'D+%: escreva o texto do WhatsApp.', v_dias; end if;
      if 'email' = any (v_canais) and (v_assunto = '' or v_corpo = '') then raise exception 'D+%: escreva o assunto e o texto do e-mail.', v_dias; end if;
      if char_length(v_whats) > 4000 or char_length(v_corpo) > 8000 or char_length(v_assunto) > 200 then raise exception 'D+%: texto longo demais.', v_dias; end if;
      v_ruins := rec_variaveis_invalidas(v_whats) || rec_variaveis_invalidas(v_assunto) || rec_variaveis_invalidas(v_corpo);
      if cardinality(v_ruins) > 0 then raise exception 'D+%: variável desconhecida %.', v_dias, array_to_string(v_ruins, ', '); end if;
    end loop;
  end if;

  -- 3) grava (mesma transação: se algo falhar, nada fica gravado)
  if p_parametros is not null then
    for v_chave, v_valor in select key, value from jsonb_each(p_parametros) loop
      insert into configuracoes (chave, valor, descricao) values (v_chave, v_valor, 'Parâmetro da regra de cobrança (editado na tela Cobrança > Regra de cobrança).')
      on conflict (chave) do update set valor = excluded.valor;
    end loop;
  end if;

  if p_marcos is not null then
    select id into v_regua from rec_reguas where nome = 'Padrao' and ativa;
    if v_regua is null then raise exception 'A régua padrão não está ativa.'; end if;
    select coalesce(array_agg(dia_relativo), '{}') into v_antigos from rec_regua_marcos where regua_id = v_regua and acao = 'cobranca' and ativo;

    for v_m in select value from jsonb_array_elements(p_marcos) loop
      select coalesce(array_agg(distinct x), '{}') into v_canais from jsonb_array_elements_text(v_m -> 'canais') as x;
      v_whats := btrim(coalesce(v_m ->> 'texto_whatsapp', ''), E' \n\r\t');
      v_assunto := btrim(coalesce(v_m ->> 'assunto_email', ''), E' \n\r\t');
      v_corpo := btrim(coalesce(v_m ->> 'corpo_email', ''), E' \n\r\t');
      insert into rec_regua_marcos (regua_id, dia_relativo, acao, canais, descricao, texto_whatsapp, assunto_email, corpo_email, ativo, atualizado_em, atualizado_por)
      values (v_regua, (v_m ->> 'dias')::int, 'cobranca', v_canais::canal[], btrim(v_m ->> 'descricao'),
              case when 'whatsapp' = any (v_canais) then v_whats end,
              case when 'email' = any (v_canais) then v_assunto end,
              case when 'email' = any (v_canais) then v_corpo end,
              true, now(), auth.uid())
      on conflict (regua_id, dia_relativo, acao) do update
        set canais = excluded.canais, descricao = excluded.descricao, texto_whatsapp = excluded.texto_whatsapp, assunto_email = excluded.assunto_email,
            corpo_email = excluded.corpo_email, ativo = true, atualizado_em = now(), atualizado_por = auth.uid()
        where (rec_regua_marcos.canais, rec_regua_marcos.descricao, rec_regua_marcos.texto_whatsapp, rec_regua_marcos.assunto_email, rec_regua_marcos.corpo_email, rec_regua_marcos.ativo)
              is distinct from (excluded.canais, excluded.descricao, excluded.texto_whatsapp, excluded.assunto_email, excluded.corpo_email, true);
    end loop;

    -- marcos que saíram da lista: ficam inativos (nada é apagado) e as pendências abertas deles são canceladas
    update rec_regua_marcos set ativo = false, atualizado_em = now(), atualizado_por = auth.uid()
     where regua_id = v_regua and acao = 'cobranca' and ativo and dia_relativo <> all (v_vistos);
    for v_dias in select unnest(v_antigos) loop
      if v_dias <> all (v_vistos) then
        update pendencias set status = 'cancelada'
         where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes'
           and titulo like 'Cobrar D+' || v_dias || ':%' and status in ('aberta', 'em_andamento');
        get diagnostics v_n = row_count;
        v_cancel := v_cancel + v_n;
      end if;
    end loop;
  end if;

  select nome into v_nome from perfis where id = auth.uid();
  insert into configuracoes (chave, valor, descricao)
  values (v_prefixo || 'regra_ultima_alteracao', jsonb_build_object('por', coalesce(v_nome, 'usuário'), 'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          'Quem alterou a regra de cobrança por último e quando (mostrado na tela).')
  on conflict (chave) do update set valor = excluded.valor;

  return jsonb_build_object('pendencias_canceladas', v_cancel);
end;
$$;

revoke all on function rec_salvar_regua(jsonb, jsonb) from public, anon;
grant execute on function rec_salvar_regua(jsonb, jsonb) to authenticated;

-- rec_registrar_cobranca (0109): o marco vale se estiver ativo na régua (antes: só 1, 5 ou 10) ---------------------------
create or replace function rec_registrar_cobranca(
  p_titulos uuid[], p_marco int, p_resultado text, p_canal canal default 'whatsapp', p_data_prometida date default null, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_qtd int;
  v_clientes int;
  v_unidades int;
  v_unidade text;
  v_cliente uuid;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atualizados int;
  v_concluidas int := 0;
  v_tipo text;
  v_texto text;
  v_canal_txt text;
begin
  if p_resultado not in ('enviada', 'promessa', 'contestou') then
    raise exception 'Resultado inválido.';
  end if;
  if not exists (select 1 from rec_regua_marcos m join rec_reguas r on r.id = m.regua_id
                  where r.nome = 'Padrao' and r.ativa and m.acao = 'cobranca' and m.ativo and m.dia_relativo = p_marco) then
    raise exception 'Marco da régua inválido.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos uma parcela.';
  end if;

  select count(*), count(distinct contraparte_id), min(contraparte_id::text)::uuid, count(distinct unidade), min(unidade)
    into v_qtd, v_clientes, v_cliente, v_unidades, v_unidade
    from rec_titulos
   where id = any(v_ids)
     and estagio in ('importado', 'aguardando_boleto', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  if v_qtd <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já foi paga ou encerrada (ou você não tem acesso a ela).';
  end if;
  if v_clientes <> 1 then
    raise exception 'As parcelas precisam ser do mesmo cliente.';
  end if;
  if v_unidades <> 1 then
    raise exception 'As parcelas precisam ser da mesma unidade (Matriz ou Filial Contagem).';
  end if;

  v_canal_txt := case p_canal when 'email' then 'por e-mail' when 'whatsapp' then 'por WhatsApp' when 'telefone' then 'por telefone' else 'por outro meio' end;

  if p_resultado = 'promessa' then
    if p_data_prometida is null then
      raise exception 'Informe a data prometida para o pagamento.';
    end if;
    if p_data_prometida <= v_hoje then
      raise exception 'A data prometida precisa ser futura.';
    end if;
    if p_data_prometida > v_hoje + 90 then
      raise exception 'A data prometida não pode passar de 90 dias.';
    end if;
    update rec_titulos set estagio = 'promessa', regua_pausada_ate = p_data_prometida where id = any(v_ids);
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar esta promessa (é preciso ser operador do Financeiro).';
    end if;
    insert into rec_promessas (titulo_id, data_prometida, valor_prometido)
    select t.id, p_data_prometida, t.valor from rec_titulos t where t.id = any(v_ids);
    v_tipo := 'promessa';
    v_texto := 'Cobrança ' || 'D+' || p_marco || ': o cliente prometeu pagar em ' || to_char(p_data_prometida, 'DD/MM/YYYY') || ' (' || v_canal_txt || '). A régua fica pausada até essa data.';
  elsif p_resultado = 'contestou' then
    if length(trim(coalesce(p_descricao, ''))) < 5 then
      raise exception 'Informe o motivo da contestação.';
    end if;
    update rec_titulos set contestado = true where id = any(v_ids);
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar esta contestação (é preciso ser operador do Financeiro).';
    end if;
    v_tipo := 'contestacao';
    v_texto := 'Cobrança D+' || p_marco || ': o cliente contestou a cobrança (' || v_canal_txt || '). A régua fica pausada para estes títulos.';
  else
    v_tipo := 'cobranca';
    v_texto := 'Cobrança D+' || p_marco || ' enviada ' || v_canal_txt || '.';
  end if;
  if nullif(trim(coalesce(p_descricao, '')), '') is not null then
    v_texto := v_texto || ' ' || trim(p_descricao);
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, p_canal, v_tipo, v_texto, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  -- A pendência do marco, DESTA UNIDADE, acaba: a cobrança foi feita (ou a régua foi pausada).
  update pendencias set status = 'concluida'
   where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
     and titulo like 'Cobrar D+' || p_marco || ':%' and status in ('aberta', 'em_andamento')
     and (titulo like '%(Filial Contagem)%') = (v_unidade = 'contagem');
  get diagnostics v_concluidas = row_count;

  return jsonb_build_object('parcelas', cardinality(v_ids), 'pendencias_concluidas', v_concluidas);
end $$;
