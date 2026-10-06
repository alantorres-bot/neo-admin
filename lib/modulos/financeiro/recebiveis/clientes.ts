// Cadastro de contatos dos clientes (regras puras). Combinado com o usuário em 06/10/2026: por enquanto só se cadastram os
// contatos dos clientes de CUIABÁ (Matriz) que têm título em aberto a vencer ou vencido há MENOS de 60 dias; os antigos e os
// da Filial Contagem ficam para outro momento.

export const DIAS_ESCOPO_CADASTRO = 60;

export type TituloParaEscopo = { unidade: string; faixa: string; dias_atraso: number };

/** Este título coloca o cliente na lista de quem precisa ter contato cadastrado agora? */
export function titulaNoEscopoDeCadastro(t: TituloParaEscopo): boolean {
  return t.unidade === "matriz" && t.faixa !== "encerrado" && t.dias_atraso < DIAS_ESCOPO_CADASTRO;
}

/** O cliente precisa de contato agora se tiver pelo menos um título no escopo. */
export function clienteNoEscopoDeCadastro(titulos: readonly TituloParaEscopo[]): boolean {
  return titulos.some(titulaNoEscopoDeCadastro);
}
