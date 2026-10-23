-- =========================================================
-- Neo Admin — 0181 Financeiro > Intimações de cartório (Agente 01). Especificação: docs/modulos/financeiro-intimacoes-cartorio.md
-- Fluxo: e-mail (4º Ofício ou aviso CENPROT) → intimação identificada → título do Contas a Pagar localizado → novo vencimento
-- proposto (operador) → aprovado (gestor) → alterado no Consistem pela API (só a data, conferida) → adiantamento das custas ao
-- cartório LANÇADO À MÃO no Consistem e confirmado pela pessoa → NF de serviço do cartório → consignação → concluída.
-- O Neo Admin NUNCA cria o adiantamento pela API (a inclusão tipo A não sai igual à da tela; seção 9 da especificação).
-- Duas chaves começam DESLIGADAS: a leitura agendada do Gmail e a alteração do vencimento no ERP.
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('financeiro.intimacoes', 'financeiro', 'Intimações de cartório', true)
on conflict (codigo) do nothing;

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.intimacoes.ler_gmail', 'false',
   'Intimações de cartório: ler o Gmail a cada 30 minutos (dias úteis). Ligar depois de autorizar a caixa (scripts/gmail-autorizar.mjs --leitura).'),
  ('financeiro.intimacoes.alterar_vencimento_no_erp', 'false',
   'Intimações de cartório: alterar o vencimento do título no Consistem pela API depois da aprovação do gestor. Desligado = a aprovação é recusada.'),
  ('financeiro.intimacoes.cartorios',
   '{"CUIABÁ 04": {"nome": "4º Ofício de Protesto de Títulos de Cuiabá/MT", "codFornecedor": null}}',
   'Intimações de cartório: cartório (como a CENPROT o chama) → nome e código de fornecedor no Consistem, para a tarefa do adiantamento.')
on conflict (chave) do nothing;

create function fin_int_chave_ligada(p_chave text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select valor from configuracoes where chave = p_chave), 'false'::jsonb) = 'true'::jsonb
$$;

create function fin_int_exigir(p_nivel nivel_acesso) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', p_nivel) then
    raise exception 'Somente % do Financeiro (ou acima) faz isto.', p_nivel;
  end if;
end $$;

-- 1) Intimações ----------------------------------------------------------------------------------------------------------------
-- Status = a etapa em que a intimação ESTÁ. "Vencimento alterado" e "adiantamento confirmado" são fatos com data e autor
-- (vencimento_alterado_em, adiantamento_confirmado_em), não etapas de espera: ao acontecerem, a intimação passa à etapa seguinte.
create type fin_int_status as enum (
  'identificada',          -- veio do e-mail; falta conferir os dados e localizar o título
  'titulo_localizado',     -- título do Contas a Pagar escolhido; falta propor o novo vencimento
  'aguardando_aprovacao',  -- novo vencimento proposto; falta o gestor aprovar
  'adiantamento_pendente', -- vencimento alterado e conferido no Consistem; falta lançar À MÃO o adiantamento ao cartório
  'nf_pendente',           -- adiantamento confirmado pela pessoa; falta a NF de serviço do cartório
  'consignacao_pendente',  -- NF registrada; falta consignar (abater) o adiantamento
  'concluida',
  'revisao',               -- erro ou dúvida (ex.: o Consistem recusou ou a conferência falhou): alguém precisa olhar
  'descartada'             -- não se aplica, duplicada ou mesclada (motivo obrigatório)
);

