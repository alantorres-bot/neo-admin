import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarData } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ImportadorGenerico, type ModeloSalvo } from "./importador";

export const metadata: Metadata = { title: "Importador" };

type LinhaImportacao = {
  id: string; modulo: string; tipo: string; arquivo: string | null; criado_em: string;
  usuario: { nome: string } | null;
};

export default async function PaginaImportador() {
  const sessao = await exigirSessao();
  // Quem importa precisa ser operador na área do módulo.
  const modulos = sessao.modulos
    .filter((m) => m.ativo && temAcesso(sessao.acesso, m.area, "operador"))
    .map((m) => ({ codigo: m.codigo, nome: m.nome }));
  if (modulos.length === 0 && !sessao.acesso.adminGeral) redirect("/configuracoes/empresas");

  const supabase = await criarClienteServidor();
  const [modelos, importacoes] = await Promise.all([
    supabase.from("importacao_modelos").select("id, modulo, tipo, nome, mapeamento").order("nome"),
    supabase
      .from("importacoes")
      .select("id, modulo, tipo, arquivo, criado_em, usuario:perfis(nome)")
      .order("criado_em", { ascending: false })
      .limit(10),
  ]);
  if (modelos.error) throw new Error(`Falha ao ler os modelos: ${modelos.error.message}`);
  if (importacoes.error) throw new Error(`Falha ao ler as importações: ${importacoes.error.message}`);

  const nomeDoModulo = new Map(sessao.modulos.map((m) => [m.codigo, m.nome]));

  return (
    <section className="space-y-6">
      <p className="max-w-prose text-sm text-muted-foreground">
        Leitura de relatórios em CSV ou XLSX (como os do Consistem) com mapeamento de colunas. O mapeamento fica salvo por módulo e tipo para as próximas importações.
      </p>

      <ImportadorGenerico modulos={modulos} modelos={(modelos.data ?? []) as ModeloSalvo[]} />

      <div className="space-y-2">
        <h2 className="font-medium">Últimas importações</h2>
        {(importacoes.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma importação registrada.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Data</TableHead><TableHead>Módulo</TableHead><TableHead>Tipo</TableHead><TableHead>Arquivo</TableHead><TableHead>Por</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(importacoes.data as unknown as LinhaImportacao[]).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="tabular-nums">{formatarData(i.criado_em)}</TableCell>
                    <TableCell>{nomeDoModulo.get(i.modulo) ?? i.modulo}</TableCell>
                    <TableCell>{i.tipo}</TableCell>
                    <TableCell>{i.arquivo ?? "—"}</TableCell>
                    <TableCell>{i.usuario?.nome ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  );
}
