import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarData, formatarDataHora, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { descreverDuracao, hrefAtividades, lerFiltrosAtividades, resumirTipos } from "@/lib/nucleo/gestao/atividades";
import { temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerAtividades } from "./dados";
import { AlternarRegistroAcessos } from "./registro-acessos";

export const metadata: Metadata = { title: "Atividades da equipe" };

const CLASSE_CAMPO = "h-8 w-full min-w-0 rounded-[3px] border border-input bg-white px-2 text-[13px]";
const ROTULO_ORIGEM = { direto: "", servico_a_pedido: " · por rotina a pedido", historico: " · do histórico" } as const;

// Central de Gestão > Atividades (docs/modulos/administrativo-gestao.md, seção 5.9): o que cada pessoa fez e viu.
// Quem acompanha a equipe (perfis.acompanha_equipe; admin geral sempre) vê todos; os demais, só o próprio registro.
// Sem nota, ranking ou rótulo de produtividade: os números aparecem com o tipo de trabalho de cada um.
export default async function PaginaAtividades({ searchParams }: PageProps<"/gestao/atividades">) {
  const sessao = await exigirSessao();
  if (sessao.acesso.restrito || !temAcessoAlgumaArea(sessao.acesso, sessao.areas)) notFound();
  const supabase = await criarClienteServidor();
  const hoje = hojeEmCuiaba();

  const { data: eu } = await supabase.from("perfis").select("acompanha_equipe").eq("id", sessao.userId).maybeSingle();
  const acompanha = sessao.acesso.adminGeral || Boolean(eu?.acompanha_equipe);
  const filtros = lerFiltrosAtividades(await searchParams, hoje, sessao.userId, acompanha);
  const { resumo, linhas, nomesTipos, registrandoAcessos, pessoas, processo } = await lerAtividades(supabase, filtros, acompanha);

  const pessoaNome = filtros.pessoa ? (pessoas.find((p) => p.id === filtros.pessoa)?.nome ?? sessao.perfil.nome) : null;
  const titulo = acompanha ? "Atividades da equipe" : "Minhas atividades";
  const modulosVisiveis = sessao.modulos.map((m) => ({ codigo: m.codigo, nome: `${sessao.areas.find((a) => a.codigo === m.area)?.nome ?? m.area} › ${m.nome}` }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return (
    <div className="space-y-5">
      <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/gestao" />}><ArrowLeft /> Central de Gestão</Button>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
          <p className="text-sm text-muted-foreground">
            O que {acompanha ? "cada pessoa" : "você"} fez e acessou no Neo Admin, de {formatarData(filtros.de)} a {formatarData(filtros.ate)}.
          </p>
        </div>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={hrefAtividades(filtros, {}, "/gestao/atividades/exportar")} prefetch={false} />}>
          <Download /> Exportar (Excel)
        </Button>
      </header>

      {!registrandoAcessos && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-grade bg-cabecalho p-2.5 text-[12px]">
          <span>
            O registro de <strong>acessos</strong> (telas e registros abertos) está desligado: aparecem só as ações.
            {sessao.acesso.adminGeral && " Antes de ligar, comunique a equipe (LGPD; valide o texto com o jurídico ou o RH)."}
          </span>
          {sessao.acesso.adminGeral && <AlternarRegistroAcessos ligado={false} />}
        </div>
      )}
      {registrandoAcessos && sessao.acesso.adminGeral && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
          <span>Registro de acessos ligado: aberturas de tela agrupadas a cada 30 minutos, guardadas por 12 meses.</span>
          <AlternarRegistroAcessos ligado />
        </div>
      )}

      <form method="get" action="/gestao/atividades" className="grid grid-cols-2 gap-2 rounded-[3px] border border-grade bg-cabecalho p-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {acompanha && (
          <label className="space-y-0.5 text-[11px] text-muted-foreground">
            <span>Pessoa</span>
            <select name="pessoa" defaultValue={filtros.pessoa ?? ""} className={CLASSE_CAMPO}>
              <option value="">Todas (resumo)</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
        )}
        <label className="space-y-0.5 text-[11px] text-muted-foreground">
          <span>De</span><input type="date" name="de" defaultValue={filtros.de} className={CLASSE_CAMPO} />
        </label>
        <label className="space-y-0.5 text-[11px] text-muted-foreground">
          <span>Até</span><input type="date" name="ate" defaultValue={filtros.ate} className={CLASSE_CAMPO} />
        </label>
        <label className="space-y-0.5 text-[11px] text-muted-foreground">
          <span>Módulo</span>
          <select name="modulo" defaultValue={filtros.modulo ?? ""} className={CLASSE_CAMPO}>
            <option value="">Todos</option>
            {modulosVisiveis.map((m) => <option key={m.codigo} value={m.codigo}>{m.nome}</option>)}
          </select>
        </label>
        <label className="flex items-end gap-1.5 pb-1.5 text-[12px]">
          <input type="checkbox" name="acessos" value="nao" defaultChecked={!filtros.acessos} /> Só ações (sem acessos)
        </label>
        {filtros.ref && <input type="hidden" name="ref" value={filtros.ref} />}
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm">Filtrar</Button>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/gestao/atividades" />}>Limpar</Button>
        </div>
      </form>

      {resumo && !filtros.pessoa && !filtros.ref && (
        <Card>
          <CardHeader>
            <CardTitle>Resumo por pessoa</CardTitle>
            <CardDescription>
              Ações registradas e pendências concluídas no período. Não é nota de produtividade: volume e tipo de trabalho variam por
              área e responsabilidade. Clique no nome para ver a linha do tempo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {resumo.length === 0 ? (
              <p className="rounded-[3px] border border-dashed p-6 text-center text-sm text-muted-foreground">Ninguém para mostrar.</p>
            ) : (
              <Table className="cartoes">
                <TableHeader>
                  <TableRow>
                    <TableHead>Pessoa</TableHead><TableHead>Ações</TableHead><TableHead>Dias com atividade</TableHead><TableHead>Principais ações</TableHead>
                    <TableHead>Pendências concluídas</TableHead><TableHead>No prazo</TableHead><TableHead>Após o prazo</TableHead>
                    <TableHead>Tempo médio até concluir</TableHead><TableHead>Última ação</TableHead><TableHead>Último acesso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumo.map((r) => (
                    <TableRow key={r.usuario_id}>
                      <TableCell><Link href={hrefAtividades(filtros, { pessoa: r.usuario_id })} className="text-elo hover:underline">{r.nome}</Link></TableCell>
                      <TableCell>{r.acoes}</TableCell>
                      <TableCell>{r.dias_com_atividade}</TableCell>
                      <TableCell className="max-w-[24rem] whitespace-normal text-[12px]">{resumirTipos(r.por_tipo, nomesTipos)}</TableCell>
                      <TableCell>{r.concluidas}</TableCell>
                      <TableCell>{r.concluidas_no_prazo}</TableCell>
                      <TableCell className={r.concluidas_apos_prazo > 0 ? "text-marca" : undefined}>{r.concluidas_apos_prazo}</TableCell>
                      <TableCell>{descreverDuracao(r.horas_ate_concluir)}</TableCell>
                      <TableCell>{formatarDataHora(r.ultima_atividade) || "—"}</TableCell>
                      <TableCell>{formatarDataHora(r.ultimo_acesso) || (registrandoAcessos ? "—" : "não registrado")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {(filtros.pessoa || filtros.ref) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {filtros.ref ? `Quem fez cada etapa${processo ? `: ${processo}` : ""}` : `Linha do tempo de ${pessoaNome}`}
            </CardTitle>
            <CardDescription>
              Mais recente primeiro (até 300 registros; para mais, exporte).
              {filtros.ref && <> <Link href={hrefAtividades(filtros, { ref: null })} className="text-elo hover:underline">Voltar</Link></>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {linhas.length === 0 ? (
              <p className="rounded-[3px] border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum registro no período.</p>
            ) : (
              <Table className="cartoes">
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>{filtros.ref && <TableHead>Pessoa</TableHead>}<TableHead>Tipo</TableHead><TableHead>Módulo</TableHead>
                    <TableHead>O quê</TableHead><TableHead>Registro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l, i) => (
                    <TableRow key={`${l.tipo}-${l.em}-${i}`} className={l.tipo === "acesso" ? "text-muted-foreground" : undefined}>
                      <TableCell>{formatarDataHora(l.em)}</TableCell>
                      {filtros.ref && <TableCell>{l.nome}</TableCell>}
                      <TableCell>{l.tipo === "acesso" ? `Acessou${l.vezes > 1 ? ` (${l.vezes}×)` : ""}` : l.acao}</TableCell>
                      <TableCell>{l.modulo_nome ?? "—"}</TableCell>
                      <TableCell className="max-w-[32rem] whitespace-normal">
                        {l.descricao}{l.tipo === "atividade" && l.origem ? ROTULO_ORIGEM[l.origem as keyof typeof ROTULO_ORIGEM] : ""}
                      </TableCell>
                      <TableCell>
                        {l.link && l.link.startsWith("/") && !l.link.startsWith("//") ? <Link href={l.link} className="text-elo hover:underline">Abrir</Link> : null}
                        {l.tipo === "atividade" && l.referencia_id && !filtros.ref && (
                          <> {" "}<Link href={hrefAtividades({ ...filtros, pessoa: acompanha ? null : filtros.pessoa }, { ref: l.referencia_id })} className="text-elo hover:underline">Quem mais atuou</Link></>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
