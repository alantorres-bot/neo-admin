// GED — pasta → cliente, só sugestão (docs/modulos/administrativo-ged.md, 5.4.2 e 5.4.3).
// Nada é confirmado automaticamente, nem com nota 100: a pasta fica `sugerida` ou `sem_sugestao` até uma pessoa decidir.

import { somenteDigitos, validarCnpj } from "@/lib/nucleo/documentos";

/** Termos societários e de ramo retirados do nome (5.4.2; a lista é configurável). */
export const TERMOS_IGNORADOS_PADRAO = ["ltda", "sa", "me", "eireli", "construtora", "construcoes", "engenharia"];
// Conectivos retirados para que "X Engenharia e Construções" e "X" cheguem ao mesmo núcleo (detalhe técnico, 11.1).
const CONECTIVOS = ["e", "de", "da", "do", "das", "dos"];

/** Núcleo do nome: sem acento, minúsculo, sem sufixo de ano ("- 2026"), sem pontuação, sem termos societários. */
export function normalizarNomeCliente(nome: string, termos: readonly string[] = TERMOS_IGNORADOS_PADRAO): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*-\s*(19|20)\d{2}\s*$/, "")
    .replace(/\bs\s*\/\s*a\b|\bs\.a\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((p) => p !== "" && !termos.includes(p) && !CONECTIVOS.includes(p))
    .join(" ");
}

/** CNPJs válidos citados num texto (com ou sem máscara). */
export function cnpjsNoTexto(texto: string): string[] {
  const achados = texto.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) ?? [];
  return [...new Set(achados.map(somenteDigitos).filter(validarCnpj))];
}

export type ClienteCadastro = { id: string; nome: string; documento: string | null };
export type Candidato = { clienteId: string; nota: number; motivo: string };
export type Sugestao = { situacao: "sugerida" | "sem_sugestao"; candidatos: Candidato[] };

// shortcut: semelhança por palavras em comum (Jaccard) com corte fixo; trocar por um índice de similaridade do banco
// (pg_trgm) se a qualidade das sugestões não bastar.
const NOTA_MINIMA = 40;

function semelhanca(a: string, b: string): number {
  const x = new Set(a.split(" ").filter(Boolean));
  const y = new Set(b.split(" ").filter(Boolean));
  if (x.size === 0 || y.size === 0) return 0;
  const comuns = [...x].filter((p) => y.has(p)).length;
  return comuns / (x.size + y.size - comuns);
}

/**
 * Sugere até 3 clientes para uma pasta (`contrapartes` do tipo cliente, ativas). CNPJ válido no nome da pasta ou de um arquivo
 * dela vale nota 100; nome igual depois da normalização, 90; semelhança de palavras, até 80.
 */
export function sugerirCliente(nomePasta: string, nomesArquivos: readonly string[], clientes: readonly ClienteCadastro[]): Sugestao {
  const cnpjPasta = cnpjsNoTexto(nomePasta);
  const cnpjArquivos = nomesArquivos.flatMap(cnpjsNoTexto);
  const nucleo = normalizarNomeCliente(nomePasta);

  const candidatos = clientes
    .map((c): Candidato | null => {
      const doc = c.documento ? somenteDigitos(c.documento) : "";
      if (doc && cnpjPasta.includes(doc)) return { clienteId: c.id, nota: 100, motivo: "mesmo CNPJ no nome da pasta" };
      if (doc && cnpjArquivos.includes(doc)) return { clienteId: c.id, nota: 100, motivo: "mesmo CNPJ no nome do arquivo" };
      const outro = normalizarNomeCliente(c.nome);
      if (nucleo !== "" && outro === nucleo) return { clienteId: c.id, nota: 90, motivo: "nome igual após normalização" };
      const nota = Math.round(semelhanca(nucleo, outro) * 80);
      return nota >= NOTA_MINIMA ? { clienteId: c.id, nota, motivo: "nome parecido" } : null;
    })
    .filter((c): c is Candidato => c !== null)
    .sort((a, b) => b.nota - a.nota)
    .slice(0, 3);

  return { situacao: candidatos.length > 0 ? "sugerida" : "sem_sugestao", candidatos };
}
