import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MODULO_FILIAL, ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Remessas da filial" };

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function PaginaRemessas() {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL)) notFound();

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("rec_vw_remessas")
    .select("id, numero, criado_em, criado_por_nome, aviso_aberto_em, kits, aguardando_implantacao, prontas")
    .order("numero", { ascending: false }).limit(200);
  if (error) throw new Error(`Falha ao ler as remessas: ${error.message}`);

  return (
    <div className="space-y-6">
      <p className="text-[12px] text-muted-foreground">Cada envio de faturas da filial. Abra a remessa para baixar as notas, implantar no Consistem e acompanhar o andamento.</p>
      <div className="overflow-x-auto rounded-[3px] border border-grade">
      <Table className="cartoes">
        <TableHeader>
          <TableRow><TableHead>Remessa</TableHead><TableHead>Enviada</TableHead><TableHead>Por</TableHead><TableHead className="text-right">NFs</TableHead><TableHead>Situação</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {(data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nenhuma remessa ainda.</TableCell></TableRow>}
          {(data ?? []).map((r) => (
            <TableRow key={r.id}>
              <TableCell><Link className="underline" href={`${ROTA_FILIAL}/remessas/${r.numero}`}>nº {r.numero}</Link></TableCell>
              <TableCell>{quando(r.criado_em)}</TableCell>
              <TableCell>{r.criado_por_nome ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{r.kits}</TableCell>
              <TableCell className="space-x-1">
                {r.aguardando_implantacao > 0
                  ? <Badge variant="outline">{r.aguardando_implantacao} a implantar</Badge>
                  : <Badge variant="secondary">implantada</Badge>}
                {r.prontas > 0 && <Badge>{r.prontas} {r.prontas === 1 ? "pronta" : "prontas"}</Badge>}
                {!r.aviso_aberto_em && <Badge variant="outline" title="O e-mail de aviso a Cuiabá ainda não foi aberto">sem aviso</Badge>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
