import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTULO_ABRIR, rotaDoAplicativo } from "@/lib/nucleo/aplicativos";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import type { Aplicativo } from "@/lib/nucleo/tipos";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { DialogoAplicativo } from "./form-aplicativo";

export const metadata: Metadata = { title: "Aplicativos" };

export default async function PaginaAplicativos() {
  const sessao = await exigirAdminGeral();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("aplicativos")
    .select("id, codigo, nome, descricao, area, url, abrir, icone, ordem, ativo")
    .order("ativo", { ascending: false })
    .order("area")
    .order("ordem")
    .order("nome");
  if (error) throw new Error(`Falha ao ler os aplicativos: ${error.message}`);
  const aplicativos = (data ?? []) as Aplicativo[];
  const nomeDaArea = new Map(sessao.areas.map((a) => [a.codigo, a.nome]));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Sistemas de outras áreas que aparecem no menu e no Início do painel (Vigilância Fiscal, NEOControl, apps de Produção…).
          Cada um continua separado, com o próprio login; aqui fica só o cadastro. Quem tem acesso à área escolhida vê o aplicativo.
        </p>
        <DialogoAplicativo areas={sessao.areas} />
      </div>

      {aplicativos.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum aplicativo cadastrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Área</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead>Abre</TableHead>
                <TableHead className="text-right">Ordem</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {aplicativos.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={rotaDoAplicativo(a.codigo)} className="font-medium text-elo underline-offset-2 hover:underline">{a.nome}</Link>
                    <div className="text-xs text-muted-foreground">/apps/{a.codigo}</div>
                  </TableCell>
                  <TableCell>{nomeDaArea.get(a.area) ?? a.area}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs" title={a.url}>{a.url}</TableCell>
                  <TableCell>{ROTULO_ABRIR[a.abrir]}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.ordem}</TableCell>
                  <TableCell>{a.ativo ? <Badge variant="secondary">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}</TableCell>
                  <TableCell className="text-right"><DialogoAplicativo aplicativo={a} areas={sessao.areas} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
