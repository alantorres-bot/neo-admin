-- =========================================================
-- Neo Admin — 0513 RH/SST: código do escritório único por empresa
-- Em 15/10/2026 a importação da Relação dos Líquidos de 09/2026 achou dois códigos do escritório repetidos na mesma empresa
-- (sobras da matrícula do eSocial, que é o código + 1 para parte das pessoas) e gravou o líquido de uma pessoa em outra.
-- O app passou a apontar código repetido (não grava em ninguém); aqui o banco impede que ele exista: duas pessoas ATIVAS da
-- mesma empresa empregadora não podem ter o mesmo código. Mensagem clara para o cadastro e para a ligação feita na importação.
-- Pré-requisito: os códigos repetidos já corrigidos (script de 15/10/2026).
-- =========================================================

create function fn_rh_colab_codigo_unico() returns trigger language plpgsql as $$
declare
  v_outro text;
begin
  if new.ativo and new.matricula_escritorio is not null then
    select cod_fornecedor || ' ' || nome into v_outro from rh_colaboradores
     where empregador = new.empregador and matricula_escritorio = new.matricula_escritorio and ativo and id <> new.id limit 1;
    if v_outro is not null then
      raise exception 'O código do escritório % já está com % (%). Corrija o cadastro de um dos dois.', new.matricula_escritorio, v_outro, new.empregador;
    end if;
  end if;
  return new;
end $$;
create trigger trg_rh_colab_codigo_unico before insert or update of matricula_escritorio, empregador, ativo on rh_colaboradores
  for each row execute function fn_rh_colab_codigo_unico();

create unique index uq_rh_colab_codigo_escritorio on rh_colaboradores (empregador, matricula_escritorio)
  where ativo and matricula_escritorio is not null;
