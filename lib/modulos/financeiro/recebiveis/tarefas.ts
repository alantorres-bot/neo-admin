// Lista de tarefas do contas a receber: o que cada pessoa precisa fazer, separado por fila (como as listas de um ClickUp).
// Regras puras: o carregador (`app/.../tarefas/dados.ts`) lê o banco e monta os itens; aqui ficam a classificação, o corte das
// cobranças já feitas, os filtros e as contagens. As filas são CALCULADAS do estado dos títulos, nunca gravadas (uma só verdade).
import type { GrupoCobranca, MarcoCobranca, Unidade } from "../../../../supabase/functions/_shared/cobranca";
import { dentroDaJanelaDoBoleto, prazoBoleto } from "../../../../supabase/functions/_shared/consistem-receber";

export const FILAS = ["anexar", "enviar", "dados", "confirmar", "cobrar", "baixa", "contato"] as const;
export type Fila = (typeof FILAS)[number];
export const ehFila = (v: string): v is Fila => (FILAS as readonly string[]).includes(v);

export const ROTULO_FILA: Record<Fila, string> = {
  anexar: "Boletos a anexar",
  enviar: "Boletos a enviar",
  dados: "Enviar dados de pagamento",
  confirmar: "Confirmar pagamento",
  cobrar: "Cobrar",
  baixa: "Registrar baixa",
  contato: "Cadastrar contato",
};

export const EXPLICACAO_FILA: Record<Fila, string> = {
  anexar: "Parcelas pagas por boleto, sem o PDF, que vencem em 30 dias ou menos (antes disso ainda não é hora de anexar). Anexe aqui mesmo; se o cliente paga por transferência, use “Pago por transferência”.",
  enviar: "O boleto já está anexado, mas ainda não foi enviado ao cliente. Abra a ficha para criar o rascunho no Gmail ou copiar a mensagem; depois marque como enviado.",
  dados: "Parcelas pagas por transferência (PIX/TED): falta enviar ao cliente os dados bancários da Neo. Abra a ficha para a mensagem pronta.",
  confirmar: "Clientes com parcelas vencendo nos próximos 7 dias e soma a partir do valor mínimo: contatar para confirmar a programação do pagamento. “Ligar” = o cliente não respondeu à mensagem.",
  cobrar: "Parcelas vencidas na régua de cobrança (D+1, D+5 e D+10, vencimentos a partir de 06/10/2026), por cliente e marco. Só aparece o que ainda não foi cobrado naquele marco.",
  baixa: "Títulos que saíram da lista de contas a receber em aberto do Consistem: confira e dê a baixa (pago ou cancelado).",
  contato: "Clientes de Cuiabá (Matriz) com título a vencer ou vencido há menos de 60 dias e sem nenhum contato cadastrado.",
};

/** A explicação da fila com os números da regra em vigor (janelas e data de corte editáveis em Cobrança > Regra de cobrança). */
export function explicacaoDaFila(
  fila: Fila, regra: { janelaBoletoDias: number; janelaConfirmacaoDias: number; reguaAPartirDe: string | null; marcos?: readonly { dias: number }[] },
): string {
  const dia = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;
  if (fila === "anexar") {
    return `Parcelas pagas por boleto, sem o PDF, que vencem em ${dia(regra.janelaBoletoDias)} ou menos (antes disso ainda não é hora de anexar). Anexe aqui mesmo; se o cliente paga por transferência, use “Pago por transferência”.`;
  }
  if (fila === "confirmar") {
    return `Clientes com parcelas vencendo nos próximos ${dia(regra.janelaConfirmacaoDias)} e soma a partir do valor mínimo: contatar para confirmar a programação do pagamento. “Ligar” = o cliente não respondeu à mensagem.`;
  }
  if (fila === "cobrar") {
    const [a, m, d] = (regra.reguaAPartirDe ?? "").split("-");
    const desde = regra.reguaAPartirDe ? `, vencimentos a partir de ${d}/${m}/${a}` : " (a régua está desligada: sem data de início)";
    const nomes = (regra.marcos ?? [{ dias: 1 }, { dias: 5 }, { dias: 10 }]).map((m) => `D+${m.dias}`);
    const lista = nomes.length === 0 ? "sem marcos" : nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
    return `Parcelas vencidas na régua de cobrança (${lista}${desde}), por cliente e marco. Só aparece o que ainda não foi cobrado naquele marco.`;
  }
  return EXPLICACAO_FILA[fila];
}

