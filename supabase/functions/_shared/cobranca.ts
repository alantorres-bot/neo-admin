// Régua de cobrança (regras puras, sem imports). Usada pela Edge Function `rec-sincronizar-consistem` (abre as pendências
// "Cobrar D+n") e pela tela de cobrança do cliente (mesmo texto, mesmas parcelas, mesmo demonstrativo).
//
// Marcos desta entrega (spec, seção 4): D+1 lembrete cordial (e-mail e WhatsApp), D+5 segundo aviso pedindo previsão
// (WhatsApp), D+10 cobrança formal com demonstrativo de encargos (e-mail). D+15, D+30 e D+45 ficam para a etapa seguinte.
// O sistema nunca envia: ele abre a pendência com o texto pronto; uma pessoa envia e registra o resultado.
//
// A régua só vale para vencimentos a partir de uma data de corte (configuração), para não cobrar a carteira antiga em massa.

/** Unidades do grupo: o documento que começa com 400 é da Filial Contagem; os demais, da Matriz (mesma regra da coluna `rec_titulos.unidade`). */
export type Unidade = "matriz" | "contagem";
export const ROTULO_UNIDADE: Record<Unidade, string> = { matriz: "Matriz", contagem: "Filial Contagem" };
export const unidadeDoDocumento = (documento: string): Unidade => (documento.startsWith("400") ? "contagem" : "matriz");
/** Sufixo do título das pendências da Filial Contagem (a Matriz não leva sufixo, para não mudar o que já existe). */
export const sufixoUnidade = (u: Unidade | undefined): string => (u === "contagem" ? ` (${ROTULO_UNIDADE.contagem})` : "");
/** A unidade a que uma pendência de cobrança ou confirmação pertence, lida do título dela. */
export const unidadeDaPendencia = (titulo: string): Unidade => (titulo.includes(`(${ROTULO_UNIDADE.contagem})`) ? "contagem" : "matriz");

export type MarcoCobranca = 1 | 5 | 10;
export type CanalCobranca = "email" | "whatsapp";

export const MARCOS_COBRANCA: readonly { dias: MarcoCobranca; nome: string; canais: readonly CanalCobranca[]; descricao: string }[] = [
  { dias: 1, nome: "D+1", canais: ["email", "whatsapp"], descricao: "Lembrete cordial de vencimento" },
  { dias: 5, nome: "D+5", canais: ["whatsapp"], descricao: "Segundo aviso, pedindo previsão de pagamento" },
  { dias: 10, nome: "D+10", canais: ["email"], descricao: "Cobrança formal com demonstrativo de encargos" },
];

export const PREFIXO_COBRANCA = "Cobrar";
/** Estágios em que a régua cobra (vencido, ainda sem pagamento nem acordo). `promessa` só depois de vencida a promessa. */
export const ESTAGIOS_COBRAVEIS = ["importado", "aguardando_boleto", "boleto_enviado", "confirmado_cliente", "vencido", "promessa"] as const;
/** Estágios que viram `vencido` quando passam do vencimento. */
export const ESTAGIOS_QUE_VENCEM = ["importado", "boleto_enviado", "confirmado_cliente"] as const;
/** Não abrir mais que isto de uma vez: passou disso, a configuração está errada e ninguém deve receber cobrança. */
export const TRAVA_PENDENCIAS_COBRANCA = 40;
/** Padrão do módulo enquanto os contratos não têm multa e juros próprios (spec, seção 7). */
export const MULTA_PADRAO_PCT = 2;
export const JUROS_MES_PADRAO_PCT = 2;

export type TituloCobranca = {
  id: string;
  contraparteId: string;
  nomeCliente: string;
  documento: string;
  parcela: string;
  vencimento: string; // aaaa-mm-dd
  valorCentavos: number;
  estagio: string;
  cedido?: boolean;
  contestado?: boolean;
  unidade?: Unidade;
  /** A régua está pausada até esta data (promessa de pagamento). */
  reguaPausadaAte?: string | null;
  multaPct?: number;
  jurosMesPct?: number;
};

