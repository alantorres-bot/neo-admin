// Régua de cobrança (regras puras, sem imports). Usada pela Edge Function `rec-sincronizar-consistem` (abre as pendências
// "Cobrar D+n") e pela tela de cobrança do cliente (mesmo texto, mesmas parcelas, mesmo demonstrativo).
//
// Marcos padrão (spec, seção 4): D+1 lembrete cordial (e-mail e WhatsApp), D+5 segundo aviso pedindo previsão (WhatsApp), D+10
// cobrança formal com demonstrativo de encargos (e-mail). Os marcos (dias, canais e textos) são editáveis na tela Cobrança > Regra
// de cobrança e ficam em `rec_regua_marcos`; as funções abaixo recebem a lista por parâmetro (padrão = os três acima).
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

/** Dias de atraso em que a cobrança acontece (1, 5, 10 no padrão). O nome do marco é sempre `D+<dias>`: é o que liga a pendência e o histórico. */
export type MarcoCobranca = number;
export type CanalCobranca = "email" | "whatsapp";

/** Um marco da régua: quando (dias de atraso), por onde e com que texto. Os textos usam as variáveis de `VARIAVEIS_TEXTO_COBRANCA`. */
export type MarcoRegua = {
  dias: number;
  nome: string;
  canais: readonly CanalCobranca[];
  /** Frase curta do que o marco faz (aparece na pendência e na tela da regra). */
  descricao: string;
  textoWhatsapp: string | null;
  assuntoEmail: string | null;
  corpoEmail: string | null;
};

const SAUDACAO_FINANCEIRO = "{saudacao} Aqui é do Financeiro da Neo Formas.";
const SE_FOI_PAGO_EMAIL = "Se o pagamento já foi realizado, pedimos a gentileza de nos enviar o comprovante para darmos a baixa. Caso precise da segunda via do boleto, é só nos avisar.";

export const MARCOS_PADRAO: readonly MarcoRegua[] = [
  {
    dias: 1, nome: "D+1", canais: ["email", "whatsapp"], descricao: "Lembrete cordial de vencimento",
    textoWhatsapp: [
      SAUDACAO_FINANCEIRO,
      "Identificamos que {pl:a parcela abaixo, já vencida, ainda não consta como paga|as parcelas abaixo, já vencidas, ainda não constam como pagas}:",
      "{parcelas}",
      "Se o pagamento já foi feito, pedimos a gentileza de nos enviar o comprovante para darmos a baixa. Se precisar da segunda via do boleto ou dos dados para PIX/transferência, é só avisar que enviamos na hora.",
      "Obrigado!",
    ].join("\n\n"),
    assuntoEmail: "Lembrete de vencimento — {cliente}",
    corpoEmail: [
      "{saudacao}",
      "Identificamos que {pl:a parcela abaixo, já vencida, ainda não consta como paga|as parcelas abaixo, já vencidas, ainda não constam como pagas}:",
      "{parcelas}",
      SE_FOI_PAGO_EMAIL,
      "Atenciosamente,",
    ].join("\n\n"),
  },
  {
    dias: 5, nome: "D+5", canais: ["whatsapp"], descricao: "Segundo aviso, pedindo previsão de pagamento",
    textoWhatsapp: [
      SAUDACAO_FINANCEIRO,
      "Voltamos a falar sobre {pl:a parcela abaixo, ainda em aberto|as parcelas abaixo, ainda em aberto}:",
      "{parcelas}",
      "Você consegue nos informar a previsão de pagamento? Se houver algum impedimento, nos conte para encontrarmos uma solução juntos. Se o pagamento já foi feito, envie o comprovante, por favor.",
      "Ficamos à disposição. Obrigado!",
    ].join("\n\n"),
    assuntoEmail: null,
    corpoEmail: null,
  },
  {
    dias: 10, nome: "D+10", canais: ["email"], descricao: "Cobrança formal com demonstrativo de encargos",
    textoWhatsapp: null,
    assuntoEmail: "Cobrança de títulos vencidos — {cliente}",
    corpoEmail: [
      "{saudacao}",
      "Até esta data não localizamos o pagamento {pl:do título abaixo|dos títulos abaixo}, {pl:vencido|vencidos} há mais de {marco_dias} dias. O demonstrativo atualizado em {data} é o seguinte:",
      "{demonstrativo}",
      "Total atualizado: {total_atualizado}.",
      "Os encargos seguem a multa de {multa_pct}% e os juros de {juros_pct}% ao mês, calculados por dia de atraso.",
      "Pedimos que o pagamento seja regularizado ou que nos informe a previsão. Se já foi efetuado, envie o comprovante para darmos a baixa. Estamos à disposição para esclarecer qualquer ponto.",
      "Atenciosamente,",
    ].join("\n\n"),
  },
];

