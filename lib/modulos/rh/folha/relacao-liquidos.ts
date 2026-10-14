// "Relação Geral dos Líquidos" do escritório de contabilidade (.xls): interpretação e casamento com a folha do mês.
// Regras em docs/modulos/rh-folha.md, seção 4 e regra 12. Um arquivo por empresa e por cálculo; cada pessoa é casada pelo
// código do escritório (rh_colaboradores.matricula_escritorio) dentro da empresa empregadora. A soma das linhas tem de bater
// com o "Total da Empresa" — senão o arquivo é recusado (leitura incompleta daria valor errado na folha).
import type { PlanilhaXls, ValorXls } from "@/lib/integracoes/importador/xls";
import type { Natureza } from "./modulo";

/** CNPJ (só dígitos) → empresa empregadora como está no cadastro (coluna EMPRESA das planilhas). */
export const EMPREGADOR_POR_CNPJ: Record<string, string> = {
  "45513941000167": "NEO SERVIÇOS",   // Neo Formas Serviços de Manutenção de Metais (escritório: 23)
  "03070443000147": "OESTE",          // Oeste Formas para Concreto (escritório: 21)
  "17209767000128": "NEO FORMAS",     // Neo Formas para Concreto
};

export type PessoaRelacao = { codigo: string; nome: string; centavos: number };
export type Relacao = {
  empresa: string; cnpj: string; empregador: string; calculo: string; natureza: Exclude<Natureza, "avulso">;
  competencia: string; pessoas: PessoaRelacao[]; totalCentavos: number;
};

const normalizar = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const centavos = (n: number) => Math.round(n * 100);
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Excel guarda data como número de série (dias desde 30/12/1899). */
function competenciaDe(v: ValorXls | null | undefined): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  const m = /^(\d{2})\/(\d{4})$/.exec(String(v ?? "").trim());
  return m ? `${m[2]}-${m[1]}-01` : null;
}

export function naturezaDoCalculo(calculo: string): Exclude<Natureza, "avulso"> | null {
  const c = normalizar(calculo);
  if (/13/.test(c)) return "decimo_terceiro";
  if (/FERIAS/.test(c)) return "ferias_acrescimos";
  if (/FOLHA MENSAL/.test(c)) return "liquido";
  return null;
}

