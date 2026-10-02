import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarWhatsapp } from "@/lib/nucleo/documentos";
import { temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { ROTULO_CANAL, ROTULO_TIPO_CONTRAPARTE } from "@/lib/nucleo/rotulos";
import { exigirSessao } from "@/lib/nucleo/sessao";
import type { Contato, Contraparte } from "@/lib/nucleo/tipos";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { DialogoContato } from "../dialogos";

export const metadata: Metadata = { title: "Contatos" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaContatos({ params }: PageProps<"/configuracoes/contrapartes/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const podeEditar = temAcessoAlgumaArea(sessao.acesso, sessao.areas, "operador");

  // A RLS já esconde colaboradores de quem não tem a área RH: nesse caso volta vazio e vira 404.
  const { data: contraparte } = await supabase
    .from("contrapartes")
    .select("id, nome, documento, tipos, codigo_erp, observacoes, ativo, criado_em")
    .eq("id", id)
    .maybeSingle();
  if (!contraparte) notFound();
  const c = contraparte as Contraparte;

  const { data: contatosBrutos, error } = await supabase
    .from("contatos")
    .select("id, contraparte_id, nome, funcao, email, whatsapp, canal_preferido, finalidades, ativo")
    .eq("contraparte_id", id)
    .order("ativo", { ascending: false })
    .order("nome");
  if (error) throw new Error(`Falha ao ler os contatos: ${error.message}`);
  const contatos = (contatosBrutos ?? []) as Contato[];

  return (
    <section className="space-y-4">
      <Button variant="ghost" size="sm" render={<Link href="/configuracoes/contrapartes" />}>
        <ArrowLeft /> Voltar
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{c.nome}</h2>
          <p className="text-sm text-muted-foreground">
            {[c.documento, c.codigo_erp ? `Consistem ${c.codigo_erp}` : null].filter(Boolean).join(" · ") || "Sem documento"}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {c.tipos.map((t) => <Badge key={t} variant="secondary">{ROTULO_TIPO_CONTRAPARTE[t]}</Badge>)}
            {!c.ativo && <Badge variant="outline">Inativa</Badge>}
          </div>
          {c.observacoes && <p className="mt-2 max-w-prose whitespace-pre-line text-sm">{c.observacoes}</p>}
        </div>
        {podeEditar && <DialogoContato contraparteId={c.id} />}
      </div>

      {contatos.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum contato cadastrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Finalidades</TableHead>
                {podeEditar && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contatos.map((t) => (
                <TableRow key={t.id} className={t.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{t.nome}{!t.ativo && <Badge variant="outline" className="ml-2">Inativo</Badge>}</TableCell>
                  <TableCell>{t.funcao ?? "—"}</TableCell>
                  <TableCell>{t.email ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{t.whatsapp ? formatarWhatsapp(t.whatsapp) : "—"}</TableCell>
                  <TableCell>{t.canal_preferido ? ROTULO_CANAL[t.canal_preferido] : "—"}</TableCell>
                  <TableCell className="space-x-1">{t.finalidades.map((f) => <Badge key={f} variant="outline">{f}</Badge>)}</TableCell>
                  {podeEditar && <TableCell className="text-right"><DialogoContato contraparteId={c.id} contato={t} /></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
