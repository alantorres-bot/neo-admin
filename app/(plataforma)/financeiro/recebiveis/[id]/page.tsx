import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MODULO_RECEBIVEIS } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { descreverAtraso, ROTULO_ESTAGIO } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { FUSO } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { AnexarBoleto, BotaoCopiar, CriarRascunhoGmail, LinhaDigitavel, MarcarEnviado } from "./componentes";
import { carregarFicha, centavos, ENCERRADOS } from "./dados";

export const metadata: Metadata = { title: "Boleto e envio" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const quando = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default async function PaginaBoleto({ params, searchParams }: PageProps<"/financeiro/recebiveis/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_RECEBIVEIS);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const parametros = await searchParams;

  const supabase = await criarClienteServidor();
  const f = await carregarFicha(supabase, id, primeiro(parametros.contato), { assinarLinks: true });
  if (!f) notFound();
  const { parcelas, contato, contatos, boletoDaParcela, aguardando, email, whatsapp } = f;

  const parcelasEnvio = aguardando.map((p) => ({
    id: p.id,
    rotulo: `${p.documento}${p.parcela !== "1" ? `/${p.parcela}` : ""} — vence ${formatarData(p.vencimento)} — ${formatarMoeda(centavos(p.valor))}`,
    temBoleto: boletoDaParcela.has(p.id),
  }));
  const faltaBoleto = aguardando.some((p) => !boletoDaParcela.has(p.id));
  let motivoSemRascunho: string | null = null;
  if (aguardando.length === 0) motivoSemRascunho = "Nenhuma parcela aguardando envio.";
  else if (faltaBoleto) motivoSemRascunho = "Anexe o boleto de todas as parcelas que aguardam envio.";
  else if (!contato?.email) motivoSemRascunho = "O contato escolhido não tem e-mail cadastrado.";
  else if (!email) motivoSemRascunho = "O modelo de e-mail do boleto está desativado.";

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/financeiro/recebiveis" />}><ArrowLeft /> Voltar à carteira</Button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{f.notaNumero ? `NF ${f.notaNumero}` : f.base.documento} <span className="font-normal text-muted-foreground">— {f.nomeCliente || "cliente"}</span></h1>
        <p className="text-sm text-muted-foreground">
          {parcelas.length} {parcelas.length === 1 ? "parcela" : "parcelas"} · {formatarMoeda(f.totalCentavos)}
          {f.pedidos.length > 0 && <> · Pedido{f.pedidos.length > 1 ? "s" : ""} {f.pedidos.join(", ")}</>}
          {f.codigoErp ? <> · Cliente {f.codigoErp} no Consistem</> : null}
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
            Copie o texto ou crie o rascunho do e-mail no Gmail, já com os boletos em anexo (o sistema nunca envia: você confere e envia no Gmail).{" "}
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
          {podeOperar && (
            <div className="pt-1">
              <CriarRascunhoGmail tituloId={id} contatoId={contato?.id ?? null} desabilitadoPor={motivoSemRascunho} />
            </div>
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
          {whatsapp ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">WhatsApp</h3><BotaoCopiar texto={whatsapp.corpo} rotulo="WhatsApp" /></div>
              <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-sans text-sm">{whatsapp.corpo}</pre>
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
          {f.interacoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {f.interacoes.map((i) => {
                const p = parcelas.find((x) => x.id === i.referencia_id);
                return (
                  <li key={i.id} className="flex flex-wrap gap-x-3">
                    <span className="tabular-nums text-muted-foreground">{quando(i.criado_em)}</span>
                    <span className="font-medium">{p ? `${p.documento}${p.parcela !== "1" ? `/${p.parcela}` : ""}` : ""}</span>
                    <span>{i.descricao ?? i.tipo}</span>
                    {i.usuario_id ? <span className="text-muted-foreground">— {f.nomesUsuarios.get(i.usuario_id) ?? "usuário"}</span> : null}
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
