// Recibo de pagamento avulso impresso (modelo novo, 15/10/2026): A4 com duas vias (empregador e empregado) e linha de corte.
// Página de impressão: <table> cru é permitido aqui (CLAUDE.md, regra 10).
import type { Recibo } from "@/app/(plataforma)/rh/folha/dados";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { ROTULO_TIPO_RECIBO } from "@/lib/modulos/rh/folha/recibos";
import { reaisPorExtenso } from "@/lib/nucleo/extenso";

export type Empregador = { razao_social: string; cnpj: string | null };

const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
const ref = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 4 }));
const hoje = () => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "long", year: "numeric" }).format(new Date());

function Via({ r, empregador, via }: { r: Recibo; empregador: Empregador; via: string }) {
  const proventos = r.linhas.filter((l) => l.natureza === "provento");
  const descontos = r.linhas.filter((l) => l.natureza === "desconto");
  const centavos = Math.round(r.total * 100);
  return (
    <div className="rounded-[4px] border-[1.5px] border-black">
      <header className="flex items-start justify-between gap-4 border-b-[1.5px] border-black px-4 py-2.5">
        <div>
          <p className="text-[13px] font-bold uppercase leading-tight">{empregador.razao_social}</p>
          <p className="text-[10px]">CNPJ {empregador.cnpj ?? "—"}</p>
        </div>
        <div className="text-right">
          <p className="text-[15px] font-bold uppercase leading-tight tracking-wide">Recibo de pagamento</p>
          <p className="text-[10px]">Referente a {rotuloMes(r.competencia)} · {ROTULO_TIPO_RECIBO[r.tipo]}</p>
        </div>
      </header>
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 gap-y-0.5 border-b border-black px-4 py-2 text-[10.5px]">
        <span className="text-neutral-600">Nº</span><span className="font-bold">{r.nome}</span><span className="text-neutral-600">CPF</span><span className="tabular-nums">{r.cpf ?? "—"}</span>
        <span className="tabular-nums font-bold">{r.cod_fornecedor}</span><span>{r.funcao ?? ""}</span><span className="text-neutral-600">Salário</span><span className="tabular-nums">{r.salario ? `R$ ${reais(r.salario)}` : "—"}</span>
        {r.periodo_inicio && (<><span className="text-neutral-600">Período</span><span className="col-span-3">{br(r.periodo_inicio)} a {br(r.periodo_fim)}</span></>)}
      </div>
      <table className="w-full border-collapse text-[10.5px]">
        <thead>
          <tr className="border-b border-black bg-neutral-100 text-left">
            <th className="w-10 px-4 py-1">Cód.</th><th className="py-1">Descrição</th><th className="w-20 py-1 text-right">Referência</th>
            <th className="w-24 py-1 text-right">Proventos</th><th className="w-24 py-1 pr-4 text-right">Descontos</th>
          </tr>
        </thead>
        <tbody>
          {[...proventos, ...descontos].map((l) => (
            <tr key={l.ordem} className="border-b border-neutral-200">
              <td className="px-4 py-1 tabular-nums">{String(l.ordem).padStart(3, "0")}</td><td className="py-1">{l.descricao}</td>
              <td className="py-1 text-right tabular-nums">{ref(l.referencia)}</td>
              <td className="py-1 text-right tabular-nums">{l.natureza === "provento" ? reais(l.valor) : ""}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{l.natureza === "desconto" ? reais(l.valor) : ""}</td>
            </tr>
          ))}
          <tr className="border-t border-black font-bold">
            <td colSpan={3} className="px-4 py-1 text-right">Totais</td>
            <td className="py-1 text-right tabular-nums">{reais(r.proventos)}</td><td className="py-1 pr-4 text-right tabular-nums">{reais(r.descontos)}</td>
          </tr>
        </tbody>
      </table>
      <div className="flex items-stretch border-t-[1.5px] border-black">
        <div className="flex-1 px-4 py-2 text-[10px] leading-snug">
          {r.mensagem && <p className="mb-1">{r.mensagem}</p>}
          <p className="italic">({reaisPorExtenso(centavos)})</p>
        </div>
        <div className="flex min-w-44 flex-col justify-center border-l-[1.5px] border-black bg-neutral-100 px-4 py-2 text-right">
          <span className="text-[9.5px] uppercase tracking-wide text-neutral-600">Líquido a receber</span>
          <span className="text-[17px] font-bold tabular-nums">R$ {reais(r.total)}</span>
        </div>
      </div>
      <div className="flex items-end justify-between gap-6 border-t border-black px-4 pb-2 pt-5 text-[10px]">
        <p className="max-w-[55%] leading-snug">Declaro ter recebido a importância líquida discriminada neste recibo.<br />Cuiabá, {hoje()}.</p>
        <div className="w-64 text-center"><div className="border-t border-black pt-0.5">{r.nome}</div></div>
      </div>
      <p className="border-t border-neutral-300 px-4 py-0.5 text-right text-[8.5px] uppercase tracking-wide text-neutral-500">{via}</p>
    </div>
  );
}

/** Um recibo = uma folha A4 com as duas vias. */
export function ReciboImpresso({ r, empregador }: { r: Recibo; empregador: Empregador }) {
  return (
    <article className="flex flex-col gap-5 break-after-page py-2 [&:last-child]:break-after-auto">
      <Via r={r} empregador={empregador} via="1ª via — empregador" />
      <div className="flex items-center gap-2 text-[9px] text-neutral-500"><span className="flex-1 border-t border-dashed border-neutral-400" />✂ recortar<span className="flex-1 border-t border-dashed border-neutral-400" /></div>
      <Via r={r} empregador={empregador} via="2ª via — empregado" />
    </article>
  );
}
