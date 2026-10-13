// Ficha de implantação da fatura da filial no Consistem, na ordem da rotina CCFT040 (POP "Implantação de Faturas de
// Locação"): cabeçalho, aba Item, PIS/COFINS, Totais e "Altera Valor Título". Os campos fixos vêm da configuração
// financeiro.filial.implantacao (migration 0149); os variáveis, da nota lida (emissão, NF, cliente, valor, vencimentos).
// Regra pura: monta a ficha e os alertas; a tela só desenha.
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import type { ParcelaInformada } from "./remessa";

export type ConfigImplantacao = {
  rotina: string;
  tipo_nota: string;
  representante: string;
  condicao_venda: string;
  produto: string;
  classificacao_fiscal: string;
  pis: string;
  cofins: string;
};

/** Valores do POP; valem se a configuração não existir ou vier incompleta. */
export const CONFIG_IMPLANTACAO_PADRAO: ConfigImplantacao = {
  rotina: "CCFT040 — Implantação de Notas Fiscais – Antiga",
  tipo_nota: "12 — FAT LOCAÇÃO",
  representante: "5 — LUCAS DE MOURA SILVA",
  condicao_venda: "1",
  produto: "2.09.002.0024 — LOCAÇÃO DE BENS MÓVEIS",
  classificacao_fiscal: "11837 — OUTRAS",
  pis: "1,65%",
  cofins: "7,60%",
};

export function lerConfigImplantacao(v: unknown): ConfigImplantacao {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const pegar = (k: keyof ConfigImplantacao) => (typeof o[k] === "string" && (o[k] as string).trim() !== "" ? (o[k] as string) : CONFIG_IMPLANTACAO_PADRAO[k]);
  return Object.fromEntries((Object.keys(CONFIG_IMPLANTACAO_PADRAO) as (keyof ConfigImplantacao)[]).map((k) => [k, pegar(k)])) as ConfigImplantacao;
}

/** Campo da ficha. `copiar` = o texto exatamente como se digita no Consistem (botão copiar); fixo = não muda de nota para nota. */
export type CampoFicha = { rotulo: string; valor: string; copiar: string | null; fixo: boolean; detalhe?: string };
export type SecaoFicha = { titulo: string; campos: CampoFicha[] };

export type KitParaFicha = {
  nota: string;
  emissao: string | null;
  clienteNome: string;
  clienteDocumento: string | null;
  clienteCodigoErp: string | null;
  /** Já conferido no Consistem (com ou sem código). */
  clienteConferido: boolean;
  parcelas: ParcelaInformada[];
};

export type FichaImplantacao = { secoes: SecaoFicha[]; alertas: string[]; totalCentavos: number };

const dataBr = (iso: string) => iso.split("-").reverse().join("/");
/** dd/mm/aa: como a tela "Altera Valor Título" mostra. */
const dataCurta = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
};
/** Número como se digita no Consistem: sem "R$" e sem separador de milhar (o campo aceita 1234,56). */
const numeroDigitavel = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");
const nfSemZeros = (nota: string) => String(Number(nota));

export function montarFichaImplantacao(kit: KitParaFicha, cfg: ConfigImplantacao): FichaImplantacao {
  const alertas: string[] = [];
  const total = kit.parcelas.reduce((s, p) => s + p.valorCentavos, 0);
  const parcelas = [...kit.parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const fixo = (rotulo: string, valor: string, detalhe?: string): CampoFicha => ({ rotulo, valor, copiar: null, fixo: true, detalhe });
  const variavel = (rotulo: string, valor: string, copiar: string | null, detalhe?: string): CampoFicha => ({ rotulo, valor, copiar, fixo: false, detalhe });

  if (!kit.emissao) alertas.push("Sem data de emissão: confira na nota.");
  if (!kit.clienteCodigoErp) {
    alertas.push(
      kit.clienteConferido
        ? `Cliente não cadastrado no Consistem${kit.clienteDocumento ? ` (${kit.clienteDocumento})` : ""}: cadastrar antes de implantar.`
        : kit.clienteDocumento
          ? `Código do cliente ainda não conferido no Consistem (${kit.clienteDocumento}): use "Conferir clientes no Consistem".`
          : "Sem CNPJ/CPF do cliente na nota: procure o cliente no Consistem pelo nome.",
    );
  }
  if (parcelas.length === 0) alertas.push("Sem vencimento e valor: confira na nota.");

  const cliente = kit.clienteCodigoErp
    ? variavel("Cliente", `${kit.clienteCodigoErp} — ${kit.clienteNome}`, kit.clienteCodigoErp, kit.clienteDocumento ?? undefined)
    : variavel("Cliente", `? — ${kit.clienteNome}`, null, kit.clienteDocumento ?? undefined);

  const secoes: SecaoFicha[] = [
    {
      titulo: "Cabeçalho",
      campos: [
        variavel("Data Emissão", kit.emissao ? dataBr(kit.emissao) : "—", kit.emissao ? dataBr(kit.emissao) : null),
        variavel("Nota Fiscal", nfSemZeros(kit.nota), nfSemZeros(kit.nota)),
        fixo("Tipo de Nota", cfg.tipo_nota),
        cliente,
        fixo("Representante", cfg.representante, "clientes de Minas Gerais"),
        fixo("Condição Venda", cfg.condicao_venda, "provisória: o vencimento é corrigido no fim"),
      ],
    },
    {
      titulo: "Aba Item",
      campos: [
        fixo("Produto", cfg.produto),
        fixo("Classificação Fiscal", cfg.classificacao_fiscal),
        fixo("Quantidade", "1"),
        variavel("Preço Unitário / Valor Item", total ? formatarMoeda(total) : "—", total ? numeroDigitavel(total) : null),
      ],
    },
    { titulo: "PIS/COFINS", campos: [fixo("Conferir alíquotas", `PIS ${cfg.pis} · COFINS ${cfg.cofins}`, "e salvar")] },
    { titulo: "Abas Outros e Placas", campos: [fixo("Salvar", "Enter até habilitar o Salvar")] },
    { titulo: "Aba Totais", campos: [variavel("Valor Total (conferir)", total ? formatarMoeda(total) : "—", total ? numeroDigitavel(total) : null)] },
    {
      titulo: "Confirma → \"Altera vencimento/valor de duplicatas?\" Sim → Altera Valor Título",
      campos: parcelas.length === 0
        ? [variavel("Vencimento", "—", null)]
        : parcelas.map((p, i) => variavel(
          parcelas.length === 1 ? "Vencimento e valor" : `Parcela ${i + 1}`,
          `${dataCurta(p.vencimento)} · ${formatarMoeda(p.valorCentavos)}`,
          dataCurta(p.vencimento),
          `valor ${numeroDigitavel(p.valorCentavos)}`,
        )),
    },
  ];
  return { secoes, alertas, totalCentavos: total };
}
