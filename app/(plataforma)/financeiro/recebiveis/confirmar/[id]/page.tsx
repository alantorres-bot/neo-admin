import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { lerPartes } from "@/lib/modulos/financeiro/akf/parcial";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { FUSO, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import {
  agruparPorCliente, mensagemWhatsAppConfirmacao, observacaoDemaisParcelas, prazoConfirmacao, type TituloConfirmacao,
} from "@/supabase/functions/_shared/confirmacao";
import { ROTULO_UNIDADE } from "@/supabase/functions/_shared/cobranca";
import { BotaoCopiar } from "../../[id]/componentes";
import { RegistrarConfirmacao } from "./componentes";

export const metadata: Metadata = { title: "Confirmação de pagamento" };

const MODULO = "financeiro.recebiveis";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nomeParcela = (t: { documento: string; parcela: string }) => `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`;
const quando = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

type Linha = { id: string; documento: string; parcela: string; vencimento: string; valor: number | string; estagio: string; cedido: boolean; contestado: boolean };
type Contato = { id: string; nome: string; funcao: string | null; whatsapp: string | null; email: string | null; finalidades: string[] };

export default async function PaginaConfirmacao({ params, searchParams }: PageProps<"/financeiro/recebiveis/confirmar/[id]">) {
  const { id } = await params;
  const pedida = (await searchParams).unidade;
  const unidade = (Array.isArray(pedida) ? pedida[0] : pedida) === "contagem" ? "contagem" : "matriz";
  if (!UUID.test(id)) notFound();
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");

  const supabase = await criarClienteServidor();
  const { data: cliente } = await supabase.from("contrapartes").select("nome, codigo_erp").eq("id", id).maybeSingle();
  if (!cliente) notFound();
  const nomeCliente = cliente.nome as string;

  const hoje = hojeEmCuiaba();
  const [{ data: linhasBrutas }, { data: contatosBrutos }, { data: interacoesBrutas }] = await Promise.all([
    supabase.from("rec_titulos").select("id, documento, parcela, vencimento, valor, estagio, cedido, contestado").eq("contraparte_id", id).eq("unidade", unidade)
      .in("estagio", ["importado", "aguardando_boleto", "boleto_enviado", "confirmado_cliente"]).gte("vencimento", hoje).order("vencimento").limit(200),
    supabase.from("contatos").select("id, nome, funcao, whatsapp, email, finalidades").eq("contraparte_id", id).eq("ativo", true).order("nome"),
    supabase.from("interacoes").select("id, referencia_id, canal, tipo, descricao, criado_em, usuario_id").eq("contraparte_id", id).eq("modulo", MODULO)
      .in("tipo", ["confirmacao", "sem_resposta_confirmacao"]).order("criado_em", { ascending: false }).limit(10),
  ]);
  const linhas = (linhasBrutas ?? []) as Linha[];
  const contatos = (contatosBrutos ?? []) as Contato[];
  const contato = contatos.find((c) => c.finalidades.includes("confirmacao")) ?? contatos.find((c) => c.finalidades.includes("cobranca")) ?? contatos.find((c) => c.whatsapp) ?? contatos[0] ?? null;

  // Título com parte antecipada na AKF: a confirmação fala só do que resta com a Neo (migration 0113).
  const partes = await lerPartes(supabase, linhas.map((l) => l.id));
  const titulos: TituloConfirmacao[] = linhas.map((l) => ({
    id: l.id, contraparteId: id, nomeCliente, documento: l.documento, parcela: l.parcela, vencimento: l.vencimento,
    valorCentavos: partes.get(l.id)?.restanteCentavos ?? Math.round(Number(l.valor) * 100), estagio: l.estagio, cedido: l.cedido, contestado: l.contestado, unidade,
  }));
  const [grupo] = agruparPorCliente(titulos, hoje);
  const jaConfirmadas = linhas.filter((l) => l.estagio === "confirmado_cliente" && l.vencimento <= new Date(Date.parse(`${hoje}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10));
  const prazoContato = grupo ? prazoConfirmacao(grupo.vencimentoMaisProximo, hoje) : hoje;
  const mensagem = grupo ? mensagemWhatsAppConfirmacao(grupo, contato?.nome ?? "") : null;
  const observacao = grupo ? observacaoDemaisParcelas(grupo) : "";
  const parcelas = grupo ? grupo.titulos.map((t) => ({ id: t.id, rotulo: `${nomeParcela(t)} — vence ${formatarData(t.vencimento)} — ${formatarMoeda(t.valorCentavos)}` })) : [];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/financeiro/recebiveis" />}><ArrowLeft /> Voltar à carteira</Button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Confirmar pagamento <span className="font-normal text-muted-foreground">— {nomeCliente}</span> <Badge variant={unidade === "contagem" ? "default" : "secondary"} className="align-middle">{ROTULO_UNIDADE[unidade]}</Badge></h1>
        <p className="text-sm text-muted-foreground">
          {grupo
            ? <>{grupo.titulos.length} {grupo.titulos.length === 1 ? "parcela" : "parcelas"} vencendo nos próximos 7 dias, total {formatarMoeda(grupo.totalCentavos)}. {prazoContato === hoje ? "Contate o cliente hoje" : `Contate o cliente até ${formatarData(prazoContato)}`} (o ideal é 4 dias antes do vencimento).</>
            : "Nenhuma parcela pendente de confirmação nos próximos 7 dias."}
          {cliente.codigo_erp ? <> Cliente {cliente.codigo_erp as string} no Consistem.</> : null}
        </p>
      </div>

      {grupo && mensagem && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Mensagem pronta (WhatsApp)</CardTitle>
            <CardDescription>
              Copie e envie pelo seu WhatsApp (o sistema não envia).{" "}
              {contato ? <>Para <strong>{contato.nome}</strong>{contato.funcao ? ` (${contato.funcao})` : ""}{contato.whatsapp ? ` · ${contato.whatsapp}` : ""}.</> : "Este cliente ainda não tem contato cadastrado: cadastre em Configurações > Contrapartes e contatos."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-end"><BotaoCopiar texto={mensagem} rotulo="WhatsApp" /></div>
            <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-sans text-sm">{mensagem}</pre>
            {observacao && <p className="text-xs text-muted-foreground">{observacao}</p>}
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
