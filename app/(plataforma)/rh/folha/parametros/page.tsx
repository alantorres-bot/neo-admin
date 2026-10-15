import type { Metadata } from "next";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { ROTULO_FORMA_RUBRICA } from "@/lib/modulos/rh/folha/recibos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerRubricas, lerVigencias } from "../dados";
import { EditorRubrica, NovoParametro } from "./formularios";

export const metadata: Metadata = { title: "Folha — parâmetros dos recibos" };
const ROTULO_PARAM = { assiduidade_mensal: "Assiduidade mensal (CCT)", salario_minimo: "Salário mínimo (base da insalubridade)" } as const;
const SIMPLES = new Set(["dias", "horas", "fracao_salario", "valor"]);

export default async function PaginaParametrosFolha() {
  const sessao = await exigirSessao();
  const ehGestor = temAcesso(sessao.acesso, "rh", "gestor");
  const supabase = await criarClienteServidor();
  const [vigencias, rubricas] = await Promise.all([lerVigencias(supabase), lerRubricas(supabase, false)]);
  return (
    <div className="max-w-4xl space-y-6">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Valores com vigência</h2>
            <p className="text-sm text-muted-foreground">Cada recibo usa o valor vigente no mês dele. Quando mudar a CCT ou o salário mínimo, inclua o novo valor a partir do mês certo.</p>
          </div>
          {ehGestor && <NovoParametro />}
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Parâmetro</TableHead><TableHead>A partir de</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
          <TableBody>
            {vigencias.map((v) => (
              <TableRow key={`${v.chave}-${v.vigente_desde}`}>
                <TableCell>{ROTULO_PARAM[v.chave]}</TableCell><TableCell>{rotuloMes(v.vigente_desde)}</TableCell>
                <TableCell className="text-right tabular-nums">{v.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Rubricas dos recibos</h2>
            <p className="text-sm text-muted-foreground">Assiduidade, insalubridade e adicional noturno dependem dos parâmetros e do percentual da pessoa no cadastro; as demais o gestor pode incluir e editar.</p>
          </div>
          {ehGestor && <EditorRubrica />}
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Descrição</TableHead><TableHead>Tipo</TableHead><TableHead>Cálculo</TableHead><TableHead>Situação</TableHead>{ehGestor && <TableHead />}</TableRow></TableHeader>
          <TableBody>
            {rubricas.map((r) => (
              <TableRow key={r.codigo} className={r.ativo ? "" : "text-muted-foreground"}>
                <TableCell className="font-medium">{r.descricao}</TableCell><TableCell>{r.natureza === "provento" ? "Provento" : "Desconto"}</TableCell>
                <TableCell className="text-xs">{ROTULO_FORMA_RUBRICA[r.forma]}</TableCell><TableCell>{r.ativo ? "Ativa" : "Inativa"}</TableCell>
                {ehGestor && <TableCell>{SIMPLES.has(r.forma) && <EditorRubrica rubrica={r} />}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
