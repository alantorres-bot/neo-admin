-- =========================================================
-- Neo Admin — 0145 Cartão de crédito: texto da conta de fluxo do dicionário igual à conta codificada
-- Especificação: docs/modulos/financeiro-cartao.md (regra 50).
--
-- O Alan apontou (13/10/2026) que faltou preencher as contas de fluxo: a coluna de texto crt_estabelecimentos.conta_fluxo
-- (mostrada em "A lançar" e na aba Estabelecimentos; vazia = [CONFERIR]) estava vazia em 21 estabelecimentos e divergente nos
-- pedágios ("Viagens e Lobby" com o código 18/8 Pedágios). A partir daqui o texto vem da conta codificada
-- (lancamento_erp.grupoContaFluxoCaixa/contaFluxoCaixa → cap_contas_fluxo.descricao), por gatilho.
-- CORREIOS recebe a conta 16/11 Correios e Malotes (proposta aprovada).
-- =========================================================

create function fn_crt_estabelecimento_conta_fluxo() returns trigger language plpgsql as $$
declare
  v_desc text;
begin
  if new.lancamento_erp ? 'grupoContaFluxoCaixa' and new.lancamento_erp ? 'contaFluxoCaixa' then
    select descricao into v_desc from cap_contas_fluxo
     where grupo = (new.lancamento_erp ->> 'grupoContaFluxoCaixa')::int and item = (new.lancamento_erp ->> 'contaFluxoCaixa')::int;
    if v_desc is not null then
      new.conta_fluxo := v_desc;
    end if;
  end if;
  return new;
end $$;
create trigger trg_crt_estabelecimentos_conta_fluxo before insert or update on crt_estabelecimentos
  for each row execute function fn_crt_estabelecimento_conta_fluxo();

update crt_estabelecimentos
   set lancamento_erp = coalesce(lancamento_erp, '{}'::jsonb) || '{"grupoContaFluxoCaixa": 16, "contaFluxoCaixa": 11}'::jsonb
 where padrao = 'CORREIOS';

-- Recalcula o texto de todos (o gatilho preenche).
update crt_estabelecimentos set lancamento_erp = lancamento_erp where lancamento_erp is not null;
