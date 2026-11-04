import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_PEDIDOS_RH, ROTULO_STATUS, ROTULO_TIPO } from "@/lib/modulos/rh/portal-lider/modulo";
import { formatarDataHora } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { COR_STATUS } from "../../lider/status";
import { lerSetores } from "../ponto/dados";
import { lerLideres, lerPedidos } from "./dados";
import { EditorLideres } from "./quadro";

export const metadata: Metadata = { title: "Portal do Líder" };

export default async function PaginaPedidosDoLider() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const [pedidos, setores, { lideres, usuarios }] = await Promise.all([lerPedidos(supabase), lerSetores(supabase), lerLideres(supabase)]);
  const ehGestor = temAcesso(sessao.acesso, "rh", "gestor");

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Pedidos</h2>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Enviado em</TableHead><TableHead>Setor</TableHead><TableHead>Pedido</TableHead><TableHead>Funcionário</TableHead><TableHead>Líder</TableHead><TableHead>Situação</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {pedidos.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap"><Link href={`${ROTA_PEDIDOS_RH}/${p.id}`} className="text-elo hover:underline">{formatarDataHora(p.criado_em)}</Link></TableCell>
                <TableCell>{p.setor}</TableCell>
                <TableCell>{ROTULO_TIPO[p.tipo]}</TableCell>
                <TableCell className="font-medium">{p.pessoa}</TableCell>
                <TableCell>{p.autor}</TableCell>
                <TableCell><Badge variant="outline" className={COR_STATUS[p.status]}>{ROTULO_STATUS[p.status]}</Badge></TableCell>
              </TableRow>
            ))}
            {!pedidos.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhum pedido ainda.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Líderes no portal</h2>
        <p className="text-sm text-muted-foreground">
          O líder entra com a conta Google da empresa e vê só o setor dele: a equipe (sem salário), o banco de horas e o ponto e a bonificação que estão com ele. Crie o usuário em Configurações &gt; Usuários sem nenhuma área; aqui o gestor do RH liga o usuário ao setor.
        </p>
        <Table interativa={false}>
          <TableHeader><TableRow><TableHead>Setor</TableHead><TableHead>Líderes</TableHead></TableRow></TableHeader>
          <TableBody>
            {setores.filter((s) => s.ativo).map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.nome}</TableCell>
                <TableCell><EditorLideres setor={s.id} lideres={lideres.filter((l) => l.setor_id === s.id).map((l) => l.perfil_id)} usuarios={usuarios} podeEditar={ehGestor} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
