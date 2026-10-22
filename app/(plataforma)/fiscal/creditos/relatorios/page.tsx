import type { Metadata } from "next";
import { ROTA_CREDITOS } from "@/lib/modulos/fiscal/creditos/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { Secao } from "../componentes";
import { contexto, lerCadastros, lerFiltros } from "../dados";
import { BarraFiltros } from "../filtros";

export const metadata: Metadata = { title: "Relatórios" };

const RELATORIOS: { tipo: string; nome: string; explica: string; usa: string }[] = [
  { tipo: "creditos", nome: "Posição dos créditos", explica: "Valor original, reconhecido, utilizado, compensado, baixado, saldo, disponível, validação e disponibilidade (posição atual).", usa: "empresa, estabelecimento, tributo" },
  { tipo: "movimentos", nome: "Livro de movimentações", explica: "Todos os lançamentos do período, com estornos, protocolos e quem registrou.", usa: "ano, competência, empresa, estabelecimento, tributo" },
  { tipo: "apuracao", nome: "Apuração mensal", explica: "Saldo inicial, entradas, saídas e saldo final por estabelecimento, tributo e mês, com o saldo oficial e a situação do fechamento.", usa: "ano, empresa, estabelecimento, tributo" },
  { tipo: "consolidado", nome: "Consolidado anual", explica: "Resumo do exercício por tributo e por estabelecimento (também em PDF pela versão de impressão).", usa: "ano, empresa, estabelecimento, tributo" },
  { tipo: "obrigacoes", nome: "Obrigações fiscais", explica: "Obrigações com vencimento, situação, transmissão e recibo.", usa: "ano, competência, empresa, estabelecimento, tributo" },
  { tipo: "conciliacao", nome: "Conciliação", explica: "Alertas das verificações (regra e registros) e divergências registradas.", usa: "ano, empresa, estabelecimento, tributo" },
];
const link = "inline-flex h-7 items-center rounded-[3px] border bg-botao-claro px-2.5 font-condensada text-[12px] font-bold hover:bg-grade-clara";

export default async function PaginaRelatorios({ searchParams }: PageProps<"/fiscal/creditos/relatorios">) {
  await contexto();
  const f = lerFiltros(await searchParams, Number(hojeEmCuiaba().slice(0, 4)));
  const cad = await lerCadastros();
  const qs = new URLSearchParams(Object.entries({ ano: String(f.ano), mes: f.mes ? String(f.mes) : "", empresa: f.empresa, estab: f.estab, tributo: f.tributo }).filter(([, v]) => v)).toString();
  return (
    <div className="space-y-4">
      <Secao titulo="Relatórios" descricao="Os relatórios saem dos dados gravados, respeitam as empresas que você pode ver e os filtros abaixo; cada arquivo informa data de emissão, período e critérios.">
        <BarraFiltros cad={cad} f={f} campos={["ano", "mes", "empresa", "estab", "tributo"]} />
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {RELATORIOS.map((r) => (
            <li key={r.tipo} className="rounded-[3px] border p-3">
              <div className="font-condensada font-bold">{r.nome}</div>
              <p className="text-sm text-muted-foreground">{r.explica}</p>
              <p className="text-xs text-muted-foreground">Filtros considerados: {r.usa}.</p>
              <div className="mt-2 flex gap-2">
                <a className={link} href={`${ROTA_CREDITOS}/relatorios/exportar/${r.tipo}?${qs}`}>Excel (.xlsx)</a>
                {r.tipo === "consolidado" && <a className={link} href={`/imprimir/fiscal/consolidado?${qs}`} target="_blank" rel="noreferrer">Imprimir / salvar PDF</a>}
              </div>
            </li>
          ))}
        </ul>
      </Secao>
      <Secao titulo="Modelos de importação">
        <div className="flex flex-wrap gap-2">
          <a className={link} href={`${ROTA_CREDITOS}/relatorios/exportar/modelo-creditos`}>Modelo — créditos</a>
          <a className={link} href={`${ROTA_CREDITOS}/relatorios/exportar/modelo-movimentos`}>Modelo — movimentações</a>
        </div>
      </Secao>
    </div>
  );
}
