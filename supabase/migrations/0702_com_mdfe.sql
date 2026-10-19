-- =========================================================
-- Neo Admin — 0702 Comercial / Pedidos: MDF-e (Fase 2, expedição)
-- Especificação: docs/modulos/comercial-pedidos.md §10-C.
--
-- com_mdfes: espelho dos manifestos (GET comercial/v10/mdfe, lista em `listaMDFe`), lido pela mesma rodada da
-- com-pedidos-sincronizar. A API NÃO informa as NFs de cada manifesto: o MDF-e fica num painel próprio, sem ligação
-- com o pedido. Só a service role grava; quem tem acesso ao módulo lê.
--
-- Parâmetro `comercial.pedidos.mdfe_dias_alerta`: dias desde a emissão para abrir a pendência "MDF-e não encerrado"
-- (manifesto autorizado, com pendência ou em contingência). Nasce NULO = alerta desligado: o prazo é definido pelo
-- Alan (regra 7 do projeto: prazo legal não se inventa).
-- =========================================================

create table com_mdfes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  numero text not null,                     -- numeroMDFe
  chave varchar(44),
  protocolo text,
  uf_final text,
  placas text,
  situacao text,                            -- 0 Em digitação, 1 Com pendência, 2 Autorizado, 3 Cancelado, 4 Encerrado, 5 Contingência
  data_emissao date,
  hora_emissao text,
  valor_carga numeric(14,2),
  primeiro_visto_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index idx_com_mdfes_abertos on com_mdfes (empresa_id, data_emissao) where situacao in ('1', '2', '5');

alter table com_mdfes enable row level security;
create policy com_mdfes_ler on com_mdfes for select to authenticated using (tem_acesso_modulo('comercial.pedidos'));

insert into configuracoes (chave, valor, descricao) values
  ('comercial.pedidos.mdfe_dias_alerta', 'null',
   'Dias desde a emissão do MDF-e (autorizado, com pendência ou em contingência) para abrir a pendência "MDF-e não encerrado" na Fila do dia. Vazio = alerta desligado.')
on conflict (chave) do nothing;
