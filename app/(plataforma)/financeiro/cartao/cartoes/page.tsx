import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_CARTAO, ROTULO_LEITOR } from "@/lib/modulos/financeiro/cartao/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerCartoes } from "../dados";
import { DialogoCartao } from "./form-cartao";

export const metadata: Metadata = { title: "Cartões de crédito" };

export default async function PaginaCartoes() {
  const sessao = await exigirSessao();
  const ehGestor = temAcesso(sessao.acesso, "financeiro", "gestor");
  const cartoes = await lerCartoes(await criarClienteServidor());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Fechamento e vencimento vêm da <strong>Planilha Cartões</strong> (fonte oficial). O código vai no complemento do título (“CARTÃO NUBANK PF 3x — …”); o leitor diz como o PDF da fatura é lido.
        </p>
        {ehGestor && <DialogoCartao />}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead><TableHead>Nome</TableHead><TableHead>Banco</TableHead><TableHead>PF/PJ</TableHead>
            <TableHead className="text-right">Fecha</TableHead><TableHead className="text-right">Vence</TableHead><TableHead className="text-right">Tipo de título</TableHead>
            <TableHead>Leitor</TableHead><TableHead>Pasta no Drive</TableHead><TableHead>Situação</TableHead>{ehGestor && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {cartoes.map((c) => (
            <TableRow key={c.codigo} className={c.ativo ? "" : "text-muted-foreground"}>
              <TableCell className="font-medium"><Link href={`${ROTA_CARTAO}/historico?cartao=${encodeURIComponent(c.codigo)}`} className="text-elo hover:underline" title="Histórico do cartão, mês a mês">{c.codigo}</Link></TableCell><TableCell>{c.nome}</TableCell><TableCell>{c.banco}</TableCell><TableCell>{c.tipo_pessoa}</TableCell>
              <TableCell className="text-right tabular-nums">{c.dia_fechamento}</TableCell><TableCell className="text-right tabular-nums">{c.dia_vencimento}</TableCell>
              <TableCell className="text-right tabular-nums">{c.tipo_titulo ?? ""}</TableCell>
              <TableCell>{ROTULO_LEITOR[c.leitor]}</TableCell><TableCell>{c.pasta_faturas ?? ""}</TableCell>
              <TableCell>{c.ativo ? <Badge variant="outline" className="border-marca text-marca">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}</TableCell>
              {ehGestor && <TableCell><DialogoCartao cartao={c} /></TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
