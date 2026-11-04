import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_BONIFICAR } from "@/lib/modulos/rh/bonificacoes/modulo";
import { horas, ROTA_JUSTIFICAR } from "@/lib/modulos/rh/ponto/modulo";
import { linhasDoPedido, MODULO_PORTAL_LIDER, ROTA_PORTAL_LIDER, ROTULO_STATUS, ROTULO_TIPO } from "@/lib/modulos/rh/portal-lider/modulo";
import { formatarData, formatarDataHora } from "@/lib/nucleo/fila";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerPortal, meusSetores } from "./dados";
import { AnexarArquivo, CancelarPedido } from "./formulario";
import { COR_STATUS } from "./status";

export const metadata: Metadata = { title: "Portal do Líder" };

export default async function PaginaPortalLider({ searchParams }: PageProps<"/lider">) {
  const sessao = await exigirSessao();
  if (!sessao.modulos.some((m) => m.codigo === MODULO_PORTAL_LIDER && m.ativo)) notFound();
  const supabase = await criarClienteServidor();
  const setores = await meusSetores(supabase);
  if (!setores.length) notFound();
  const { setor: pedido } = await searchParams;
  const setor = setores.find((s) => s.id === pedido) ?? setores[0];
  const { equipe, lotes, pedidos } = await lerPortal(supabase, setor.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portal do Líder · {setor.nome}</h1>
          <p className="text-sm text-muted-foreground">Sua equipe, o que está com você e os pedidos ao RH. Salário e dados bancários ficam só com o RH.</p>
          {setores.length > 1 && (
            <p className="mt-1 flex flex-wrap gap-2 text-sm">
              {setores.map((s) => (
                <Link key={s.id} href={`${ROTA_PORTAL_LIDER}?setor=${s.id}`} className={s.id === setor.id ? "font-bold text-marca" : "text-elo hover:underline"}>{s.nome}</Link>
              ))}
            </p>
          )}
        </div>
        <Button render={<Link href={`${ROTA_PORTAL_LIDER}/novo?setor=${setor.id}`} />}>Novo pedido ao RH</Button>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Com você agora</h2>
        {lotes.length ? (
          <ul className="space-y-2">
            {lotes.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-amber-600 bg-amber-50 p-2 text-sm">
                <span>{l.tipo === "ponto" ? "Justificar inconsistências do " : "Lançar a "}{l.rotulo}{l.prazo ? ` · prazo ${formatarData(l.prazo)}` : ""}</span>
                <Button size="sm" render={<Link href={`${l.tipo === "ponto" ? ROTA_JUSTIFICAR : ROTA_BONIFICAR}/${l.chave}`} />}>Abrir</Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Nada pendente com você.</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Pedidos ao RH</h2>
        <Table className="cartoes">
          <TableHeader>
            <TableRow><TableHead>Enviado em</TableHead><TableHead>Pedido</TableHead><TableHead>Funcionário</TableHead><TableHead>Situação</TableHead><TableHead>Resposta do RH</TableHead><TableHead>Ações</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {pedidos.map((p) => (

                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">{formatarDataHora(p.criado_em)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{ROTULO_TIPO[p.tipo]}</div>
                    <div className="text-xs text-muted-foreground">{linhasDoPedido(p.tipo, p.dados).filter(([, v]) => v !== "—").map(([r, v]) => `${r}: ${v}`).join(" · ")}</div>
                  </TableCell>
                  <TableCell>{p.pessoa}</TableCell>
                  <TableCell><Badge variant="outline" className={COR_STATUS[p.status]}>{ROTULO_STATUS[p.status]}</Badge></TableCell>
                  <TableCell className="text-sm">{p.resposta}</TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    {p.tipo === "atestado" && p.anexos === 0 && ["enviada", "em_andamento"].includes(p.status) && <AnexarArquivo pedido={p.id} />}
                    {p.status === "enviada" && <CancelarPedido pedido={p.id} />}
                  </TableCell>
                </TableRow>

            ))}
            {!pedidos.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhum pedido ainda.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Equipe ({equipe.length})</h2>
        <Table className="cartoes">
          <TableHeader>
            <TableRow><TableHead>Nome</TableHead><TableHead>Função</TableHead><TableHead>Admissão</TableHead><TableHead>Banco de horas</TableHead><TableHead>Vencido</TableHead><TableHead>Próximo vencimento</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {equipe.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.nome}</TableCell>
                <TableCell>{e.funcao ?? ""}</TableCell>
                <TableCell>{formatarData(e.data_admissao)}</TableCell>
                <TableCell className={`tabular-nums ${(e.saldo_min ?? 0) < 0 ? "text-destructive" : ""}`}>{horas(e.saldo_min)}</TableCell>
                <TableCell className={`tabular-nums ${e.vencido_min ? "text-destructive" : ""}`}>{e.vencido_min ? horas(e.vencido_min) : ""}</TableCell>
                <TableCell>{formatarData(e.proximo_vencimento)}</TableCell>
              </TableRow>
            ))}
            {!equipe.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Ninguém ativo no departamento deste setor. Fale com o RH.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