create table fin_intimacoes (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,                       -- protocolo:<cartório>:<protocolo> (portal e CENPROT) | localizador:<uuid> (portal falhou)
  origem text not null check (origem in ('cartorio', 'cenprot')),
  empresa_id uuid references empresas(id),
  cartorio text not null,
  protocolo text,
  data_protocolo date,
  localizador text,
  link_intimacao text,
  credor_documento varchar(18),
  credor_nome text,
  devedor_documento varchar(18),
  especie text,
  numero_titulo text,
  valor_titulo numeric(14,2),
  vencimento_titulo date,
  -- prazo e custas: lidos do portal do 4º Ofício (dados_portal_em) ou informados/corrigidos pela pessoa (dados_informados_*).
  -- Custas do portal = total no cartório − saldo do título (o portal não mostra a composição); a pessoa confere ao propor.
  data_limite date,
  valor_custas numeric(14,2) check (valor_custas is null or valor_custas > 0),
  valor_total_cartorio numeric(14,2),
  dados_portal_em timestamptz,
  dados_informados_por uuid references perfis(id),
  dados_informados_em timestamptz,
  -- título do Contas a Pagar
  cod_lancamento text check (cod_lancamento is null or cod_lancamento ~ '^\d{1,12}$'),
  titulo jsonb,                                      -- foto do título no momento da escolha (fornecedor, documento, vencimento, valor)
  titulo_escolhido_por uuid references perfis(id),
  titulo_escolhido_em timestamptz,
  -- vencimento
  nova_data_vencimento date,
  proposto_por uuid references perfis(id),
  proposto_em timestamptz,
  aprovado_por uuid references perfis(id),
  aprovado_em timestamptz,
  vencimento_alterado_em timestamptz,
  -- adiantamento (manual), NF e consignação: confirmações da PESSOA, nunca do Consistem
  adiantamento_confirmado_por uuid references perfis(id),
  adiantamento_confirmado_em timestamptz,
  adiantamento_referencia text check (adiantamento_referencia is null or length(adiantamento_referencia) <= 50),
  nf_numero text check (nf_numero is null or length(nf_numero) <= 50),
  nf_registrada_por uuid references perfis(id),
  nf_registrada_em timestamptz,
  consignacao_referencia text check (consignacao_referencia is null or length(consignacao_referencia) <= 50),
  consignacao_por uuid references perfis(id),
  consignacao_em timestamptz,
  status fin_int_status not null default 'identificada',
  motivo text,                                       -- da revisão, do descarte ou da devolução da proposta
  mesclada_com uuid references fin_intimacoes(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table fin_intimacoes is 'Intimações de protesto lidas do Gmail e o tratamento de cada uma (vencimento, adiantamento manual, NF, consignação). Nunca apagadas.';
-- Um título do Contas a Pagar não fica em duas intimações em andamento.
create unique index uq_fin_intimacoes_titulo_ativo on fin_intimacoes (empresa_id, cod_lancamento)
  where cod_lancamento is not null and status not in ('concluida', 'descartada');
create index idx_fin_intimacoes_status on fin_intimacoes (status);

create trigger trg_fin_intimacoes_atualizado before update on fin_intimacoes for each row execute function fn_atualizado_em();
create trigger trg_fin_intimacoes_sem_delete before delete on fin_intimacoes for each row execute function fn_bloquear_delete();
create trigger trg_aud_fin_intimacoes after insert or update on fin_intimacoes for each row execute function fn_auditoria();

-- 2) E-mails lidos (prova da origem; o mesmo e-mail nunca é lido duas vezes) -------------------------------------------------
create table fin_intimacao_emails (
  message_id text primary key,
  thread_id text,
  caixa text not null,
  tipo text not null check (tipo in ('cartorio', 'cenprot')),
  remetente text,
  assunto text,
  recebido_em timestamptz,
  intimacoes int not null default 0,                 -- quantas intimações o e-mail trouxe (0 = nada reconhecível)
  lido_em timestamptz not null default now()
);
create table fin_intimacao_origens (
  intimacao_id uuid not null references fin_intimacoes(id),
  message_id text not null references fin_intimacao_emails(message_id),
  primary key (intimacao_id, message_id)
);
create trigger trg_fin_intimacao_emails_sem_delete before delete on fin_intimacao_emails for each row execute function fn_bloquear_delete();

-- 3) Alterações de vencimento no Consistem (prova: antes, depois, quem aprovou) ---------------------------------------------
create type fin_int_situacao_envio as enum ('reservado', 'enviando', 'concluido', 'erro');

create table fin_intimacao_vencimentos (
  id uuid primary key default gen_random_uuid(),
  intimacao_id uuid not null references fin_intimacoes(id),
  empresa_id uuid not null references empresas(id),
  cod_lancamento text not null check (cod_lancamento ~ '^\d{1,12}$'),
  alteracao jsonb not null,                          -- só { dataVencimento }
  situacao fin_int_situacao_envio not null default 'reservado',
  ja_estava boolean not null default false,          -- o título já tinha a data: nada foi enviado
  antes jsonb,
  depois jsonb,
  resposta jsonb,
  erro text,
  aprovado_por uuid not null references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  concluido_em timestamptz,
  check (alteracao ? 'dataVencimento' and alteracao - 'dataVencimento' = '{}'::jsonb)
);
comment on table fin_intimacao_vencimentos is 'Alterações de vencimento feitas no Consistem pelas intimações de cartório: antes, depois, quem aprovou. Nunca apagadas.';
create unique index uq_fin_intimacao_vencimentos_ativo on fin_intimacao_vencimentos (intimacao_id) where situacao in ('reservado', 'enviando');

create function fn_fin_int_vencimento_regras() returns trigger language plpgsql as $$
begin
  if (new.intimacao_id, new.empresa_id, new.cod_lancamento, new.alteracao, new.aprovado_por, new.criado_em)
     is distinct from (old.intimacao_id, old.empresa_id, old.cod_lancamento, old.alteracao, old.aprovado_por, old.criado_em) then
    raise exception 'A alteração de vencimento é imutável (título, data, quem aprovou e quando).';
  end if;
  if old.situacao in ('concluido', 'erro') then raise exception 'Esta alteração já foi concluída.'; end if;
  if new.situacao <> old.situacao and not (
       (old.situacao = 'reservado' and new.situacao in ('enviando', 'erro')) or
       (old.situacao = 'enviando' and new.situacao in ('concluido', 'erro'))) then
    raise exception 'Mudança de situação inválida: % → %.', old.situacao, new.situacao;
  end if;
  return new;
