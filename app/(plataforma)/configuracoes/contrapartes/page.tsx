import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { temAcesso, temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { ROTULO_TIPO_CONTRAPARTE, TIPOS_CONTRAPARTE } from "@/lib/nucleo/rotulos";
import { exigirSessao } from "@/lib/nucleo/sessao";
import type { Contraparte, TipoContraparte } from "@/lib/nucleo/tipos";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { DialogoContraparte } from "./dialogos";

export const metadata: Metadata = { title: "Contrapartes e contatos" };

const POR_PAGINA = 50;

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PaginaContrapartes({ searchParams }: PageProps<"/configuracoes/contrapartes">) {
  const sessao = await exigirSessao();
  const parametros = await searchParams;
  const busca = sanitizarBusca(primeiro(parametros.q));
  const tipoPedido = primeiro(parametros.tipo);
  const tipo = (TIPOS_CONTRAPARTE as string[]).includes(tipoPedido) ? (tipoPedido as TipoContraparte) : null;
  const inativos = primeiro(parametros.inativos) === "1";
  const pagina = Math.max(1, Number.parseInt(primeiro(parametros.pagina), 10) || 1);

  const podeEditar = temAcessoAlgumaArea(sessao.acesso, sessao.areas, "operador");
  const podeColaborador = temAcesso(sessao.acesso, "rh", "operador");

  const supabase = await criarClienteServidor();
  let consulta = supabase
    .from("contrapartes")
    .select("id, nome, documento, tipos, codigo_erp, observacoes, ativo, criado_em", { count: "exact" })
    .order("nome")
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (!inativos) consulta = consulta.eq("ativo", true);
  if (tipo) consulta = consulta.contains("tipos", [tipo]);
  if (busca) consulta = consulta.or(`nome.ilike.%${busca}%,documento.ilike.%${busca}%,codigo_erp.ilike.%${busca}%`);

  const { data, count, error } = await consulta;
  if (error) throw new Error(`Falha ao ler as contrapartes: ${error.message}`);
  const contrapartes = (data ?? []) as Contraparte[];
  const total = count ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const link = (p: number) => {
    const qs = new URLSearchParams();
    if (busca) qs.set("q", busca);
    if (tipo) qs.set("tipo", tipo);
    if (inativos) qs.set("inativos", "1");
    if (p > 1) qs.set("pagina", String(p));
    const texto = qs.toString();
    return `/configuracoes/contrapartes${texto ? `?${texto}` : ""}`;
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form method="get" className="flex flex-wrap items-center gap-2" role="search">
          <Input name="q" defaultValue={busca} placeholder="Nome, CPF/CNPJ ou código" aria-label="Buscar" className="w-60" />
          <select name="tipo" defaultValue={tipo ?? ""} aria-label="Tipo" className="h-8 rounded-lg border bg-background px-2 text-sm">
            <option value="">Todos os tipos</option>
            {TIPOS_CONTRAPARTE.filter((t) => t !== "colaborador" || temAcesso(sessao.acesso, "rh")).map((t) => (
              <option key={t} value={t}>{ROTULO_TIPO_CONTRAPARTE[t]}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="inativos" value="1" defaultChecked={inativos} className="size-4" /> Mostrar inativos
          </label>
          <Button type="submit" variant="secondary">Filtrar</Button>
        </form>
        {podeEditar && <DialogoContraparte podeColaborador={podeColaborador} />}
      </div>

      {contrapartes.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma contraparte encontrada.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>CPF/CNPJ</TableHead>
                <TableHead>Tipos</TableHead>
                <TableHead>Cód. Consistem</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contrapartes.map((c) => (
                <TableRow key={c.id} className={c.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">
                    <Link href={`/configuracoes/contrapartes/${c.id}`} className="hover:underline">{c.nome}</Link>
                    {!c.ativo && <Badge variant="outline" className="ml-2">Inativa</Badge>}
                  </TableCell>
                  <TableCell className="tabular-nums">{c.documento ?? "—"}</TableCell>
                  <TableCell className="space-x-1">
                    {c.tipos.map((t) => <Badge key={t} variant="secondary">{ROTULO_TIPO_CONTRAPARTE[t]}</Badge>)}
                  </TableCell>
                  <TableCell>{c.codigo_erp ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" render={<Link href={`/configuracoes/contrapartes/${c.id}`} />}>Contatos</Button>
                    {podeEditar && <DialogoContraparte contraparte={c} podeColaborador={podeColaborador} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} {total === 1 ? "registro" : "registros"}</span>
        {totalPaginas > 1 && (
          <div className="flex items-center gap-2">
            {pagina > 1 && <Button variant="outline" size="sm" render={<Link href={link(pagina - 1)} />}>Anterior</Button>}
            <span>Página {pagina} de {totalPaginas}</span>
            {pagina < totalPaginas && <Button variant="outline" size="sm" render={<Link href={link(pagina + 1)} />}>Próxima</Button>}
          </div>
        )}
      </div>
    </section>
  );
}
