import type { Metadata } from "next";
import { Ajuda } from "@/components/plataforma/ajuda";
import { AJUDA } from "@/lib/modulos/rh/banco-horas/ajuda";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarData } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerImportacoes, lerParametros } from "../dados";
import { ImportarCsv } from "./importar";

export const metadata: Metadata = { title: "Banco de horas — importações" };

export default async function PaginaImportacoesBanco() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const [importacoes, par] = await Promise.all([lerImportacoes(supabase), lerParametros(supabase)]);
  return (
    <div className="space-y-4">
      <Ajuda titulo={AJUDA.importacoes.titulo} passos={AJUDA.importacoes.passos} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          CSV de banco de horas do Control iD, geral (todas as pessoas), um ou vários de uma vez (ex.: um por ciclo). Reimportar um período corrige os dias.
          Na primeira carga, cubra desde {formatarData(par.inicio)}, sem buracos. O setor de cada pessoa vem do departamento dela em RH &gt; Colaboradores (&quot;Importar do Control iD&quot;).
        </p>
        {temAcesso(sessao.acesso, "rh", "operador") && <ImportarCsv inicioConta={par.inicio} />}
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Importado em</TableHead><TableHead>Período</TableHead><TableHead>Arquivo</TableHead><TableHead className="text-right">Pessoas</TableHead><TableHead className="text-right">Dias com movimento</TableHead><TableHead>Por</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {importacoes.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhuma importação.</TableCell></TableRow>}
          {importacoes.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="tabular-nums">{new Date(i.importado_em).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" })}</TableCell>
              <TableCell className="tabular-nums">{formatarData(i.periodo_inicio)} a {formatarData(i.periodo_fim)}</TableCell>
              <TableCell>{i.arquivo_nome}</TableCell>
              <TableCell className="text-right tabular-nums">{i.pessoas}</TableCell>
              <TableCell className="text-right tabular-nums">{i.movimentos}</TableCell>
              <TableCell>{i.quem}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
