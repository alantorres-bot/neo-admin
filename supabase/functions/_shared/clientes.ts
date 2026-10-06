// Cadastro de contatos dos clientes (regras puras, sem imports). Combinado com o usuário em 06/10/2026: por enquanto só se
// cadastram os contatos dos clientes de CUIABÁ (Matriz) com título em aberto a vencer ou vencido há MENOS de 60 dias; os
// antigos e os da Filial Contagem ficam para outro momento. Usado pela tela (selo "Sem contato") e pela Edge Function de
// sincronização (pendências "Cadastrar contato" e "Conferir cadastro").

export const DIAS_ESCOPO_CADASTRO = 60;
export const PREFIXO_CADASTRAR_CONTATO = "Cadastrar contato";
export const PREFIXO_CONFERIR_CADASTRO = "Conferir cadastro";
/** Mais pendências novas que isto de uma vez = provável erro de configuração: nenhuma é aberta. */
export const TRAVA_PENDENCIAS_CADASTRO = 80;

export type TituloParaEscopo = { unidade: string; faixa: string; dias_atraso: number };

/** Este título coloca o cliente na lista de quem precisa ter contato cadastrado agora? */
export function titulaNoEscopoDeCadastro(t: TituloParaEscopo): boolean {
  return t.unidade === "matriz" && t.faixa !== "encerrado" && t.dias_atraso < DIAS_ESCOPO_CADASTRO;
}

/** O cliente precisa de contato agora se tiver pelo menos um título no escopo. */
export function clienteNoEscopoDeCadastro(titulos: readonly TituloParaEscopo[]): boolean {
  return titulos.some(titulaNoEscopoDeCadastro);
}

// ---------------------------------------------------------------- pendências

export type TituloDoCliente = { documento: string; parcela: string; vencimento: string; valorCentavos: number };

export type ClienteParaCadastro = {
  id: string;
  nome: string;
  /** CPF/CNPJ gravado no cadastro (nulo = ausente, inválido ou repetido). */
  documento: string | null;
  /** Títulos em aberto da Matriz no escopo do cadastro. */
  titulos: TituloDoCliente[];
  /** O cliente tem pelo menos um contato ativo com e-mail, WhatsApp ou telefone. */
  temContato: boolean;
};

export type PlanoCadastro = { semContato: ClienteParaCadastro[]; semDocumento: ClienteParaCadastro[] };

/** Entre os clientes que têm título no escopo: quem não tem contato e quem não tem CPF/CNPJ. Mais urgente primeiro. */
export function planejarCadastro(clientes: readonly ClienteParaCadastro[]): PlanoCadastro {
  const comTitulo = clientes.filter((c) => c.titulos.length > 0);
  const menorVencimento = (c: ClienteParaCadastro) => c.titulos.reduce((m, t) => (t.vencimento < m ? t.vencimento : m), "9999-12-31");
  const ordenar = (lista: ClienteParaCadastro[]) => [...lista].sort((a, b) => menorVencimento(a).localeCompare(menorVencimento(b)) || a.nome.localeCompare(b.nome, "pt-BR"));
  return {
    semContato: ordenar(comTitulo.filter((c) => !c.temContato)),
    semDocumento: ordenar(comTitulo.filter((c) => !c.documento)),
  };
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const moedaBr = (centavos: number) => {
  const [inteiro, frac] = (Math.abs(centavos) / 100).toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const nomeTitulo = (t: Pick<TituloDoCliente, "documento" | "parcela">) => `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`;

export const tituloPendenciaContato = (nome: string) => `${PREFIXO_CADASTRAR_CONTATO}: ${nome.trim() || "cliente"}`;
export const tituloPendenciaCadastro = (nome: string) => `${PREFIXO_CONFERIR_CADASTRO}: ${nome.trim() || "cliente"}`;

/** Alta quando o cliente tem título vencido ou vencendo em até 7 dias; normal nos demais. */
export function criticidadeCadastro(c: Pick<ClienteParaCadastro, "titulos">, hoje: string): "alta" | "normal" {
  return c.titulos.some((t) => diasEntre(t.vencimento, hoje) <= 7) ? "alta" : "normal";
}

function resumoTitulos(c: Pick<ClienteParaCadastro, "titulos">): string {
  const ordenados = [...c.titulos].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const total = ordenados.reduce((s, t) => s + t.valorCentavos, 0);
  const linhas = ordenados.slice(0, 5).map((t) => `• ${nomeTitulo(t)} — vence ${dataBr(t.vencimento)} — ${moedaBr(t.valorCentavos)}`);
  const resto = ordenados.length > 5 ? `\n… e mais ${ordenados.length - 5}.` : "";
  return `${ordenados.length} ${ordenados.length === 1 ? "título em aberto" : "títulos em aberto"}, total ${moedaBr(total)}:\n${linhas.join("\n")}${resto}`;
}

export function descricaoPendenciaContato(c: ClienteParaCadastro): string {
  return [
    "Este cliente ainda não tem contato cadastrado (e-mail, WhatsApp ou telefone). Sem ele não dá para enviar o boleto, confirmar o pagamento nem cobrar.",
    resumoTitulos(c),
    "Abra a ficha do cliente e cadastre o contato: a pendência se conclui sozinha.",
  ].join("\n\n");
}

export function descricaoPendenciaCadastro(c: ClienteParaCadastro): string {
  return [
    "O CPF/CNPJ deste cliente está ausente, inválido ou repetido em outro cadastro. Sem ele o cliente pode ser duplicado quando o Consistem mudar o código.",
    resumoTitulos(c),
    "Abra a ficha do cliente, confira o documento no Consistem e corrija em Editar: a pendência se conclui sozinha.",
  ].join("\n\n");
}
