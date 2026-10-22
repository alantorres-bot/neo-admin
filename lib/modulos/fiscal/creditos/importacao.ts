// Fiscal > Créditos tributários: importação de planilhas (créditos e movimentações). Aqui só a parte pura: modelo de colunas,
// mapeamento automático pelo título (o usuário pode trocar), normalização de formatos e erros de cada linha. Cadastros,
// escopo e duplicidades são conferidos no banco (fis_imp_preparar) e nada entra sem confirmação (fis_imp_confirmar).
import { decimal, lerCompetencia, lerData, lerValor } from "./formatos";

export type TipoImportacao = "creditos" | "movimentos";
export type Campo = { chave: string; titulo: string; obrigatorio: boolean; sinonimos: string[]; formato: "texto" | "valor" | "data" | "competencia" | "cnpj"; exemplo: string };

export const CAMPOS: Record<TipoImportacao, Campo[]> = {
  creditos: [
    { chave: "cnpj_estabelecimento", titulo: "CNPJ do estabelecimento", obrigatorio: true, sinonimos: ["cnpj", "estabelecimento", "cnpj estabelecimento"], formato: "cnpj", exemplo: "99.999.999/0001-91" },
    { chave: "tributo", titulo: "Tributo", obrigatorio: true, sinonimos: ["imposto", "codigo tributo"], formato: "texto", exemplo: "ICMS" },
    { chave: "categoria", titulo: "Categoria", obrigatorio: true, sinonimos: ["codigo categoria", "tipo de credito"], formato: "texto", exemplo: "ICMS_SALDO_CREDOR" },
    { chave: "origem", titulo: "Origem", obrigatorio: false, sinonimos: ["origem do credito"], formato: "texto", exemplo: "apuracao_mensal" },
    { chave: "competencia_origem", titulo: "Competência de origem", obrigatorio: true, sinonimos: ["competencia", "mes", "periodo"], formato: "competencia", exemplo: "01/2025" },
    { chave: "valor_original", titulo: "Valor original", obrigatorio: true, sinonimos: ["valor", "valor do credito"], formato: "valor", exemplo: "1.234,56" },
    { chave: "descricao", titulo: "Descrição", obrigatorio: true, sinonimos: ["historico", "descricao do credito"], formato: "texto", exemplo: "Saldo credor de ICMS" },
    { chave: "tipo_entrada", titulo: "Tipo do lançamento inicial", obrigatorio: false, sinonimos: ["tipo entrada", "tipo"], formato: "texto", exemplo: "credito_apurado" },
    { chave: "data_entrada", titulo: "Data do lançamento inicial", obrigatorio: false, sinonimos: ["data", "data entrada"], formato: "data", exemplo: "31/01/2025" },
    { chave: "data_reconhecimento", titulo: "Data de reconhecimento", obrigatorio: false, sinonimos: ["reconhecimento"], formato: "data", exemplo: "" },
    { chave: "numero_processo", titulo: "Número do processo", obrigatorio: false, sinonimos: ["processo"], formato: "texto", exemplo: "" },
    { chave: "documento_ref", titulo: "Documento comprobatório", obrigatorio: false, sinonimos: ["documento", "comprovante"], formato: "texto", exemplo: "Livro de apuração 01/2025" },
    { chave: "observacoes", titulo: "Observações", obrigatorio: false, sinonimos: ["obs", "observacao"], formato: "texto", exemplo: "" },
  ],
  movimentos: [
    { chave: "codigo_credito", titulo: "Código do crédito", obrigatorio: true, sinonimos: ["credito", "codigo"], formato: "texto", exemplo: "CR-2025-00001" },
    { chave: "tipo", titulo: "Tipo", obrigatorio: true, sinonimos: ["tipo de movimentacao", "movimentacao"], formato: "texto", exemplo: "utilizacao" },
    { chave: "competencia", titulo: "Competência", obrigatorio: true, sinonimos: ["mes", "periodo"], formato: "competencia", exemplo: "02/2025" },
    { chave: "data", titulo: "Data", obrigatorio: true, sinonimos: ["data do lancamento"], formato: "data", exemplo: "20/02/2025" },
    { chave: "valor", titulo: "Valor", obrigatorio: true, sinonimos: ["valor do lancamento"], formato: "valor", exemplo: "1.000,00" },
    { chave: "descricao", titulo: "Descrição", obrigatorio: true, sinonimos: ["historico"], formato: "texto", exemplo: "Dedução na apuração" },
    { chave: "protocolo", titulo: "Protocolo", obrigatorio: false, sinonimos: ["perdcomp", "per dcomp", "numero protocolo", "recibo"], formato: "texto", exemplo: "" },
    { chave: "processo", titulo: "Processo", obrigatorio: false, sinonimos: [], formato: "texto", exemplo: "" },
    { chave: "documento_ref", titulo: "Documento", obrigatorio: false, sinonimos: ["documento de suporte"], formato: "texto", exemplo: "" },
  ],
};

