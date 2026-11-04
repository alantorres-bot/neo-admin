# RH/SST > Bonificações

Rotas: `/rh/bonificacoes` (RH) e `/bonificar/<chave>` (líder, sem login). Migration `0525_rh_bonificacoes.sql`.
Mesma linha do Ponto (`docs/modulos/rh-ponto.md`, link público da 0517).

## Fluxo
1. O RH escolhe o mês e clica **Abrir lote** no setor (setores = RH > Ponto > Setores e líderes). Um lote por setor × mês.
2. **Copiar link** e mandar ao líder (e-mail, WhatsApp…). Quem tiver o link lança.
3. O líder vê os funcionários **ativos** cujo `departamento` (Control iD) casa com o nome do setor (`rh_chave_setor`, sem acento
   nem caixa). Marca quem tem direito e o percentual de cada um: **5, 10, 15 ou 20% do salário** (um "% padrão" preenche ao marcar).
   Informa o nome e envia: ficam gravados nome, IP e data/hora; o link fecha. O líder não vê salário (LGPD).
4. O RH confere (salário, valor e total do setor) e:
   - **Aprovar e lançar na folha**: exige salário no cadastro de todos os marcados; grava um **recibo Eventual** por pessoa
     com a linha `bonificacao_producao` (salário × pct/100, o mesmo cálculo da Folha) na competência do lote. O valor entra no
     avulso da folha do mês. Se algum recibo falhar (folha fechada, pessoa fora da folha…), os demais ficam gravados e o botão
     **Lançar na folha (n faltando)** repete só os que faltam.
   - **Devolver ao líder** com motivo: o link reabre; o novo envio substitui o anterior (a auditoria guarda o que havia).
   - **Cancelar** (gestor) com motivo, antes de aprovado. Depois dá para abrir outro lote no mesmo mês.

## Status
`enviado` (com o líder) → `preenchido` (aguardando aprovação) → `aprovado`; `devolvido` volta ao líder; `cancelado`.
Lote não se apaga; depois de aprovado, os itens também não mudam (o recibo se cancela pela Folha, se preciso).

## Pendências (Fila do dia, módulo `rh.bonificacoes`)
"Aguardando líder — <setor> MM/AAAA" ao abrir/devolver; "Aprovar bonificação — …" quando o líder envia.

## Permissões
consulta: só vê. operador: abre lote, copia link, aprova/lança, devolve. gestor: tudo e cancela.

## Riscos aceitos
Link encaminhado também lança (por isso nome + IP e o link fecha no envio), como no Ponto.

## Fora do escopo (por ora)
Rascunho de e-mail pelo Gmail, lembrete automático por prazo, histórico de bonificação por pessoa.
