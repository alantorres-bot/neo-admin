-- =========================================================
-- Neo Admin — 0112 Módulo AKF, Fase 1 (base e carteira na AKF)
-- A AKF Securitizadora recebe títulos da Neo Formas em cessão/antecipação. No Consistem o título cedido fica com o
-- portador 998. Esta migration:
-- 1) Cadastra o módulo `financeiro.akf` (menu Financeiro > AKF; a rota sai do código do módulo).
-- 2) Parâmetros do módulo em `configuracoes` (taxa de referência, multa de recompra, clientes "sem boleto de factoring").
-- 3) Mantém `rec_titulos.cedido` sozinho a partir do portador: entrou no 998 = cedido; saiu do 998 = deixa de ser cedido.
--    (Cedido já tira o título da régua de cobrança, da confirmação e do botão "Cobrar" de Recebíveis.)
--    Regulariza os títulos abertos que já estão no 998.
-- 4) akf_marcar_cedido(): marca ou desmarca títulos à mão (quando o portador ainda não foi atualizado no Consistem), numa
--    transação, com a RLS de quem chama (operador do Financeiro), e registra a interação no histórico do título.
-- As tabelas de operação (solicitação, borderô, passivo, prorrogação) entram nas fases seguintes.
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('financeiro.akf', 'financeiro', 'AKF', true)
on conflict (codigo) do update set ativo = true, nome = excluded.nome;

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.akf.taxa_referencia_am', '0.0218', 'Taxa de referência (fração ao mês, 0.0218 = 2,18%) para ESTIMAR o deságio de uma antecipação. É estimativa: vale o borderô da AKF.'),
  ('financeiro.akf.multa_recompra', '0.02', 'Multa da recompra (fração do valor do título, 0.02 = 2%).'),
  ('financeiro.akf.clientes_sem_boleto', '["MIP","MB","JANEIRO","CAPARAO","HOUSE GARDEN","QRTZ 39"]', 'Clientes "sem boleto de factoring": o título só é operado um dia após o vencimento, sem emitir boleto. Casa por trecho do nome (sem acento e sem diferenciar maiúsculas).'),
  ('financeiro.akf.observacao_sem_boleto', '"Operar 1 dia após o vencimento, sem emitir boleto."', 'Texto que acompanha os títulos de clientes "sem boleto de factoring" na instrução à AKF.')
on conflict (chave) do nothing;

-- Portador 998 = cedido à AKF ---------------------------------------------------------------------------------------
create function fn_rec_cedido_por_portador() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.cod_portador = '998' then
      new.cedido := true;
    end if;
  elsif new.cod_portador is distinct from old.cod_portador then
    if new.cod_portador = '998' then
      new.cedido := true;
    elsif old.cod_portador = '998' then
      new.cedido := false; -- saiu da AKF (recompra ou liquidação): volta para a régua de cobrança de Recebíveis
    end if;
  end if;
  return new;
end $$;

create trigger trg_rec_titulos_cedido_portador
  before insert or update of cod_portador on rec_titulos
  for each row execute function fn_rec_cedido_por_portador();

-- Regulariza o que já está no 998 (títulos abertos).
update rec_titulos set cedido = true
 where cod_portador = '998' and not cedido and estagio not in ('pago', 'renegociado', 'cancelado');

-- Marcar ou desmarcar títulos como "na AKF" à mão -------------------------------------------------------------------
create function akf_marcar_cedido(p_titulos uuid[], p_cedido boolean, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_qtd int;
  v_atualizados int;
  v_texto text;
begin
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos um título.';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'No máximo 100 títulos de uma vez.';
  end if;

  select count(*) into v_qtd from rec_titulos
   where id = any(v_ids) and estagio not in ('pago', 'renegociado', 'cancelado');
  if v_qtd <> cardinality(v_ids) then
    raise exception 'Algum título já está encerrado (ou você não tem acesso a ele).';
  end if;

  update rec_titulos set cedido = p_cedido where id = any(v_ids) and cedido is distinct from p_cedido;
  get diagnostics v_atualizados = row_count;
  -- A RLS esconde (e não altera) o que a pessoa não pode mexer: se algum título não ficou no estado pedido, é falta de permissão.
  if (select count(*) from rec_titulos where id = any(v_ids) and cedido = p_cedido) <> cardinality(v_ids) then
    raise exception 'Você não tem permissão para marcar títulos (é preciso ser operador do Financeiro).';
  end if;

  v_texto := case when p_cedido then 'Marcado como cedido à AKF.' else 'Retirado da AKF (deixou de ser cedido).' end;
  if nullif(trim(coalesce(p_descricao, '')), '') is not null then
    v_texto := v_texto || ' ' || trim(p_descricao);
  end if;
  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.akf', t.contraparte_id, 'rec_titulos', t.id, 'interno',
         case when p_cedido then 'akf_cessao' else 'akf_retirada' end, v_texto, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  return jsonb_build_object('titulos', cardinality(v_ids), 'alterados', v_atualizados);
end $$;

revoke all on function akf_marcar_cedido(uuid[], boolean, text) from public, anon;
grant execute on function akf_marcar_cedido(uuid[], boolean, text) to authenticated;
