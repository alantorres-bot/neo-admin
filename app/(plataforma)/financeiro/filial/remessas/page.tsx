import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MODULO_FILIAL, ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import {
  ESTAGIOS_FILA, ORDEM_URGENCIA, ROTULO_ESTAGIO_FILA, ROTULO_URGENCIA, textoVencimento, type EstagioFila, type Papel,
} from "@/lib/modulos/financeiro/filial/estagios";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { carregarFila, type LinhaFila } from "../fila-dados";
import { COR_URGENCIA } from "../painel-conteudo";

export const metadata: Metadata = { title: "Remessas da filial" };

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Remessas da filial (visão por lote, complementar à fila): cada envio, quem enviou, quantas NFs, em que estágio estão e a NF mais
 * urgente dela. Abrir a remessa mostra o detalhe.
 */
export default async function PaginaRemessas() {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL)) notFound();
  const papel: Papel = sessao.acesso.restrito ? "filial" : "cuiaba";
  const hoje = hojeEmCuiaba();

  const supabase = await criarClienteServidor();
  const [{ data, error }, nfs] = await Promise.all([
    supabase.from("rec_vw_remessas").select("id, numero, criado_em, criado_por_nome, aviso_aberto_em, kits")
      .order("numero", { ascending: false }).limit(200),
    carregarFila(supabase, { papel, hoje, estagios: "todas" }),
  ]);
  if (error) throw new Error(`Falha ao ler as remessas: ${error.message}`);

  const porRemessa = new Map<number, LinhaFila[]>();
  for (const l of nfs) for (const n of l.remessas) porRemessa.set(n, [...(porRemessa.get(n) ?? []), l]);

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">Cada envio de faturas da filial. Abra a remessa para ver as NFs dela, baixar as notas, implantar no Consistem e conferir com a nota.</p>
      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table className="cartoes">
          <TableHeader><TableRow>
            <TableHead>Remessa</TableHead><TableHead>Enviada</TableHead><TableHead>Por</TableHead><TableHead className="text-right">NFs</TableHead>
            <TableHead>Andamento</TableHead><TableHead>Mais urgente</TableHead><TableHead>Aviso a Cuiabá</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Nenhuma remessa ainda.</TableCell></TableRow>}
            {(data ?? []).map((r) => {
              const linhas = porRemessa.get(r.numero) ?? [];
              const contagem = new Map<EstagioFila, number>();
              for (const l of linhas) contagem.set(l.situacao.estagio, (contagem.get(l.situacao.estagio) ?? 0) + 1);
              const urgente = linhas.filter((l) => l.urgencia && l.urgencia !== "sem_data")
                .sort((a, b) => ORDEM_URGENCIA[a.urgencia!] - ORDEM_URGENCIA[b.urgencia!] || (a.vencimento ?? "").localeCompare(b.vencimento ?? ""))[0];
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium"><Link className="underline" href={`${ROTA_FILIAL}/remessas/${r.numero}`}>nº {r.numero}</Link></TableCell>
                  <TableCell className="whitespace-nowrap">{quando(r.criado_em)}</TableCell>
                  <TableCell>{r.criado_por_nome ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.kits}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {ESTAGIOS_FILA.filter((e) => contagem.has(e)).map((e) => (
                        <Badge key={e} variant={e === "enviada" ? "secondary" : e === "cancelada" ? "outline" : "default"}>{contagem.get(e)} · {ROTULO_ESTAGIO_FILA[e]}</Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[12px]">
                    {urgente ? (
                      <Link href={`${ROTA_FILIAL}/remessas/${r.numero}?nf=${urgente.id}`} className="hover:underline">
                        <Badge variant={COR_URGENCIA[urgente.urgencia!]}>{ROTULO_URGENCIA[urgente.urgencia!]}</Badge>{" "}
                        NF {Number(urgente.nota)} · {textoVencimento(urgente.vencimento, hoje)}
                      </Link>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-[12px]">
                    {r.aviso_aberto_em ? quando(r.aviso_aberto_em) : <Badge variant="outline">não aberto</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