export type GrupoCobranca = {
  contraparteId: string;
  nomeCliente: string;
  unidade: Unidade;
  marco: MarcoCobranca;
  titulos: TituloCobranca[];
  totalCentavos: number;
  /** Vencimento mais antigo do grupo (identifica a pendência). */
  vencimentoMaisAntigo: string;
};

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const dataCurta = (iso: string) => dataBr(iso).slice(0, 5);
const moedaBr = (centavos: number) => {
  const [inteiro, frac] = (Math.abs(centavos) / 100).toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};
const nomeTitulo = (t: Pick<TituloCobranca, "documento" | "parcela">) => `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`;

/** O maior marco já atingido (um título atrasado há 7 dias está no D+5); sem atraso, nenhum. */
export function marcoDoAtraso(diasAtraso: number): MarcoCobranca | null {
  let atual: MarcoCobranca | null = null;
  for (const m of MARCOS_COBRANCA) if (diasAtraso >= m.dias) atual = m.dias;
  return atual;
}

export const nomeDoMarco = (marco: MarcoCobranca): string => MARCOS_COBRANCA.find((m) => m.dias === marco)?.nome ?? `D+${marco}`;
export const canaisDoMarco = (marco: MarcoCobranca): readonly CanalCobranca[] => MARCOS_COBRANCA.find((m) => m.dias === marco)?.canais ?? [];

/**
 * Encargos na data: multa fixa + juros simples pro rata dia (juros ao mês / 30), sobre o valor original, sem carência.
 * Mesma conta da view `rec_vw_titulos`: o total é arredondado uma vez (há teste de paridade com o banco).
 */
export function calcularEncargos(valorCentavos: number, diasAtraso: number, multaPct = MULTA_PADRAO_PCT, jurosMesPct = JUROS_MES_PADRAO_PCT) {
  if (diasAtraso <= 0) return { multaCentavos: 0, jurosCentavos: 0, totalCentavos: valorCentavos };
  const bruto = valorCentavos + (valorCentavos * multaPct) / 100 + (((valorCentavos * jurosMesPct) / 100) / 30) * diasAtraso;
  const totalCentavos = Math.round(bruto);
  const multaCentavos = Math.round((valorCentavos * multaPct) / 100);
  // Os juros fecham a conta: valor + multa + juros = total, sem diferença de centavo na tela.
  return { multaCentavos, jurosCentavos: totalCentavos - valorCentavos - multaCentavos, totalCentavos };
}

/** A régua cobra este título hoje? Vencido, dentro do corte, sem pausa e fora dos casos que não se cobra por mensagem. */
export function cobravel(t: TituloCobranca, hoje: string, corte: string, excluidos: ReadonlySet<string> = new Set()): boolean {
  if (!(ESTAGIOS_COBRAVEIS as readonly string[]).includes(t.estagio)) return false;
  if (t.cedido || t.contestado || excluidos.has(t.id)) return false;
  if (t.vencimento < corte || t.vencimento >= hoje) return false;
  if (t.estagio === "promessa" && !t.reguaPausadaAte) return false;
  if (t.reguaPausadaAte && t.reguaPausadaAte >= hoje) return false;
  return true;
}

