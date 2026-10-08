// Confirmação de pagamento (regras puras, sem imports). Usada pela Edge Function `rec-sincronizar-consistem` (abre a
// pendência) e pela tela de confirmação do cliente (mesmo texto e mesmas parcelas).
//
// Regras vêm da rotina que já existe no ClickUp (skill `confirmacoes-pagamento`): contatar os clientes de MAIOR valor
// 3–4 dias antes do vencimento para confirmar a programação do pagamento; corte padrão de R$ 25.000,00 por cliente,
// somando as parcelas do mesmo cliente; tarefa com prazo = vencimento menos ~4 dias; mensagem de WhatsApp com o modelo
// abaixo (sem emojis; saudação com o nome do contato quando conhecido).

/** Sufixo do título das pendências da Filial Contagem (mesma regra de `cobranca.ts`; os arquivos compartilhados não importam uns aos outros). */
const sufixoUnidade = (u: "matriz" | "contagem" | undefined): string => (u === "contagem" ? " (Filial Contagem)" : "");

export const DIAS_JANELA_CONFIRMACAO = 7; // a pendência aparece quando faltam até 7 dias para o vencimento
export const DIAS_CONTATO_ANTES = 4; // prazo do contato = vencimento menos 4 dias
export const MINIMO_PADRAO_CENTAVOS = 25_000_00;
export const PREFIXO_CONFIRMACAO = "Confirmar pagamento";
export const PREFIXO_LIGAR = "Ligar para confirmar pagamento";
/** Parcelas ainda sem confirmação do cliente e sem pagamento. */
export const ESTAGIOS_CONFIRMAVEIS = ["importado", "aguardando_boleto", "boleto_enviado"] as const;

export type TituloConfirmacao = {
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
  unidade?: "matriz" | "contagem";
};

export type GrupoConfirmacao = {
  contraparteId: string;
  nomeCliente: string;
  unidade: "matriz" | "contagem";
  /** Todas as parcelas do cliente na janela, da mais próxima para a mais distante. */
  titulos: TituloConfirmacao[];
  totalCentavos: number;
  vencimentoMaisProximo: string;
  /** As parcelas do vencimento mais próximo: o foco da mensagem. */
  titulosDoFoco: TituloConfirmacao[];
  /** Parcelas de vencimentos seguintes (vão numa observação para quem envia, não na mensagem). */
  demais: TituloConfirmacao[];
};

const adicionarDias = (iso: string, dias: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const dataCurta = (iso: string) => dataBr(iso).slice(0, 5);
const moedaBr = (centavos: number) => {
  const [inteiro, frac] = (Math.abs(centavos) / 100).toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};
const nomeTitulo = (t: Pick<TituloConfirmacao, "documento" | "parcela">) => `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`;

/** Parcelas elegíveis à confirmação: sem confirmação, sem pagamento, não cedidas nem contestadas, vencendo na janela. */
export function elegiveis(titulos: readonly TituloConfirmacao[], hoje: string, janela = DIAS_JANELA_CONFIRMACAO): TituloConfirmacao[] {
  const ate = adicionarDias(hoje, janela);
  return titulos.filter((t) =>
    (ESTAGIOS_CONFIRMAVEIS as readonly string[]).includes(t.estagio) && !t.cedido && !t.contestado && t.vencimento >= hoje && t.vencimento <= ate,
  );
}

function montarGrupo(lista: TituloConfirmacao[]): GrupoConfirmacao {
  const titulos = [...lista].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.documento.localeCompare(b.documento) || a.parcela.localeCompare(b.parcela));
  const vencimentoMaisProximo = titulos[0].vencimento;
  return {
    contraparteId: titulos[0].contraparteId,
    nomeCliente: titulos[0].nomeCliente,
    unidade: titulos[0].unidade ?? "matriz",
    titulos,
    totalCentavos: titulos.reduce((s, t) => s + t.valorCentavos, 0),
    vencimentoMaisProximo,
    titulosDoFoco: titulos.filter((t) => t.vencimento === vencimentoMaisProximo),
    demais: titulos.filter((t) => t.vencimento !== vencimentoMaisProximo),
  };
}

