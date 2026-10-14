import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_COLABORADORES, ROTULO_FORMA } from "@/lib/modulos/rh/colaboradores/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerColaboradores, lerEmpresas } from "./dados";
import { ConferenciaConsistem } from "./conferencia";
import { DialogoColaborador } from "./form-colaborador";

export const metadata: Metadata = { title: "Colaboradores" };

const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function PaginaColaboradores({ searchParams }: PageProps<"/rh/colaboradores">) {
  const sessao = await exigirSessao();
  const verInativos = (await searchParams).inativos === "1";
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  const supabase = await criarClienteServidor();
  const [colaboradores, empresas] = await Promise.all([lerColaboradores(supabase), lerEmpresas(supabase)]);
  const empregadores = [...new Set(colaboradores.map((c) => c.empregador))];
  const ativos = colaboradores.filter((c) => c.ativo);
  const comVt = ativos.filter((c) => c.recebe_vt).length;
  const fopagSemConta = ativos.filter((c) => c.forma_pagamento === "fopag" && (!c.cpf || !c.agencia || !c.conta));
  const inativos = colaboradores.length - ativos.length;
  // Inativos ficam escondidos: são ex-funcionários que seguem no histórico (VT e folha já pagos), por isso não se apagam.
  const lista = verInativos ? colaboradores : ativos;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {ativos.length} ativos ({comVt} recebem VT). Desligado não se apaga: desmarque “Ativo” (continua no histórico do VT e da folha).
          {inativos > 0 && (
            <Link href={verInativos ? ROTA_COLABORADORES : `${ROTA_COLABORADORES}?inativos=1`} className="ml-2 text-elo hover:underline">
              {verInativos ? "Ocultar inativos" : `Mostrar inativos (${inativos})`}
            </Link>
          )}
        </p>
        {podeOperar && <DialogoColaborador empresas={empresas} empregadores={empregadores} />}
      </div>
      {fopagSemConta.length > 0 && (
        <p className="rounded-[3px] border border-destructive/40 p-3 text-sm text-destructive">
          FOPAG sem CPF, agência ou conta (não poderão entrar no arquivo do BB): {fopagSemConta.map((c) => `${c.cod_fornecedor} ${c.nome}`).join(", ")}.
        </p>
      )}
      {podeOperar && colaboradores.length > 0 && <ConferenciaConsistem />}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nº</TableHead><TableHead>Matr. escritório</TableHead><TableHead>Nome</TableHead><TableHead>Empresa</TableHead><TableHead>CPF</TableHead>
            <TableHead>Pagamento</TableHead><TableHead>Agência</TableHead><TableHead>Conta</TableHead>
            <TableHead>VT</TableHead><TableHead className="text-right">Passagem</TableHead><TableHead className="text-right">Por dia</TableHead><TableHead className="text-right">Valor fixo</TableHead><TableHead>Situação</TableHead>
            {podeOperar && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lista.map((c) => (
            <TableRow key={c.id} className={c.ativo ? "" : "text-muted-foreground"}>
              <TableCell className="tabular-nums">{c.cod_fornecedor}</TableCell>
              <TableCell className="tabular-nums">{c.matricula_escritorio ?? ""}</TableCell>
              <TableCell className="font-medium">{c.nome}</TableCell>
              <TableCell>{c.empregador}</TableCell>
              <TableCell className="tabular-nums">{c.cpf ?? "—"}</TableCell>
              <TableCell>{ROTULO_FORMA[c.forma_pagamento]}</TableCell>
              <TableCell className="tabular-nums">{c.agencia ?? ""}</TableCell>
              <TableCell className="tabular-nums">{c.conta ?? ""}</TableCell>
              <TableCell>{c.recebe_vt ? "Sim" : "Não"}</TableCell>
              <TableCell className="text-right tabular-nums">{c.recebe_vt && c.tarifa !== null ? reais(c.tarifa) : ""}</TableCell>
              <TableCell className="text-right tabular-nums">{c.recebe_vt && c.valor_fixo === null ? c.passagens_dia : ""}</TableCell>
              <TableCell className="text-right tabular-nums">{c.recebe_vt && c.valor_fixo !== null ? reais(c.valor_fixo) : ""}</TableCell>
              <TableCell>{c.ativo ? <Badge variant="outline" className="border-marca text-marca">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}</TableCell>
              {podeOperar && <TableCell><DialogoColaborador colaborador={c} empresas={empresas} empregadores={empregadores} /></TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
