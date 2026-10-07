import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DialogoContato, DialogoContraparte } from "@/app/(plataforma)/configuracoes/contrapartes/dialogos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerPartes } from "@/lib/modulos/financeiro/akf/parcial";
import { descreverAtraso, formatarMoeda, formatarValor, grupoDaSituacao, ROTULO_GRUPO_SELO } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { clienteNoEscopoDeCadastro, DIAS_ESCOPO_CADASTRO } from "@/lib/modulos/financeiro/recebiveis/clientes";
import { formatarWhatsapp } from "@/lib/nucleo/documentos";
import { FUSO, formatarData } from "@/lib/nucleo/fila";
import { temAcesso, temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { ROTULO_CANAL, ROTULO_TIPO_CONTRAPARTE } from "@/lib/nucleo/rotulos";
import { exigirSessao } from "@/lib/nucleo/sessao";
import type { Contato, Contraparte } from "@/lib/nucleo/tipos";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ROTULO_UNIDADE } from "@/supabase/functions/_shared/cobranca";
import { finalidadesDesconhecidas, normalizarFinalidade, ROTULO_FINALIDADE, temContatoUtil, type Finalidade } from "@/supabase/functions/_shared/contatos";

export const metadata: Metadata = { title: "Cliente" };

const MODULO = "financeiro.recebiveis";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const quando = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

type TituloAberto = {
  id: string; documento: string; parcela: string; vencimento: string; valor: number | string; dias_atraso: number; faixa: string; estagio: string;
  cedido: boolean; contestado: boolean; unidade: string;
};

