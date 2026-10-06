// Esteira de um título: a sequência de passos (boleto, envio, confirmação, vencimento, cobranças D+n, pagamento) com o que já
// foi feito, o que está na vez e o que vem depois. Regras puras: a tela da ficha só desenha o resultado.
import { DIAS_CONTATO_ANTES, DIAS_JANELA_CONFIRMACAO } from "../../../../supabase/functions/_shared/confirmacao";
import { MARCOS_COBRANCA } from "../../../../supabase/functions/_shared/cobranca";

export type EstadoEtapa = "feita" | "atual" | "pendente" | "fora";

export type Etapa = {
  chave: string;
  rotulo: string;
  estado: EstadoEtapa;
  /** Data (aaaa-mm-dd ou ISO) em que foi feita, quando se sabe. */
  quando: string | null;
  /** Complemento curto: prazo, resultado, motivo de estar fora. */
  detalhe: string | null;
};

export type TituloEsteira = {
  estagio: string;
  vencimento: string; // aaaa-mm-dd
  boletoAnexado: boolean;
  boletoEnviadoEm: string | null;
  dataPagamento: string | null;
  reguaPausadaAte: string | null;
  /** A régua de cobrança vale para este título (vencimento a partir da data de corte, não cedido nem contestado). */
  reguaAplica: boolean;
};

export type InteracaoEsteira = { tipo: string; criado_em: string; descricao: string | null };

const diaDe = (iso: string) => iso.slice(0, 10);
const dataBr = (iso: string) => diaDe(iso).split("-").reverse().join("/");
const dataCurta = (iso: string) => dataBr(iso).slice(0, 5);
const somar = (iso: string, dias: number) => new Date(Date.parse(`${diaDe(iso)}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${diaDe(a)}T00:00:00Z`) - Date.parse(`${diaDe(b)}T00:00:00Z`)) / 86_400_000);

const maisRecente = (lista: readonly InteracaoEsteira[], pred: (i: InteracaoEsteira) => boolean) =>
  [...lista].filter(pred).sort((a, b) => b.criado_em.localeCompare(a.criado_em))[0];

/** O D+n a que uma interação de cobrança se refere ("Cobrança D+5 ..."). */
const marcoDaInteracao = (i: InteracaoEsteira): number | null => {
  const m = /D\+(\d+)/.exec(i.descricao ?? "");
  return m ? Number(m[1]) : null;
};

