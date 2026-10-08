import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DialogoContato } from "@/app/(plataforma)/configuracoes/contrapartes/dialogos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { FUSO } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import {
  emailCobranca, linhaDemonstrativo, marcoInformaEncargos, mensagemWhatsAppCobranca, ROTULO_UNIDADE, totalAtualizadoCentavos,
} from "@/supabase/functions/_shared/cobranca";
import { BotaoCopiar } from "@/app/(plataforma)/financeiro/recebiveis/[id]/componentes";
import { carregarCobranca } from "./dados";
import { CriarRascunhoCobranca, RegistrarCobranca } from "./componentes";

export const metadata: Metadata = { title: "Cobrança do cliente" };

const MODULO = "financeiro.cobranca";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nomeParcela = (t: { documento: string; parcela: string }) => `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`;
const quando = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default async function PaginaCobranca({ params }: PageProps<"/financeiro/cobranca/cobrar/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");

  const supabase = await criarClienteServidor();
  const dados = await carregarCobranca(supabase, id);
  if (!dados) notFound();
  const { data: historico } = await supabase.from("interacoes").select("id, tipo, descricao, criado_em").eq("contraparte_id", id).eq("modulo", MODULO)
    .in("tipo", ["cobranca", "promessa", "contestacao", "rascunho_gmail"]).order("criado_em", { ascending: false }).limit(15);

  const { hoje, grupos, contatoWhatsapp, contatoEmail, foraDaRegua } = dados;
  const totalEmAberto = grupos.reduce((s, g) => s + g.totalCentavos, 0);
  const totalTitulos = grupos.reduce((s, g) => s + g.titulos.length, 0);
  // O histórico mostra só os rascunhos de cobrança (os do boleto ficam na ficha da NF).
  const registros = (historico ?? []).filter((i) => i.tipo !== "rascunho_gmail" || String(i.descricao ?? "").includes("de cobrança"));

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/financeiro/cobranca/cobrar" />}><ArrowLeft /> Voltar às cobranças</Button>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">Cobrar <span className="font-normal text-muted-foreground">— <Link href={`/financeiro/recebiveis/clientes/${id}`} className="hover:underline">{dados.nomeCliente}</Link></span></h2>
        <p className="text-sm text-muted-foreground">
          {grupos.length > 0
            ? <>{totalTitulos} {totalTitulos === 1 ? "título vencido" : "títulos vencidos"} na régua, total {formatarMoeda(totalEmAberto)}.</>
            : dados.corte ? "Nenhum título para cobrar pela régua agora." : "A régua de cobrança está desligada (sem data de corte)."}
          {dados.codigoErp ? <> Cliente {dados.codigoErp} no Consistem.</> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          A régua vale para vencimentos a partir de {dados.corte ? formatarData(dados.corte) : "—"}. O sistema nunca envia: você copia a mensagem (ou cria o rascunho no Gmail), envia e registra o resultado.
        </p>
      </div>

      {foraDaRegua.quantidade > 0 && (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Este cliente tem também {foraDaRegua.quantidade} {foraDaRegua.quantidade === 1 ? "título vencido" : "títulos vencidos"} ({formatarMoeda(foraDaRegua.totalCentavos)}) com vencimento antes de {formatarData(dados.corte)}: fora da régua automática. Decida o tratamento caso a caso (cedido, contestado, acordo).
        </p>
      )}

      {grupos.map((g) => {
        const def = dados.marcos.find((m) => m.dias === g.marco)!;
        const whats = mensagemWhatsAppCobranca(g, contatoWhatsapp?.nome ?? "", dados.marcos, hoje);
        const email = emailCobranca(g, hoje, contatoEmail?.nome ?? "", dados.marcos);
        const parcelas = g.titulos.map((t) => ({ id: t.id, rotulo: `${nomeParcela(t)} — venceu ${formatarData(t.vencimento)} — ${formatarMoeda(t.valorCentavos)}` }));
        const canalSugerido = def.canais.includes("whatsapp") ? "whatsapp" : "email";
        return (
          <Card key={`${g.unidade}-${g.marco}`}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">{def.nome} — {def.descricao} <Badge variant={g.unidade === "contagem" ? "default" : "secondary"}>{ROTULO_UNIDADE[g.unidade]}</Badge></CardTitle>
              <CardDescription>
                {g.titulos.length} {g.titulos.length === 1 ? "parcela" : "parcelas"}, total {formatarMoeda(g.totalCentavos)} (atualizado hoje com multa e juros: {formatarMoeda(totalAtualizadoCentavos(g, hoje))}*).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {whats && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">Mensagem de WhatsApp</p>
                    <BotaoCopiar texto={whats} rotulo="WhatsApp" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {contatoWhatsapp ? <>Para <strong>{contatoWhatsapp.nome}</strong>{contatoWhatsapp.funcao ? ` (${contatoWhatsapp.funcao})` : ""}{contatoWhatsapp.whatsapp ? ` · ${contatoWhatsapp.whatsapp}` : ""}.</> : <>{dados.contatos.length > 0 ? "Nenhum contato deste cliente tem WhatsApp." : "Este cliente ainda não tem contato cadastrado."} {podeOperar && <DialogoContato contraparteId={id} finalidadesIniciais={["cobranca"]} rotuloBotao="Cadastrar contato" />}</>}
                  </p>
                  <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-sans text-sm">{whats}</pre>
                </div>
              )}

              {email && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">E-mail</p>
                    <div className="flex flex-wrap gap-2">
                      <BotaoCopiar texto={email.assunto} rotulo="assunto" />
                      <BotaoCopiar texto={email.corpo} rotulo="e-mail" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {contatoEmail ? <>Para <strong>{contatoEmail.nome}</strong>{contatoEmail.email ? ` · ${contatoEmail.email}` : ""}.</> : <>Nenhum contato com e-mail cadastrado. {podeOperar && <DialogoContato contraparteId={id} finalidadesIniciais={["cobranca"]} rotuloBotao="Cadastrar contato" />}</>}{" "}
                    Assunto: {email.assunto}
                  </p>
                  <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-sans text-sm">{email.corpo}</pre>
                  {podeOperar && (
                    <CriarRascunhoCobranca clienteId={id} marco={g.marco} unidade={g.unidade} desabilitadoPor={contatoEmail?.email ? null : "O cliente não tem contato com e-mail cadastrado."} />
                  )}
                  {marcoInformaEncargos(def) && (
                    <p className="text-xs text-muted-foreground">
                      * Encargos pelo padrão do módulo (multa 2% e juros 2% ao mês, pro rata dia). Confirme no contrato do cliente antes de enviar o demonstrativo.
                    </p>
                  )}
                </div>
              )}

              {marcoInformaEncargos(def) && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Demonstrativo por título</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-sans text-xs">{g.titulos.map((t) => linhaDemonstrativo(t, hoje)).join("\n")}</pre>
                </details>
              )}

              {podeOperar && (
                <div className="space-y-2 border-t pt-4">
                  <p className="text-sm font-medium">Registrar o resultado</p>
                  <RegistrarCobranca key={parcelas.map((p) => p.id).join(",")} marco={g.marco} parcelas={parcelas} hoje={hoje} canalSugerido={canalSugerido} />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card size="sm">
        <CardHeader><CardTitle>Histórico da cobrança</CardTitle></CardHeader>
        <CardContent>
          {registros.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {registros.map((i) => (
                <li key={i.id as string} className="flex flex-wrap gap-x-3">
                  <span className="tabular-nums text-muted-foreground">{quando(i.criado_em as string)}</span>
                  <span>{(i.descricao as string | null) ?? (i.tipo as string)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
