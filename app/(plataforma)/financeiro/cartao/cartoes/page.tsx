import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_CARTAO, ROTULO_LEITOR } from "@/lib/modulos/financeiro/cartao/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerCartoes, lerListasConsistem, lerRegras, nomesDosFornecedores, ultimaSincronizacaoRegras } from "../dados";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { BotaoAtualizarRegras } from "./regras";
import { DialogoCartao } from "./form-cartao";

export const metadata: Metadata = { title: "Cartões de crédito" };

export default async function PaginaCartoes() {
  const sessao = await exigirSessao();
  const ehGestor = temAcesso(sessao.acesso, "financeiro", "gestor");
  const supabase = await criarClienteServidor();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const [cartoes, regras, ultima, listas] = await Promise.all([lerCartoes(supabase), lerRegras(supabase), ultimaSincronizacaoRegras(supabase), lerListasConsistem(supabase)]);
  const nomes = await nomesDosFornecedores(supabase, [...new Set(regras.map((r) => r.cod_fornecedor))]);
  const nomeCartao = new Map(cartoes.map((c) => [c.codigo, c.nome]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Fechamento e vencimento vêm da <strong>Planilha Cartões</strong> (fonte oficial). O código vai no complemento do título (“CARTÃO NUBANK PF 3x — …”); o leitor diz como o PDF da fatura é lido.
        </p>
        {ehGestor && <DialogoCartao contasFluxo={listas.contasFluxo} />}
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
              {ehGestor && <TableCell><DialogoCartao cartao={c} contasFluxo={listas.contasFluxo} /></TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="space-y-2 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Regras fornecedor → cartão (do Neo Fiscal)</h2>
            <p className="text-sm text-muted-foreground">
              Cópia da regra cadastrada no Neo Fiscal (tela Cartões de lá; o cadastro é só lá). A conciliação usa a regra para incluir na fatura o título de fornecedor pago no cartão mesmo quando o complemento não cita o cartão, e para apontar título lançado no cartão errado. Atualiza sozinha todo dia às 07:15.
              {ultima ? ` Última atualização: ${ultima.quando} (${ultima.novas} novas · ${ultima.alteradas} alteradas · ${ultima.removidas} removidas).` : " Ainda não foi atualizada."}
            </p>
          </div>
          {podeOperar && <BotaoAtualizarRegras />}
        </div>
        {regras.length === 0 ? (
          <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">Nenhuma regra copiada ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Fornecedor</TableHead><TableHead>Cartão</TableHead><TableHead className="text-right">Parcelas</TableHead><TableHead>Vigência</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {regras.map((r) => (
                <TableRow key={r.id} className={r.vigencia_fim ? "text-muted-foreground" : ""}>
                  <TableCell>{nomes.get(r.cod_fornecedor) ?? "—"} <span className="text-xs text-muted-foreground">({r.cod_fornecedor})</span></TableCell>
                  <TableCell>{nomeCartao.get(r.cartao) ?? r.cartao}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.parcelas_padrao}</TableCell>
                  <TableCell className="tabular-nums">desde {formatarData(r.vigencia_ini)}{r.vigencia_fim ? ` até ${formatarData(r.vigencia_fim)}` : " (em aberto)"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
