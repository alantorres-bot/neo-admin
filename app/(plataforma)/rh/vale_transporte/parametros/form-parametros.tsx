"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CAMPOS_LANCAMENTO, ROTULO_CAMPO_LANCAMENTO, type CodigosLancamento } from "@/lib/modulos/rh/vale-transporte/lancamento";
import { buscarModelo, salvarParametros, type Modelo } from "./acoes";

/** Códigos do título do VT no Consistem, preenchidos à mão ou copiados de um VT já lançado (modelo), e a chave liga/desliga. */
export function FormParametros({ inicial, ligado, empresas, editavel }: { inicial: Record<string, unknown> | null; ligado: boolean; empresas: { id: string; nome: string }[]; editavel: boolean }) {
  const router = useRouter();
  const [codigos, setCodigos] = useState<Record<string, string>>(Object.fromEntries(CAMPOS_LANCAMENTO.map((k) => [k, inicial?.[k] != null ? String(inicial[k]) : ""])));
  const [liga, setLiga] = useState(ligado);
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id ?? "");
  const [codLancamento, setCodLancamento] = useState("");
  const [codFornecedor, setCodFornecedor] = useState("");
  const [valor, setValor] = useState("");
  const [modelo, setModelo] = useState<Modelo>();
  const [pendente, iniciar] = useTransition();

  const buscar = (porLancamento: boolean, codigo = codLancamento) => iniciar(async () => {
    const r = await buscarModelo({ empresaId, ...(porLancamento ? { codLancamento: codigo } : { codFornecedor, valor }) });
    if (!r.ok) { toast.error(r.erro); return; }
    // Ao escolher um da lista, mantém a lista da busca por fornecedor.
    setModelo((anterior) => ({ ...r.modelo, outros: r.modelo.outros.length ? r.modelo.outros : anterior?.outros ?? [] }));
    const achados = r.modelo.codigos as Partial<CodigosLancamento>;
    setCodigos((c) => ({ ...c, ...Object.fromEntries(Object.entries(achados).map(([k, v]) => [k, String(v)])) }));
    const faltam = CAMPOS_LANCAMENTO.filter((k) => achados[k] === undefined);
    toast.success(faltam.length ? `Códigos copiados; faltou: ${faltam.map((k) => ROTULO_CAMPO_LANCAMENTO[k]).join(", ")}.` : "Códigos copiados do modelo. Confira e salve.");
  });
  const salvar = () => iniciar(async () => {
    const r = await salvarParametros({ codigos, ligado: liga });
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success("Parâmetros salvos.");
    router.refresh();
  });

  return (
    <div className="space-y-5">
      {editavel && (
        <fieldset className="space-y-3 rounded-[3px] border border-grade p-3">
          <legend className="px-1 text-sm font-medium">Copiar de um VT já lançado no Consistem (só leitura)</legend>
          <div className="flex flex-wrap items-end gap-3">
            {empresas.length > 1 && (
              <div className="grid gap-1">
                <Label htmlFor="empresa" className="text-xs">Empresa</Label>
                <select id="empresa" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]">
                  {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
            )}
            <div className="grid gap-1">
              <Label htmlFor="codFornecedor" className="text-xs">Títulos do fornecedor (Nº) de um VT pago</Label>
              <div className="flex gap-2">
                <Input id="codFornecedor" value={codFornecedor} onChange={(e) => setCodFornecedor(e.target.value)} inputMode="numeric" placeholder="Nº" className="h-8 w-20" />
                <Input aria-label="Valor do VT (R$)" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="Valor (R$)" className="h-8 w-28" />
                <Button variant="outline" size="sm" disabled={pendente || !codFornecedor} onClick={() => buscar(false)}><Search /> Buscar</Button>
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="codLancamento" className="text-xs">ou o código do lançamento</Label>
              <div className="flex gap-2">
                <Input id="codLancamento" value={codLancamento} onChange={(e) => setCodLancamento(e.target.value)} inputMode="numeric" className="h-8 w-28" />
                <Button variant="outline" size="sm" disabled={pendente || !codLancamento} onClick={() => buscar(true)}><Search /> Buscar</Button>
              </div>
            </div>
          </div>
          {pendente && <p className="text-xs text-muted-foreground">Consultando o Consistem… a busca por fornecedor lê os títulos dos últimos 120 dias e pode levar até um minuto.</p>}
          {modelo && (
            <div className="space-y-2 text-sm">
              <p>Modelo em uso: <strong>{modelo.resumo}</strong></p>
              {modelo.outros.length > 1 && (
                <>
                  <p className="text-xs text-muted-foreground">Títulos encontrados (mais recentes primeiro). Se o modelo não for o VT, use o certo:</p>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Lançamento</TableHead><TableHead>Emissão</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Complemento</TableHead><TableHead /></TableRow>
                    </TableHeader>
                    <TableBody>
                      {modelo.outros.map((o) => (
                        <TableRow key={o.codLancamento} className={o.codLancamento === modelo.codLancamento ? "bg-cabecalho font-medium" : ""}>
                          <TableCell className="tabular-nums">{o.codLancamento}</TableCell>
                          <TableCell className="tabular-nums">{o.emissao ? o.emissao.split("-").reverse().join("/") : ""}</TableCell>
                          <TableCell className="text-right tabular-nums">{o.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                          <TableCell className="text-xs">{o.complemento}</TableCell>
                          <TableCell>
                            {o.codLancamento !== modelo.codLancamento && (
                              <Button variant="ghost" size="sm" disabled={pendente} onClick={() => { setCodLancamento(o.codLancamento); buscar(true, o.codLancamento); }}>Usar este</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </div>
          )}
        </fieldset>
      )}
      <fieldset disabled={!editavel} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CAMPOS_LANCAMENTO.map((k) => (
            <div key={k} className="grid gap-1">
              <Label htmlFor={k} className="text-xs">{ROTULO_CAMPO_LANCAMENTO[k]}</Label>
              <Input id={k} value={codigos[k]} onChange={(e) => setCodigos((c) => ({ ...c, [k]: e.target.value }))} inputMode="numeric" className="h-8" autoComplete="off" />
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={liga} onChange={(e) => setLiga(e.target.checked)} className="size-4" />
          Lançar no Consistem ligado (mostra o botão “Lançar no Consistem” no mês aprovado)
        </label>
        {editavel && <Button onClick={salvar} disabled={pendente}>Salvar parâmetros</Button>}
      </fieldset>
    </div>
  );
}
