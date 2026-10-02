import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exigirSessao } from "@/lib/nucleo/sessao";
import type { Empresa } from "@/lib/nucleo/tipos";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { DialogoEmpresa } from "./form-empresa";

export const metadata: Metadata = { title: "Empresas" };

export default async function PaginaEmpresas() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("empresas")
    .select("id, razao_social, nome_curto, cnpj, ativa")
    .order("ativa", { ascending: false })
    .order("nome_curto");
  if (error) throw new Error(`Falha ao ler as empresas: ${error.message}`);
  const empresas = (data ?? []) as Empresa[];
  const podeEditar = sessao.acesso.adminGeral;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Empresas do grupo. Usadas em todos os módulos.</p>
        {podeEditar && <DialogoEmpresa />}
      </div>

      {empresas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma empresa cadastrada{podeEditar ? "." : ". Peça ao administrador geral para cadastrar."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome curto</TableHead>
                <TableHead>Razão social</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Situação</TableHead>
                {podeEditar && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {empresas.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.nome_curto}</TableCell>
                  <TableCell>{e.razao_social}</TableCell>
                  <TableCell className="tabular-nums">{e.cnpj ?? "—"}</TableCell>
                  <TableCell>{e.ativa ? <Badge variant="secondary">Ativa</Badge> : <Badge variant="outline">Inativa</Badge>}</TableCell>
                  {podeEditar && <TableCell className="text-right"><DialogoEmpresa empresa={e} /></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
