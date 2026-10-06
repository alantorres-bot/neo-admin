-- =========================================================
-- Neo Admin — 0105 Boleto e envio (Etapa 1b)
-- 1) Modelos de mensagem do envio do boleto (e-mail e WhatsApp). Variáveis: {contato} {cliente} {referencia}
--    {parcelas} {linhas_digitaveis} {total} {qtd_parcelas}. E-mail termina em "Atenciosamente," sem assinatura.
-- 2) rec_marcar_boleto_enviado(): marca parcelas como enviadas numa transação só. É SECURITY INVOKER: roda com os
--    direitos de quem chama, então a RLS vale (operador do Financeiro altera títulos, registra a interação e conclui a
--    pendência dele). Exige boleto anexado em cada parcela.
-- =========================================================

insert into modelos_mensagem (modulo, nome, canal, assunto, corpo)
select 'financeiro.recebiveis', 'Envio de boleto — e-mail', 'email', 'Boleto — {referencia} — Neo Formas',
$corpo$Olá, {contato}!

Segue em anexo o boleto referente à {referencia}, emitido pela Neo Formas:

{parcelas}

Em caso de dúvida ou se precisar de uma segunda via, é só nos avisar.

Atenciosamente,$corpo$
where not exists (select 1 from modelos_mensagem where modulo = 'financeiro.recebiveis' and nome = 'Envio de boleto — e-mail');

insert into modelos_mensagem (modulo, nome, canal, assunto, corpo)
select 'financeiro.recebiveis', 'Envio de boleto — WhatsApp', 'whatsapp', null,
$corpo$Olá, {contato}! Aqui é do Financeiro da Neo Formas. Segue o boleto referente à {referencia}:

{parcelas}

Se precisar de uma segunda via ou dos dados para PIX, é só avisar.$corpo$
where not exists (select 1 from modelos_mensagem where modulo = 'financeiro.recebiveis' and nome = 'Envio de boleto — WhatsApp');

create function rec_marcar_boleto_enviado(p_titulos uuid[], p_canal canal, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_aguardando int;
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

  select count(*) into v_aguardando from rec_titulos where id = any(v_ids) and estagio = 'aguardando_boleto';
  if v_aguardando <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já não está aguardando boleto (ou você não tem acesso a ela).';
  end if;

  select count(*) into v_sem_boleto from rec_titulos t
   where t.id = any(v_ids)
     and not exists (select 1 from anexos a where a.referencia_tabela = 'rec_titulos' and a.referencia_id = t.id and a.tipo = 'boleto');
  if v_sem_boleto > 0 then
    raise exception 'Anexe o boleto de cada parcela marcada antes de marcar como enviado.';
  end if;

  update rec_titulos set estagio = 'boleto_enviado', boleto_enviado_em = now()
   where id = any(v_ids) and estagio = 'aguardando_boleto';
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

revoke all on function rec_marcar_boleto_enviado(uuid[], canal, text) from public, anon;
grant execute on function rec_marcar_boleto_enviado(uuid[], canal, text) to authenticated;