/** Variáveis aceitas nos textos (a tela e o banco só deixam salvar estas), com o que cada uma vira. Mais `{pl:se for uma|se forem várias}`. */
export const VARIAVEIS_TEXTO_COBRANCA = {
  saudacao: "“Olá, Maria!” (com o nome do contato) ou “Olá!”",
  cliente: "nome do cliente",
  parcelas: "lista das parcelas em aberto (título, vencimento e valor)",
  demonstrativo: "lista das parcelas com multa, juros e total atualizado",
  total: "soma das parcelas, sem encargos",
  total_atualizado: "soma das parcelas com multa e juros até hoje",
  data: "data de hoje (dd/mm/aaaa)",
  multa_pct: "percentual de multa",
  juros_pct: "percentual de juros ao mês",
  marco: "nome do marco (D+5)",
  marco_dias: "dias de atraso do marco (5)",
} as const;
export type VariavelTextoCobranca = keyof typeof VARIAVEIS_TEXTO_COBRANCA;

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
export function marcoDoAtraso(diasAtraso: number, marcos: readonly MarcoRegua[] = MARCOS_PADRAO): MarcoCobranca | null {
  let atual: MarcoCobranca | null = null;
  for (const m of marcos) if (diasAtraso >= m.dias && (atual === null || m.dias > atual)) atual = m.dias;
  return atual;
}

