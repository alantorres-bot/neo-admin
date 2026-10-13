// Marcas da fatura do cartão nos títulos do Consistem: banco (portador) e histórico (migrations 0162 e 0164;
// docs/modulos/financeiro-cartao.md, regras 56 a 60). Cada cartão tem um portador (crt_cartoes.portador_fatura) e um histórico
// (historico_fatura) próprios. Ao fechar o mês, os títulos conciliados da fatura recebem os dois (o borderô CCFFE065 filtra pelo
// histórico); os que o painel lança para a fatura já nascem com eles.
import type { ResultadoConciliacao, TituloPagar } from "./conciliacao";

export type MarcasCartao = { portador: number | null | undefined; historico?: number | null };
export type TituloParaTrocar = {
  cod_lancamento: string; num_documento: string; fornecedor: string; valor: number; portador_atual: number | null; historico_atual: number | null;
};

const codigo = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Os códigos de compra/encargos com o portador e o histórico da fatura do cartão por cima (sem código, ficam como estão). */
export function comMarcasDaFatura<T extends { codPortador?: number; codHistorico?: number }>(campos: T, marcas: MarcasCartao): T {
  return {
    ...campos,
    ...(marcas.portador ? { codPortador: marcas.portador } : {}),
    ...(marcas.historico ? { codHistorico: marcas.historico } : {}),
  };
}

/**
 * Títulos da fatura que recebem as marcas: os conciliados (e os demais títulos dos casamentos à mão), com código no Consistem.
 * Ficam de fora o provisório, as antecipações (já pagas), os que já estão num borderô e os que já têm o portador e o histórico.
 */
export function titulosParaTrocar(resultado: Pick<ResultadoConciliacao, "conciliados">, opcoes: { portador: number; historico?: number | null; provisorio?: string | null }): TituloParaTrocar[] {
  const vistos = new Set<string>();
  const lista: TituloParaTrocar[] = [];
  const considerar = (t: TituloPagar) => {
    const cod = t.codLancamento?.trim();
    if (!cod || !/^\d{1,12}$/.test(cod) || vistos.has(cod)) return;
    vistos.add(cod);
    if (cod === opcoes.provisorio || t.antecipacao || t.emBordero) return;
    const portador = codigo(t.codBanco);
    const historico = codigo(t.codHistorico);
    if (portador === opcoes.portador && (!opcoes.historico || historico === opcoes.historico)) return;
    lista.push({ cod_lancamento: cod, num_documento: t.numeroTitulo, fornecedor: t.fornecedor, valor: t.valorCentavos / 100, portador_atual: portador, historico_atual: historico });
  };
  for (const c of resultado.conciliados) {
    considerar(c.titulo);
    for (const t of c.titulosExtras ?? []) considerar(t);
  }
  return lista;
}
