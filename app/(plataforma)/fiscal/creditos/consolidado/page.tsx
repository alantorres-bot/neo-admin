import type { Metadata } from "next";
import { Fragment } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Consolidado } from "@/lib/modulos/fiscal/creditos/apuracao";
import { moeda } from "@/lib/modulos/fiscal/creditos/formatos";
import { ROTA_CREDITOS } from "@/lib/modulos/fiscal/creditos/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { Secao, Selo, Vazio } from "../componentes";
import { contexto, lerCadastros, lerFiltros, nomes } from "../dados";
import { BarraFiltros } from "../filtros";
import { lerConsolidado } from "./dados";

export const metadata: Metadata = { title: "Consolidado anual" };
const link = "inline-flex h-7 items-center rounded-[3px] border bg-botao-claro px-2.5 font-condensada text-[12px] font-bold hover:bg-grade-clara";

const COLS: [string, (c: Consolidado) => number][] = [
  ["Saldo inicial do exercício", (c) => c.saldoInicial], ["Implantado no ano", (c) => c.implantadoNoAno], ["Créditos gerados", (c) => c.gerado],
  ["Créditos reconhecidos", (c) => c.reconhecido], ["Ajustes (líquido)", (c) => c.ajustesPositivos - c.ajustesNegativos], ["Utilizações", (c) => c.utilizado],
  ["Compensações", (c) => c.compensado], ["Ressarcimentos e baixas", (c) => c.baixado], ["Transferências (líquido)", (c) => c.transferidoEntrada - c.transferidoSaida],
  ["Saldo final do exercício", (c) => c.saldoFinal],
];

export default async function PaginaConsolidado({ searchParams }: PageProps<"/fiscal/creditos/consolidado">) {
  const { supabase } = await contexto();
  const hoje = hojeEmCuiaba();
  const f = lerFiltros(await searchParams, Number(hoje.slice(0, 4)));
  const cad = await lerCadastros();
  const n = nomes(cad);
  const r = await lerConsolidado(supabase, f);
  const qs = new URLSearchParams(Object.entries({ ano: String(f.ano), empresa: f.empresa, estab: f.estab, tributo: f.tributo }).filter(([, v]) => v)).toString();
  const anoCorrente = f.ano === Number(hoje.slice(0, 4));

  return (
    <div className="space-y-4">
      <BarraFiltros cad={cad} f={f} campos={["ano", "empresa", "estab", "tributo"]} />
      <Secao titulo={`Consolidado do exercício ${f.ano}${anoCorrente ? " (em andamento)" : ""}`}
        descricao={`Visão consolidada${f.empresa ? ` de ${n.empresa.get(f.empresa)}` : " das empresas do seu escopo"}. O saldo final é transportado como saldo inicial de ${f.ano + 1}.`}
        acoes={<>
          <a className={link} href={`${ROTA_CREDITOS}/relatorios/exportar/consolidado?${qs}`}>Exportar Excel</a>
          <a className={link} href={`/imprimir/fiscal/consolidado?${qs}`} target="_blank" rel="noreferrer">Imprimir / PDF</a>
        </>}>
        {r.porTributo.length === 0 ? <Vazio titulo={`Sem créditos em ${f.ano}`}>Escolha outro exercício ou cadastre créditos.</Vazio> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Tributo</TableHead>
              {COLS.map(([r]) => <TableHead key={r} className="text-right">{r}</TableHead>)}
              <TableHead className="text-right">Transportado p/ {f.ano + 1}</TableHead><TableHead className="text-right">Pendentes de validação</TableHead>
              <TableHead className="text-right">Doc. incompleta</TableHead><TableHead className="text-right">Divergências abertas</TableHead><TableHead>Janeiro × dezembro anterior</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {r.porTributo.map((g) => {
                const c = g.atual;
                const e = r.extras(g.chave);
                const inicioSemImplantacao = c ? c.saldoInicial - (c.implantado - c.implantadoNoAno) : 0;
                return (
                  <TableRow key={g.chave}>
                    <TableCell className="font-medium">{n.tributo.get(g.chave)}</TableCell>
                    {COLS.map(([rot, fn]) => <TableCell key={rot} className="text-right tabular-nums">{c ? moeda(fn(c)) : "—"}</TableCell>)}
                    <TableCell className="text-right tabular-nums">{c ? moeda(c.saldoFinal) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{moeda(e.pendenteValidacao)}</TableCell>
                    <TableCell className="text-right">{e.docIncompleta}</TableCell>
                    <TableCell className="text-right">{e.divergencias}</TableCell>
                    <TableCell>
                      {e.fechadoDezembro === null
                        ? <Selo tom="atencao">dez/{f.ano - 1} não fechado</Selo>
                        : e.fechadoDezembro === g.transportadoDoAnterior && (!c || inicioSemImplantacao === g.transportadoDoAnterior)
                          ? <Selo tom="bom">confere ({moeda(e.fechadoDezembro)})</Selo>
                          : <Selo tom="grave">fechado {moeda(e.fechadoDezembro)} × transportado {moeda(g.transportadoDoAnterior)}</Selo>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {r.total && (
                <TableRow className="font-bold">
                  <TableCell colSpan={1}>Total</TableCell>
                  {COLS.map(([rot, fn]) => <TableCell key={rot} className="text-right tabular-nums">{moeda(fn(r.total!))}</TableCell>)}
                  <TableCell className="text-right tabular-nums">{moeda(r.total.saldoFinal)}</TableCell><TableCell colSpan={4} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Secao>

      <Secao titulo={`Comparação ${f.ano - 1} × ${f.ano}`}>
        <Table interativa={false}>
          <TableHeader><TableRow><TableHead></TableHead><TableHead className="text-right">{f.ano - 1}</TableHead><TableHead className="text-right">{f.ano}</TableHead><TableHead className="text-right">Variação</TableHead></TableRow></TableHeader>
          <TableBody>
            {COLS.map(([rot, fn]) => {
              const a = r.totalAnterior ? fn(r.totalAnterior) : 0, b = r.total ? fn(r.total) : 0;
              return <TableRow key={rot}><TableCell>{rot}</TableCell><TableCell className="text-right tabular-nums">{moeda(a)}</TableCell><TableCell className="text-right tabular-nums">{moeda(b)}</TableCell><TableCell className="text-right tabular-nums">{moeda(b - a)}</TableCell></TableRow>;
            })}
          </TableBody>
        </Table>
      </Secao>

      <Secao titulo="Detalhamento por estabelecimento">
        <Table>
          <TableHeader><TableRow><TableHead>Estabelecimento</TableHead><TableHead>Tributo</TableHead>{COLS.map(([r]) => <TableHead key={r} className="text-right">{r}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {r.porEstab.filter((g) => g.atual).map((g) => {
              const [estab, trib] = g.chave.split("|");
              return (
                <Fragment key={g.chave}>
                  <TableRow>
                    <TableCell>{n.estab.get(estab)}</TableCell><TableCell>{n.tributo.get(trib)}</TableCell>
                    {COLS.map(([rot, fn]) => <TableCell key={rot} className="text-right tabular-nums">{moeda(fn(g.atual!))}</TableCell>)}
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Secao>
    </div>
  );
}
