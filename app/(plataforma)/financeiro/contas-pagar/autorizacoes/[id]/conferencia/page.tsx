import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { podeConferir, type LinhaConferencia } from "@/lib/modulos/financeiro/contas-pagar/conferencia";
import { ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerAutorizacao, quandoEm } from "../../../dados";
import { TabelaConferencia } from "./tabela-conferencia";

export const metadata: Metadata = { title: "Conferência com o banco" };

const centavos = (v: number | string | null) => (v === null ? 0 : Math.round(Number(v) * 100));
const centavosOuNulo = (v: number | string | null) => (v === null ? null : Math.round(Number(v) * 100));

/**
 * Conferência dos pagamentos com o banco (Fase 4e): quem libera no banco marca, item a item, que o pagamento lançado lá é o da
 * autorização (ou que diverge). Substitui a autorização impressa marcada à caneta. Só autorização autorizada.
 */
export default async function PaginaConferencia({ params }: PageProps<"/financeiro/contas-pagar/autorizacoes/[id]/conferencia">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const lido = await lerAutorizacao(supabase, id);
  if (!lido) notFound();
  const { autorizacao: a, itens, extras } = lido;
  const voltar = `${ROTA_CONTAS_PAGAR}/autorizacoes/${a.id}`;
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");

  if (a.status !== "autorizada") {
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-bold">Conferência com o banco · {a.codigo}</h2>
        <p className="text-sm text-muted-foreground">
          {a.status === "rascunho" ? "A conferência abre depois que a autorização é autorizada." : "Esta autorização foi cancelada; não há o que conferir."}
        </p>
        <Button variant="outline" render={<Link href={voltar} />}>Voltar à autorização</Button>
      </div>
    );
  }

  const linhas: LinhaConferencia[] = [
    ...itens.filter((i) => i.removido_em === null).map((i): LinhaConferencia => ({
      origem: "item", id: i.id, tipo: i.tipo, nome: i.fornecedor_nome, documento: i.num_documento || i.cod_lancamento,
      data: i.tipo === "titulo" ? i.data_vencimento : i.data_pagamento, historico: i.complemento_historico ?? "",
      valorCentavos: centavos(i.valor), situacao: i.conferencia_banco, valorBancoCentavos: centavosOuNulo(i.valor_banco),
      observacao: i.observacao_conferencia, conferidoPorNome: i.conferido_banco_por_nome, conferidoEm: i.conferido_banco_em ? quandoEm(i.conferido_banco_em) : null,
    })),
    ...extras.filter((x) => x.removido_em === null).map((x): LinhaConferencia => ({
      origem: "extra", id: x.id, tipo: "extra", nome: x.favorecido, documento: x.descricao, data: null, historico: "",
      valorCentavos: centavos(x.valor), situacao: x.conferencia_banco, valorBancoCentavos: centavosOuNulo(x.valor_banco),
      observacao: x.observacao_conferencia, conferidoPorNome: x.conferido_banco_por_nome, conferidoEm: x.conferido_banco_em ? quandoEm(x.conferido_banco_em) : null,
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Conferência com o banco · {a.codigo}</h2>
          <p className="text-sm text-muted-foreground">
            {a.empresa_nome} · data {formatarData(a.data)} · autorizada por {a.autorizada_por_nome ?? "—"}{a.autorizada_em ? ` em ${quandoEm(a.autorizada_em)}` : ""}.
            Para cada pagamento lançado no banco, busque pelo valor, confira e marque. Se não bater, marque divergente com o valor do banco. Se não foi pago, marque não pago: o título volta para a lista Autorizar pagamento.
          </p>
        </div>
        <Button variant="ghost" render={<Link href={voltar} />}>Voltar à autorização</Button>
      </div>
      <TabelaConferencia autorizacaoId={a.id} linhas={linhas} podeMarcar={podeConferir(a.status, podeOperar)} nomeUsuario={sessao.perfil.nome ?? "você"} />
    </div>
  );
}
