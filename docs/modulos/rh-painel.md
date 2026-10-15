# RH — Painel do RH (`rh.painel`)

Tela inicial do RH em `/rh/painel` (migration `0515_rh_painel.sql`, que só cadastra o módulo).

- **Quem vê:** quem tem acesso à área RH.
- **Só leitura:** usa as tabelas da folha, do cadastro único e as pendências, com a RLS de quem chama. As ações ficam nas telas de
  cada módulo.
- **Visual:** é o "V2 — visual renovado" do design de 15/10/2026: cartões brancos sobre fundo cinza-claro, Roboto Condensed nos
  números e o vermelho da marca só nos destaques. As demais telas do RH continuam no visual de sempre.

## Blocos

| Bloco | Regra | Origem |
| --- | --- | --- |
| Saudação | "Bom dia" até 11h59, "Boa tarde" até 17h59, depois "Boa noite" (hora de Cuiabá). Mostra quantas pendências vencem hoje ou estão atrasadas. | perfil, `pendencias` |
| Fechamento em andamento | O mês da folha **aberto mais antigo**. Mostra os dias corridos até o pagamento (5º dia útil), as etapas aberta → conferida → aprovada → paga e o checklist abaixo. | `rh_fp_competencias`, `rh_fp_itens`, `rh_fp_recibo_modelos`, `rh_fp_recibos` |
| Folha em destaque | O mês **conferido ou aprovado** mais recente. Sem nenhum, a última folha paga. Mostra o total, a variação sobre o mês anterior, pessoas, a divisão salários/13º/avulsos e a folha do escritório (líquido + férias) por empresa. | `rh_fp_itens` |
| Números do ano | Pago no ano (meses com valor), média por mês, ativos e com VT, 13º do ano. | `rh_fp_itens`, `rh_colaboradores` |
| Folha mês a mês | Barras empilhadas (salários, 13º, avulsos) dos meses do ano, com o mês em destaque realçado. Clicar abre o mês. | os mesmos totais da tela de meses |
| Fila do RH | Pendências abertas dos módulos `rh.*`, por prazo, até 8. Ficam em vermelho as que vencem em até 2 dias ou têm criticidade alta. | `pendencias` |

## Checklist do fechamento

As regras ficam em `lib/modulos/rh/painel/painel.ts`, com testes.

1. **Folha do mês aberta:** sempre feito.
2. **Recibos recorrentes:**
   - feito quando os recibos recorrentes não cancelados do mês chegam ao número de modelos ativos;
   - sem modelos ativos, conta como feito.
3. **Líquidos do escritório:**
   - feito quando cada empresa da folha do mês tem algum líquido, importado ou digitado;
   - se falta parte das empresas, diz qual falta.
4. **13º do mês:**
   - "Lançado" quando há 13º no mês;
   - sem 13º, fica "Aguardando escritório" e **nunca** "Pendente", porque só há 13º quando alguém faz aniversário;
   - depois de conferida, aparece "Sem 13º no mês".
5. **Conferência e aprovação:**
   - "Depois" com a folha aberta;
   - "Aguardando aprovação" quando conferida;
   - feito quando aprovada ou paga.

## Fora por enquanto

- Guias DARF e FGTS: entram com a F3 da folha.
- Indicadores do VT além de "com VT".
