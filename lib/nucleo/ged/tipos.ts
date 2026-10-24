// GED — tipo documental sugerido por regras de nome (docs/modulos/administrativo-ged.md, 5.5).
// As regras vêm do catálogo `ged_regras_tipo` (o admin cadastra); nenhuma regra de nome é fixada no código [PENDENTE 6].
// O tipo confirmado por uma pessoa nunca é sobrescrito.

import { normalizar } from "@/lib/nucleo/tabela";

export type Finalidade = "elaboracao" | "dossie_cliente" | "tematica";
export type FuncaoPasta = "modelos" | "trabalho";
export type TipoSituacao = "sugerido" | "confirmado" | "sem_tipo";

export type RegraTipo = {
  tipo: string;
  expressao: string;
  /** Menor número = avaliada primeiro. */
  prioridade: number;
  finalidade?: Finalidade;
  funcaoPasta?: FuncaoPasta;
};

export type DocumentoClassificavel = {
  nome: string;
  finalidade: Finalidade;
  funcaoPasta?: FuncaoPasta | null;
  tipo: string | null;
  tipoSituacao: TipoSituacao;
};

export type Classificacao = { tipo: string | null; tipoSituacao: TipoSituacao; modeloSituacao?: "nao_avaliado" };

/**
 * "Documentação cadastral" que a raiz `elaboracao` não sugere. PROVISÓRIO: a especificação não lista os códigos.
 * shortcut: leitura do assistente (cartão CNPJ, contrato social, procuração); substituir pelo catálogo final [PENDENTE 6 (GED)].
 */
export const TIPOS_CADASTRAIS_PROVISORIOS: readonly string[] = ["cartao_cnpj", "contrato_social", "procuracao"];

/** Tipos que a raiz não deixa sugerir (5.5, cautela 4); continuam classificáveis à mão. */
export const TIPOS_NAO_SUGERIDOS: Record<Finalidade, readonly string[]> = {
  elaboracao: ["contrato_assinado", "nf_venda", "nf_remessa", "boleto", ...TIPOS_CADASTRAIS_PROVISORIOS],
  dossie_cliente: ["modelo_contrato"],
  tematica: [],
};

export class ErroRegraTipo extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroRegraTipo";
  }
}

/** Compila as regras uma vez, na ordem de prioridade. Expressão inválida é erro de configuração. */
export function prepararRegras(regras: readonly RegraTipo[]): (RegraTipo & { re: RegExp })[] {
  return [...regras]
    .sort((a, b) => a.prioridade - b.prioridade)
    .map((r) => {
      try {
        return { ...r, re: new RegExp(r.expressao) };
      } catch {
        throw new ErroRegraTipo(`Expressão inválida na regra do tipo "${r.tipo}".`);
      }
    });
}

/**
 * Sugere o tipo. Confirmado: devolve como está. Arquivo em pasta de modelos da elaboração: `modelo_contrato` não avaliado
 * (cautela 1). Senão, a primeira regra que casa com o nome normalizado, respeitando finalidade, função da pasta e os
 * limites da raiz; nenhuma casando: `sem_tipo`.
 */
export function classificarTipo(doc: DocumentoClassificavel, regras: ReturnType<typeof prepararRegras>): Classificacao {
  if (doc.tipoSituacao === "confirmado") return { tipo: doc.tipo, tipoSituacao: "confirmado" };
  if (doc.finalidade === "elaboracao" && doc.funcaoPasta === "modelos") {
    return { tipo: "modelo_contrato", tipoSituacao: "sugerido", modeloSituacao: "nao_avaliado" };
  }
  const nome = normalizar(doc.nome);
  const bloqueados = TIPOS_NAO_SUGERIDOS[doc.finalidade];
  const regra = regras.find(
    (r) =>
      !bloqueados.includes(r.tipo) &&
      (r.finalidade === undefined || r.finalidade === doc.finalidade) &&
      (r.funcaoPasta === undefined || r.funcaoPasta === doc.funcaoPasta) &&
      r.re.test(nome),
  );
  return regra ? { tipo: regra.tipo, tipoSituacao: "sugerido" } : { tipo: null, tipoSituacao: "sem_tipo" };
}
