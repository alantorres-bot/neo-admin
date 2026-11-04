# RH/SST > Portal do Líder

Rotas:
- `/lider` e `/lider/novo`: tela do líder, com login.
- `/rh/portal_lider` e `/rh/portal_lider/<id>`: pedidos e líderes, para o RH.

Migrations `0526_rh_portal_lider.sql` e `0527_rh_portal_lider_email.sql`; Edge Function `rh-ld-enviar-email`. Fase 1, decidida em 04/11/2026.

## Por quê
Desde 30/10, as demandas de DP dos líderes chegam por e-mail ao Alan. São elas: férias, alteração de função ou salário, desligamento, atestado, contratação, bonificação e ponto. O portal reúne tudo numa tela por setor. Cada pedido vira pendência do RH na Fila do dia.

## Acesso
- O líder entra com a **conta Google da empresa**. Ele é um usuário comum, criado em Configurações > Usuários **sem nenhuma área**.
- O gestor do RH liga o usuário ao setor na tela do RH, na seção "Líderes no portal" (tabela `rh_ld_lideres`). Um líder pode ter mais de um setor.
- Este acesso muda a decisão da 0517 (sem login) **só para o portal**. Os links do Ponto (`/justificar-ponto/<chave>`) e da Bonificação (`/bonificar/<chave>`) continuam valendo. O portal apenas mostra os lotes abertos do setor e abre esses mesmos links.
- O líder sem área nenhuma é levado do Início direto para `/lider`. O item **Líder** do trilho só aparece para quem lidera algum setor ativo.
- Tudo o que o líder lê ou grava passa por funções `security definer` `rh_ld_*`, que conferem a liderança (`rh_ld_lidera`). Ele não lê `rh_colaboradores` nem as demais tabelas do RH.

## O que o líder vê
- **Com você agora**: os lotes de ponto e de bonificação do setor que estão com ele (enviado ou devolvido).
- **Pedidos ao RH**: o status de cada pedido e a resposta do RH. Pode cancelar enquanto o pedido está "Enviado ao RH". No atestado sem arquivo, aparece o botão **Anexar**.
- **Equipe**: os ativos do departamento do setor, pelo mesmo casamento de nome do Banco de horas e da Bonificação (`rh_bo_pessoas_do_setor`). Aparecem nome, função, admissão e banco de horas (saldo, vencido, próximo vencimento). **Sem salário e sem dados bancários (LGPD).**

## Pedidos (`rh_ld_solicitacoes`)
Todos os tipos ficam numa tabela só, com `tipo` e `dados jsonb`. Os campos são validados em `lib/modulos/rh/portal-lider/modulo.ts`, e o banco confere os obrigatórios.

| Tipo | Campos |
|---|---|
| Férias | início, dias de gozo, vende 10 dias (sim/não), observação |
| Alteração de função/salário | função nova, salário proposto (opcional), vigência, precisa de exame, motivo |
| Desligamento | iniciativa (empregado/empresa), aviso (trabalhado, indenizado, dispensado), data, motivo |
| Atestado | primeiro e último dia, observação, arquivo (foto/PDF) |
| Contratação | nome, cargo, salário, benefícios, contato, início previsto (sem funcionário) |

**Avisos** ao líder, que não bloqueiam o envio:
- Férias com menos de 30 dias de antecedência. É a antecedência que o RH pede nos e-mails.
- Vigência de função fora do dia 1º, porque o salário fica quebrado.
- Data no passado.

**Nenhuma regra trabalhista é calculada:** o portal não calcula saldo de férias, prazo de dobra nem verbas. Não existem períodos aquisitivos no banco, então o RH confere e responde no pedido.

Status:
- `enviada` → `em_andamento` → `concluida` ou `recusada`. A recusa exige resposta.
- `cancelada`: pelo líder, só a partir de `enviada`.
- Pedido não se apaga.

## Pendências (módulo `rh.portal_lider`)
- O pedido abre "Pedido do líder: <tipo> — <pessoa> (<setor>)", com link para `/rh/portal_lider/<id>`.
- O atendimento move a pendência: Em andamento passa para em_andamento; Concluir conclui; Recusar ou o cancelamento pelo líder cancela.
- Pela regra da Central (0092, `criado_por`), o líder também enxerga as pendências que ele mesmo abriu. Ele não enxerga as dos outros.

## E-mail ao RH (0527)
Decisão do Alan em 04/11/2026: todo pedido enviado pelo portal também vai **por e-mail** ao RH.
- O e-mail **sai de fato**, sem passar por rascunho. Sai do **Gmail do próprio líder**, pela conexão "Conectar meu Gmail" (0153, escopo `gmail.compose`, que também permite enviar), e a resposta volta para ele.
- O líder autoriza o Gmail uma vez. Enquanto não conecta, o portal mostra o aviso e o botão **Enviar ao RH** fica travado.
- O destino é a lista **E-mail do RH** (`rh.portal_lider.email_rh`, começa com `alantorres@`), que o gestor do RH troca na tela. Só aceita endereços `@neoformas.com.br`, porque é comunicação interna: a regra 2 do projeto (nada vai a terceiros sem regra) continua valendo, e a Edge Function confere o domínio de novo.
- Assunto: "Portal do Líder — <tipo> — <pessoa> (<setor>)".
- Corpo: os dados do pedido e o link para responder no Neo Admin, terminando em "Atenciosamente," (regra 3).
- O atestado vai anexado.
- Um envio por pedido. O resultado fica em `email_enviado_em` ou `email_erro`.
- Se falhar (Gmail desconectado, autorização expirada, falha do Google), o pedido continua gravado e na Fila do dia. O líder vê "Não enviado" e usa **Reenviar e-mail**.

## Anexo do atestado
- O arquivo sobe pelo navegador para `anexos`, no caminho `rh.portal_lider/rh_ld_solicitacoes/<id>/…`.
- Pelas políticas da 0526, o líder envia e lê só os anexos de pedidos do seu setor.
- O RH lê pelas regras que já existiam e abre o arquivo por URL assinada.
- O original em papel continua sendo entregue ao RH.

## Permissões
- Líder: apenas o próprio setor.
- RH consulta: vê os pedidos.
- RH operador: atende os pedidos.
- RH gestor: também define os líderes.

## Riscos aceitos
- O líder vê a equipe inteira do departamento, porque o casamento é pelo nome do setor. Se o `departamento` no Control iD estiver errado, a pessoa aparece no setor errado. É o mesmo risco do Banco de horas e da Bonificação.
- Se o arquivo do atestado falhar depois do pedido criado, o pedido fica sem arquivo. O líder usa **Anexar** e o RH vê o aviso.

## Fora da Fase 1
- Cadastro completo (contato e documentos não existem no banco).
- Saldo e prazo de férias calculados.
- Advertência e termos para assinar (EPI, ficha de empregado).
- Benefícios: combustível e plano de saúde.
- E-mail ao líder quando o RH responde (hoje ele vê a resposta no portal).
- Envio automático ao escritório (AM DP).
