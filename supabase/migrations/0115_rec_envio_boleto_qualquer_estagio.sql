-- =========================================================
-- Neo Admin — 0115 Registrar o envio do boleto em qualquer título em aberto
-- Antes o envio só podia ser registrado em parcela `aguardando_boleto`: título anterior à esteira (`importado`) ou já enviado
-- não tinha como avançar nem como registrar um REENVIO. Agora:
--  - `aguardando_boleto` e `importado` passam para `boleto_enviado`;
--  - `boleto_enviado`, `confirmado_cliente`, `vencido` e `promessa` ficam no estágio em que estão (é um reenvio: só registra a
--    interação e atualiza a data do último envio);
--  - encerrado (pago, cancelado, renegociado), em renegociação e jurídico continuam recusados.
-- Continua exigindo o boleto anexado em cada parcela, numa transação, com a RLS de quem chama (operador do Financeiro).
-- =========================================================

create or replace function rec_marcar_boleto_enviado(p_titulos uuid[], p_canal canal, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_validos int;
  v_sem_boleto int;
  v_atualizados int;
  v_pendencias int := 0;
  v_n int;
  r record;
begin
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos uma parcela.';
  end if;

  select count(*) into v_validos from rec_titulos
   where id = any(v_ids) and estagio in ('aguardando_boleto', 'importado', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  if v_validos <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já está encerrada, em renegociação ou no jurídico (ou você não tem acesso a ela).';
  end if;

  select count(*) into v_sem_boleto from rec_titulos t
   where t.id = any(v_ids)
     and not exists (select 1 from anexos a where a.referencia_tabela = 'rec_titulos' and a.referencia_id = t.id and a.tipo = 'boleto');
  if v_sem_boleto > 0 then
    raise exception 'Anexe o boleto de cada parcela marcada antes de marcar como enviado.';
  end if;

  update rec_titulos
     set estagio = case when estagio in ('aguardando_boleto', 'importado') then 'boleto_enviado'::rec_estagio else estagio end,
         boleto_enviado_em = now()
   where id = any(v_ids)
     and estagio in ('aguardando_boleto', 'importado', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  get diagnostics v_atualizados = row_count;
  if v_atualizados <> cardinality(v_ids) then
    raise exception 'Você não tem permissão para marcar este envio (é preciso ser operador do Financeiro).';
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, p_canal, 'boleto_enviado', p_descricao, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  -- Conclui a pendência "Anexar boleto" de cada NF (ou título avulso) que não tem mais parcela aguardando.
  for r in
    select distinct t.nota_saida_id, case when t.nota_saida_id is null then t.id else null end as titulo_id
      from rec_titulos t where t.id = any(v_ids)
  loop
    if not exists (
      select 1 from rec_titulos x
       where x.estagio = 'aguardando_boleto'
         and ((r.nota_saida_id is not null and x.nota_saida_id = r.nota_saida_id) or (r.nota_saida_id is null and x.id = r.titulo_id))
    ) then
      update pendencias set status = 'concluida'
       where modulo = 'financeiro.recebiveis'
         and referencia_tabela = case when r.nota_saida_id is null then 'rec_titulos' else 'rec_notas_saida' end
         and referencia_id = coalesce(r.nota_saida_id, r.titulo_id)
         and titulo like 'Anexar boleto%'
         and status in ('aberta', 'em_andamento');
      get diagnostics v_n = row_count;
      v_pendencias := v_pendencias + v_n;
    end if;
  end loop;

  return jsonb_build_object('parcelas', v_atualizados, 'pendencias_concluidas', v_pendencias);
end $$;
