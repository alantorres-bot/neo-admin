"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerReais } from "@/lib/modulos/rh/folha/modulo";
import { decimoDoRecorrente } from "@/lib/modulos/rh/folha/recibos";
import { gerarDecimoRecorrentes } from "../../recibos-acoes";
import { reaisC } from "../../componentes-recibo";

export type LinhaDecimoRecorrente = {
  colaboradorId: string; cod_fornecedor: string; nome: string;
  base: number;        // centavos: proventos do recibo recorrente de um mês
  avos: number;        // sugeridos pela admissão
  jaPago: number;      // centavos: 13º por fora já pago na 1ª parcela (só na 2ª)
  gerado: number | null;   // centavos do recibo já gerado nesta folha
};

const paraTexto = (c: number) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

/** Folha do 13º: quem tem recibo recorrente e, por opção do RH, recebe o 13º desse valor por fora (decisão de 27/11/2026). */
export function DecimoDosRecorrentes({ mesId, parcela, editavel, linhas }: { mesId: string; parcela: "decimo_1" | "decimo_2"; editavel: boolean; linhas: LinhaDecimoRecorrente[] }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  // por pessoa: marcada para pagar, avos e valor (texto; recalculado quando os avos mudam)
  const [escolha, setEscolha] = useState<Record<string, { pagar: boolean; avos: string; valor: string }>>(() =>
    Object.fromEntries(linhas.map((l) => [l.colaboradorId, { pagar: false, avos: String(l.avos), valor: paraTexto(decimoDoRecorrente(l.base, l.avos, parcela, l.jaPago)) }])));
  const mudar = (l: LinhaDecimoRecorrente, m: Partial<{ pagar: boolean; avos: string; valor: string }>) => setEscolha((x) => {
    const atual = { ...x[l.colaboradorId], ...m };
    if (m.avos !== undefined) {
      const avos = Number(m.avos);
      atual.valor = Number.isInteger(avos) && avos >= 1 && avos <= 12 ? paraTexto(decimoDoRecorrente(l.base, avos, parcela, l.jaPago)) : "";
    }
    return { ...x, [l.colaboradorId]: atual };
  });

  const marcadas = linhas.filter((l) => l.gerado === null && escolha[l.colaboradorId]?.pagar);
  const gerar = () => iniciar(async () => {
    const envio = marcadas.map((l) => ({ colaboradorId: l.colaboradorId, avos: Number(escolha[l.colaboradorId].avos), valor: lerReais(escolha[l.colaboradorId].valor) }));
    const ruim = envio.find((e) => !Number.isInteger(e.avos) || e.avos < 1 || e.avos > 12 || !(e.valor > 0));
    if (ruim) { toast.error(`Avos (1 a 12) ou valor inválido em ${linhas.find((l) => l.colaboradorId === ruim.colaboradorId)?.nome}.`); return; }
    const r = await gerarDecimoRecorrentes(mesId, envio);
    if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso); router.refresh(); }
  });

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold">13º dos recibos recorrentes (por fora)</h3>
          <p className="text-xs text-muted-foreground">
            Base = proventos do recibo recorrente de um mês (modelo + salário do cadastro). 13º = base × avos ÷ 12; {parcela === "decimo_1" ? "nesta 1ª parcela, a metade" : "nesta 2ª parcela, o restante (menos o que saiu na 1ª)"}.
            Marque quem recebe: o recibo entra no Avulso da folha do 13º.
          </p>
        </div>
        {editavel && <Button size="sm" disabled={pendente || marcadas.length === 0} onClick={gerar}><FilePlus2 /> Gerar recibos do 13º ({marcadas.length})</Button>}
      </div>
      {linhas.length === 0 ? (
        <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">Ninguém desta folha tem recibo recorrente ativo.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pagar</TableHead><TableHead>Nº</TableHead><TableHead>Funcionário</TableHead><TableHead className="text-right">Base (mês)</TableHead>
              <TableHead className="text-right">Avos</TableHead>{parcela === "decimo_2" && <TableHead className="text-right">Pago na 1ª</TableHead>}<TableHead className="text-right">13º por fora</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => {
              const e = escolha[l.colaboradorId];
              const aberta = editavel && l.gerado === null;
              return (
                <TableRow key={l.colaboradorId} className={l.gerado === null && !e.pagar ? "text-muted-foreground" : ""}>
                  <TableCell>
                    {l.gerado !== null ? <span className="text-xs text-marca">Recibo gerado</span>
                      : <input type="checkbox" aria-label={`Pagar o 13º por fora de ${l.nome}`} className="size-4" disabled={!aberta} checked={e.pagar} onChange={(x) => mudar(l, { pagar: x.target.checked })} />}
                  </TableCell>
                  <TableCell className="tabular-nums">{l.cod_fornecedor}</TableCell>
                  <TableCell className="font-medium">{l.nome}</TableCell>
                  <TableCell className="text-right tabular-nums">{reaisC(l.base)}</TableCell>
                  <TableCell className="text-right">
                    {aberta ? <Input aria-label={`Avos de ${l.nome}`} inputMode="numeric" value={e.avos} onChange={(x) => mudar(l, { avos: x.target.value })} className="ml-auto h-7 w-14 px-1 text-right tabular-nums" /> : <span className="tabular-nums">{e.avos}</span>}
                  </TableCell>
                  {parcela === "decimo_2" && <TableCell className="text-right tabular-nums">{l.jaPago ? reaisC(l.jaPago) : ""}</TableCell>}
                  <TableCell className="text-right tabular-nums">
                    {l.gerado !== null ? <span className="font-medium">{reaisC(l.gerado)}</span>
                      : aberta ? <Input aria-label={`13º por fora de ${l.nome}`} inputMode="decimal" value={e.valor} onChange={(x) => mudar(l, { valor: x.target.value })} aria-invalid={Number.isNaN(lerReais(e.valor))} className="ml-auto h-7 w-24 px-1 text-right tabular-nums" />
                      : e.valor}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
