import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MODULO_RECEBIVEIS } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { avisoDaBaixa } from "@/lib/modulos/financeiro/recebiveis/baixa";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BaixaComEvidencia, BaixaManual, type LinhaEvidencia, type LinhaManual } from "./componentes";

export const metadata: Metadata = { title: "Baixas a conferir" };

type Titulo = {
  id: string; contraparte_id: string; documento: string; parcela: string; emissao: string | null; vencimento: string; valor: number | string;
  estagio: string; dias_atraso: number; consistem_pago_em: string | null; consistem_valor_pago: number | string | null; consistem_tipo_baixa: string | null;
};

const centavos = (v: number | string) => Math.round(Number(v) * 100);
const nomeTitulo = (t: Pick<Titulo, "documento" | "parcela">) => `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`;

export default async function PaginaBaixas() {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === "financeiro.cobranca");
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const supabase = await criarClienteServidor();

  // Títulos com pendência "Possível baixa" em aberto: saíram da lista de abertos do Consistem.
  const { data: pendencias } = await supabase.from("pendencias").select("referencia_id")
    .eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "rec_titulos").like("titulo", "Possível baixa:%").in("status", ["aberta", "em_andamento"]).limit(500);
  const ids = [...new Set((pendencias ?? []).map((p) => p.referencia_id as string))];

  const titulos: Titulo[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("rec_vw_titulos")
      .select("id, contraparte_id, documento, parcela, emissao, vencimento, valor, estagio, dias_atraso, consistem_pago_em, consistem_valor_pago, consistem_tipo_baixa")
      .in("id", ids.slice(i, i + 100)).order("vencimento");
    if (error) throw new Error(`Falha ao ler os títulos: ${error.message}`);
    titulos.push(...((data ?? []) as Titulo[]));
  }
  const abertos = titulos.filter((t) => !["pago", "renegociado", "cancelado"].includes(t.estagio));

  const nomes = new Map<string, string>();
  const idsClientes = [...new Set(abertos.map((t) => t.contraparte_id))];
  for (let i = 0; i < idsClientes.length; i += 100) {
    const { data } = await supabase.from("contrapartes").select("id, nome").in("id", idsClientes.slice(i, i + 100));
    for (const c of data ?? []) nomes.set(c.id as string, c.nome as string);
  }

  const rotulo = (t: Titulo) => `${nomeTitulo(t)} — ${nomes.get(t.contraparte_id) ?? "cliente"}`;
  const comEvidencia = abertos.filter((t) => t.consistem_pago_em && t.consistem_valor_pago !== null);
  const semEvidencia = abertos.filter((t) => !(t.consistem_pago_em && t.consistem_valor_pago !== null));

  const hoje = hojeEmCuiaba();
  const linhasEvidencia: LinhaEvidencia[] = comEvidencia.map((t) => {
    const aviso = avisoDaBaixa({ valorCentavos: centavos(t.valor), valorPagoCentavos: centavos(t.consistem_valor_pago!), pagoEm: t.consistem_pago_em! }, hoje);
    return {
      id: t.id,
      rotulo: rotulo(t),
      detalhe: `venceu em ${formatarData(t.vencimento)} · título ${formatarMoeda(centavos(t.valor))} · Consistem: pago em ${formatarData(t.consistem_pago_em)}, ${formatarMoeda(centavos(t.consistem_valor_pago!))}${t.consistem_tipo_baixa ? ` (tipo de baixa ${t.consistem_tipo_baixa})` : ""}`,
      aviso,
    };
  });
  const linhasManuais: LinhaManual[] = semEvidencia.map((t) => ({
    id: t.id,
    rotulo: rotulo(t),
    detalhe: `venceu em ${formatarData(t.vencimento)} · ${formatarMoeda(centavos(t.valor))} · ${t.dias_atraso > 0 ? `${t.dias_atraso} dias de atraso` : "a vencer"}`,
    valorTitulo: Number(t.valor),
    emissao: t.emissao,
  }));

  const totalEvidencia = comEvidencia.reduce((s, t) => s + centavos(t.valor), 0);
  const totalSem = semEvidencia.reduce((s, t) => s + centavos(t.valor), 0);

  return (
    <div className="space-y-6">

      <div>
        <h2 className="text-xl font-semibold tracking-tight">Baixas a conferir</h2>
        <p className="text-sm text-muted-foreground">
          Títulos que saíram da lista de contas a receber em aberto do Consistem. {abertos.length === 0 ? "Nenhum no momento." : `${abertos.length} ${abertos.length === 1 ? "título" : "títulos"}.`}{" "}
          O sistema só mostra o que o Consistem informa: <strong>quem dá a baixa é você</strong>.
        </p>
      </div>

      {abertos.length === 0 && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nada para conferir. Quando um título sair da lista do Consistem, ele aparece aqui.</p>
      )}

      {linhasEvidencia.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>O Consistem informa o pagamento ({linhasEvidencia.length})</CardTitle>
            <CardDescription>
              Total dos títulos: {formatarMoeda(totalEvidencia)}. Data e valor vêm da lista de pagos do Consistem. Pagamento recente e de valor igual ao do título já vem marcado. Quando o valor difere (juros ou desconto) ou o pagamento é antigo (mais de 7 dias), o item vem desmarcado, com o motivo: confira e marque se estiver certo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BaixaComEvidencia key={linhasEvidencia.map((l) => l.id).join(",")} linhas={linhasEvidencia} podeOperar={podeOperar} />
          </CardContent>
        </Card>
      )}

      {linhasManuais.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Sem informação de pagamento no Consistem ({linhasManuais.length})</CardTitle>
            <CardDescription>
              Total dos títulos: {formatarMoeda(totalSem)}. Não constam como pagos: podem ter sido cancelados ou renegociados. Confira no Consistem e resolva um a um: pago (com data e valor) ou cancelado (com o motivo).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {linhasManuais.map((l) => (podeOperar
                ? <BaixaManual key={l.id} linha={l} hoje={hoje} />
                : <li key={l.id} className="px-3 py-2 text-sm"><span className="font-medium">{l.rotulo}</span> <span className="text-muted-foreground">{l.detalhe}</span></li>))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