/** Filtros comuns a todas as filas. */
export type Filtros = { unidade: Unidade | null; busca: string };

/** Dados de todo item de fila: quem é o cliente, em que unidade e o texto usado na busca. */
export type ItemBase = { clienteId: string; cliente: string; codigo: string | null; unidade: Unidade; textoBusca: string };

/** Último registro do histórico do título ("Boleto enviado", "Cobrança enviada"...), para ver o que já foi feito. */
export type Andamento = { texto: string; quando: string } | null;

export type ContatoSugerido = { id: string; nome: string; email: string | null; whatsapp: string | null } | null;

export type ParcelaItem = { id: string; documento: string; parcela: string; vencimento: string; valorCentavos: number };

/** Uma parcela nas filas de boleto (anexar, enviar) e de dados de pagamento. */
export type ItemParcela = ItemBase & ParcelaItem & {
  estagio: string; prazo: string; contato: ContatoSugerido; andamento: Andamento; diasAtraso: number;
  /** NF da parcela (vazio = título avulso): parcelas da mesma NF aparecem juntas na lista. */
  notaSaidaId: string | null; nota: string | null;
};
export type ItemConfirmar = ItemBase & {
  parcelas: ParcelaItem[]; totalCentavos: number; vencimentoMaisProximo: string; prazo: string; ligar: boolean; contato: ContatoSugerido; andamento: Andamento;
  /** Mensagem pronta (WhatsApp) e o link `wa.me` já com o texto, quando o contato tem WhatsApp. O sistema nunca envia. */
  mensagem: string | null; linkWhatsApp: string | null;
};
export type ItemCobrar = ItemBase & {
  marco: MarcoCobranca; parcelas: ParcelaItem[]; totalCentavos: number; vencimentoMaisAntigo: string; diasAtraso: number; contato: ContatoSugerido; andamento: Andamento;
  mensagem: string | null; linkWhatsApp: string | null;
};
export type ItemBaixa = ItemBase & ParcelaItem & { diasAtraso: number; pagoEm: string | null; valorPagoCentavos: number | null };
export type ItemContato = ItemBase & { titulos: number; totalCentavos: number; menorVencimento: string; maiorAtraso: number };

export type Tarefas = {
  hoje: string;
  anexar: ItemParcela[]; enviar: ItemParcela[]; dados: ItemParcela[];
  confirmar: ItemConfirmar[]; cobrar: ItemCobrar[]; baixa: ItemBaixa[]; contato: ItemContato[];
};

// ---------------------------------------------------------------------------------------------------------------------------

export const nomeParcela = (t: Pick<ParcelaItem, "documento" | "parcela">) => `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`;

/** Minúsculas e sem acento, para a busca achar "ação" digitando "acao". */
export const normalizarBusca = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Texto que a busca consulta: cliente, código no Consistem e os documentos das parcelas. */
export const montarTextoBusca = (cliente: string, codigo: string | null, documentos: readonly string[]) =>
  normalizarBusca([cliente, codigo ?? "", ...documentos].join(" "));

/**
 * Em qual fila de boleto/dados a parcela está? Só parcela aguardando boleto entra: com PDF vai para "enviar", sem PDF para "anexar";
 * quem paga por transferência não tem boleto e vai para "dados de pagamento".
 */
export function filaDaParcela(t: { estagio: string; forma: string; temBoleto: boolean; vencimento?: string; hoje?: string; janelaBoletoDias?: number }): "anexar" | "enviar" | "dados" | null {
  if (t.estagio !== "aguardando_boleto") return null;
  if (t.forma === "transferencia") return "dados";
  if (t.temBoleto) return "enviar";
  // "Anexar boleto" só vira tarefa dentro da janela (30 dias, editável na Regra de cobrança; a mesma regra da pendência da sincronização).
  if (t.vencimento && t.hoje && !dentroDaJanelaDoBoleto(t.vencimento, t.hoje, t.janelaBoletoDias)) return null;
  return "anexar";
}

