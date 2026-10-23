-- =========================================================
-- Neo Admin — 0183 Intimações de cartório: situação do título no portal do 4º Ofício.
-- Primeiro uso (23/10/2026): o aviso "Avise-me" da CENPROT repete por dias apontamentos antigos, e 9 protocolos já PAGOS ou
-- PROTESTADOS entraram como "Intimação identificada". O portal diz a situação (intimado/pago/protestado); agora ela é gravada:
--   pago       → a intimação sai da fila (descartada, com o motivo) se ainda está só identificada;
--   protestado → vai para "Revisão necessária" (o cancelamento do protesto é tratado fora deste fluxo), com pendência crítica,
--                se está identificada ou com o título escolhido (antes da proposta).
-- Daí em diante (título escolhido, proposta, adiantamento, NF…) só a situação fica registrada: pagar no cartório é o caminho normal.
-- Especificação: docs/modulos/financeiro-intimacoes-cartorio.md, regra 1.
-- =========================================================

alter table fin_intimacoes add column situacao_cartorio text;
comment on column fin_intimacoes.situacao_cartorio is 'Situação no portal do 4º Ofício na última leitura: intimado, pago, protestado (null = não lido no portal).';

create or replace function fin_int_registrar_leitura(p_caixa text, p_emails jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email jsonb;
  v_int jsonb;
  v_id uuid;
  v_novas int := 0;
  v_repetidas int := 0;
  v_emails int := 0;
  v_ja_lidos int := 0;
  v_encerradas int := 0;
  v_empresa uuid;
  v_sit text;
  v_status fin_int_status;
  v_motivo text;
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
      v_sit := nullif(v_int ->> 'situacaoCartorio', '');
      v_status := case v_sit when 'pago' then 'descartada'::fin_int_status when 'protestado' then 'revisao'::fin_int_status else 'identificada'::fin_int_status end;
      v_motivo := case v_sit
        when 'pago' then 'O portal do 4º Ofício informa que o título já foi PAGO no cartório.'
        when 'protestado' then 'O portal do 4º Ofício informa que o título foi PROTESTADO: tratar o cancelamento do protesto fora deste fluxo.'
      end;
      select id into v_empresa from empresas
       where ativa and regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = regexp_replace(coalesce(v_int ->> 'devedorDocumento', ''), '\D', '', 'g')
         and coalesce(v_int ->> 'devedorDocumento', '') <> ''
       limit 1;
      v_id := null;
      insert into fin_intimacoes (chave, origem, empresa_id, cartorio, protocolo, data_protocolo, localizador, link_intimacao,
                                  credor_documento, credor_nome, devedor_documento, especie, numero_titulo, valor_titulo, vencimento_titulo,
                                  data_limite, valor_custas, valor_total_cartorio, dados_portal_em, situacao_cartorio, status, motivo)
      values (v_int ->> 'chave', v_int ->> 'origem', v_empresa, v_int ->> 'cartorio', v_int ->> 'protocolo', (v_int ->> 'dataProtocolo')::date,
              v_int ->> 'localizador', v_int ->> 'link', left(v_int ->> 'credorDocumento', 18), v_int ->> 'credorNome',
              left(v_int ->> 'devedorDocumento', 18), v_int ->> 'especie', v_int ->> 'numeroTitulo', (v_int ->> 'valorTitulo')::numeric(14,2),
              (v_int ->> 'vencimentoTitulo')::date, (v_int ->> 'dataLimite')::date, nullif((v_int ->> 'valorCustas')::numeric(14,2), 0),
              (v_int ->> 'valorTotalCartorio')::numeric(14,2), case when v_int ->> 'dataLimite' is not null then now() end,
              v_sit, v_status, v_motivo)
      on conflict (chave) do nothing
      returning id into v_id;
      if v_id is not null then
        v_novas := v_novas + 1;
        select * into r from fin_intimacoes where id = v_id;
        if r.status = 'identificada' then
          perform fin_int_trocar_pendencia(v_id,
            'Intimação de protesto: ' || fin_int_rotulo(r),
            case when r.data_limite is not null
                 then 'Protocolo ' || r.protocolo || ', prazo ' || to_char(r.data_limite, 'DD/MM/YYYY') || ' (lido do portal do cartório). Confira e localize o título no Consistem.'
                 when r.origem = 'cartorio'
                 then 'Chegou intimação do 4º Ofício, mas o portal não pôde ser lido. Abra o link, informe os dados e localize o título no Consistem.'
                 else 'Apontamento na CENPROT (protocolo ' || r.protocolo || '). O prazo e as custas chegam com a intimação do cartório.' end,
            'alta');
        elsif r.status = 'revisao' then
          perform fin_int_trocar_pendencia(v_id, 'Título protestado: ' || fin_int_rotulo(r), r.motivo, 'critica');
        else
          v_encerradas := v_encerradas + 1;
        end if;
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
        if v_sit is not null then
          update fin_intimacoes set situacao_cartorio = v_sit where id = v_id and situacao_cartorio is distinct from v_sit;
          -- Pago antes de qualquer tratamento (só identificada): sai da fila. Protestado (identificada ou com o título já
          -- escolhido, antes da proposta): vai à revisão. Daí em diante, só a situação fica registrada.
          if v_sit in ('pago', 'protestado') then
            update fin_intimacoes set status = v_status, motivo = v_motivo
             where id = v_id and (status = 'identificada' or (v_sit = 'protestado' and status = 'titulo_localizado'))
            returning * into r;
            if found then
              v_encerradas := v_encerradas + 1;
              if v_sit = 'protestado' then
                perform fin_int_trocar_pendencia(v_id, 'Título protestado: ' || fin_int_rotulo(r), v_motivo, 'critica');
              else
                perform fin_int_trocar_pendencia(v_id, null, null, 'normal');
              end if;
            end if;
          end if;
        end if;
      end if;
      insert into fin_intimacao_origens (intimacao_id, message_id) values (v_id, v_email ->> 'messageId') on conflict do nothing;
    end loop;
  end loop;
  return jsonb_build_object('emails', v_emails, 'jaLidos', v_ja_lidos, 'novas', v_novas, 'repetidas', v_repetidas, 'encerradas', v_encerradas);
end $$;
revoke all on function fin_int_registrar_leitura(text, jsonb) from public, anon, authenticated;
grant execute on function fin_int_registrar_leitura(text, jsonb) to service_role;

-- A view lista as colunas de fin_intimacoes (i.*): recriada para incluir situacao_cartorio (a posição das colunas muda,
-- então não dá para "create or replace").
drop view fin_int_vw_intimacoes;
create view fin_int_vw_intimacoes with (security_invoker = true) as
select i.*, e.nome_curto as empresa_nome,
       pp.nome as proposto_por_nome, pa.nome as aprovado_por_nome, pc.nome as adiantamento_confirmado_por_nome,
       (select count(*)::int from fin_intimacao_origens o where o.intimacao_id = i.id) as emails
  from fin_intimacoes i
  left join empresas e on e.id = i.empresa_id
  left join perfis pp on pp.id = i.proposto_por
  left join perfis pa on pa.id = i.aprovado_por
  left join perfis pc on pc.id = i.adiantamento_confirmado_por;