export const normalizarTitulo = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Mapeamento automático: índice da coluna do arquivo para cada campo (pelo título ou sinônimo). */
export function mapearAutomatico(tipo: TipoImportacao, cabecalho: readonly string[]): Record<string, number | null> {
  const titulos = cabecalho.map(normalizarTitulo);
  const usados = new Set<number>();
  const r: Record<string, number | null> = {};
  for (const c of CAMPOS[tipo]) {
    const nomes = [c.chave.replace(/_/g, " "), normalizarTitulo(c.titulo), ...c.sinonimos.map(normalizarTitulo)];
    let i = titulos.findIndex((t, k) => !usados.has(k) && nomes.includes(t));
    if (i < 0) i = -1;
    r[c.chave] = i >= 0 ? i : null;
    if (i >= 0) usados.add(i);
  }
  return r;
}

export type LinhaPreparada = { linha: number; dados: Record<string, string | null>; erros: string[] };

type Celula = string | number | Date | null | undefined;
function texto(v: Celula): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/**
 * Normaliza as linhas (matriz sem o cabeçalho; `primeiraLinha` = número da 1ª linha de dados na planilha) para o formato
 * do banco: datas 'AAAA-MM-DD', competência 'AAAA-MM-01', valores '1234.56', CNPJ só dígitos. Linhas vazias são ignoradas.
 */
export function prepararLinhas(tipo: TipoImportacao, matriz: readonly Celula[][], mapa: Record<string, number | null>, primeiraLinha = 2): LinhaPreparada[] {
  const r: LinhaPreparada[] = [];
  matriz.forEach((celulas, i) => {
    if (celulas.every((c) => texto(c) === "")) return;
    const dados: Record<string, string | null> = {};
    const erros: string[] = [];
    for (const c of CAMPOS[tipo]) {
      const idx = mapa[c.chave];
      const bruto = idx === null || idx === undefined ? undefined : celulas[idx];
      const t = texto(bruto);
      if (t === "") {
        dados[c.chave] = null;
        if (c.obrigatorio) erros.push(`${c.titulo}: obrigatório.`);
        continue;
      }
      switch (c.formato) {
        case "valor": {
          const v = lerValor(typeof bruto === "number" ? bruto : t);
          if (v.ok) dados[c.chave] = decimal(v.centavos);
          else { dados[c.chave] = null; erros.push(`${c.titulo}: ${v.erro}`); }
          break;
        }
        case "data": {
          const d = bruto instanceof Date ? bruto.toISOString().slice(0, 10) : lerData(t);
          dados[c.chave] = d;
          if (!d) erros.push(`${c.titulo}: data inválida ("${t}"), use dd/mm/aaaa.`);
          break;
        }
        case "competencia": {
          const d = bruto instanceof Date ? `${bruto.toISOString().slice(0, 7)}-01` : lerCompetencia(t) ?? (lerData(t) ? `${lerData(t)!.slice(0, 7)}-01` : null);
          dados[c.chave] = d;
          if (!d) erros.push(`${c.titulo}: competência inválida ("${t}"), use MM/AAAA.`);
          break;
        }
        case "cnpj": {
          const d = t.replace(/\D/g, "");
          dados[c.chave] = d;
          if (d.length !== 14) erros.push(`${c.titulo}: CNPJ deve ter 14 dígitos.`);
          break;
        }
        default:
          dados[c.chave] = t.slice(0, 500);
      }
    }
    if (tipo === "creditos" && dados.tipo_entrada && !["saldo_inicial", "credito_apurado", "credito_reconhecido"].includes(dados.tipo_entrada)) {
      erros.push("Tipo do lançamento inicial: use saldo_inicial, credito_apurado ou credito_reconhecido.");
    }
    if (dados.descricao && dados.descricao.length < 3) erros.push("Descrição: mínimo 3 caracteres.");
    r.push({ linha: primeiraLinha + i, dados, erros });
  });
  return r;
}

/** Modelo para download: cabeçalho + uma linha de exemplo. */
export function modelo(tipo: TipoImportacao): { cabecalho: string[]; exemplo: string[]; obrigatorios: boolean[] } {
  return { cabecalho: CAMPOS[tipo].map((c) => c.titulo), exemplo: CAMPOS[tipo].map((c) => c.exemplo), obrigatorios: CAMPOS[tipo].map((c) => c.obrigatorio) };
}