/** Prazo da parcela na fila: vencimento menos 8 dias (o mesmo da pendência "Anexar boleto"); se já passou, hoje. */
export const prazoDaParcela = (vencimento: string, hoje: string) => prazoBoleto(vencimento, hoje);

/** O D+n a que um registro de cobrança se refere ("Cobrança D+5 enviada ..."). */
export function marcoDaDescricao(descricao: string | null | undefined): number | null {
  const m = /D\+(\d+)/.exec(descricao ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Tira dos grupos de cobrança as parcelas que já foram cobradas NAQUELE marco (cobrança enviada, promessa ou contestação).
 * Sem parcela restante, o grupo some da fila. `feita(parcelaId, marco)` diz se a parcela já tem registro desse marco.
 */
export function removerCobrancasFeitas(grupos: readonly GrupoCobranca[], feita: (parcelaId: string, marco: number) => boolean): GrupoCobranca[] {
  const resultado: GrupoCobranca[] = [];
  for (const g of grupos) {
    const restantes = g.titulos.filter((t) => !feita(t.id, g.marco));
    if (restantes.length === 0) continue;
    resultado.push({
      ...g, titulos: restantes, totalCentavos: restantes.reduce((s, t) => s + t.valorCentavos, 0), vencimentoMaisAntigo: restantes[0].vencimento,
    });
  }
  return resultado;
}

/** Mais urgente primeiro: vencimento mais antigo/próximo, depois cliente e documento. */
export function ordenarParcelas<T extends { vencimento: string; cliente: string; documento: string; parcela: string }>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) =>
    a.vencimento.localeCompare(b.vencimento) || a.cliente.localeCompare(b.cliente, "pt-BR") || a.documento.localeCompare(b.documento) || a.parcela.localeCompare(b.parcela, undefined, { numeric: true }));
}

/** Clientes sem contato: o de título mais urgente primeiro (menor vencimento), depois por nome. */
export const ordenarContatos = (lista: readonly ItemContato[]): ItemContato[] =>
  [...lista].sort((a, b) => a.menorVencimento.localeCompare(b.menorVencimento) || a.cliente.localeCompare(b.cliente, "pt-BR"));

type Titulado = ItemBase;
const passa = (i: Titulado, f: Filtros) => (f.unidade === null || i.unidade === f.unidade) && (f.busca === "" || i.textoBusca.includes(normalizarBusca(f.busca)));

/** Aplica unidade e busca em todas as filas ao mesmo tempo: as contagens das abas saem das mesmas listas mostradas. */
export function aplicarFiltros(t: Tarefas, f: Filtros): Tarefas {
  return {
    hoje: t.hoje,
    anexar: t.anexar.filter((i) => passa(i, f)), enviar: t.enviar.filter((i) => passa(i, f)), dados: t.dados.filter((i) => passa(i, f)),
    confirmar: t.confirmar.filter((i) => passa(i, f)), cobrar: t.cobrar.filter((i) => passa(i, f)),
    baixa: t.baixa.filter((i) => passa(i, f)), contato: t.contato.filter((i) => passa(i, f)),
  };
}

export const contarFilas = (t: Tarefas): Record<Fila, number> => ({
  anexar: t.anexar.length, enviar: t.enviar.length, dados: t.dados.length, confirmar: t.confirmar.length, cobrar: t.cobrar.length,
  baixa: t.baixa.length, contato: t.contato.length,
});

export const totalDeTarefas = (t: Tarefas): number => Object.values(contarFilas(t)).reduce((s, n) => s + n, 0);

