import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DialogoContato } from "@/app/(plataforma)/configuracoes/contrapartes/dialogos";
import { Badge } from "@/components/ui/badge";
import { formatarWhatsapp } from "@/lib/nucleo/documentos";
import { escolherContato } from "@/supabase/functions/_shared/contatos";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { FUSO } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { emailConfirmacao, mensagemWhatsAppConfirmacao, observacaoDemaisParcelas, prazoConfirmacao } from "@/supabase/functions/_shared/confirmacao";
import { ROTULO_UNIDADE } from "@/supabase/functions/_shared/cobranca";
import { BotaoCopiar } from "@/app/(plataforma)/financeiro/recebiveis/[id]/componentes";
import { CriarRascunhoConfirmacao, RegistrarConfirmacao } from "./componentes";
import { carregarConfirmacao } from "./dados";

export const metadata: Metadata = { title: "Confirmação de pagamento" };

const MODULO = "financeiro.cobranca";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nomeParcela = (t: { documento: string; parcela: string }) => `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`;
const quando = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));


export default async function PaginaConfirmacao({ params, searchParams }: PageProps<"/financeiro/cobranca/confirmar/[id]">) {
  const { id } = await params;
  const pedida = (await searchParams).unidade;
  if (!UUID.test(id)) notFound();
  const sessao = await exigirSessao();
  // O usuário restrito à unidade só vê a dele.
  const unidade = sessao.acesso.restrito ? "contagem" : (Array.isArray(pedida) ? pedida[0] : pedida) === "contagem" ? "contagem" : "matriz";
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, "financeiro.cobranca")) notFound();
  const podeOperar = temAcessoModulo(sessao.acesso, sessao.modulos, "financeiro.cobranca", "operador");

  const supabase = await criarClienteServidor();
  const [dados, { data: interacoesBrutas }] = await Promise.all([
    carregarConfirmacao(supabase, id, unidade),
    supabase.from("interacoes").select("id, referencia_id, canal, tipo, descricao, criado_em, usuario_id").eq("contraparte_id", id).in("modulo", ["financeiro.recebiveis", MODULO])
      .in("tipo", ["confirmacao", "sem_resposta_confirmacao"]).order("criado_em", { ascending: false }).limit(10),
  ]);
  if (!dados) notFound();
  const { nomeCliente, hoje, regra, linhas, contatos, grupo } = dados;
  const cliente = { codigo_erp: dados.codigoErp };
  // Regra única de escolha (`_shared/contatos.ts`): o WhatsApp da mensagem vai para quem tem WhatsApp; o telefone, para ligar.
  const contato = escolherContato(contatos, ["confirmacao", "cobranca"], "whatsapp");
  const contatoLigar = escolherContato(contatos, ["confirmacao", "cobranca"], "telefone");

  const contatoEmail = escolherContato(contatos, ["confirmacao", "cobranca", "boleto"], "email");
  const email = grupo ? emailConfirmacao(grupo, contatoEmail?.nome ?? "") : null;
  const jaConfirmadas = linhas.filter((l) => l.estagio === "confirmado_cliente" && l.vencimento <= new Date(Date.parse(`${hoje}T00:00:00Z`) + regra.janelaConfirmacaoDias * 86_400_000).toISOString().slice(0, 10));
  const prazoContato = grupo ? prazoConfirmacao(grupo.vencimentoMaisProximo, hoje, regra.prazoContatoAntesDias) : hoje;
  const mensagem = grupo ? mensagemWhatsAppConfirmacao(grupo, contato?.nome ?? "") : null;
  const observacao = grupo ? observacaoDemaisParcelas(grupo) : "";
  const parcelas = grupo ? grupo.titulos.map((t) => ({ id: t.id, rotulo: `${nomeParcela(t)} — vence ${formatarData(t.vencimento)} — ${formatarMoeda(t.valorCentavos)}` })) : [];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/financeiro/cobranca/confirmar" />}><ArrowLeft /> Voltar a confirmar pagamento</Button>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">Confirmar pagamento <span className="font-normal text-muted-foreground">— <Link href={`/financeiro/recebiveis/clientes/${id}`} className="hover:underline">{nomeCliente}</Link></span> <Badge variant={unidade === "contagem" ? "default" : "secondary"} className="align-middle">{ROTULO_UNIDADE[unidade]}</Badge></h2>
        <p className="text-sm text-muted-foreground">
          {grupo
            ? <>{grupo.titulos.length} {grupo.titulos.length === 1 ? "parcela" : "parcelas"} vencendo nos próximos {regra.janelaConfirmacaoDias} dias, total {formatarMoeda(grupo.totalCentavos)}. {prazoContato === hoje ? "Contate o cliente hoje" : `Contate o cliente até ${formatarData(prazoContato)}`} (o ideal é {regra.prazoContatoAntesDias} dias antes do vencimento).</>
            : `Nenhuma parcela pendente de confirmação nos próximos ${regra.janelaConfirmacaoDias} dias.`}
          {cliente.codigo_erp ? <> Cliente {cliente.codigo_erp as string} no Consistem.</> : null}
        </p>
      </div>

      {grupo && mensagem && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Mensagem pronta (WhatsApp)</CardTitle>
            <CardDescription>
              Copie e envie pelo seu WhatsApp (o sistema não envia).{" "}
              {contato ? <>Para <strong>{contato.nome}</strong>{contato.funcao ? ` (${contato.funcao})` : ""}{contato.whatsapp ? ` · ${formatarWhatsapp(contato.whatsapp)}` : ""}.</> : <>{contatos.length > 0 ? "Nenhum contato deste cliente tem WhatsApp." : "Este cliente ainda não tem contato cadastrado."} {podeOperar && <DialogoContato contraparteId={id} finalidadesIniciais={["confirmacao"]} rotuloBotao="Cadastrar contato" />}</>}
              {contatoLigar && <> Para ligar: <strong>{contatoLigar.nome}</strong> · {formatarWhatsapp(contatoLigar.telefone ?? contatoLigar.whatsapp)}.</>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-end"><BotaoCopiar texto={mensagem} rotulo="WhatsApp" /></div>
            <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-sans text-sm">{mensagem}</pre>
            {observacao && <p className="text-xs text-muted-foreground">{observacao}</p>}
          </CardContent>
        </Card>
      )}

      {grupo && email && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>E-mail pronto</CardTitle>
            <CardDescription>
              Crie o rascunho no Gmail (o boleto de cada parcela, quando houver, vai anexado) e envie de lá; o sistema não envia.{" "}
              {contatoEmail ? <>Para <strong>{contatoEmail.nome}</strong> · {contatoEmail.email}.</> : "Nenhum contato deste cliente tem e-mail."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <BotaoCopiar texto={email.corpo} rotulo="E-mail" />
              {podeOperar && <CriarRascunhoConfirmacao clienteId={id} unidade={unidade} desabilitadoPor={contatoEmail?.email ? null : "Cadastre um contato com e-mail."} />}
            </div>
            <p className="text-sm"><span className="text-muted-foreground">Assunto:</span> {email.assunto}</p>
            <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-sans text-sm">{email.corpo}</pre>
          </CardContent>
        </Card>
      )}

      {podeOperar && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Registrar o resultado do contato</CardTitle>
            <CardDescription>“Cliente confirmou” passa as parcelas marcadas para “Confirmado pelo cliente”. “Sem resposta” mantém o estágio e abre a pendência para ligar. Nos dois casos a pendência de confirmação é concluída e o contato fica no histórico.</CardDescription>
          </CardHeader>
          <CardContent>
            <RegistrarConfirmacao key={parcelas.map((p) => p.id).join(",")} parcelas={parcelas} />
          </CardContent>
        </Card>
      )}

      {jaConfirmadas.length > 0 && (
        <p className="text-sm text-muted-foreground">Já confirmadas pelo cliente nesta janela: {jaConfirmadas.map((l) => nomeParcela(l)).join(", ")}.</p>
      )}

      <Card size="sm">
        <CardHeader><CardTitle>Histórico das confirmações</CardTitle></CardHeader>
        <CardContent>
          {(interacoesBrutas ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(interacoesBrutas ?? []).map((i) => (
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
