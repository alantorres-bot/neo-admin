import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { acaoSugerida, ROTA_PONTO, ROTULO_STATUS } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerAtestados, lerColaboradores, lerLote, lerOcorrencias, lerSetores } from "../../dados";
import { COR_STATUS } from "../../lotes/status";
import { AcoesLote, GradeOcorrencias } from "./quadro";

export const metadata: Metadata = { title: "Ponto — quinzena" };

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" }) : "");

export default async function PaginaLotePonto({ params }: PageProps<"/rh/ponto/lote/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const lote = await lerLote(supabase, id);
  if (!lote) notFound();
  const [ocorrencias, setores, colaboradores, gmail, pdf] = await Promise.all([
    lerOcorrencias(supabase, id), lerSetores(supabase), lerColaboradores(supabase),
    supabase.from("gmail_contas").select("email").eq("perfil_id", sessao.userId).is("desconectado_em", null).maybeSingle(),
    supabase.from("anexos").select("arquivo_path, nome_arquivo").eq("referencia_tabela", "rh_pt_lotes").eq("referencia_id", id).order("enviado_em", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const atestados = await lerAtestados(supabase, ocorrencias.map((o) => o.id));
  const setor = setores.find((s) => s.id === lote.setor_id);
  const hoje = hojeEmCuiaba();
  const vencido = (lote.status === "enviado" || lote.status === "devolvido") && lote.prazo !== null && lote.prazo < hoje;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm"><Link href={`${ROTA_PONTO}/lotes`} className="text-elo hover:underline">← Quinzenas</Link></p>
          <h2 className="text-xl font-semibold">
            {lote.setor} · {formatarData(lote.periodo_inicio)} a {formatarData(lote.periodo_fim)}{" "}
            <Badge variant="outline" className={COR_STATUS[lote.status]}>{ROTULO_STATUS[lote.status]}</Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            Líder: {setor?.lider ? `${setor.lider.nome} (${setor.lider.email})` : "—"}
            {setor?.substituto ? ` · substituto: ${setor.substituto.nome}` : ""}
            {lote.prazo && (lote.status === "enviado" || lote.status === "devolvido") ? <> · prazo <span className={vencido ? "font-medium text-destructive" : ""}>{formatarData(lote.prazo)}</span></> : null}
          </p>
          <p className="text-sm text-muted-foreground">
            {[
              `Importado em ${quando(lote.importado_em)}`,
              lote.enviado_em && `e-mail ao líder em ${quando(lote.enviado_em)}`,
              lote.lembrete_em && `lembrete em ${quando(lote.lembrete_em)}`,
              lote.justificado_em && `justificado por ${lote.justificado_por_nome ?? "—"} em ${quando(lote.justificado_em)}`,
              lote.concluido_em && `concluído em ${quando(lote.concluido_em)}`,
            ].filter(Boolean).join(" · ")}
          </p>
          {lote.devolvido_motivo && lote.status === "devolvido" && <p className="text-sm text-destructive">Devolvido ao líder: {lote.devolvido_motivo}</p>}
          {lote.cancelado_motivo && <p className="text-sm text-destructive">Cancelado: {lote.cancelado_motivo}</p>}
        </div>
        <AcoesLote
          loteId={lote.id} status={lote.status} vencido={vencido} gmail={(gmail.data?.email as string | undefined) ?? null}
          pdf={pdf.data ? { caminho: pdf.data.arquivo_path as string, nome: pdf.data.nome_arquivo as string } : null}
          podeOperar={temAcesso(sessao.acesso, "rh", "operador")} ehGestor={temAcesso(sessao.acesso, "rh", "gestor")}
        />
      </div>
      <GradeOcorrencias
        loteId={lote.id} status={lote.status} podeOperar={temAcesso(sessao.acesso, "rh", "operador")}
        colaboradores={colaboradores.filter((c) => c.ativo).map((c) => ({ id: c.id, nome: c.nome }))}
        ocorrencias={ocorrencias.map((o) => ({
          ...o, acao: acaoSugerida(o.tipo, o.falta_atraso_min, o.banco_saldo_min),
          atestados: (atestados.get(o.id) ?? []).map((a) => ({ caminho: a.arquivo_path, nome: a.nome_arquivo })),
          ajustadoTexto: o.ajustado_em ? `${o.ajustado_por_nome ?? ""} ${quando(o.ajustado_em)}`.trim() : "",
        }))}
      />
    </div>
  );
}