/** A aba que abre sem escolha: a primeira com itens (na ordem das abas); se todas vazias, a primeira. */
export function abaInicial(contagens: Record<Fila, number>): Fila {
  return FILAS.find((f) => contagens[f] > 0) ?? FILAS[0];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Lista: paginação, parcelas da mesma NF juntas, totais e atalho de WhatsApp.

export const POR_PAGINA_TAREFAS = 50;

/** Fatia a lista na página pedida (1 em diante; fora do intervalo, a mais próxima). */
export function paginar<T>(lista: readonly T[], pagina: number, porPagina = POR_PAGINA_TAREFAS): { itens: T[]; pagina: number; totalPaginas: number; total: number } {
  const totalPaginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const atual = Math.min(Math.max(1, Math.trunc(pagina) || 1), totalPaginas);
  return { itens: lista.slice((atual - 1) * porPagina, atual * porPagina), pagina: atual, totalPaginas, total: lista.length };
}

/** Parcelas do mesmo cliente e da mesma NF (ou uma parcela avulsa, sem NF) numa linha só. */
export type GrupoNota = ItemBase & {
  chave: string;
  notaSaidaId: string | null;
  nota: string | null;
  parcelas: ItemParcela[];
  totalCentavos: number;
  vencimentoMaisProximo: string;
  prazo: string;
};

/** Agrupa as parcelas por NF (mais urgente primeiro). Parcela sem NF vira um grupo de uma parcela. */
export function agruparPorNota(itens: readonly ItemParcela[]): GrupoNota[] {
  const grupos = new Map<string, GrupoNota>();
  for (const i of itens) {
    const chave = i.notaSaidaId ? `${i.clienteId}|${i.notaSaidaId}` : `avulso|${i.id}`;
    const g = grupos.get(chave);
    if (!g) {
      grupos.set(chave, {
        clienteId: i.clienteId, cliente: i.cliente, codigo: i.codigo, unidade: i.unidade, textoBusca: i.textoBusca,
        chave, notaSaidaId: i.notaSaidaId, nota: i.nota, parcelas: [i], totalCentavos: i.valorCentavos, vencimentoMaisProximo: i.vencimento, prazo: i.prazo,
      });
      continue;
    }
    g.parcelas.push(i);
    g.totalCentavos += i.valorCentavos;
    if (i.vencimento < g.vencimentoMaisProximo) g.vencimentoMaisProximo = i.vencimento;
    if (i.prazo < g.prazo) g.prazo = i.prazo;
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, parcelas: ordenarParcelas(g.parcelas) }))
    .sort((a, b) => a.vencimentoMaisProximo.localeCompare(b.vencimentoMaisProximo) || a.cliente.localeCompare(b.cliente, "pt-BR") || a.chave.localeCompare(b.chave));
}

/** Soma em centavos do que a fila representa (valor das parcelas, ou o total dos grupos). */
export function totalDaFila(t: Tarefas, fila: Fila): number {
  const soma = (lista: readonly { valorCentavos: number }[]) => lista.reduce((s, i) => s + i.valorCentavos, 0);
  const somaTotal = (lista: readonly { totalCentavos: number }[]) => lista.reduce((s, i) => s + i.totalCentavos, 0);
  switch (fila) {
    case "anexar": return soma(t.anexar);
    case "enviar": return soma(t.enviar);
    case "dados": return soma(t.dados);
    case "baixa": return soma(t.baixa);
    case "confirmar": return somaTotal(t.confirmar);
    case "cobrar": return somaTotal(t.cobrar);
    case "contato": return somaTotal(t.contato);
  }
}

/** Link `wa.me` com a mensagem já preenchida (abre o WhatsApp da pessoa; o sistema nunca envia). Aceita +5565..., (65) 9..., etc. */
export function linkWhatsApp(numero: string | null | undefined, texto: string): string | null {
  const digitos = (numero ?? "").replace(/\D/g, "");
  // Com "+" o código do país já vem no número (e só o do Brasil serve); sem "+", DDD + número ganha o 55.
  const comCodigoDoPais = /^\s*\+/.test(numero ?? "");
  const completo = !comCodigoDoPais && (digitos.length === 10 || digitos.length === 11) ? `55${digitos}` : digitos;
  if (!/^55\d{10,11}$/.test(completo)) return null;
  return `https://wa.me/${completo}?text=${encodeURIComponent(texto)}`;
}
