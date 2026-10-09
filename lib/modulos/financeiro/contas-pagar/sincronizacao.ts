// Resultado da Edge Function `cap-sincronizar-consistem` e o texto que a tela mostra. Sem imports.

export type TotalTipo = { quantidade: number; valor: number };

export type ResumoSincronizacaoPagar = {
  empresa: string;
  simulacao: boolean;
  segundosApi: number;
  registrosNaApi: number;
  abertos: { titulos: TotalTipo; antecipacoes: TotalTipo; creditos: TotalTipo; projecoes: TotalTipo };
  novos: number;
  alterados: number;
  baixados: number;
  inalterados: number;
  recusados: number;
  duplicadosNaApi: number;
  fornecedoresNovos?: number;
  avisoFornecedores?: string;
  detalhesLidos?: number;
  avisoDetalhe?: string;
  avisoAutorizacoes?: string;
};

export type ResultadoMedicao = {
  empresa: string;
  segundosApi: number;
  paginas: number;
  registrosNaApi: number;
  recusados: number;
  abertos: Record<string, TotalTipo>;
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const reais = (v: number) => {
  const [inteiro, frac] = Math.abs(v).toFixed(2).split(".");
  return `${v < 0 ? "-" : ""}R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};

export function descreverSincronizacaoPagar(r: ResumoSincronizacaoPagar): string[] {
  const linhas = [
    `${r.simulacao ? "Simulação (nada foi gravado)" : "Atualização concluída"} — ${r.empresa}: ${r.registrosNaApi.toLocaleString("pt-BR")} lançamentos lidos do Consistem em ${r.segundosApi} s.`,
    `Em aberto: ${plural(r.abertos.titulos.quantidade, "título", "títulos")} (${reais(r.abertos.titulos.valor)}) · ${plural(r.abertos.antecipacoes.quantidade, "antecipação", "antecipações")} (${reais(r.abertos.antecipacoes.valor)}) · ${plural(r.abertos.creditos.quantidade, "crédito de fornecedor", "créditos de fornecedor")} (${reais(r.abertos.creditos.valor)}).`,
    `Novos: ${r.novos} · Alterados: ${r.alterados} · Saíram dos abertos: ${r.baixados} · Sem mudança: ${r.inalterados}`,
  ];
  if (!r.simulacao && (r.fornecedoresNovos ?? 0) > 0) linhas.push(`${plural(r.fornecedoresNovos!, "fornecedor novo", "fornecedores novos")} no cadastro.`);
  if (!r.simulacao && (r.detalhesLidos ?? 0) > 0) linhas.push(`Detalhe lido de ${plural(r.detalhesLidos!, "antecipação", "antecipações")} (data de pagamento, portador).`);
  if (r.recusados > 0) linhas.push(`${plural(r.recusados, "registro recusado", "registros recusados")} por dados inválidos.`);
  if (r.duplicadosNaApi > 0) linhas.push(`${plural(r.duplicadosNaApi, "lançamento repetido", "lançamentos repetidos")} na resposta do Consistem (usado o primeiro).`);
  if (r.avisoFornecedores) linhas.push(`Aviso: ${r.avisoFornecedores}`);
  if (r.avisoDetalhe) linhas.push(`Aviso: ${r.avisoDetalhe}`);
  if (r.avisoAutorizacoes) linhas.push(`Aviso: ${r.avisoAutorizacoes}`);
  return linhas;
}

export function descreverMedicao(m: ResultadoMedicao): string[] {
  const nome: Record<string, string> = { C: "títulos", A: "antecipações", D: "créditos de fornecedor", B: "baixas de antecipação", P: "projeções" };
  return [
    `Medição — ${m.empresa}: ${m.registrosNaApi.toLocaleString("pt-BR")} lançamentos em ${m.paginas} páginas, ${m.segundosApi} s de leitura da API.${m.recusados > 0 ? ` ${m.recusados} recusados.` : ""}`,
    ...Object.entries(m.abertos).filter(([, v]) => v.quantidade > 0).map(([t, v]) => `Em aberto, ${nome[t] ?? t}: ${v.quantidade} (${reais(v.valor)})`),
  ];
}
