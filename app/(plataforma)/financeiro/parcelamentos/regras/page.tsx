import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { contaFluxo, MODULO_PARCELAMENTOS } from "@/lib/modulos/financeiro/parcelamentos/parcelamentos";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotaoSimples, FormRegra, type RegraInicial } from "../componentes";
import { listarApoio, listarRegras, listarSincronizacoes, type Regra } from "../dados";

export const metadata: Metadata = { title: "Regras — Gestão de Parcelamentos" };

const hora = (iso: string | null) => (iso ? `${formatarData(iso)} ${new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Cuiaba", hour: "2-digit", minute: "2-digit" })}` : "—");
const NOVA: RegraInicial = { id: null, nome: "", empresaId: "", tipos: ["P", "C"], fornecedores: "", grupo: "", conta: "", complementoContem: "", natureza: "", excecao: false, prioridade: "100", ativa: true, observacoes: "" };
const paraForm = (r: Regra): RegraInicial => ({
  id: r.id, nome: r.nome, empresaId: r.empresa_id ?? "", tipos: (r.tipos ?? []) as ("P" | "C")[], fornecedores: (r.fornecedores ?? []).join(", "),
  grupo: r.grupo ? String(r.grupo) : "", conta: r.conta ? String(r.conta) : "", complementoContem: r.complemento_contem ?? "", natureza: r.natureza ?? "",
  excecao: r.excecao, prioridade: String(r.prioridade), ativa: r.ativa, observacoes: r.observacoes ?? "",
});

export default async function PaginaRegras() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const [regras, apoio, rodadas] = await Promise.all([listarRegras(supabase), listarApoio(supabase), listarSincronizacoes(supabase)]);
  const operador = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, "operador");
  const gestor = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, "gestor");
  const nomeEmpresa = (id: string | null) => (id ? apoio.empresas.find((e) => e.codigo === id)?.nome ?? "—" : "Todas");
  const nomeNatureza = (c: string | null) => apoio.naturezas.find((n) => n.codigo === c)?.nome ?? "—";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Um lançamento do Contas a Pagar é parcelamento quando casa com uma regra ativa (todos os critérios preenchidos). Vence a menor prioridade;
          empate entre naturezas diferentes vai para Pendentes; exceção que casa vence tudo. Lançamento que não casa com nenhuma regra fica fora.
        </p>
        <div className="flex flex-wrap gap-2">
          {operador && <BotaoSimples acao="reprocessar" rotulo="Reaplicar as regras" pendenteRotulo="Reaplicando…" />}
          {gestor && <FormRegra inicial={NOVA} naturezas={apoio.naturezas} empresas={apoio.empresas} rotulo="Nova regra" variante="default" />}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table className="cartoes">
          <TableHeader>
            <TableRow>
              <TableHead>Regra</TableHead><TableHead>Empresa</TableHead><TableHead>Tipos</TableHead><TableHead>Fornecedores</TableHead>
              <TableHead>Conta de fluxo</TableHead><TableHead>Histórico contém</TableHead><TableHead>Resultado</TableHead><TableHead className="text-right">Prioridade</TableHead>
              <TableHead>Situação</TableHead><TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {regras.map((r) => (
              <TableRow key={r.id} className={r.ativa ? undefined : "opacity-60"}>
                <TableCell className="max-w-xs"><span title={r.observacoes ?? undefined}>{r.nome}</span></TableCell>
                <TableCell>{nomeEmpresa(r.empresa_id)}</TableCell>
                <TableCell>{r.tipos?.join(", ") ?? "Todos"}</TableCell>
                <TableCell>{r.fornecedores?.join(", ") ?? "Todos"}</TableCell>
                <TableCell>{r.grupo ? contaFluxo(r.grupo, r.conta) : "Qualquer"}</TableCell>
                <TableCell>{r.complemento_contem ?? "—"}</TableCell>
                <TableCell>{r.excecao ? <Badge variant="destructive">Exceção: não é parcelamento</Badge> : nomeNatureza(r.natureza)}</TableCell>
                <TableCell className="text-right">{r.prioridade}</TableCell>
                <TableCell>{r.ativa ? "Ativa" : "Inativa"}</TableCell>
                <TableCell>{gestor && <FormRegra inicial={paraForm(r)} naturezas={apoio.naturezas} empresas={apoio.empresas} rotulo="Editar" variante="ghost" />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <h3 className="font-semibold">Leituras do Consistem</h3>
      <p className="text-sm text-muted-foreground">
        Cada leitura busca todos os lançamentos tipo P e todos os lançamentos dos fornecedores das regras (P e C), e o detalhe dos novos e dos que mudaram. Só leitura no ERP.
        A leitura agendada (a cada 2 horas em dias úteis) começa desligada: configuração financeiro.parcelamentos.sincronizar_agendado.
      </p>
      {rodadas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma leitura ainda.</p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow><TableHead>Início</TableHead><TableHead>Fim</TableHead><TableHead>Quem</TableHead><TableHead>Situação</TableHead><TableHead>Resumo</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rodadas.map((x) => {
                const r = (x.resumo ?? {}) as Record<string, unknown>;
                const d = (r.detalhes ?? {}) as Record<string, number>;
                return (
                  <TableRow key={x.id as string}>
                    <TableCell>{hora(x.iniciada_em as string)}</TableCell>
                    <TableCell>{hora(x.concluida_em as string | null)}</TableCell>
                    <TableCell>{x.agendada ? "Agendada" : "Manual"}</TableCell>
                    <TableCell>{x.situacao === "erro" ? <Badge variant="destructive">Erro</Badge> : x.situacao === "ok" ? "Ok" : "Em andamento"}</TableCell>
                    <TableCell className="text-xs">
                      {x.erro ? String(x.erro) : x.resumo
                        ? `${r.projecoes ?? 0} P e ${r.titulosC ?? 0} C no ERP · ${r.novos ?? 0} novo(s) · ${r.alterados ?? 0} alterado(s) · ${d.lidos ?? 0} detalhe(s) · ${(Number(r.quitados) || 0) + (d.quitados ?? 0)} baixa(s) · ${d.viraramC ?? 0} virou(aram) C · ${d.sumiram ?? 0} excluído(s) no ERP` +
                          (Number(r.detalhesAdiados) > 0 ? ` · ${r.detalhesAdiados} adiado(s)` : "") + (Array.isArray(r.falhasDetalhe) && r.falhasDetalhe.length ? ` · ${r.falhasDetalhe.length} falha(s) de detalhe` : "")
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
