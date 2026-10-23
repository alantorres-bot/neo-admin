// Central de Gestão > Avisos: os eventos que podem gerar aviso no Slack (migration 0098) e o texto de cada um na tela.
export const EVENTOS_AVISO = [
  { codigo: "atribuicao", nome: "Atribuição", quando: "A pessoa recebe uma pendência de outra pessoa (DM para ela)." },
  { codigo: "prazo_proximo", nome: "Prazo próximo", quando: "Uma vez por prazo, quando a pendência entra no limite de prazo próximo (DM para o responsável)." },
  { codigo: "atraso", nome: "Atraso", quando: "Uma vez por prazo, quando a pendência atrasa (DM para o responsável)." },
  { codigo: "aguarda_gestor", nome: "Pedido de decisão", quando: "O responsável pede uma decisão (canal da gestão)." },
  { codigo: "cobranca_gestor", nome: "Cobrança do gestor", quando: "Só quando o gestor clica em \"Cobrar andamento\" (DM para o responsável)." },
  { codigo: "resumo_diario", nome: "Resumo diário", quando: "Uma vez por dia, a partir do horário configurado (canal da gestão)." },
] as const;

export const ROTULO_STATUS_AVISO: Record<string, string> = { pendente: "Na fila", enviando: "Enviando", enviada: "Enviado", falhou: "Falhou", ignorada: "Ignorado" };