/** Monta a sequência de passos do título, na ordem em que acontecem. `hoje` é aaaa-mm-dd (Cuiabá). */
export function montarEsteira(t: TituloEsteira, interacoes: readonly InteracaoEsteira[], hoje: string): Etapa[] {
  const encerrado = ["pago", "cancelado", "renegociado"].includes(t.estagio);
  const diasAtraso = Math.max(diasEntre(hoje, t.vencimento), 0);
  const etapas: Etapa[] = [];

  // 1) Boleto anexado
  const enviado = maisRecente(interacoes, (i) => i.tipo === "boleto_enviado");
  const enviadoEm = t.boletoEnviadoEm ?? enviado?.criado_em ?? null;
  const boletoFeito = t.boletoAnexado || enviadoEm !== null;
  etapas.push({
    chave: "boleto", rotulo: "Boleto anexado", quando: null,
    estado: boletoFeito ? "feita" : t.estagio === "aguardando_boleto" ? "atual" : encerrado ? "fora" : "fora",
    detalhe: boletoFeito ? null : t.estagio === "aguardando_boleto" ? "falta anexar o PDF" : "não registrado no sistema",
  });

  // 2) Boleto enviado
  etapas.push({
    chave: "envio", rotulo: "Boleto enviado", quando: enviadoEm,
    estado: enviadoEm ? "feita" : t.estagio === "aguardando_boleto" && t.boletoAnexado ? "atual" : t.estagio === "aguardando_boleto" ? "pendente" : "fora",
    detalhe: enviadoEm ? null : t.estagio === "aguardando_boleto" ? (t.boletoAnexado ? "falta registrar o envio" : null) : "não registrado no sistema",
  });

  // 3) Confirmação do pagamento (4 dias antes do vencimento; a janela abre 7 dias antes)
  const confirmou = maisRecente(interacoes, (i) => i.tipo === "confirmacao");
  const semResposta = maisRecente(interacoes, (i) => i.tipo === "sem_resposta_confirmacao");
  let confirmacao: Etapa;
  if (confirmou || t.estagio === "confirmado_cliente") {
    confirmacao = { chave: "confirmacao", rotulo: "Confirmação do pagamento", estado: "feita", quando: confirmou?.criado_em ?? null, detalhe: "cliente confirmou" };
  } else if (t.vencimento < hoje || encerrado) {
    confirmacao = { chave: "confirmacao", rotulo: "Confirmação do pagamento", estado: "fora", quando: semResposta?.criado_em ?? null, detalhe: semResposta ? "sem resposta do cliente" : "não feita" };
  } else if (diasEntre(t.vencimento, hoje) <= DIAS_JANELA_CONFIRMACAO) {
    confirmacao = {
      chave: "confirmacao", rotulo: "Confirmação do pagamento", estado: "atual", quando: null,
      detalhe: semResposta ? `sem resposta em ${dataCurta(semResposta.criado_em)}; ligar` : `contatar até ${dataCurta(somar(t.vencimento, -DIAS_CONTATO_ANTES))}`,
    };
  } else {
    confirmacao = { chave: "confirmacao", rotulo: "Confirmação do pagamento", estado: "pendente", quando: null, detalhe: `a partir de ${dataCurta(somar(t.vencimento, -DIAS_JANELA_CONFIRMACAO))}` };
  }
  etapas.push(confirmacao);

  // 4) Vencimento
  etapas.push({
    chave: "vencimento", rotulo: "Vencimento", quando: t.vencimento, estado: t.vencimento < hoje || (encerrado && t.vencimento <= hoje) ? "feita" : "pendente",
    detalhe: t.vencimento < hoje ? `${diasAtraso} ${diasAtraso === 1 ? "dia" : "dias"} de atraso` : t.vencimento === hoje ? "vence hoje" : `em ${diasEntre(t.vencimento, hoje)} dias`,
  });

  // 5) Cobranças D+n
  for (const m of MARCOS_COBRANCA) {
    const feita = maisRecente(interacoes, (i) => ["cobranca", "promessa", "contestacao"].includes(i.tipo) && marcoDaInteracao(i) === m.dias);
    let estado: EstadoEtapa;
    let detalhe: string | null;
    if (feita) {
      estado = "feita";
      detalhe = feita.tipo === "promessa" ? "cliente prometeu pagar" : feita.tipo === "contestacao" ? "cliente contestou" : "cobrança enviada";
    } else if (!t.reguaAplica || encerrado) {
      estado = "fora";
      detalhe = encerrado ? null : "fora da régua";
    } else if (diasAtraso >= m.dias) {
      estado = "atual";
      detalhe = "na vez: cobrar";
    } else {
      estado = "pendente";
      detalhe = `a partir de ${dataCurta(somar(t.vencimento, m.dias))}`;
    }
    etapas.push({ chave: `d${m.dias}`, rotulo: `Cobrança ${m.nome}`, estado, quando: feita?.criado_em ?? null, detalhe });
  }

  // 6) Promessa de pagamento (só aparece quando houve)
  if (t.estagio === "promessa" || maisRecente(interacoes, (i) => i.tipo === "promessa")) {
    etapas.push({
      chave: "promessa", rotulo: "Promessa de pagamento", quando: null,
      estado: t.estagio === "promessa" && t.reguaPausadaAte && t.reguaPausadaAte >= hoje ? "atual" : "feita",
      detalhe: t.reguaPausadaAte ? `régua pausada até ${dataBr(t.reguaPausadaAte)}` : null,
    });
  }

  // 7) Pagamento
  etapas.push({
    chave: "pago", rotulo: t.estagio === "cancelado" ? "Cancelado" : t.estagio === "renegociado" ? "Renegociado" : "Pago",
    quando: t.dataPagamento, estado: encerrado ? "feita" : "pendente", detalhe: null,
  });
  return etapas;
}