end $$;
create trigger trg_fin_intimacao_vencimentos_regras before update on fin_intimacao_vencimentos for each row execute function fn_fin_int_vencimento_regras();
create trigger trg_fin_intimacao_vencimentos_sem_delete before delete on fin_intimacao_vencimentos for each row execute function fn_bloquear_delete();
create trigger trg_aud_fin_intimacao_vencimentos after insert or update on fin_intimacao_vencimentos for each row execute function fn_auditoria();

-- RLS: leitura para quem tem o Financeiro; gravação só pelas funções abaixo.
alter table fin_intimacoes enable row level security;
alter table fin_intimacao_emails enable row level security;
alter table fin_intimacao_origens enable row level security;
alter table fin_intimacao_vencimentos enable row level security;
create policy fin_intimacoes_ler on fin_intimacoes for select to authenticated using (tem_acesso_area('financeiro'));
create policy fin_intimacao_emails_ler on fin_intimacao_emails for select to authenticated using (tem_acesso_area('financeiro'));
create policy fin_intimacao_origens_ler on fin_intimacao_origens for select to authenticated using (tem_acesso_area('financeiro'));
create policy fin_intimacao_vencimentos_ler on fin_intimacao_vencimentos for select to authenticated using (tem_acesso_area('financeiro'));

create view fin_int_vw_intimacoes with (security_invoker = true) as
select i.*, e.nome_curto as empresa_nome,
       pp.nome as proposto_por_nome, pa.nome as aprovado_por_nome, pc.nome as adiantamento_confirmado_por_nome,
       (select count(*)::int from fin_intimacao_origens o where o.intimacao_id = i.id) as emails
  from fin_intimacoes i
  left join empresas e on e.id = i.empresa_id
  left join perfis pp on pp.id = i.proposto_por
  left join perfis pa on pa.id = i.aprovado_por
  left join perfis pc on pc.id = i.adiantamento_confirmado_por;

-- 4) Pendências (Fila do dia) ---------------------------------------------------------------------------------------------------
create function fin_int_trocar_pendencia(p_id uuid, p_titulo text, p_descricao text, p_criticidade criticidade) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pendencias set status = 'concluida', concluido_em = now(), concluido_por = auth.uid()
   where modulo = 'financeiro.intimacoes' and referencia_tabela = 'fin_intimacoes' and referencia_id = p_id
     and status in ('aberta', 'em_andamento') and (p_titulo is null or titulo <> p_titulo);
  if p_titulo is not null then
    insert into pendencias (modulo, empresa_id, titulo, descricao, criticidade, referencia_tabela, referencia_id, link)
    select 'financeiro.intimacoes', i.empresa_id, p_titulo, p_descricao, p_criticidade, 'fin_intimacoes', p_id, '/financeiro/intimacoes/' || p_id
      from fin_intimacoes i
     where i.id = p_id
       and not exists (select 1 from pendencias where modulo = 'financeiro.intimacoes' and referencia_tabela = 'fin_intimacoes'
                                                  and referencia_id = p_id and titulo = p_titulo and status in ('aberta', 'em_andamento'));
  end if;
end $$;
revoke all on function fin_int_trocar_pendencia(uuid, text, text, criticidade) from public, anon, authenticated;

create function fin_int_rotulo(i fin_intimacoes) returns text
language sql immutable as $$
  select coalesce(nullif(concat_ws(' · ', i.credor_nome, nullif('título ' || coalesce(i.numero_titulo, ''), 'título ')), ''),
                  'localizador ' || left(coalesce(i.localizador, '?'), 8))
$$;

