import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MODELO_BOLETO_EMAIL, MODELO_BOLETO_WHATSAPP, MODULO_RECEBIVEIS, montarMensagem, TIPO_ANEXO_BOLETO, type DadosMensagem, type ParcelaMensagem,
} from "@/lib/modulos/financeiro/recebiveis/boleto";
import { descreverAtraso, ROTULO_ESTAGIO } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { urlAssinadaAnexo } from "@/lib/nucleo/anexos";
import { FUSO } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { AnexarBoleto, BotaoCopiar, LinhaDigitavel, MarcarEnviado } from "./componentes";

export const metadata: Metadata = { title: "Boleto e envio" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const centavos = (v: number | string) => Math.round(Number(v) * 100);

type Parcela = {
  id: string; documento: string; parcela: string; emissao: string | null; vencimento: string; valor: number | string; valor_atualizado: number | string;
  dias_atraso: number; estagio: string; linha_digitavel: string | null; boleto_enviado_em: string | null; nota_fiscal: string | null;
  nota_saida_id: string | null; contraparte_id: string;
};
type Contato = { id: string; nome: string; funcao: string | null; email: string | null; whatsapp: string | null; finalidades: string[]; canal_preferido: "email" | "whatsapp" | "telefone" | "interno" | null };

const ENCERRADOS = ["pago", "renegociado", "cancelado"];

export default async function PaginaBoleto({ params, searchParams }: PageProps<"/financeiro/recebiveis/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_RECEBIVEIS);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const parametros = await searchParams;

  const supabase = await criarClienteServidor();
  const colunas = "id, documento, parcela, emissao, vencimento, valor, valor_atualizado, dias_atraso, estagio, linha_digitavel, boleto_enviado_em, nota_fiscal, nota_saida_id, contraparte_id";

  const { data: alvo } = await supabase.from("rec_vw_titulos").select(colunas).eq("id", id).maybeSingle();
  if (!alvo) notFound();
  const base = alvo as Parcela;

  // As parcelas da mesma NF andam juntas (um boleto por parcela, um envio por NF).
  const consultaParcelas = supabase.from("rec_vw_titulos").select(colunas).order("vencimento").order("documento");
  const { data: grupoBruto, error: erroGrupo } = await (base.nota_saida_id ? consultaParcelas.eq("nota_saida_id", base.nota_saida_id) : consultaParcelas.eq("id", id));
  if (erroGrupo) throw new Error(`Falha ao ler as parcelas: ${erroGrupo.message}`);
  const parcelas = (grupoBruto ?? []) as Parcela[];
  const ids = parcelas.map((p) => p.id);

  const [{ data: cliente }, { data: nota }, { data: contatosBrutos }, { data: anexosBrutos }, { data: interacoesBrutas }, { data: modelosBrutos }] = await Promise.all([
    supabase.from("contrapartes").select("nome, codigo_erp").eq("id", base.contraparte_id).maybeSingle(),
    base.nota_saida_id ? supabase.from("rec_notas_saida").select("nota, pedidos").eq("id", base.nota_saida_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("contatos").select("id, nome, funcao, email, whatsapp, finalidades, canal_preferido").eq("contraparte_id", base.contraparte_id).eq("ativo", true).order("nome"),
    supabase.from("anexos").select("referencia_id, arquivo_path, nome_arquivo, enviado_em").eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "rec_titulos")
      .eq("tipo", TIPO_ANEXO_BOLETO).in("referencia_id", ids).order("enviado_em", { ascending: false }),
    supabase.from("interacoes").select("id, referencia_id, canal, tipo, descricao, criado_em, usuario_id").eq("referencia_tabela", "rec_titulos")
      .in("referencia_id", ids).order("criado_em", { ascending: false }).limit(20),
    supabase.from("modelos_mensagem").select("nome, canal, assunto, corpo").eq("modulo", MODULO_RECEBIVEIS).eq("ativo", true).in("nome", [MODELO_BOLETO_EMAIL, MODELO_BOLETO_WHATSAPP]),
  ]);

  // Boleto mais recente de cada parcela, com link assinado (o bucket é privado).
  const boletoDaParcela = new Map<string, { nome: string; url: string | null }>();
  for (const a of anexosBrutos ?? []) {
    const parcelaId = a.referencia_id as string;
    if (boletoDaParcela.has(parcelaId)) continue;
    const r = await urlAssinadaAnexo(supabase, a.arquivo_path as string, 900);
    boletoDaParcela.set(parcelaId, { nome: a.nome_arquivo as string, url: r.ok ? r.url : null });
  }

  const idsUsuarios = [...new Set((interacoesBrutas ?? []).map((i) => i.usuario_id as string | null).filter((x): x is string => !!x))];
  const nomesUsuarios = new Map<string, string>();
  if (idsUsuarios.length > 0) {
    const { data } = await supabase.from("perfis").select("id, nome").in("id", idsUsuarios);
    for (const p of data ?? []) nomesUsuarios.set(p.id as string, p.nome as string);
  }

  const contatos = (contatosBrutos ?? []) as Contato[];
  const contatoPedido = primeiro(parametros.contato);
  const contato = contatos.find((c) => c.id === contatoPedido) ?? contatos.find((c) => c.finalidades.includes("boleto")) ?? contatos[0] ?? null;

  const nomeCliente = (cliente?.nome as string | undefined) ?? "";
  const referencia = nota ? `NF ${nota.nota as string}` : `título ${base.documento}${base.parcela !== "1" ? `/${base.parcela}` : ""}`;
  const pedidos = (nota?.pedidos as string[] | undefined) ?? [];

  const aguardando = parcelas.filter((p) => p.estagio === "aguardando_boleto");
  const paraMensagem = aguardando.length > 0 ? aguardando : parcelas.filter((p) => !ENCERRADOS.includes(p.estagio));
  const dadosMensagem: DadosMensagem = {
    contato: contato?.nome ?? "",
    cliente: nomeCliente,
    referencia,
    parcelas: paraMensagem.map((p): ParcelaMensagem => ({
      documento: p.documento, parcela: p.parcela, vencimento: p.vencimento, valorCentavos: centavos(p.valor), linhaDigitavel: p.linha_digitavel,
    })),
  };
  const modeloEmail = modelosBrutos?.find((m) => m.nome === MODELO_BOLETO_EMAIL);
  const modeloWhats = modelosBrutos?.find((m) => m.nome === MODELO_BOLETO_WHATSAPP);
  const email = modeloEmail && paraMensagem.length > 0 ? montarMensagem({ assunto: modeloEmail.assunto as string | null, corpo: modeloEmail.corpo as string }, dadosMensagem) : null;
  const whats = modeloWhats && paraMensagem.length > 0 ? montarMensagem({ assunto: null, corpo: modeloWhats.corpo as string }, dadosMensagem) : null;

  const totalCentavos = parcelas.reduce((s, p) => s + centavos(p.valor), 0);
  const parcelasEnvio = aguardando.map((p) => ({ id: p.id, rotulo: `${p.documento}${p.parcela !== "1" ? `/${p.parcela}` : ""} — vence ${formatarData(p.vencimento)} — ${formatarMoeda(centavos(p.valor))}`, temBoleto: boletoDaParcela.has(p.id) }));
  const quando = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/financeiro/recebiveis" />}><ArrowLeft /> Voltar à carteira</Button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{nota ? `NF ${nota.nota as string}` : base.documento} <span className="font-normal text-muted-foreground">— {nomeCliente || "cliente"}</span></h1>
        <p className="text-sm text-muted-foreground">
          {parcelas.length} {parcelas.length === 1 ? "parcela" : "parcelas"} · {formatarMoeda(totalCentavos)}
          {pedidos.length > 0 && <> · Pedido{pedidos.length > 1 ? "s" : ""} {pedidos.join(", ")}</>}
          {cliente?.codigo_erp ? <> · Cliente {cliente.codigo_erp as string} no Consistem</> : null}
        </p>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Boleto de cada parcela</CardTitle>
          <CardDescription>O boleto é gerado no Consistem ou no banco; anexe aqui o PDF de cada parcela. Anexo não se apaga: para trocar, envie outro (vale o mais recente).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {parcelas.map((p) => {
            const boleto = boletoDaParcela.get(p.id);
            const aberto = !ENCERRADOS.includes(p.estagio);
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3 text-sm">
                <div className="min-w-44">
                  <div className="font-medium tabular-nums">{p.documento}{p.parcela !== "1" ? `/${p.parcela}` : ""}</div>
                  <div className="text-xs text-muted-foreground">vence {formatarData(p.vencimento)} · {p.dias_atraso > 0 ? descreverAtraso(p.dias_atraso) : "a vencer"}</div>
                </div>
                <div className="tabular-nums">{formatarMoeda(centavos(p.valor))}</div>
                <Badge variant={p.estagio === "aguardando_boleto" ? "outline" : "secondary"}>{ROTULO_ESTAGIO[p.estagio] ?? p.estagio}</Badge>
                {p.boleto_enviado_em && <span className="text-xs text-muted-foreground">enviado em {quando(p.boleto_enviado_em)}</span>}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {boleto ? (
                    boleto.url
                      ? <Button variant="outline" size="sm" render={<a href={boleto.url} target="_blank" rel="noreferrer" />}><ExternalLink /> {boleto.nome.length > 28 ? `${boleto.nome.slice(0, 25)}…` : boleto.nome}</Button>
                      : <span className="text-xs text-muted-foreground">{boleto.nome}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">sem boleto</span>
                  )}
                  {podeOperar && aberto && <AnexarBoleto tituloId={p.id} temBoleto={!!boleto} />}
                </div>
                {aberto && (
                  <div className="w-full">
                    <LinhaDigitavel tituloId={p.id} valor={p.linha_digitavel} podeEditar={podeOperar} />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Mensagem pronta</CardTitle>
          <CardDescription>
            Texto para copiar e enviar (nada é enviado pelo sistema).{" "}
            {contato ? <>Para <strong>{contato.nome}</strong>{contato.funcao ? ` (${contato.funcao})` : ""}{contato.email ? ` · ${contato.email}` : ""}{contato.whatsapp ? ` · ${contato.whatsapp}` : ""}.</> : "Este cliente ainda não tem contato cadastrado: cadastre em Configurações > Contrapartes e contatos."}
          </CardDescription>
          {contatos.length > 1 && (
            <form method="get" className="flex items-center gap-2 pt-1">
              <select name="contato" defaultValue={contato?.id} aria-label="Contato" className="h-8 rounded-lg border bg-background px-2 text-sm">
                {contatos.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.finalidades.includes("boleto") ? " (boleto)" : ""}</option>)}
              </select>
              <Button type="submit" variant="secondary" size="sm">Usar este contato</Button>
            </form>
          )}
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {email ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">E-mail</h3><BotaoCopiar texto={`${email.assunto ?? ""}\n\n${email.corpo}`} rotulo="E-mail" /></div>
              <p className="text-xs text-muted-foreground">Assunto: {email.assunto}</p>
              <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-sans text-sm">{email.corpo}</pre>
            </div>
          ) : <p className="text-sm text-muted-foreground">Sem parcelas em aberto para montar o e-mail (ou o modelo foi desativado).</p>}
          {whats ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">WhatsApp</h3><BotaoCopiar texto={whats.corpo} rotulo="WhatsApp" /></div>
              <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-sans text-sm">{whats.corpo}</pre>
            </div>
          ) : <p className="text-sm text-muted-foreground">Sem parcelas em aberto para montar o WhatsApp (ou o modelo foi desativado).</p>}
        </CardContent>
      </Card>

      {podeOperar && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Registrar o envio</CardTitle>
            <CardDescription>Depois de enviar ao cliente, marque aqui. A parcela passa para “Boleto enviado”, o envio fica no histórico e, quando a NF não tem mais parcela aguardando, a pendência “Anexar boleto” é concluída.</CardDescription>
          </CardHeader>
          <CardContent>
            <MarcarEnviado key={parcelasEnvio.map((p) => `${p.id}:${p.temBoleto ? 1 : 0}`).join(",")} parcelas={parcelasEnvio} contatoId={contato?.id ?? null} canalSugerido={contato?.canal_preferido ?? "email"} />
          </CardContent>
        </Card>
      )}

      <Card size="sm">
        <CardHeader><CardTitle>Histórico</CardTitle></CardHeader>
        <CardContent>
          {(interacoesBrutas ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(interacoesBrutas ?? []).map((i) => {
                const p = parcelas.find((x) => x.id === i.referencia_id);
                return (
                  <li key={i.id as string} className="flex flex-wrap gap-x-3">
                    <span className="tabular-nums text-muted-foreground">{quando(i.criado_em as string)}</span>
                    <span className="font-medium">{p ? `${p.documento}${p.parcela !== "1" ? `/${p.parcela}` : ""}` : ""}</span>
                    <span>{(i.descricao as string | null) ?? (i.tipo as string)}</span>
                    {i.usuario_id ? <span className="text-muted-foreground">— {nomesUsuarios.get(i.usuario_id as string) ?? "usuário"}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