/** Agrupa as parcelas elegíveis por cliente (sem corte de valor). Usada pela tela do cliente. */
export function agruparPorCliente(titulos: readonly TituloConfirmacao[], hoje: string, janela = DIAS_JANELA_CONFIRMACAO): GrupoConfirmacao[] {
  const porCliente = new Map<string, TituloConfirmacao[]>();
  for (const t of elegiveis(titulos, hoje, janela)) porCliente.set(`${t.contraparteId}|${t.unidade ?? "matriz"}`, [...(porCliente.get(`${t.contraparteId}|${t.unidade ?? "matriz"}`) ?? []), t]);
  return [...porCliente.values()].map(montarGrupo).sort((a, b) => a.vencimentoMaisProximo.localeCompare(b.vencimentoMaisProximo) || b.totalCentavos - a.totalCentavos);
}

/** Clientes que passam do corte (soma das parcelas da janela >= mínimo), do vencimento mais próximo e do maior valor. */
export function planejarConfirmacoes(titulos: readonly TituloConfirmacao[], hoje: string, minimoCentavos = MINIMO_PADRAO_CENTAVOS, janela = DIAS_JANELA_CONFIRMACAO): GrupoConfirmacao[] {
  return agruparPorCliente(titulos, hoje, janela).filter((g) => g.totalCentavos >= minimoCentavos);
}

/**
 * Pendências de confirmação ("Confirmar pagamento" e "Ligar para confirmar pagamento") ABERTAS que perderam o sentido: o cliente
 * (naquela unidade) já não tem parcela na janela acima do corte (paga, vencida, confirmada, fora do corte) ou, no caso de "Confirmar",
 * o vencimento mais próximo mudou (a pendência do novo vencimento já foi aberta). Devolve os ids a cancelar.
 */
export function pendenciasConfirmacaoObsoletas(
  abertas: readonly { id: string; referencia_id: string; titulo: string }[],
  grupos: readonly (Pick<GrupoConfirmacao, "contraparteId" | "unidade" | "vencimentoMaisProximo" | "nomeCliente">)[],
): string[] {
  const unidadeDoTitulo = (titulo: string): "matriz" | "contagem" => (titulo.includes("(Filial Contagem)") ? "contagem" : "matriz");
  const porChave = new Map(grupos.map((g) => [`${g.contraparteId}|${g.unidade}`, g]));
  return abertas.filter((p) => {
    const ehConfirmar = p.titulo.startsWith(`${PREFIXO_CONFIRMACAO}:`);
    const ehLigar = p.titulo.startsWith(`${PREFIXO_LIGAR}:`);
    if (!ehConfirmar && !ehLigar) return false;
    const g = porChave.get(`${p.referencia_id}|${unidadeDoTitulo(p.titulo)}`);
    if (!g) return true;
    return ehConfirmar && p.titulo !== tituloPendenciaConfirmacao(g);
  }).map((p) => p.id);
}

/** Prazo do contato: vencimento menos 4 dias (parâmetro `antes`); se já passou, hoje. */
export function prazoConfirmacao(vencimento: string, hoje: string, antes = DIAS_CONTATO_ANTES): string {
  const alvo = adicionarDias(vencimento, -antes);
  return alvo > hoje ? alvo : hoje;
}

/** Faltando até 2 dias, alta; antes disso, normal. */
export function criticidadeConfirmacao(vencimento: string, hoje: string): "alta" | "normal" {
  return diasEntre(vencimento, hoje) <= 2 ? "alta" : "normal";
}