/** Um grupo por cliente e marco: vários títulos do mesmo cliente no mesmo marco viram UMA mensagem. */
export function planejarCobrancas(titulos: readonly TituloCobranca[], hoje: string, corte: string, excluidos: ReadonlySet<string> = new Set()): GrupoCobranca[] {
  const grupos = new Map<string, TituloCobranca[]>();
  const marcos = new Map<string, MarcoCobranca>();
  for (const t of titulos) {
    if (!cobravel(t, hoje, corte, excluidos)) continue;
    const marco = marcoDoAtraso(diasEntre(hoje, t.vencimento));
    if (marco === null) continue;
    const chave = `${t.contraparteId}|${t.unidade ?? "matriz"}|${marco}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), t]);
    marcos.set(chave, marco);
  }
  return [...grupos.entries()].map(([chave, lista]): GrupoCobranca => {
    const ordenados = [...lista].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.documento.localeCompare(b.documento) || a.parcela.localeCompare(b.parcela));
    return {
      contraparteId: ordenados[0].contraparteId,
      nomeCliente: ordenados[0].nomeCliente,
      unidade: ordenados[0].unidade ?? "matriz",
      marco: marcos.get(chave)!,
      titulos: ordenados,
      totalCentavos: ordenados.reduce((s, t) => s + t.valorCentavos, 0),
      vencimentoMaisAntigo: ordenados[0].vencimento,
    };
  }).sort((a, b) => b.marco - a.marco || a.vencimentoMaisAntigo.localeCompare(b.vencimentoMaisAntigo) || a.nomeCliente.localeCompare(b.nomeCliente) || a.unidade.localeCompare(b.unidade));
}

/** Título único por cliente, marco e vencimento mais antigo (a pendência não se repete). */
export function tituloPendenciaCobranca(g: Pick<GrupoCobranca, "nomeCliente" | "marco" | "vencimentoMaisAntigo"> & { unidade?: Unidade }): string {
  return `${PREFIXO_COBRANCA} ${nomeDoMarco(g.marco)}: ${g.nomeCliente.trim() || "cliente"}${sufixoUnidade(g.unidade)} — venc. ${dataCurta(g.vencimentoMaisAntigo)}`;
}

/** D+10 e acima, alta; antes, normal. */
export function criticidadeCobranca(marco: MarcoCobranca): "alta" | "normal" {
  return marco >= 10 ? "alta" : "normal";
}

const linhaParcela = (t: TituloCobranca) => `• título ${nomeTitulo(t)} — vencimento ${dataBr(t.vencimento)} — ${moedaBr(t.valorCentavos)}`;
const listaParcelas = (g: Pick<GrupoCobranca, "titulos">) => g.titulos.map(linhaParcela).join("\n");
const saudacao = (contato: string) => (contato.trim() ? `Olá, ${contato.trim()}!` : "Olá!");

/** Demonstrativo de encargos de um título na data (multa, juros e total atualizado). */
export function linhaDemonstrativo(t: TituloCobranca, hoje: string): string {
  const dias = Math.max(diasEntre(hoje, t.vencimento), 0);
  const e = calcularEncargos(t.valorCentavos, dias, t.multaPct, t.jurosMesPct);
  return `• título ${nomeTitulo(t)} — vencimento ${dataBr(t.vencimento)} (${dias} ${dias === 1 ? "dia" : "dias"} de atraso): valor ${moedaBr(t.valorCentavos)} + multa ${moedaBr(e.multaCentavos)} + juros ${moedaBr(e.jurosCentavos)} = ${moedaBr(e.totalCentavos)}`;
}

export function totalAtualizadoCentavos(g: Pick<GrupoCobranca, "titulos">, hoje: string): number {
  return g.titulos.reduce((s, t) => s + calcularEncargos(t.valorCentavos, Math.max(diasEntre(hoje, t.vencimento), 0), t.multaPct, t.jurosMesPct).totalCentavos, 0);
}

/** Mensagem de WhatsApp dos marcos D+1 e D+5 (sem emojis). O D+10 é por e-mail. */
export function mensagemWhatsAppCobranca(g: Pick<GrupoCobranca, "marco" | "titulos">, contato = ""): string | null {
  const plural = g.titulos.length > 1;
  const comeco = `${saudacao(contato)} Aqui é do Financeiro da Neo Formas.`;
  if (g.marco === 1) {
    return [
      comeco,
      `Identificamos que ${plural ? "as parcelas abaixo, já vencidas, ainda não constam como pagas" : "a parcela abaixo, já vencida, ainda não consta como paga"}:`,
      listaParcelas(g),
      "Se o pagamento já foi feito, pedimos a gentileza de nos enviar o comprovante para darmos a baixa. Se precisar da segunda via do boleto ou dos dados para PIX/transferência, é só avisar que enviamos na hora.",
      "Obrigado!",
    ].join("\n\n");
  }
  if (g.marco === 5) {
    return [
      comeco,
      `Voltamos a falar sobre ${plural ? "as parcelas abaixo, ainda em aberto" : "a parcela abaixo, ainda em aberto"}:`,
      listaParcelas(g),
      "Você consegue nos informar a previsão de pagamento? Se houver algum impedimento, nos conte para encontrarmos uma solução juntos. Se o pagamento já foi feito, envie o comprovante, por favor.",
      "Ficamos à disposição. Obrigado!",
    ].join("\n\n");
  }
  return null;
}

/** E-mail dos marcos D+1 e D+10 (termina em "Atenciosamente," sem assinatura). Os demais marcos não têm e-mail. */
export function emailCobranca(g: Pick<GrupoCobranca, "marco" | "titulos" | "nomeCliente">, hoje: string, contato = ""): { assunto: string; corpo: string } | null {
  const plural = g.titulos.length > 1;
  if (g.marco === 1) {
    return {
      assunto: `Lembrete de vencimento — ${g.nomeCliente.trim() || "Neo Formas"}`,
      corpo: [
        `${saudacao(contato)}`,
        `Identificamos que ${plural ? "as parcelas abaixo, já vencidas, ainda não constam como pagas" : "a parcela abaixo, já vencida, ainda não consta como paga"}:`,
        listaParcelas(g),
        "Se o pagamento já foi realizado, pedimos a gentileza de nos enviar o comprovante para darmos a baixa. Caso precise da segunda via do boleto, é só nos avisar.",
        "Atenciosamente,",
      ].join("\n\n"),
    };
  }
  if (g.marco === 10) {
    const total = totalAtualizadoCentavos(g, hoje);
    return {
      assunto: `Cobrança de títulos vencidos — ${g.nomeCliente.trim() || "Neo Formas"}`,
      corpo: [
        `${saudacao(contato)}`,
        `Até esta data não localizamos o pagamento ${plural ? "dos títulos abaixo" : "do título abaixo"}, vencido${plural ? "s" : ""} há mais de 10 dias. O demonstrativo atualizado em ${dataBr(hoje)} é o seguinte:`,
        g.titulos.map((t) => linhaDemonstrativo(t, hoje)).join("\n"),
        `Total atualizado: ${moedaBr(total)}.`,
        `Os encargos seguem a multa de ${g.titulos[0]?.multaPct ?? MULTA_PADRAO_PCT}% e os juros de ${g.titulos[0]?.jurosMesPct ?? JUROS_MES_PADRAO_PCT}% ao mês, calculados por dia de atraso.`,
        "Pedimos que o pagamento seja regularizado ou que nos informe a previsão. Se já foi efetuado, envie o comprovante para darmos a baixa. Estamos à disposição para esclarecer qualquer ponto.",
        "Atenciosamente,",
      ].join("\n\n"),
    };
  }
  return null;
}

/** Descrição da pendência: o que fazer, a observação sobre encargos (D+10) e as mensagens prontas. */
export function descricaoPendenciaCobranca(g: GrupoCobranca, hoje: string, contato = ""): string {
  const partes: string[] = [
    ...(g.unidade === "contagem" ? [`Unidade: ${ROTULO_UNIDADE.contagem}. A cobrança desta unidade é tratada à parte da Matriz.`] : []),
    `${nomeDoMarco(g.marco)}: ${MARCOS_COBRANCA.find((m) => m.dias === g.marco)?.descricao ?? "cobrança"}. Total em aberto ${moedaBr(g.totalCentavos)}. Envie a mensagem e registre o resultado na tela do cliente.`,
    listaParcelas(g),
  ];
  const whats = mensagemWhatsAppCobranca(g, contato);
  if (whats) partes.push(`Mensagem para o cliente (WhatsApp):\n\n${whats}`);
  const email = emailCobranca(g, hoje, contato);
  if (email) {
    if (g.marco === 10) partes.push("Atenção: os encargos usam o padrão do módulo (multa 2% e juros 2% ao mês). Confirme no contrato do cliente antes de enviar.");
    partes.push(`E-mail: assunto “${email.assunto}”. O texto está na tela do cliente, com o botão para criar o rascunho no Gmail.`);
  }
  return partes.join("\n\n");
}
