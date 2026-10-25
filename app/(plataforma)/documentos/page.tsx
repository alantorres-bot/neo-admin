import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FINALIDADES_BUSCA, idsComMesmoNomeEmOutraRaiz, LIMITE_BUSCA, lerFinalidade, linkDoDrive, padraoBusca, type LinhaBusca,
} from "@/lib/nucleo/ged/busca";
import type { RaizGed } from "@/lib/nucleo/ged/conexao-tela";
import { formatarData } from "@/lib/nucleo/fila";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Central de Documentos" };

const SELECT = "h-9 rounded-md border bg-background px-2 text-sm";
const AVISO_SEM_ACESSO = "Você não tem acesso a nenhuma pasta do GED. Se precisar, peça ao administrador.";

type Documento = LinhaBusca & {
  extensao: string; situacao: string; alterado_no_drive_em: string | null; web_link: string | null; pasta: { nome: string } | null;
};

/**
 * Central de Documentos (especificação 7.1, fase A1b): busca por nome no índice do Drive, filtro por finalidade e "Abrir no Drive".
 * As linhas vêm com o cliente do usuário: a RLS (ged_pode_ler_raiz) decide o que cada um vê, inclusive a trava da elaboração.
 * Sem acesso a raiz nenhuma, a mesma mensagem fixa, haja ou não documentos (5.11.7). Tipo, cliente e vínculos chegam na A2.
 */
export default async function PaginaDocumentos({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sessao = await exigirSessao();
  if (sessao.acesso.restrito) notFound();
  const p = await searchParams;
  const texto = typeof p.q === "string" ? p.q : "";
  const finalidade = lerFinalidade(p.finalidade);
  const padrao = padraoBusca(texto);

  const supabase = await criarClienteServidor();
  const { data: dadosRaizes, error: erroRaizes } = await supabase.rpc("ged_raizes");
  // Só raízes ativas entram na busca (5.2.3: desativada, os documentos somem da busca).
  const raizes = ((dadosRaizes as RaizGed[] | null) ?? []).filter((r) => r.situacao === "ativa");
  const doFiltro = raizes.filter((r) => finalidade === "todas" || r.finalidade === finalidade);
  const nomeDaRaiz = new Map(raizes.map((r) => [r.id, FINALIDADES_BUSCA[r.finalidade as keyof typeof FINALIDADES_BUSCA] ?? r.nome]));

  let documentos: Documento[] = [];
  let erroBusca = false;
  if (padrao && doFiltro.length > 0) {
    const { data, error } = await supabase.from("ged_documentos")
      .select("id, nome, nome_normalizado, raiz_id, extensao, situacao, alterado_no_drive_em, web_link, pasta:ged_pastas(nome)")
      .ilike("nome_normalizado", padrao)
      .in("raiz_id", doFiltro.map((r) => r.id))
      .in("situacao", ["vigente", "substituido"])                    // temporário (ignorado), removido e fora do escopo não aparecem
      .order("alterado_no_drive_em", { ascending: false, nullsFirst: false })
      .limit(LIMITE_BUSCA);
    erroBusca = !!error;
    documentos = (data ?? []) as unknown as Documento[];
  }
  const mesmoNome = idsComMesmoNomeEmOutraRaiz(documentos);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Central de Documentos</h1>
        <p className="text-sm text-muted-foreground">
          Busca nos arquivos do Google Drive das pastas que você pode ver. O arquivo abre no próprio Drive, que confere o seu acesso.
        </p>
      </div>

      {erroRaizes ? (
        <p role="alert" className="text-sm text-destructive">Não foi possível carregar as pastas do GED.</p>
      ) : raizes.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{AVISO_SEM_ACESSO}</p>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-2" role="search">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="ged-q">Nome do arquivo</Label>
              <Input id="ged-q" name="q" defaultValue={texto} placeholder="Ex.: 229, contrato de venda, nome do cliente" maxLength={100} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ged-finalidade">Finalidade</Label>
              <select id="ged-finalidade" name="finalidade" defaultValue={finalidade} className={SELECT}>
                {Object.entries(FINALIDADES_BUSCA).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
              </select>
            </div>
            <Button type="submit">Buscar</Button>
          </form>

          {erroBusca && <p role="alert" className="text-sm text-destructive">Não foi possível buscar agora. Tente de novo.</p>}
          {!padrao ? (
            <p className="text-sm text-muted-foreground">Digite ao menos 2 letras do nome do arquivo.</p>
          ) : (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                {documentos.length === 0 ? "Nenhum arquivo encontrado." : `${documentos.length} arquivo(s)${documentos.length === LIMITE_BUSCA ? ` (os ${LIMITE_BUSCA} mais recentes; refine a busca)` : ""}.`}
              </p>
              {documentos.length > 0 && (
                <Table className="cartoes">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Arquivo</TableHead>
                      <TableHead>Finalidade</TableHead>
                      <TableHead>Pasta</TableHead>
                      <TableHead>Alterado em</TableHead>
                      <TableHead>Drive</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documentos.map((d) => {
                      const link = linkDoDrive(d.web_link);
                      return (
                        <TableRow key={d.id}>
                          <TableCell>
                            {d.nome}
                            {d.situacao === "substituido" && <Badge variant="secondary" className="ml-2">Substituído</Badge>}
                            {mesmoNome.has(d.id) && <Badge variant="outline" className="ml-2">Mesmo nome na outra pasta</Badge>}
                          </TableCell>
                          <TableCell>{nomeDaRaiz.get(d.raiz_id) ?? "—"}</TableCell>
                          <TableCell>{d.pasta?.nome ?? "—"}</TableCell>
                          <TableCell>{formatarData(d.alterado_no_drive_em)}</TableCell>
                          <TableCell>
                            {link ? (
                              <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                                Abrir no Drive <ExternalLink className="size-3.5" aria-hidden />
                              </a>
                            ) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
