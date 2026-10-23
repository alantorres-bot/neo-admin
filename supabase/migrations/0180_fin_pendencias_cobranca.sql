-- =========================================================
-- Neo Admin — 0180 FINANCEIRO: PENDÊNCIAS DE COBRANÇA EXIBIDAS EM "COBRANÇA" (Central de Gestão, Fase 6)
-- O Recebíveis publica todas as pendências da régua com o módulo `financeiro.recebiveis` (as telas da Cobrança e a
-- sincronização dependem disso e não mudam). Na Central, as de cobrança passam a aparecer no módulo Cobrança pelo
-- `modulo_exibicao` (migration 0097): Cobrar D+n, Confirmar pagamento, Ligar para confirmar pagamento e Possível baixa.
-- As de boleto, cadastro e falha de sincronização continuam em Recebíveis. As permissões seguem o módulo dono.
-- =========================================================
create function fin_pendencia_e_de_cobranca(p_modulo text, p_titulo text) returns boolean
language sql immutable set search_path = public as $$
  select p_modulo = 'financeiro.recebiveis'
     and (p_titulo like 'Cobrar D+%' or p_titulo like 'Confirmar pagamento:%'
          or p_titulo like 'Ligar para confirmar pagamento:%' or p_titulo like 'Possível baixa:%');
$$;

create function fn_fin_pendencias_cobranca() returns trigger language plpgsql set search_path = public as $$
begin
  if fin_pendencia_e_de_cobranca(new.modulo, new.titulo) then
    new.modulo_exibicao := 'financeiro.cobranca';
  elsif new.modulo = 'financeiro.recebiveis' and new.modulo_exibicao = 'financeiro.cobranca' then
    new.modulo_exibicao := null;
  end if;
  return new;
end $$;
create trigger trg_fin_pendencias_cobranca before insert or update of titulo, modulo on pendencias
  for each row execute function fn_fin_pendencias_cobranca();

-- Linhas existentes: preenchimento técnico (sem auditoria e sem as regras de pessoa, como na 0092).
alter table pendencias disable trigger trg_aud_pendencias;
alter table pendencias disable trigger trg_pendencias_regras;
update pendencias set modulo_exibicao = 'financeiro.cobranca' where fin_pendencia_e_de_cobranca(modulo, titulo);
alter table pendencias enable trigger trg_pendencias_regras;
alter table pendencias enable trigger trg_aud_pendencias;