-- 5) Leitura do Gmail (Edge Function fin-intimacoes-ler-gmail, service role) -------------------------------------------------
-- p_emails: [{ messageId, threadId, tipo, remetente, assunto, recebidoEm, intimacoes: [IntimacaoLida] }] (supabase/functions/_shared/intimacoes.ts).
-- E-mail já lido é ignorado; intimação com a mesma chave não é recriada (só ganha o e-mail como origem).
create function fin_int_registrar_leitura(p_caixa text, p_emails jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email jsonb;
  v_int jsonb;
  v_id uuid;
  v_nova boolean;
  v_novas int := 0;
  v_repetidas int := 0;
  v_emails int := 0;
  v_ja_lidos int := 0;
  v_empresa uuid;
  r fin_intimacoes;
begin
  if jsonb_typeof(p_emails) is distinct from 'array' then raise exception 'Lista de e-mails inválida.'; end if;
  for v_email in select * from jsonb_array_elements(p_emails) loop
    if coalesce(v_email ->> 'messageId', '') = '' or (v_email ->> 'tipo') not in ('cartorio', 'cenprot') then
      raise exception 'E-mail sem identificador ou de tipo desconhecido.';
    end if;
    if exists (select 1 from fin_intimacao_emails where message_id = v_email ->> 'messageId') then
      v_ja_lidos := v_ja_lidos + 1;
      continue;
    end if;
    insert into fin_intimacao_emails (message_id, thread_id, caixa, tipo, remetente, assunto, recebido_em, intimacoes)
    values (v_email ->> 'messageId', v_email ->> 'threadId', p_caixa, v_email ->> 'tipo', left(v_email ->> 'remetente', 200),
            left(v_email ->> 'assunto', 200), (v_email ->> 'recebidoEm')::timestamptz, jsonb_array_length(coalesce(v_email -> 'intimacoes', '[]')));
    v_emails := v_emails + 1;
    for v_int in select * from jsonb_array_elements(coalesce(v_email -> 'intimacoes', '[]')) loop
      select id into v_empresa from empresas
       where ativa and regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = regexp_replace(coalesce(v_int ->> 'devedorDocumento', ''), '\D', '', 'g')
         and coalesce(v_int ->> 'devedorDocumento', '') <> ''
       limit 1;
      v_id := null;
      insert into fin_intimacoes (chave, origem, empresa_id, cartorio, protocolo, data_protocolo, localizador, link_intimacao,
                                  credor_documento, credor_nome, devedor_documento, especie, numero_titulo, valor_titulo, vencimento_titulo,
                                  data_limite, valor_custas, valor_total_cartorio, dados_portal_em)
      values (v_int ->> 'chave', v_int ->> 'origem', v_empresa, v_int ->> 'cartorio', v_int ->> 'protocolo', (v_int ->> 'dataProtocolo')::date,
              v_int ->> 'localizador', v_int ->> 'link', left(v_int ->> 'credorDocumento', 18), v_int ->> 'credorNome',
              left(v_int ->> 'devedorDocumento', 18), v_int ->> 'especie', v_int ->> 'numeroTitulo', (v_int ->> 'valorTitulo')::numeric(14,2),
              (v_int ->> 'vencimentoTitulo')::date, (v_int ->> 'dataLimite')::date, nullif((v_int ->> 'valorCustas')::numeric(14,2), 0),
              (v_int ->> 'valorTotalCartorio')::numeric(14,2), case when v_int ->> 'dataLimite' is not null then now() end)
      on conflict (chave) do nothing
      returning id into v_id;
      v_nova := v_id is not null;
      if v_nova then
        v_novas := v_novas + 1;
        select * into r from fin_intimacoes where id = v_id;
        perform fin_int_trocar_pendencia(v_id,
          'Intimação de protesto: ' || fin_int_rotulo(r),
          case when r.data_limite is not null
               then 'Protocolo ' || r.protocolo || ', prazo ' || to_char(r.data_limite, 'DD/MM/YYYY') || ' (lido do portal do cartório). Confira e localize o título no Consistem.'
               when r.origem = 'cartorio'
               then 'Chegou intimação do 4º Ofício, mas o portal não pôde ser lido. Abra o link, informe os dados e localize o título no Consistem.'
               else 'Apontamento na CENPROT (protocolo ' || r.protocolo || '). O prazo e as custas chegam com a intimação do cartório.' end,
          'alta');
      else
        v_repetidas := v_repetidas + 1;
        select coalesce(mesclada_com, id) into v_id from fin_intimacoes where chave = v_int ->> 'chave';
        -- O mesmo protocolo pela outra fonte completa o que faltava (nunca sobrescreve o que a pessoa informou ou escolheu).
        update fin_intimacoes i
           set localizador = coalesce(i.localizador, v_int ->> 'localizador'),
               link_intimacao = coalesce(i.link_intimacao, v_int ->> 'link'),
               credor_documento = case when coalesce(i.credor_documento, '*') like '%*%' and coalesce(v_int ->> 'credorDocumento', '*') not like '%*%'
                                       then left(v_int ->> 'credorDocumento', 18) else coalesce(i.credor_documento, left(v_int ->> 'credorDocumento', 18)) end,
               credor_nome = coalesce(i.credor_nome, v_int ->> 'credorNome'),
               devedor_documento = coalesce(i.devedor_documento, left(v_int ->> 'devedorDocumento', 18)),
               empresa_id = coalesce(i.empresa_id, v_empresa),
               numero_titulo = coalesce(i.numero_titulo, v_int ->> 'numeroTitulo'),
               vencimento_titulo = coalesce(i.vencimento_titulo, (v_int ->> 'vencimentoTitulo')::date),
               data_limite = coalesce(i.data_limite, (v_int ->> 'dataLimite')::date),
               valor_custas = coalesce(i.valor_custas, nullif((v_int ->> 'valorCustas')::numeric(14,2), 0)),
               valor_total_cartorio = coalesce(i.valor_total_cartorio, (v_int ->> 'valorTotalCartorio')::numeric(14,2)),
               dados_portal_em = coalesce(i.dados_portal_em, case when v_int ->> 'dataLimite' is not null then now() end)
         where i.id = v_id and i.status in ('identificada', 'titulo_localizado', 'revisao')
           and (i.localizador is null or i.data_limite is null or i.valor_custas is null or i.credor_documento is null or i.credor_documento like '%*%');
      end if;
      insert into fin_intimacao_origens (intimacao_id, message_id) values (v_id, v_email ->> 'messageId') on conflict do nothing;
    end loop;
  end loop;
  return jsonb_build_object('emails', v_emails, 'jaLidos', v_ja_lidos, 'novas', v_novas, 'repetidas', v_repetidas);
end $$;
revoke all on function fin_int_registrar_leitura(text, jsonb) from public, anon, authenticated;
grant execute on function fin_int_registrar_leitura(text, jsonb) to service_role;

-- Fornecedor do Consistem pelo CPF/CNPJ (função PÚBLICA do Contas a Pagar, documentada em financeiro-contas-pagar.md):
-- o módulo de intimações acha o credor sem ler a tabela interna cap_fornecedores.
-- Documento completo: igualdade dos dígitos. Documento MASCARADO (o portal do 4º Ofício mostra "13.***.***/****-09"): os dígitos
-- visíveis têm de bater E o nome tem de conferir (um começa pelo outro, com 5 ou mais letras).
create function cap_fornecedores_por_documento(p_empresa uuid, p_documento text, p_nome text default null) returns table (cod_fornecedor text, nome text, ativo boolean)
language sql stable security definer set search_path = public as $$
  select f.cod_fornecedor, f.nome, f.ativo
    from cap_fornecedores f
   where f.empresa_id = p_empresa
     and (auth.uid() is null or tem_acesso_area('financeiro'))
     and case
       when coalesce(p_documento, '') like '%*%' then
         length(regexp_replace(p_documento, '[^0-9*]', '', 'g')) in (11, 14)
         and regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') like replace(regexp_replace(p_documento, '[^0-9*]', '', 'g'), '*', '_')
         and length(trim(coalesce(p_nome, ''))) >= 5
         and (upper(f.nome) like upper(trim(p_nome)) || '%' or upper(trim(p_nome)) like upper(f.nome) || '%')
       else
         length(regexp_replace(coalesce(p_documento, ''), '\D', '', 'g')) >= 11
         and regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') = regexp_replace(p_documento, '\D', '', 'g')
     end
   order by f.ativo desc, f.cod_fornecedor
$$;
revoke all on function cap_fornecedores_por_documento(uuid, text, text) from public, anon;
grant execute on function cap_fornecedores_por_documento(uuid, text, text) to authenticated, service_role;

-- 6) Ações da pessoa ------------------------------------------------------------------------------------------------------------
create function fin_int_carregar(p_id uuid, p_status fin_int_status[]) returns fin_intimacoes
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
begin
  select * into r from fin_intimacoes where id = p_id for update;
  if r.id is null then raise exception 'Intimação não encontrada.'; end if;
  if not (r.status = any (p_status)) then raise exception 'A intimação está em "%": esta ação não vale nesta etapa.', r.status; end if;
  return r;
