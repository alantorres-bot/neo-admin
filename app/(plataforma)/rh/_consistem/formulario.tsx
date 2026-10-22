"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CAMPOS_TIPO, ROTULO_CAMPO_LANCAMENTO, ROTULO_TIPO, TIPOS_TITULO, type FormaPortador, type ParametrosLancamento, type TipoTitulo } from "@/lib/modulos/rh/lancamento";
import { buscarModelo, salvarParametrosLancamento, type Modelo } from "./acoes";

const SELECAO = "h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]";
const FORMAS: FormaPortador[] = ["fopag", "pix"];

/**
 * Parâmetros dos títulos do RH no Consistem (folha e VT): códigos por tipo de pagamento, categoria única, portador por empregador ×
 * forma e as chaves liga/desliga. Os códigos podem ser copiados de um título já lançado (modelo).
 */
export function FormParametrosLancamento({ parametros, vtLigado, folhaLigado, empregadores, empresas, editavel }: {
  parametros: ParametrosLancamento; vtLigado: boolean; folhaLigado: boolean; empregadores: string[]; empresas: { id: string; nome: string }[]; editavel: boolean;
}) {
  const router = useRouter();
  const [categoria, setCategoria] = useState(parametros.categoriaDoc ? String(parametros.categoriaDoc) : "");
  const [tipos, setTipos] = useState<Record<string, Record<string, string>>>(Object.fromEntries(TIPOS_TITULO.map((t) => [t,
    Object.fromEntries(CAMPOS_TIPO.map((k) => [k, parametros.tipos[t]?.[k] != null ? String(parametros.tipos[t]![k]) : ""]))])));
  const nomes = [...new Set([...empregadores, ...parametros.portadores.map((p) => p.empregador)])];
  const [portadores, setPortadores] = useState(nomes.flatMap((empregador) => FORMAS.map((forma) => {
    const p = parametros.portadores.find((x) => x.empregador === empregador && x.forma === forma);
    return { empregador, forma, codPortador: p ? String(p.codPortador) : "", conta: p?.conta ?? "" };
  })));
  const [ligaVt, setLigaVt] = useState(vtLigado);
  const [ligaFolha, setLigaFolha] = useState(folhaLigado);
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id ?? "");
  const [destino, setDestino] = useState<TipoTitulo>("salario");
  const [codLancamento, setCodLancamento] = useState("");
  const [codFornecedor, setCodFornecedor] = useState("");
  const [valor, setValor] = useState("");
  const [modelo, setModelo] = useState<Modelo>();
  const [pendente, iniciar] = useTransition();

  const mudarTipo = (t: string, k: string, v: string) => setTipos((s) => ({ ...s, [t]: { ...s[t], [k]: v } }));
  const mudarPortador = (i: number, campo: "codPortador" | "conta", v: string) => setPortadores((s) => s.map((p, j) => (j === i ? { ...p, [campo]: v } : p)));

  const buscar = (porLancamento: boolean, codigo = codLancamento) => iniciar(async () => {
    const r = await buscarModelo({ empresaId, ...(porLancamento ? { codLancamento: codigo } : { codFornecedor, valor }) });
    if (!r.ok) { toast.error(r.erro); return; }
    setModelo((anterior) => ({ ...r.modelo, outros: r.modelo.outros.length ? r.modelo.outros : anterior?.outros ?? [] }));
    const c = r.modelo.codigos;
    setTipos((s) => ({ ...s, [destino]: { ...s[destino], ...Object.fromEntries(CAMPOS_TIPO.filter((k) => c[k] !== undefined).map((k) => [k, String(c[k])])) } }));
    if (!categoria && c.categoriaDoc) setCategoria(String(c.categoriaDoc));
    const faltam = CAMPOS_TIPO.filter((k) => c[k] === undefined);
    toast.success(`Códigos copiados para ${ROTULO_TIPO[destino]}${faltam.length ? `; faltou: ${faltam.map((k) => ROTULO_CAMPO_LANCAMENTO[k]).join(", ")}` : ""}.`
      + (c.codPortador ? ` O portador do modelo é ${c.codPortador}.` : "") + (c.categoriaDoc ? ` Categoria ${c.categoriaDoc}.` : ""));
  });
  const salvar = () => iniciar(async () => {
    const r = await salvarParametrosLancamento({ categoria, tipos, portadores, vtLigado: ligaVt, folhaLigado: ligaFolha });
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success("Parâmetros salvos.");
    router.refresh();
  });

  return (
    <div className="space-y-5">
      {editavel && (
        <fieldset className="space-y-3 rounded-[3px] border border-grade p-3">
          <legend className="px-1 text-sm font-medium">Copiar de um título já lançado no Consistem (só leitura)</legend>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="destino" className="text-xs">Copiar para o tipo</Label>
              <select id="destino" value={destino} onChange={(e) => setDestino(e.target.value as TipoTitulo)} className={SELECAO}>
                {TIPOS_TITULO.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
              </select>
            </div>
            {empresas.length > 1 && (
              <div className="grid gap-1">
                <Label htmlFor="empresa" className="text-xs">Empresa</Label>
                <select id="empresa" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className={SELECAO}>
                  {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
            )}
            <div className="grid gap-1">
              <Label htmlFor="codFornecedor" className="text-xs">Títulos do fornecedor (Nº)</Label>
              <div className="flex gap-2">
                <Input id="codFornecedor" value={codFornecedor} onChange={(e) => setCodFornecedor(e.target.value)} inputMode="numeric" placeholder="Nº" className="h-8 w-20" />
                <Input aria-label="Valor (R$)" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="Valor (R$)" className="h-8 w-28" />
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
              )}
            </div>
          )}
        </fieldset>
      )}

      <fieldset disabled={!editavel} className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-bold">Códigos por tipo de pagamento</h3>
          <p className="text-xs text-muted-foreground">Linha vazia = esse tipo ainda não é lançado (o botão recusa o mês que tiver esse tipo).</p>
          <Table interativa={false}>
            <TableHeader>
              <TableRow><TableHead>Tipo</TableHead>{CAMPOS_TIPO.map((k) => <TableHead key={k}>{ROTULO_CAMPO_LANCAMENTO[k]}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {TIPOS_TITULO.map((t) => (
                <TableRow key={t}>
                  <TableCell className="text-xs font-medium">{ROTULO_TIPO[t]}</TableCell>
                  {CAMPOS_TIPO.map((k) => (
                    <TableCell key={k}>
                      <Input aria-label={`${ROTULO_TIPO[t]} — ${ROTULO_CAMPO_LANCAMENTO[k]}`} value={tipos[t][k]} onChange={(e) => mudarTipo(t, k, e.target.value)} inputMode="numeric" className="h-8 w-24" autoComplete="off" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="grid w-48 gap-1">
            <Label htmlFor="categoria" className="text-xs">Categoria do documento (todos os tipos)</Label>
            <Input id="categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} inputMode="numeric" className="h-8" autoComplete="off" />
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-bold">Portador por empregadora e forma de pagamento</h3>
          <p className="text-xs text-muted-foreground">De onde sai o dinheiro: vale para salário, férias, 13º, avulso e VT. A conta pagadora agrupa a lista de PIX.</p>
          <Table interativa={false}>
            <TableHeader>
              <TableRow><TableHead>Empregadora</TableHead><TableHead>Forma</TableHead><TableHead>Portador</TableHead><TableHead>Conta pagadora</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {portadores.map((p, i) => (
                <TableRow key={`${p.empregador}:${p.forma}`}>
                  <TableCell className="text-xs">{p.empregador}</TableCell>
                  <TableCell className="text-xs">{p.forma === "fopag" ? "FOPAG" : "PIX"}</TableCell>
                  <TableCell><Input aria-label={`Portador ${p.empregador} ${p.forma}`} value={p.codPortador} onChange={(e) => mudarPortador(i, "codPortador", e.target.value)} inputMode="numeric" className="h-8 w-24" autoComplete="off" /></TableCell>
                  <TableCell><Input aria-label={`Conta pagadora ${p.empregador} ${p.forma}`} value={p.conta} onChange={(e) => mudarPortador(i, "conta", e.target.value)} placeholder="ex.: Conta Oeste" className="h-8 w-48" autoComplete="off" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ligaFolha} onChange={(e) => setLigaFolha(e.target.checked)} className="size-4" />
            Folha: lançar no Consistem ligado (botão “Lançar no Consistem” na folha aprovada)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ligaVt} onChange={(e) => setLigaVt(e.target.checked)} className="size-4" />
            Vale-transporte: lançar no Consistem ligado (botão no mês aprovado)
          </label>
        </div>
        {editavel && <Button onClick={salvar} disabled={pendente}>Salvar parâmetros</Button>}
      </fieldset>
    </div>
  );
}
