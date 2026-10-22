"use client";

// Passos 1 e 2 da importação: escolher o arquivo, conferir o mapeamento de colunas (automático pelo título, ajustável) e validar.
// A validação manda as linhas para a área de preparo; nada entra na base sem a confirmação do passo 3.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CAMPOS, type TipoImportacao } from "@/lib/modulos/fiscal/creditos/importacao";
import { ROTA_CREDITOS } from "@/lib/modulos/fiscal/creditos/modulo";
import { lerCabecalho, prepararImportacao } from "../acoes";
import { SELECT } from "../ui";

export function Assistente({ tipoInicial }: { tipoInicial: TipoImportacao }) {
  const [tipo, setTipo] = useState<TipoImportacao>(tipoInicial);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [cab, setCab] = useState<{ cabecalho: string[]; mapa: Record<string, number | null>; linhas: number } | null>(null);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const ler = (f: File | null, t = tipo) => {
    setArquivo(f); setCab(null); setErro(undefined);
    if (!f) return;
    iniciar(async () => {
      const fd = new FormData();
      fd.set("arquivo", f); fd.set("tipo", t);
      const r = await lerCabecalho(null, fd);
      if (r.ok) setCab(r.dados as typeof cab); else setErro(r.erro);
    });
  };
  const faltando = cab ? CAMPOS[tipo].filter((c) => c.obrigatorio && cab.mapa[c.chave] === null) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm"><span className="font-medium">O que importar</span>
          <select className={SELECT} value={tipo} onChange={(e) => { const t = e.target.value as TipoImportacao; setTipo(t); ler(arquivo, t); }}>
            <option value="creditos">Créditos</option><option value="movimentos">Movimentações</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm"><span className="font-medium">Planilha (.xlsx ou .csv)</span>
          <Input type="file" accept=".xlsx,.csv,.xls" onChange={(e) => ler(e.target.files?.[0] ?? null)} />
        </label>
        <a className="text-sm text-elo underline" href={`${ROTA_CREDITOS}/relatorios/exportar/modelo-${tipo}`}>Baixar modelo de {tipo === "creditos" ? "créditos" : "movimentações"}</a>
      </div>
      {pendente && <p className="text-sm text-muted-foreground" role="status">Lendo…</p>}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      {cab && (
        <div className="space-y-2">
          <p className="text-sm">{cab.linhas} linha(s) de dados. Confira de qual coluna vem cada campo:</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CAMPOS[tipo].map((c) => (
              <label key={c.chave} className="grid gap-0.5 text-xs">
                <span className="font-medium">{c.titulo}{c.obrigatorio ? " *" : ""} <span className="font-normal text-muted-foreground">({c.formato})</span></span>
                <select className={SELECT} value={cab.mapa[c.chave] ?? ""} onChange={(e) => setCab({ ...cab, mapa: { ...cab.mapa, [c.chave]: e.target.value === "" ? null : Number(e.target.value) } })}>
                  <option value="">— não importar —</option>
                  {cab.cabecalho.map((h, i) => <option key={i} value={i}>{h || `(coluna ${i + 1})`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {faltando.length > 0 && <p className="text-sm text-amber-700">Sem coluna para: {faltando.map((c) => c.titulo).join(", ")} (essas linhas ficarão com erro).</p>}
          <Button disabled={pendente || !arquivo} onClick={() => iniciar(async () => {
            const fd = new FormData();
            fd.set("arquivo", arquivo!); fd.set("tipo", tipo); fd.set("mapeamento", JSON.stringify(cab.mapa));
            const r = await prepararImportacao(null, fd);
            if (r.ok && r.id) { toast.success(r.mensagem ?? "Validado."); router.push(`${ROTA_CREDITOS}/importacao?lote=${r.id}`); }
            else setErro(r.erro);
          })}>{pendente ? "Validando…" : "Validar e ver prévia"}</Button>
        </div>
      )}
    </div>
  );
}