/** Título único por cliente e vencimento mais próximo (a pendência não se repete para o mesmo vencimento). */
export function tituloPendenciaConfirmacao(g: Pick<GrupoConfirmacao, "nomeCliente" | "vencimentoMaisProximo"> & { unidade?: "matriz" | "contagem" }): string {
  return `${PREFIXO_CONFIRMACAO}: ${g.nomeCliente.trim() || "cliente"}${sufixoUnidade(g.unidade)} — vence ${dataCurta(g.vencimentoMaisProximo)}`;
}

export function tituloPendenciaLigar(g: Pick<GrupoConfirmacao, "nomeCliente" | "vencimentoMaisProximo"> & { unidade?: "matriz" | "contagem" }): string {
  return `${PREFIXO_LIGAR}: ${g.nomeCliente.trim() || "cliente"}${sufixoUnidade(g.unidade)} — vence ${dataCurta(g.vencimentoMaisProximo)}`;
}

/**
 * Mensagem de WhatsApp (modelo da skill `confirmacoes-pagamento`, sem emojis). Foca nas parcelas do vencimento mais
 * próximo: uma parcela ou várias do mesmo vencimento (lista e total). Parcelas de outros vencimentos ficam fora.
 * `contato` personaliza a saudação ("Olá, Ana!").
 */
export function mensagemWhatsAppConfirmacao(g: Pick<GrupoConfirmacao, "titulosDoFoco" | "vencimentoMaisProximo">, contato = ""): string {
  const saudacao = contato.trim() ? `Olá, ${contato.trim()}! Aqui é do Financeiro da Neo Formas.` : "Olá! Aqui é do Financeiro da Neo Formas.";
  const foco = g.titulosDoFoco;
  const data = dataBr(g.vencimentoMaisProximo);
  const abertura = foco.length === 1
    ? `Estamos passando para confirmar a programação do pagamento da parcela no valor de *${moedaBr(foco[0].valorCentavos)}*, com vencimento em *${data}* (título ${nomeTitulo(foco[0])}).`
    : `Estamos passando para confirmar a programação do pagamento das parcelas abaixo, com vencimento em *${data}*:\n\n${foco.map((t) => `• título ${nomeTitulo(t)} — ${moedaBr(t.valorCentavos)}`).join("\n")}\n\nTotal: *${moedaBr(foco.reduce((s, t) => s + t.valorCentavos, 0))}*.`;
  return [
    saudacao,
    abertura,
    `Você pode nos confirmar que o pagamento está programado para a data? Se precisar do boleto ou dos dados para PIX/transferência, é só avisar que enviamos na hora.`,
    "Ficamos à disposição. Obrigado!",
  ].join("\n\n");
}

/** Observação para quem envia (não vai na mensagem): as parcelas de vencimentos seguintes do mesmo cliente. */
export function observacaoDemaisParcelas(g: Pick<GrupoConfirmacao, "demais">): string {
  if (g.demais.length === 0) return "";
  return `Observação (não enviar ao cliente): ele tem também ${g.demais.length === 1 ? "esta parcela" : "estas parcelas"} nos próximos dias: ${g.demais.map((t) => `${nomeTitulo(t)} (${dataBr(t.vencimento)}, ${moedaBr(t.valorCentavos)})`).join("; ")}.`;
}

/** Descrição da pendência: o que confirmar, a observação e a mensagem pronta. */
export function descricaoPendenciaConfirmacao(g: GrupoConfirmacao, contato = ""): string {
  const linhas = g.titulos.map((t) => `• ${nomeTitulo(t)} — vence ${dataBr(t.vencimento)} — ${moedaBr(t.valorCentavos)}`);
  const obs = observacaoDemaisParcelas(g);
  return [
    g.unidade === "contagem" ? "Unidade: Filial Contagem. A cobrança desta unidade é tratada à parte da Matriz." : "",
    `Contate o cliente até o prazo para confirmar a programação do pagamento (total ${moedaBr(g.totalCentavos)}).`,
    linhas.join("\n"),
    obs,
    `Mensagem para o cliente (WhatsApp):\n\n${mensagemWhatsAppConfirmacao(g, contato)}`,
  ].filter(Boolean).join("\n\n");
}