export function interpretarRelacao(planilha: PlanilhaXls): { ok: true; relacao: Relacao } | { ok: false; erro: string } {
  const linhas = planilha.linhas;
  const valorAoLado = (rotulo: string): ValorXls | null => {
    for (const l of linhas) {
      const i = l?.findIndex((c) => normalizar(c) === normalizar(rotulo)) ?? -1;
      if (i >= 0) return l.slice(i + 1).find((c) => c !== null && String(c).trim() !== "") ?? null;
    }
    return null;
  };
  if (!linhas.some((l) => l?.some((c) => normalizar(c) === "RELACAO GERAL DOS LIQUIDOS"))) {
    return { ok: false, erro: "O arquivo não é a \"Relação Geral dos Líquidos\" do escritório." };
  }
  const empresa = String(valorAoLado("Empresa:") ?? "").trim();
  const cnpj = String(valorAoLado("CNPJ:") ?? "").replace(/\D/g, "").padStart(14, "0");
  const calculo = String(valorAoLado("Cálculo:") ?? "").trim();
  const competencia = competenciaDe(valorAoLado("Competência:"));
  const empregador = EMPREGADOR_POR_CNPJ[cnpj];
  if (!empregador) return { ok: false, erro: `CNPJ ${cnpj} (${empresa}) não é de uma empresa da folha.` };
  const natureza = naturezaDoCalculo(calculo);
  if (!natureza) return { ok: false, erro: `Cálculo "${calculo}" desconhecido: esperado Folha Mensal, 13º ou Férias.` };
  if (!competencia) return { ok: false, erro: "Competência não encontrada no cabeçalho do relatório." };

  // Colunas pelo cabeçalho "Código | Nome do empregado | Identidade | Valor" (o valor fica na última coluna numérica da linha).
  const cab = linhas.find((l) => l?.some((c) => normalizar(c).startsWith("CODIGO")) && l.some((c) => normalizar(c).startsWith("NOME DO EMPREGADO")));
  if (!cab) return { ok: false, erro: "Cabeçalho \"Código / Nome do empregado\" não encontrado." };
  const colCodigo = cab.findIndex((c) => normalizar(c).startsWith("CODIGO"));
  const colNome = cab.findIndex((c) => normalizar(c).startsWith("NOME DO EMPREGADO"));
  const colIdent = cab.findIndex((c) => normalizar(c) === "IDENTIDADE");
  const depoisDe = Math.max(colNome, colIdent);

  const pessoas: PessoaRelacao[] = [];
  let totalCentavos: number | null = null;
  for (const l of linhas) {
    if (!l) continue;
    const ultimoNumero = [...l.entries()].filter(([i, c]) => i > depoisDe && typeof c === "number").pop()?.[1] as number | undefined;
    if (l.some((c) => normalizar(c).startsWith("TOTAL DA EMPRESA"))) {
      const n = [...l].reverse().find((c): c is number => typeof c === "number");
      if (n !== undefined) totalCentavos = centavos(n);
      continue;
    }
    const cod = l[colCodigo];
    if (typeof cod === "number" && Number.isInteger(cod) && typeof l[colNome] === "string" && ultimoNumero !== undefined) {
      pessoas.push({ codigo: String(cod), nome: String(l[colNome]).replace(/\s+/g, " ").trim(), centavos: centavos(ultimoNumero) });
    }
  }
  if (!pessoas.length) return { ok: false, erro: "Nenhuma pessoa encontrada no relatório." };
  if (totalCentavos === null) return { ok: false, erro: "\"Total da Empresa\" não encontrado no relatório." };
  const soma = pessoas.reduce((s, p) => s + p.centavos, 0);
  if (soma !== totalCentavos) {
    return { ok: false, erro: `A soma das linhas (R$ ${reais(soma)}) não bate com o Total da Empresa (R$ ${reais(totalCentavos)}): o arquivo não foi lido por inteiro.` };
  }
  const repetidos = pessoas.filter((p, i) => pessoas.findIndex((q) => q.codigo === p.codigo) !== i);
  if (repetidos.length) return { ok: false, erro: `Código do escritório repetido no relatório: ${[...new Set(repetidos.map((p) => p.codigo))].join(", ")}.` };
  return { ok: true, relacao: { empresa, cnpj, empregador, calculo, natureza, competencia, pessoas, totalCentavos } };
}

export type ItemCasavel = { id: string; nome: string; empregador: string; matricula_escritorio: string | null } & Record<Exclude<Natureza, "avulso">, number>;
export type Casamento = {
  casados: { item_id: string; nome: string; codigo: string; atualCentavos: number; novoCentavos: number }[];
  semCadastro: PessoaRelacao[];
  /** Pessoas da mesma empresa com valor nessa natureza que não vieram no relatório (ficam como estão). */
  foraDoRelatorio: { item_id: string; nome: string; atualCentavos: number }[];
};

/** Casa as pessoas do relatório com a folha do mês pelo código do escritório, dentro da empresa. `ligacoes`: código → item escolhido pelo operador. */
export function casarRelacao(rel: Relacao, itens: readonly ItemCasavel[], ligacoes: Record<string, string> = {}): Casamento {
  const daEmpresa = itens.filter((i) => i.empregador === rel.empregador);
  const porCodigo = new Map(daEmpresa.filter((i) => i.matricula_escritorio).map((i) => [i.matricula_escritorio!, i]));
  const porId = new Map(itens.map((i) => [i.id, i]));
  const casados: Casamento["casados"] = [];
  const semCadastro: PessoaRelacao[] = [];
  const usados = new Set<string>();
  for (const p of rel.pessoas) {
    const item = (ligacoes[p.codigo] && porId.get(ligacoes[p.codigo])) || porCodigo.get(p.codigo);
    if (!item || usados.has(item.id)) { semCadastro.push(p); continue; }
    usados.add(item.id);
    casados.push({ item_id: item.id, nome: item.nome, codigo: p.codigo, atualCentavos: centavos(item[rel.natureza]), novoCentavos: p.centavos });
  }
  const foraDoRelatorio = daEmpresa
    .filter((i) => !usados.has(i.id) && i[rel.natureza] > 0)
    .map((i) => ({ item_id: i.id, nome: i.nome, atualCentavos: centavos(i[rel.natureza]) }));
  return { casados, semCadastro, foraDoRelatorio };
}