/** O nome do marco vem sempre dos dias (`D+5`): é ele que liga a pendência e o histórico, então não é editável. */
export const nomeDoMarco = (marco: MarcoCobranca): string => `D+${marco}`;
export const canaisDoMarco = (marco: MarcoCobranca, marcos: readonly MarcoRegua[] = MARCOS_PADRAO): readonly CanalCobranca[] => marcos.find((m) => m.dias === marco)?.canais ?? [];

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
export function planejarCobrancas(
  titulos: readonly TituloCobranca[], hoje: string, corte: string, excluidos: ReadonlySet<string> = new Set(), marcosRegua: readonly MarcoRegua[] = MARCOS_PADRAO,
): GrupoCobranca[] {
  const grupos = new Map<string, TituloCobranca[]>();
  const marcos = new Map<string, MarcoCobranca>();
  for (const t of titulos) {
    if (!cobravel(t, hoje, corte, excluidos)) continue;
    const marco = marcoDoAtraso(diasEntre(hoje, t.vencimento), marcosRegua);
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

/** O último marco da régua (o mais avançado) é alta; os anteriores, normal. */
export function criticidadeCobranca(marco: MarcoCobranca, marcos: readonly MarcoRegua[] = MARCOS_PADRAO): "alta" | "normal" {
  return marcos.length > 0 && marco >= Math.max(...marcos.map((m) => m.dias)) ? "alta" : "normal";
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

/** O que os textos precisam de um grupo de cobrança (o nome e o total são opcionais: vêm do cadastro e das parcelas). */
export type GrupoTexto = Pick<GrupoCobranca, "titulos"> & { nomeCliente?: string; totalCentavos?: number };

const REGEX_VARIAVEL = /\{([a-z_]+)\}/g;
const REGEX_PLURAL = /\{pl:([^{}|]*)\|([^{}|]*)\}/g;

/**
 * Troca as variáveis do texto pelos valores do grupo (`VARIAVEIS_TEXTO_COBRANCA`). `{pl:uma parcela|várias parcelas}` escolhe
 * conforme o número de parcelas. Variável desconhecida fica como está (o salvamento da regra já a recusa).
 */
export function renderizarTexto(
  modelo: string, g: GrupoTexto, marco: MarcoCobranca, hoje: string, contato = "",
): string {
  const plural = g.titulos.length > 1;
  const valores: Record<VariavelTextoCobranca, string> = {
    saudacao: saudacao(contato),
    cliente: (g.nomeCliente ?? "").trim() || "Neo Formas",
    parcelas: listaParcelas(g),
    demonstrativo: g.titulos.map((t) => linhaDemonstrativo(t, hoje)).join("\n"),
    total: moedaBr(g.totalCentavos ?? g.titulos.reduce((s, t) => s + t.valorCentavos, 0)),
    total_atualizado: moedaBr(totalAtualizadoCentavos(g, hoje)),
    data: hoje ? dataBr(hoje) : "",
    multa_pct: String(g.titulos[0]?.multaPct ?? MULTA_PADRAO_PCT),
    juros_pct: String(g.titulos[0]?.jurosMesPct ?? JUROS_MES_PADRAO_PCT),
    marco: nomeDoMarco(marco),
    marco_dias: String(marco),
  };
  return modelo
    .replace(REGEX_PLURAL, (_t, singular: string, varios: string) => (plural ? varios : singular))
    .replace(REGEX_VARIAVEL, (t, nome: string) => (nome in valores ? valores[nome as VariavelTextoCobranca] : t))
    .trim();
}

/** Variáveis desconhecidas num texto (para recusar o salvamento). `{pl:a|b}` é válido; qualquer outro `{...}` precisa estar na lista. */
export function variaveisDesconhecidas(modelo: string): string[] {
  const semPlural = modelo.replace(REGEX_PLURAL, "");
  const achadas = semPlural.match(/\{[^{}]*\}/g) ?? [];
  return [...new Set(achadas.filter((t) => !(t.slice(1, -1) in VARIAVEIS_TEXTO_COBRANCA)))];
}

/** Este marco informa encargos ao cliente (multa e juros)? Então a pendência avisa para conferir o contrato antes de enviar. */
export function marcoInformaEncargos(m: Pick<MarcoRegua, "textoWhatsapp" | "corpoEmail">): boolean {
  return [m.textoWhatsapp, m.corpoEmail].some((t) => !!t && (t.includes("{demonstrativo}") || t.includes("{total_atualizado}")));
}

/** Confere a lista de marcos antes de salvar (o banco confere de novo, com as mesmas regras). Devolve a primeira mensagem de erro, ou null. */
export function validarMarcos(marcos: readonly Pick<MarcoRegua, "dias" | "canais" | "descricao" | "textoWhatsapp" | "assuntoEmail" | "corpoEmail">[]): string | null {
  if (marcos.length > 6) return "No máximo 6 marcos.";
  const vistos = new Set<number>();
  for (const m of marcos) {
    if (!Number.isInteger(m.dias) || m.dias < 1 || m.dias > 365) return "Os dias de atraso de cada marco devem ficar entre 1 e 365.";
    if (vistos.has(m.dias)) return `Dois marcos com ${m.dias} ${m.dias === 1 ? "dia" : "dias"} de atraso: cada marco precisa de um número de dias diferente.`;
    vistos.add(m.dias);
    const nome = `D+${m.dias}`;
    if (m.canais.length === 0) return `${nome}: escolha pelo menos um canal (e-mail ou WhatsApp).`;
    if (m.descricao.trim().length < 3 || m.descricao.length > 120) return `${nome}: descreva o marco em 3 a 120 caracteres.`;
    if (m.canais.includes("whatsapp") && !(m.textoWhatsapp ?? "").trim()) return `${nome}: escreva o texto do WhatsApp.`;
    if (m.canais.includes("email") && (!(m.assuntoEmail ?? "").trim() || !(m.corpoEmail ?? "").trim())) return `${nome}: escreva o assunto e o texto do e-mail.`;
    if ((m.textoWhatsapp ?? "").length > 4000 || (m.corpoEmail ?? "").length > 8000 || (m.assuntoEmail ?? "").length > 200) return `${nome}: texto longo demais.`;
    for (const t of [m.textoWhatsapp, m.assuntoEmail, m.corpoEmail]) {
      const ruins = variaveisDesconhecidas(t ?? "");
      if (ruins.length > 0) return `${nome}: variável desconhecida ${ruins.join(", ")}.`;
    }
  }
  return null;
}

/** Mensagem de WhatsApp do marco (sem emojis); null se o marco não usa WhatsApp. */
export function mensagemWhatsAppCobranca(
  g: GrupoTexto & { marco: MarcoCobranca }, contato = "", marcos: readonly MarcoRegua[] = MARCOS_PADRAO, hoje = "",
): string | null {
  const m = marcos.find((x) => x.dias === g.marco);
  if (!m || !m.canais.includes("whatsapp") || !m.textoWhatsapp?.trim()) return null;
  return renderizarTexto(m.textoWhatsapp, g, g.marco, hoje, contato);
}

/** E-mail do marco (termina em "Atenciosamente," sem assinatura); null se o marco não usa e-mail. */
export function emailCobranca(
  g: GrupoTexto & { marco: MarcoCobranca }, hoje: string, contato = "", marcos: readonly MarcoRegua[] = MARCOS_PADRAO,
): { assunto: string; corpo: string } | null {
  const m = marcos.find((x) => x.dias === g.marco);
  if (!m || !m.canais.includes("email") || !m.assuntoEmail?.trim() || !m.corpoEmail?.trim()) return null;
  return { assunto: renderizarTexto(m.assuntoEmail, g, g.marco, hoje, contato), corpo: renderizarTexto(m.corpoEmail, g, g.marco, hoje, contato) };
}

/** Descrição da pendência: o que fazer, a observação sobre encargos (quando o marco os informa) e as mensagens prontas. */
export function descricaoPendenciaCobranca(g: GrupoCobranca, hoje: string, contato = "", marcos: readonly MarcoRegua[] = MARCOS_PADRAO): string {
  const marco = marcos.find((m) => m.dias === g.marco);
  const partes: string[] = [
    ...(g.unidade === "contagem" ? [`Unidade: ${ROTULO_UNIDADE.contagem}. A cobrança desta unidade é tratada à parte da Matriz.`] : []),
    `${nomeDoMarco(g.marco)}: ${marco?.descricao ?? "cobrança"}. Total em aberto ${moedaBr(g.totalCentavos)}. Envie a mensagem e registre o resultado na tela do cliente.`,
    listaParcelas(g),
  ];
  const whats = mensagemWhatsAppCobranca(g, contato, marcos, hoje);
  if (whats) partes.push(`Mensagem para o cliente (WhatsApp):\n\n${whats}`);
  const email = emailCobranca(g, hoje, contato, marcos);
  if (email) {
    if (marco && marcoInformaEncargos(marco)) {
      partes.push(`Atenção: os encargos usam o padrão do módulo (multa ${MULTA_PADRAO_PCT}% e juros ${JUROS_MES_PADRAO_PCT}% ao mês). Confirme no contrato do cliente antes de enviar.`);
    }
    partes.push(`E-mail: assunto “${email.assunto}”. O texto está na tela do cliente, com o botão para criar o rascunho no Gmail.`);
  }
  return partes.join("\n\n");
}

/** Uma linha de `rec_regua_marcos` (a régua padrão, `acao = cobranca`, ativa) como o banco devolve. */
export type LinhaMarcoBanco = {
  dia_relativo: number; canais: readonly string[] | null; descricao: string | null; texto_whatsapp: string | null; assunto_email: string | null; corpo_email: string | null;
};

/** Marcos da régua a partir das linhas do banco, do menor para o maior número de dias; canal desconhecido é ignorado. */
export function marcosDeLinhas(linhas: readonly LinhaMarcoBanco[]): MarcoRegua[] {
  return linhas
    .filter((l) => Number.isInteger(l.dia_relativo) && l.dia_relativo > 0)
    .map((l): MarcoRegua => ({
      dias: l.dia_relativo,
      nome: nomeDoMarco(l.dia_relativo),
      canais: (l.canais ?? []).filter((c): c is CanalCobranca => c === "email" || c === "whatsapp"),
      descricao: (l.descricao ?? "").trim() || "Cobrança",
      textoWhatsapp: l.texto_whatsapp,
      assuntoEmail: l.assunto_email,
      corpoEmail: l.corpo_email,
    }))
    .sort((a, b) => a.dias - b.dias);
}
