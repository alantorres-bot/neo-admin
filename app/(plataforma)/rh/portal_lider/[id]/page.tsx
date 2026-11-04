import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { linhasDoPedido, ROTA_PEDIDOS_RH, ROTULO_STATUS, ROTULO_TIPO } from "@/lib/modulos/rh/portal-lider/modulo";
import { urlAssinadaAnexo } from "@/lib/nucleo/anexos";
import { formatarDataHora } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { COR_STATUS } from "../../../lider/status";
import { lerPedido } from "../dados";
import { AtenderPedido } from "../quadro";

export const metadata: Metadata = { title: "Portal do Líder — pedido" };

export default async function PaginaPedidoDoLider({ params }: PageProps<"/rh/portal_lider/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const pedido = await lerPedido(supabase, id);
  if (!pedido) notFound();
  const { data: anexos } = await supabase.from("anexos").select("id, nome_arquivo, arquivo_path")
    .eq("referencia_tabela", "rh_ld_solicitacoes").eq("referencia_id", id).order("enviado_em");
  const arquivos = await Promise.all((anexos ?? []).map(async (a) => ({ ...a, url: await urlAssinadaAnexo(supabase, a.arquivo_path, 600) })));

  return (
    <div className="space-y-4">
      <p className="text-sm"><Link href={ROTA_PEDIDOS_RH} className="text-elo hover:underline">← Pedidos</Link></p>
      <h2 className="text-xl font-semibold">
        {ROTULO_TIPO[pedido.tipo]} · {pedido.pessoa} · {pedido.setor}{" "}
        <Badge variant="outline" className={COR_STATUS[pedido.status]}>{ROTULO_STATUS[pedido.status]}</Badge>
      </h2>
      <p className="text-sm text-muted-foreground">
        Enviado por {pedido.autor ?? "—"} em {formatarDataHora(pedido.criado_em)}{pedido.atendido_em ? ` · atendido em ${formatarDataHora(pedido.atendido_em)}` : ""}
        {" · "}{pedido.email_enviado_em ? `e-mail recebido em ${formatarDataHora(pedido.email_enviado_em)}` : `e-mail não enviado${pedido.email_erro ? ` (${pedido.email_erro})` : ""}`}
      </p>
      <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {linhasDoPedido(pedido.tipo, pedido.dados).map(([r, v]) => (
          <div key={r} className="contents"><dt className="text-muted-foreground">{r}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {arquivos.length > 0 && (
        <ul className="space-y-1 text-sm">
          {arquivos.map((a) => (
            <li key={a.id}>{a.url.ok ? <a href={a.url.url} target="_blank" rel="noreferrer" className="text-elo hover:underline">{a.nome_arquivo}</a> : `${a.nome_arquivo} (${a.url.erro})`}</li>
          ))}
        </ul>
      )}
      {pedido.tipo === "atestado" && !arquivos.length && <p className="text-sm text-destructive">O líder ainda não anexou o arquivo do atestado.</p>}
      {pedido.resposta && <p className="text-sm"><span className="font-medium">Resposta ao líder:</span> {pedido.resposta}</p>}
      {temAcesso(sessao.acesso, "rh", "operador") && <AtenderPedido id={pedido.id} status={pedido.status} />}
    </div>
  );
}
