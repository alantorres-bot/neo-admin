import { CHAVE_DESTINATARIOS } from "@/lib/modulos/financeiro/filial/arquivos";
import { lerConfigImplantacao, montarFichaImplantacao } from "@/lib/modulos/financeiro/filial/implantacao";
import { divergencias, lerParcelasInformadas, type ParcelaConsistem } from "@/lib/modulos/financeiro/filial/remessa";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotaoAvisoCuiaba } from "./aviso";
import { BotaoBaixarTudo } from "./remessas/[numero]/baixar";
import { AnexarDemonstrativos } from "./remessas/[numero]/demonstrativos";
import { RelatorioImplantacao, type BlocoImplantacao } from "./remessas/[numero]/implantacao";

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const dataCuiaba = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Cuiaba" });

/**
 * Barra da remessa (fila filtrada por uma remessa): o aviso a Cuiabá, baixar as notas, os demonstrativos em lote e o relatório
 * de implantação (CCFT040, com impressão) das NFs dela. A lista das NFs é a própria fila.
 */
export async function BarraRemessa({ numero, podeOperar, ehCuiaba }: { numero: number; podeOperar: boolean; ehCuiaba: boolean }) {
  const supabase = await criarClienteServidor();
  const { data: r } = await supabase.from("rec_vw_remessas").select("*").eq("numero", numero).maybeSingle();
  if (!r) return <p className="text-sm text-muted-foreground">Remessa nº {numero} não encontrada.</p>;

  const { data: ligacoes } = await supabase.from("rec_remessa_kits").select("kit_id").eq("remessa_id", r.id);
  const ids = (ligacoes ?? []).map((l) => l.kit_id as string);
  const nenhum = ["00000000-0000-0000-0000-000000000000"];
  const [{ data: kits }, { data: dados }, { data: kitTitulos }, { data: config }, { data: configImplantacao }] = await Promise.all([
    supabase.from("rec_vw_kits").select("id, nota_fiscal, cliente_nome, estagio, aceita_boleto_factoring, demonstrativos").in("id", ids.length ? ids : nenhum).order("nota_fiscal"),
    supabase.from("rec_kits").select("id, parcelas_informadas, data_emissao, cliente_documento, cliente_codigo_erp, cliente_conferido_em").in("id", ids.length ? ids : nenhum),
    supabase.from("rec_kit_titulos").select("kit_id, rec_titulos(documento, vencimento, valor, estagio, contrapartes(codigo_erp))").in("kit_id", ids.length ? ids : nenhum),
    supabase.from("configuracoes").select("valor").eq("chave", CHAVE_DESTINATARIOS).maybeSingle(),
    supabase.from("configuracoes").select("valor").eq("chave", "financeiro.filial.implantacao").maybeSingle(),
  ]);
  const dadosKit = new Map((dados ?? []).map((k) => [k.id as string, k]));
  const parcelasPorKit = new Map((dados ?? []).map((k) => [k.id as string, lerParcelasInformadas(k.parcelas_informadas)]));
  const codigoDoTitulo = new Map<string, string>();
  const titulosPorKit = new Map<string, ParcelaConsistem[]>();
  for (const l of kitTitulos ?? []) {
    const t = (Array.isArray(l.rec_titulos) ? l.rec_titulos[0] : l.rec_titulos) as {
      documento: string; vencimento: string; valor: number | string; estagio: string; contrapartes: { codigo_erp: string | null } | { codigo_erp: string | null }[] | null;
    } | null;
    if (!t || t.estagio === "cancelado" || t.estagio === "renegociado") continue;
    const cp = Array.isArray(t.contrapartes) ? t.contrapartes[0] : t.contrapartes;
    if (cp?.codigo_erp) codigoDoTitulo.set(l.kit_id as string, cp.codigo_erp);
    titulosPorKit.set(l.kit_id as string, [...(titulosPorKit.get(l.kit_id as string) ?? []), { documento: t.documento, vencimento: t.vencimento, valorCentavos: emCentavos(t.valor) }]);
  }
  const ativos = (kits ?? []).filter((k) => k.estagio !== "cancelada");
  const cfg = lerConfigImplantacao(configImplantacao?.valor);
  const blocos: BlocoImplantacao[] = ativos.map((k) => {
    const d = dadosKit.get(k.id);
    const parcelas = parcelasPorKit.get(k.id) ?? [];
    const titulos = titulosPorKit.get(k.id) ?? [];
    return {
      kitId: k.id, nota: k.nota_fiscal, cliente: k.cliente_nome, semBoletoFactoring: !k.aceita_boleto_factoring,
      titulos: titulos.map((t) => t.documento), divergencias: divergencias(parcelas, titulos),
      ficha: montarFichaImplantacao({
        nota: k.nota_fiscal, emissao: (d?.data_emissao as string | null) ?? null, clienteNome: k.cliente_nome,
        clienteDocumento: (d?.cliente_documento as string | null) ?? null,
        clienteCodigoErp: (d?.cliente_codigo_erp as string | null) ?? codigoDoTitulo.get(k.id) ?? null,
        clienteConferido: !!d?.cliente_conferido_em || codigoDoTitulo.has(k.id), parcelas,
      }, cfg),
    };
  });
  const para = Array.isArray(config?.valor) ? (config.valor as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const itensAviso = ativos.map((k) => ({ nota: k.nota_fiscal as string, cliente: k.cliente_nome as string, aceitaBoletoFactoring: !!k.aceita_boleto_factoring, parcelas: parcelasPorKit.get(k.id) ?? [] }));
  const abertos = ativos.filter((k) => k.estagio !== "enviada");

  return (
    <section className="space-y-3 rounded-[3px] border border-grade bg-cabecalho p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-[13px]">
          <strong className="text-base">Remessa nº {r.numero}</strong>
          <span className="text-muted-foreground"> · enviada por {r.criado_por_nome ?? "—"} em {quando(r.criado_em)} · {r.kits} {r.kits === 1 ? "NF" : "NFs"}
            {r.aviso_aberto_em ? ` · aviso a Cuiabá aberto em ${quando(r.aviso_aberto_em)}` : " · aviso a Cuiabá ainda não aberto"}</span>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <BotaoBaixarTudo remessaId={r.id} />
          {podeOperar && itensAviso.length > 0 && (
            <BotaoAvisoCuiaba remessaId={r.id} numero={r.numero} data={dataCuiaba(r.criado_em)} itens={itensAviso} para={para} variante={r.aviso_aberto_em ? "outline" : "default"} />
          )}
        </div>
      </div>
      {podeOperar && abertos.length > 0 && (
        <AnexarDemonstrativos kits={abertos.map((k) => ({ id: k.id as string, nota: k.nota_fiscal as string, cliente: k.cliente_nome as string, temDemonstrativo: (k.demonstrativos ?? 0) > 0 }))} />
      )}
      {ehCuiaba && blocos.some((b) => b.titulos.length === 0) && (
        <details className="rounded-[3px] border bg-white p-3">
          <summary className="cursor-pointer text-[13px] font-medium">Relatório de implantação desta remessa (CCFT040), para imprimir</summary>
          <div className="mt-3"><RelatorioImplantacao blocos={blocos} rotina={cfg.rotina} podeOperar={podeOperar} /></div>
        </details>
      )}
    </section>
  );
}
