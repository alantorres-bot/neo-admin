// Painel da conciliação (cartões de resumo, aviso do título provisório, abas e rodapé). Usado pela página da fatura e pela
// página do mês do cartão — ao vivo (em conciliação) ou congelado (resultado gravado no fechamento).
import type { ResultadoConciliacao, TituloPagar } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { montarRoteiro } from "@/lib/modulos/financeiro/cartao/roteiro";
import type { OutroTitulo } from "@/lib/modulos/financeiro/cartao/selecao-titulos";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import type { DecisaoLinha, LinhaFaturaBanco, QuadroCompras, QuadroDesdobrar as DadosDesdobrar, QuadroEncargos as DadosEncargos } from "../dados";
import { QuadroDesdobrar } from "./desdobrar";
import { ListaComprasLancadas } from "./compras";
import { AbasConciliacao } from "./componentes";
import { QuadroEncargos } from "./encargos";
import { QuadroRoteiro } from "./roteiro";

export function PainelConciliacao({ resultado: r, outros, linhas, tituloDaFatura, podeOperar, congelado = false, faturaId = null, decisoesHistorico = [], encargos = null, compras = null, desdobrar = null, podeGestor = false, origemTitulos }: {
  /** De onde vieram os títulos (o roteiro pede o Consistem antes de lançar). */
  origemTitulos?: "consistem" | "espelho";
  /** Compras parceladas lançadas pelo total (desdobrar no Consistem); nulo = não mostra. */
  desdobrar?: DadosDesdobrar | null;
  /** Gestor: registra a exclusão no Consistem de título lançado pelo painel. */
  podeGestor?: boolean;
  /** Compras sem título (lançamento no Consistem); nulo = sem botão. */
  compras?: QuadroCompras | null;
  /** Encargos do mês (lançamento no Consistem); nulo = não mostra. */
  encargos?: DadosEncargos | null;
  /** Fatura que aceita decisões (em conciliação); nulo = só leitura. */
  faturaId?: string | null;
  decisoesHistorico?: DecisaoLinha[];
  resultado: ResultadoConciliacao;
  outros: OutroTitulo[];
  linhas: LinhaFaturaBanco[];
  tituloDaFatura: TituloPagar | null;
  podeOperar: boolean;
  /** Resultado gravado no fechamento (não recalculado). */
  congelado?: boolean;
}) {
  const residuoZero = r.residuoCentavos === 0;
  const encargosLancados = (encargos?.ativos ?? []).filter((l) => l.situacao === "lancado").map((l) => l.cod_lancamento_erp ?? "?").join(", ") || null;
  const passos = congelado || !faturaId ? [] : montarRoteiro({ resultado: r, outros, encargosLancados, origemTitulos });
  const atual = passos.find((p) => p.estado === "atual");
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Cartao rotulo="Total da fatura" valor={formatarMoeda(r.totalInformadoCentavos)} nota={r.integridadeOk ? `${r.contagens.linhas} linhas de despesa` : `Soma lida ${formatarMoeda(r.somaLinhasCentavos)} — conferir`} ruim={!r.integridadeOk} />
        <Cartao rotulo="Títulos no Contas a Pagar" valor={formatarMoeda(r.totalTitulosCentavos)} nota={`${r.contagens.titulos} títulos · ${r.contagens.conciliados} conciliados · ${r.contagens.agrupamentos} agrupados`} />
        <Cartao rotulo="Diferença apurada" valor={formatarMoeda(r.diferencaCentavos)} nota={`${r.pendentes ?? r.contagens.aLancar} pendentes${(r.pendentes ?? r.contagens.aLancar) !== r.contagens.aLancar ? ` (${r.contagens.aLancar - (r.pendentes ?? r.contagens.aLancar)} justificados)` : ""} · ${r.contagens.divergencias} sem correspondência`} />
        <Cartao rotulo="Diferença não justificada" valor={formatarMoeda(r.residuoCentavos)} ruim={!residuoZero} nota={residuoZero ? "Conciliação fecha" : "Deve ser zero antes do borderô"} />
        <Cartao rotulo="Cartão divergente" valor={String(r.contagens.cartaoDivergente)} ruim={r.contagens.cartaoDivergente > 0} nota={outros.length > 0 ? `${outros.length} outros títulos de cartão na janela` : "Conciliados citando outro cartão"} />
      </div>

      {passos.length > 0 && <QuadroRoteiro passos={passos} />}

      {tituloDaFatura && (
        <p className="rounded-[3px] border border-amber-300 bg-amber-50 p-3 text-sm">
          <strong>Título provisório da fatura:</strong> o título {tituloDaFatura.numeroTitulo} ({tituloDaFatura.fornecedor}, vencimento {formatarData(tituloDaFatura.vencimento)}, complemento “{tituloDaFatura.complemento}”) tem exatamente o total da fatura ({formatarMoeda(tituloDaFatura.valorCentavos)}).
          É o provisório do fechamento (os títulos do cartão vão para o borderô e ele é excluído após o pagamento): fica fora do cruzamento linha a linha. Quando ele sair do Consistem, o mês fechado passa a <strong>Paga</strong> sozinho.
        </p>
      )}
      {!congelado && encargos && <QuadroEncargos dados={encargos} faturaId={faturaId} podeOperar={podeOperar} podeGestor={podeGestor} />}
      {!congelado && desdobrar && <QuadroDesdobrar pares={r.aDesdobrar ?? []} dados={desdobrar} faturaId={faturaId} podeOperar={podeOperar} />}
      {!congelado && compras && <ListaComprasLancadas compras={compras} podeOperar={podeOperar} podeGestor={podeGestor} />}
      <AbasConciliacao compras={congelado ? null : compras} resultado={r} outros={outros} linhas={linhas} podeOperar={podeOperar && !congelado} faturaId={congelado ? null : faturaId} decisoesHistorico={decisoesHistorico} />

      {!congelado && (
        <p className={`rounded-[3px] border p-3 text-sm font-medium ${residuoZero ? "border-grade bg-cabecalho" : "border-red-300 bg-red-50 text-red-800"}`}>
          {residuoZero
            ? (r.pendentes ?? r.aLancar.length) > 0
              ? `Diferença não justificada igual a zero. Próximo passo: ${atual ? `${atual.numero}. ${atual.titulo} — ${atual.detalhe}` : "lançar ou decidir o que está pendente em “A lançar”."}`
              : "Nada pendente e diferença não justificada zero: o mês pode ser fechado pelo gestor."
            : "Não gerar o borderô enquanto houver diferença não justificada. Apure os itens não identificados com o portador do cartão e os títulos sem correspondência."}
        </p>
      )}
    </div>
  );
}

export function Cartao({ rotulo, valor, nota, ruim }: { rotulo: string; valor: string; nota?: string; ruim?: boolean }) {
  return (
    <div className={`rounded-[3px] border p-3 ${ruim ? "border-red-300 bg-red-50" : "border-grade bg-card"}`}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`text-lg font-bold tabular-nums ${ruim ? "text-red-700" : ""}`}>{valor}</p>
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}