end $$;
revoke all on function fin_int_carregar(uuid, fin_int_status[]) from public, anon, authenticated;

-- Dados conferidos/informados a partir da intimação. Trocar credor ou número desfaz a escolha do título.
create function fin_int_informar_dados(p_id uuid, p_empresa uuid, p_credor_documento text, p_credor_nome text, p_numero text,
                                       p_valor numeric, p_vencimento date, p_data_limite date, p_custas numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
  v_trocou boolean;
begin
  perform fin_int_exigir('operador');
  r := fin_int_carregar(p_id, array['identificada', 'titulo_localizado', 'revisao']::fin_int_status[]);
  if p_empresa is null or not exists (select 1 from empresas where id = p_empresa and ativa) then raise exception 'Escolha a empresa devedora.'; end if;
  if p_custas is not null and p_custas <= 0 then raise exception 'As custas precisam ser maiores que zero.'; end if;
  if p_valor is not null and p_valor <= 0 then raise exception 'O valor do título precisa ser maior que zero.'; end if;
  v_trocou := (p_empresa, nullif(regexp_replace(coalesce(p_credor_documento, ''), '\D', '', 'g'), ''), nullif(trim(p_numero), ''))
              is distinct from (r.empresa_id, nullif(regexp_replace(coalesce(r.credor_documento, ''), '\D', '', 'g'), ''), r.numero_titulo);
  update fin_intimacoes
     set empresa_id = p_empresa, credor_documento = nullif(trim(p_credor_documento), ''), credor_nome = nullif(trim(p_credor_nome), ''),
         numero_titulo = nullif(trim(p_numero), ''), valor_titulo = p_valor, vencimento_titulo = p_vencimento,
         data_limite = p_data_limite, valor_custas = p_custas, dados_informados_por = auth.uid(), dados_informados_em = now(),
         cod_lancamento = case when v_trocou then null else cod_lancamento end,
         titulo = case when v_trocou then null else titulo end,
         status = case when v_trocou or r.cod_lancamento is null then 'identificada'::fin_int_status else 'titulo_localizado'::fin_int_status end,
         motivo = case when r.status = 'revisao' then null else motivo end
   where id = p_id;
end $$;

-- Título escolhido entre os que a consulta ao Consistem devolveu (foto em p_titulo).
create function fin_int_escolher_titulo(p_id uuid, p_cod text, p_titulo jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
begin
  perform fin_int_exigir('operador');
  r := fin_int_carregar(p_id, array['identificada', 'titulo_localizado']::fin_int_status[]);
  if r.empresa_id is null then raise exception 'Informe a empresa devedora antes de escolher o título.'; end if;
  if coalesce(p_cod, '') !~ '^\d{1,12}$' then raise exception 'Código de lançamento inválido.'; end if;
  if jsonb_typeof(p_titulo) is distinct from 'object' then raise exception 'Título inválido.'; end if;
  begin
    update fin_intimacoes set cod_lancamento = p_cod, titulo = p_titulo, titulo_escolhido_por = auth.uid(), titulo_escolhido_em = now(),
                              status = 'titulo_localizado'
     where id = p_id;
  exception when unique_violation then
    raise exception 'O título % já está em outra intimação em andamento.', p_cod;
  end;
  perform fin_int_trocar_pendencia(p_id, 'Intimação de protesto: ' || fin_int_rotulo(r),
    'Título localizado. Proponha o novo vencimento (prazo da intimação) para o gestor aprovar.', 'alta');
end $$;

-- Proposta: novo vencimento = prazo informado da intimação. Exige título, prazo e custas.
create function fin_int_propor_vencimento(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
begin
  perform fin_int_exigir('operador');
  r := fin_int_carregar(p_id, array['titulo_localizado']::fin_int_status[]);
  if r.cod_lancamento is null then raise exception 'Escolha o título antes.'; end if;
  if r.data_limite is null then raise exception 'Informe o prazo para pagamento que consta na intimação.'; end if;
  if r.valor_custas is null then raise exception 'Informe o valor das custas que consta na intimação.'; end if;
  if r.data_limite < (now() at time zone 'America/Cuiaba')::date then raise exception 'O prazo informado (%) já passou.', to_char(r.data_limite, 'DD/MM/YYYY'); end if;
  update fin_intimacoes set nova_data_vencimento = r.data_limite, proposto_por = auth.uid(), proposto_em = now(),
                            status = 'aguardando_aprovacao', motivo = null
   where id = p_id;
  perform fin_int_trocar_pendencia(p_id, 'Aprovar novo vencimento: ' || fin_int_rotulo(r),
    'Título ' || r.cod_lancamento || ' com vencimento proposto para ' || to_char(r.data_limite, 'DD/MM/YYYY') || ' (prazo da intimação). Aprovação do gestor.', 'alta');
end $$;

create function fin_int_devolver_proposta(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
begin
  perform fin_int_exigir('gestor');
  r := fin_int_carregar(p_id, array['aguardando_aprovacao']::fin_int_status[]);
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da devolução.'; end if;
  update fin_intimacoes set status = 'titulo_localizado', nova_data_vencimento = null, proposto_por = null, proposto_em = null, motivo = trim(p_motivo)
   where id = p_id;
  perform fin_int_trocar_pendencia(p_id, 'Intimação de protesto: ' || fin_int_rotulo(r), 'Proposta devolvida pelo gestor: ' || trim(p_motivo), 'alta');
end $$;

-- Aprovação do gestor: reserva a alteração (a Edge Function fin-intimacoes-consistem envia). Devolve o id da alteração.
create function fin_int_aprovar_vencimento(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
  v_id uuid;
begin
  perform fin_int_exigir('gestor');
  if not fin_int_chave_ligada('financeiro.intimacoes.alterar_vencimento_no_erp') then
    raise exception 'A alteração do vencimento no Consistem está desligada (Configurações: financeiro.intimacoes.alterar_vencimento_no_erp).';
  end if;
  r := fin_int_carregar(p_id, array['aguardando_aprovacao']::fin_int_status[]);
  begin
    insert into fin_intimacao_vencimentos (intimacao_id, empresa_id, cod_lancamento, alteracao)
    values (p_id, r.empresa_id, r.cod_lancamento, jsonb_build_object('dataVencimento', to_char(r.nova_data_vencimento, 'YYYY-MM-DD')))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já há uma alteração de vencimento em andamento para esta intimação.';
  end;
  update fin_intimacoes set aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
  return v_id;
end $$;

-- Adiantamento lançado À MÃO no Consistem: a pessoa confirma (referência opcional: o código do lançamento, se tiver).
create function fin_int_confirmar_adiantamento(p_id uuid, p_referencia text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
begin
  perform fin_int_exigir('operador');
  r := fin_int_carregar(p_id, array['adiantamento_pendente']::fin_int_status[]);
  update fin_intimacoes set adiantamento_confirmado_por = auth.uid(), adiantamento_confirmado_em = now(),
                            adiantamento_referencia = nullif(trim(p_referencia), ''), status = 'nf_pendente'
   where id = p_id;
  perform fin_int_trocar_pendencia(p_id, 'NF do cartório: ' || fin_int_rotulo(r),
    'Adiantamento das custas confirmado. Quando o cartório emitir a NF de serviço, registre o número aqui.', 'normal');
end $$;

create function fin_int_registrar_nf(p_id uuid, p_numero text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
begin
  perform fin_int_exigir('operador');
  r := fin_int_carregar(p_id, array['nf_pendente']::fin_int_status[]);
  if length(trim(coalesce(p_numero, ''))) = 0 then raise exception 'Informe o número da NF de serviço.'; end if;
  update fin_intimacoes set nf_numero = trim(p_numero), nf_registrada_por = auth.uid(), nf_registrada_em = now(), status = 'consignacao_pendente'
   where id = p_id;
  perform fin_int_trocar_pendencia(p_id, 'Consignar adiantamento: ' || fin_int_rotulo(r),
    'NF ' || trim(p_numero) || ' registrada. Consigne (abata) o adiantamento das custas no Consistem e confirme aqui.', 'normal');
end $$;

create function fin_int_confirmar_consignacao(p_id uuid, p_referencia text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fin_int_exigir('operador');
  perform fin_int_carregar(p_id, array['consignacao_pendente']::fin_int_status[]);
  update fin_intimacoes set consignacao_referencia = nullif(trim(p_referencia), ''), consignacao_por = auth.uid(), consignacao_em = now(), status = 'concluida'
   where id = p_id;
  perform fin_int_trocar_pendencia(p_id, null, null, 'normal');
end $$;

create function fin_int_descartar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fin_int_exigir('operador');
  perform fin_int_carregar(p_id, array['identificada', 'titulo_localizado', 'revisao']::fin_int_status[]);
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do descarte.'; end if;
  update fin_intimacoes set status = 'descartada', motivo = trim(p_motivo) where id = p_id;
  perform fin_int_trocar_pendencia(p_id, null, null, 'normal');
end $$;

-- A intimação do 4º Ofício (só localizador) e o apontamento da CENPROT são o mesmo protesto: junta na da CENPROT.
create function fin_int_mesclar(p_origem uuid, p_destino uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  o fin_intimacoes;
  d fin_intimacoes;
begin
  perform fin_int_exigir('operador');
  if p_origem = p_destino then raise exception 'Escolha outra intimação.'; end if;
  o := fin_int_carregar(p_origem, array['identificada', 'revisao']::fin_int_status[]);
  d := fin_int_carregar(p_destino, array['identificada', 'titulo_localizado', 'aguardando_aprovacao', 'adiantamento_pendente', 'nf_pendente', 'consignacao_pendente']::fin_int_status[]);
  if o.origem <> 'cartorio' or o.localizador is null then raise exception 'Só se junta a intimação do 4º Ofício (com localizador) a um apontamento.'; end if;
  if d.localizador is not null then raise exception 'A intimação de destino já tem localizador.'; end if;
  update fin_intimacoes set localizador = o.localizador, link_intimacao = o.link_intimacao where id = p_destino;
  insert into fin_intimacao_origens (intimacao_id, message_id) select p_destino, message_id from fin_intimacao_origens where intimacao_id = p_origem
  on conflict do nothing;
  update fin_intimacoes set status = 'descartada', mesclada_com = p_destino,
                            motivo = 'Juntada ao apontamento ' || coalesce('protocolo ' || d.protocolo, fin_int_rotulo(d))
   where id = p_origem;
  perform fin_int_trocar_pendencia(p_origem, null, null, 'normal');
end $$;

-- Depois de revisar (ex.: corrigir o complemento no Consistem), volta à conferência.
create function fin_int_retomar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r fin_intimacoes;
begin
  perform fin_int_exigir('operador');
  r := fin_int_carregar(p_id, array['revisao']::fin_int_status[]);
  update fin_intimacoes set status = case when r.cod_lancamento is null then 'identificada'::fin_int_status else 'titulo_localizado'::fin_int_status end,
                            nova_data_vencimento = null, proposto_por = null, proposto_em = null, aprovado_por = null, aprovado_em = null
   where id = p_id;
  perform fin_int_trocar_pendencia(p_id, 'Intimação de protesto: ' || fin_int_rotulo(r), 'Retomada depois da revisão: ' || coalesce(r.motivo, ''), 'alta');
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'fin_int_informar_dados(uuid, uuid, text, text, text, numeric, date, date, numeric)', 'fin_int_escolher_titulo(uuid, text, jsonb)',
    'fin_int_propor_vencimento(uuid)', 'fin_int_devolver_proposta(uuid, text)', 'fin_int_aprovar_vencimento(uuid)',
    'fin_int_confirmar_adiantamento(uuid, text)', 'fin_int_registrar_nf(uuid, text)', 'fin_int_confirmar_consignacao(uuid, text)',
    'fin_int_descartar(uuid, text)', 'fin_int_mesclar(uuid, uuid)', 'fin_int_retomar(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 7) Envio da alteração de vencimento (Edge Function fin-intimacoes-consistem, service role) ---------------------------------
create function fin_int_iniciar_vencimento(p_id uuid) returns fin_intimacao_vencimentos
language plpgsql security definer set search_path = public as $$
declare
  v fin_intimacao_vencimentos;
begin
  update fin_intimacao_vencimentos set situacao = 'enviando', enviado_em = now() where id = p_id and situacao = 'reservado' returning * into v;
  if v.id is null then raise exception 'A alteração não está reservada.'; end if;
  return v;
end $$;

-- Sucesso só com a conferência (o depois lido do Consistem): a intimação vai para o adiantamento manual. Erro = revisão.
create function fin_int_concluir_vencimento(p_id uuid, p_ok boolean, p_ja_estava boolean, p_antes jsonb, p_depois jsonb, p_resposta jsonb, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v fin_intimacao_vencimentos;
  r fin_intimacoes;
  v_cartorio jsonb;
begin
  if p_ok and p_depois is null then raise exception 'Sem a leitura do título depois da alteração não há conferência.'; end if;
  update fin_intimacao_vencimentos
     set situacao = case when p_ok then 'concluido'::fin_int_situacao_envio else 'erro'::fin_int_situacao_envio end,
         ja_estava = coalesce(p_ja_estava, false), antes = p_antes, depois = p_depois, resposta = p_resposta,
         erro = case when p_ok then null else coalesce(nullif(trim(p_erro), ''), 'Erro não informado.') end, concluido_em = now()
   where id = p_id and situacao in ('reservado', 'enviando')
  returning * into v;
  if v.id is null then raise exception 'A alteração não está em envio.'; end if;
  select * into r from fin_intimacoes where id = v.intimacao_id for update;
  if p_ok then
    update fin_intimacoes set status = 'adiantamento_pendente', vencimento_alterado_em = now(), motivo = null where id = r.id;
    v_cartorio := (select valor -> r.cartorio from configuracoes where chave = 'financeiro.intimacoes.cartorios');
    perform fin_int_trocar_pendencia(r.id, 'Lançar adiantamento ao cartório: ' || fin_int_rotulo(r),
      'Vencimento do título ' || r.cod_lancamento || ' alterado para ' || to_char(r.nova_data_vencimento, 'DD/MM/YYYY') ||
      '. Lance À MÃO, na tela do Consistem, o adiantamento de R$ ' || translate(to_char(r.valor_custas, 'FM999,999,990.00'), ',.', '.,') || ' a ' ||
      coalesce(v_cartorio ->> 'nome', r.cartorio) || ' e confirme aqui.', 'alta');
  else
    update fin_intimacoes set status = 'revisao', motivo = left(coalesce(nullif(trim(p_erro), ''), 'Erro não informado.'), 500) where id = r.id;
    perform fin_int_trocar_pendencia(r.id, 'Revisar intimação: ' || fin_int_rotulo(r), 'A alteração do vencimento no Consistem falhou: ' || left(coalesce(p_erro, ''), 300), 'critica');
  end if;
end $$;
revoke all on function fin_int_iniciar_vencimento(uuid) from public, anon, authenticated;
revoke all on function fin_int_concluir_vencimento(uuid, boolean, boolean, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function fin_int_iniciar_vencimento(uuid) to service_role;
grant execute on function fin_int_concluir_vencimento(uuid, boolean, boolean, jsonb, jsonb, jsonb, text) to service_role;

-- 8) Leitura agendada (pg_cron + pg_net; mesmo Vault da sincronização: rec_sincronizar_url / rec_sincronizar_segredo) ----------
create function fin_int_chamar_leitura() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_segredo text;
  v_requisicao bigint;
begin
  if not fin_int_chave_ligada('financeiro.intimacoes.ler_gmail') then return null; end if;
  select replace(decrypted_secret, 'rec-sincronizar-consistem', 'fin-intimacoes-ler-gmail') into v_url from vault.decrypted_secrets where name = 'rec_sincronizar_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'rec_sincronizar_segredo';
  if v_url is null or v_segredo is null then
    raise warning 'Leitura das intimações sem configuração: faltam rec_sincronizar_url e/ou rec_sincronizar_segredo no Vault.';
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sincronizacao-segredo', v_segredo),
    body := '{"acao":"ler"}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_requisicao;
  return v_requisicao;
end $$;
revoke all on function fin_int_chamar_leitura() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Dias úteis, 07:05–18:35 de Cuiabá (UTC-4). Só chama a função com financeiro.intimacoes.ler_gmail ligada.
    perform cron.schedule('fin-intimacoes-ler-gmail-30min', '5,35 11-22 * * 1-5', 'select public.fin_int_chamar_leitura()');
  end if;
end $$;