export default async function PaginaCliente({ params }: PageProps<"/financeiro/recebiveis/clientes/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador") && temAcessoAlgumaArea(sessao.acesso, sessao.areas, "operador");
  const podeColaborador = temAcesso(sessao.acesso, "rh", "operador");

  const supabase = await criarClienteServidor();
  const { data: clienteBruto } = await supabase.from("contrapartes").select("id, nome, documento, tipos, codigo_erp, observacoes, ativo, criado_em").eq("id", id).maybeSingle();
  if (!clienteBruto) notFound();
  const cliente = clienteBruto as Contraparte;

  const [{ data: contatosBrutos }, { data: titulosBrutos }, { data: interacoesBrutas }] = await Promise.all([
    supabase.from("contatos").select("id, contraparte_id, nome, funcao, email, whatsapp, telefone, canal_preferido, finalidades, ativo").eq("contraparte_id", id).order("ativo", { ascending: false }).order("nome"),
    supabase.from("rec_vw_titulos").select("id, documento, parcela, vencimento, valor, dias_atraso, faixa, estagio, cedido, contestado, unidade").eq("contraparte_id", id).neq("faixa", "encerrado").order("vencimento").limit(500),
    supabase.from("interacoes").select("id, referencia_id, tipo, descricao, criado_em, usuario_id").eq("contraparte_id", id).in("modulo", [MODULO, "financeiro.akf"]).order("criado_em", { ascending: false }).limit(30),
  ]);
  const contatos = (contatosBrutos ?? []) as Contato[];
  const titulos = (titulosBrutos ?? []) as TituloAberto[];
  const partes = await lerPartes(supabase, titulos.map((t) => t.id));
  const interacoes = interacoesBrutas ?? [];

  const documentosDosTitulos = new Map(titulos.map((t) => [t.id, `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`]));
  const idsUsuarios = [...new Set(interacoes.map((i) => i.usuario_id as string | null).filter((x): x is string => !!x))];
  const nomesUsuarios = new Map<string, string>();
  if (idsUsuarios.length > 0) {
    const { data } = await supabase.from("perfis").select("id, nome").in("id", idsUsuarios);
    for (const p of data ?? []) nomesUsuarios.set(p.id as string, p.nome as string);
  }

  const semContatoUtil = !temContatoUtil(contatos.map((c) => ({ ...c, finalidades: c.finalidades })));
  const noEscopo = clienteNoEscopoDeCadastro(titulos);
  const porUnidade = (u: "matriz" | "contagem") => titulos.filter((t) => (t.unidade === "contagem" ? "contagem" : "matriz") === u);
  const unidades = (["matriz", "contagem"] as const).filter((u) => porUnidade(u).length > 0);
  const total = titulos.reduce((s, t) => s + Math.round(Number(t.valor) * 100), 0);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/financeiro/recebiveis" />}><ArrowLeft /> Voltar à carteira</Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{cliente.nome}</h1>
          <p className="text-sm text-muted-foreground">
            {cliente.documento ?? "Sem CPF/CNPJ"}
            {cliente.codigo_erp ? <> · Cliente {cliente.codigo_erp} no Consistem</> : null}
            {" · "}{cliente.tipos.map((t) => ROTULO_TIPO_CONTRAPARTE[t]).join(", ")}
            {!cliente.ativo && " · inativo"}
          </p>
          <p className="text-xs text-muted-foreground">
            {titulos.length} {titulos.length === 1 ? "título em aberto" : "títulos em aberto"} · {formatarMoeda(total)}
            {unidades.length > 0 && <> · {unidades.map((u) => ROTULO_UNIDADE[u]).join(" e ")}</>}
          </p>
        </div>
        {podeOperar && <DialogoContraparte contraparte={cliente} podeColaborador={podeColaborador} />}
      </div>

      {semContatoUtil && noEscopo && (
        <p className="rounded-[3px] border border-marca bg-marca-clara p-3 text-sm">
          <strong>Falta cadastrar o contato deste cliente.</strong> Ele tem título em aberto a vencer ou vencido há menos de {DIAS_ESCOPO_CADASTRO} dias: cadastre e-mail, WhatsApp ou telefone abaixo, para o boleto, a confirmação e a cobrança.
        </p>
      )}
      {semContatoUtil && !noEscopo && (
        <p className="rounded-[3px] border border-dashed p-3 text-sm text-muted-foreground">
          Este cliente ainda não tem contato cadastrado. Por enquanto só se cadastram os clientes de Cuiabá com título a vencer ou vencido há menos de {DIAS_ESCOPO_CADASTRO} dias; os demais ficam para outro momento.
        </p>
      )}

      <Card size="sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Contatos</CardTitle>
              <CardDescription>Quem recebe o boleto, a confirmação e a cobrança. Marque em &quot;Recebe&quot; o que cada contato deve receber.</CardDescription>
            </div>
            {podeOperar && <DialogoContato contraparteId={cliente.id} finalidadesIniciais={["boleto", "cobranca", "confirmacao"]} />}
          </div>
        </CardHeader>
        <CardContent>
          {contatos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum contato cadastrado.</p>
          ) : (
            <div className="overflow-x-auto rounded-[3px] border border-grade">
              <Table className="cartoes">
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>WhatsApp</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Recebe</TableHead>
                    {podeOperar && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contatos.map((t) => (
                    <TableRow key={t.id} className={t.ativo ? "" : "opacity-60"}>
                      <TableCell className="font-medium">{t.nome}{!t.ativo && <Badge variant="outline" className="ml-2">Inativo</Badge>}</TableCell>
                      <TableCell>{t.funcao ?? "—"}</TableCell>
                      <TableCell>{t.email ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{t.whatsapp ? formatarWhatsapp(t.whatsapp) : "—"}</TableCell>
                      <TableCell className="tabular-nums">{t.telefone ? formatarWhatsapp(t.telefone) : "—"}</TableCell>
                      <TableCell>{t.canal_preferido ? ROTULO_CANAL[t.canal_preferido] : "—"}</TableCell>
                      <TableCell className="space-x-1">
                        {t.finalidades.map((f) => finalidadesDesconhecidas([f]).length > 0
                          ? <Badge key={f} variant="destructive" title="O sistema não reconhece esta finalidade: edite o contato.">{f}</Badge>
                          : <Badge key={f} variant="outline">{ROTULO_FINALIDADE[normalizarFinalidade(f) as Finalidade]}</Badge>)}
                      </TableCell>
                      {podeOperar && <TableCell className="text-right"><DialogoContato contraparteId={cliente.id} contato={t} /></TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Títulos em aberto</CardTitle>
          <CardDescription>Clique no documento para ver o boleto, a esteira e o histórico do título.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {titulos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum título em aberto.</p>}
          {unidades.map((u) => (
            <div key={u} className="space-y-1">
              {unidades.length > 1 && <p className="text-xs font-bold">{ROTULO_UNIDADE[u]}</p>}
              <div className="overflow-x-auto rounded-[3px] border border-grade">
                <Table className="cartoes">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Documento</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Atraso</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {porUnidade(u).map((t) => {
                      const g = grupoDaSituacao(t);
                      const parte = partes.get(t.id);
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium tabular-nums"><Link href={`/financeiro/recebiveis/${t.id}`} className="hover:underline">{documentosDosTitulos.get(t.id)}</Link></TableCell>
                          <TableCell className="tabular-nums">{formatarData(t.vencimento)}</TableCell>
                          <TableCell className={t.dias_atraso > 0 ? "font-medium text-red-700" : "text-muted-foreground"}>{descreverAtraso(t.dias_atraso)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatarValor(t.valor)}
                            {parte && <span className="block text-[11px] text-sky-800">{formatarMoeda(parte.akfCentavos)} na AKF · resta {formatarMoeda(parte.restanteCentavos)}</span>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{ROTULO_GRUPO_SELO[g]}</Badge>
                            {t.cedido && <Badge className="ml-1 bg-sky-100 text-sky-900">Na AKF</Badge>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader><CardTitle>Histórico do cliente</CardTitle></CardHeader>
        <CardContent>
          {interacoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {interacoes.map((i) => (
                <li key={i.id as string} className="flex flex-wrap gap-x-3">
                  <span className="tabular-nums text-muted-foreground">{quando(i.criado_em as string)}</span>
                  {i.referencia_id && documentosDosTitulos.get(i.referencia_id as string) && <span className="font-medium">{documentosDosTitulos.get(i.referencia_id as string)}</span>}
                  <span>{(i.descricao as string | null) ?? (i.tipo as string)}</span>
                  {i.usuario_id ? <span className="text-muted-foreground">— {nomesUsuarios.get(i.usuario_id as string) ?? "usuário"}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
