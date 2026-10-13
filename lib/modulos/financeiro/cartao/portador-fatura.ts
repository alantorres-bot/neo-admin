// Banco (portador) da fatura do cartão no Consistem (migration 0162; docs/modulos/financeiro-cartao.md, regras 56 a 60).
// Cada cartão tem um código de banco/portador próprio (crt_cartoes.portador_fatura). Ao fechar o mês, os títulos conciliados da
// fatura passam a esse portador (o financeiro filtra o borderô por ele); os que o painel lança para a fatura já nascem com ele.
import type { ResultadoConciliacao, TituloPagar } from "./conciliacao";

export type TituloParaTrocar = { cod_lancamento: string; num_documento: string; fornecedor: string; valor: number; portador_atual: number | null };

/** Os códigos de compra/encargos com o portador da fatura do cartão por cima (sem código, ficam como estão). */
export function comPortadorDaFatura<T extends { codPortador?: number }>(campos: T, portador: number | null | undefined): T {
  return portador ? { ...campos, codPortador: portador } : campos;
}

/**
 * Títulos da fatura que trocam de portador: os conciliados (e os demais títulos dos casamentos à mão), com código no Consistem.
 * Ficam de fora o provisório, as antecipações (já pagas), os que já estão num borderô e os que já estão no portador da fatura.
 */
export function titulosParaTrocar(resultado: Pick<ResultadoConciliacao, "conciliados">, opcoes: { portador: number; provisorio?: string | null }): TituloParaTrocar[] {
  const vistos = new Set<string>();
  const lista: TituloParaTrocar[] = [];
  const considerar = (t: TituloPagar) => {
    const cod = t.codLancamento?.trim();
    if (!cod || !/^\d{1,12}$/.test(cod) || vistos.has(cod)) return;
    vistos.add(cod);
    if (cod === opcoes.provisorio || t.antecipacao || t.emBordero || t.codBanco === String(opcoes.portador)) return;
    const atual = Number(t.codBanco);
    lista.push({ cod_lancamento: cod, num_documento: t.numeroTitulo, fornecedor: t.fornecedor, valor: t.valorCentavos / 100, portador_atual: Number.isInteger(atual) && atual > 0 ? atual : null });
  };
  for (const c of resultado.conciliados) {
    considerar(c.titulo);
    for (const t of c.titulosExtras ?? []) considerar(t);
  }
  return lista;
}
