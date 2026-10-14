"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { aplicarDoConsistem, conferirNoConsistem, type ResultadoConferencia } from "./acoes";

const ROTULO_CAMPO = { nome: "Nome", cpf: "CPF", situacao: "Situação" } as const;

/** Confere os ativos com o fornecedor do Consistem e mostra só o que diverge; “Usar o do Consistem” grava nome e CPF de lá. */
export function ConferenciaConsistem() {
  const router = useRouter();
  const [resultado, setResultado] = useState<Extract<ResultadoConferencia, { ok: true }>>();
  const [trabalhando, iniciar] = useTransition();
  const [aplicando, setAplicando] = useState<string>();

  const conferir = () => iniciar(async () => {
    const r = await conferirNoConsistem();
    if (!r.ok) { toast.error(r.erro); return; }
    setResultado(r);
    if (!r.divergentes.length && !r.naoEncontrados.length && !r.erros.length) toast.success(`${r.conferidos} cadastros conferidos: tudo igual ao Consistem.`);
  });

  const aplicar = (id: string) => iniciar(async () => {
    setAplicando(id);
    const r = await aplicarDoConsistem(id);
    setAplicando(undefined);
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success("Nome e CPF copiados do Consistem.");
    setResultado((atual) => atual && { ...atual, divergentes: atual.divergentes.filter((d) => d.id !== id) });
    router.refresh();
  });

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" onClick={conferir} disabled={trabalhando}><RefreshCw /> {trabalhando && !aplicando ? "Conferindo…" : "Conferir no Consistem"}</Button>
      {resultado && (resultado.divergentes.length > 0 || resultado.naoEncontrados.length > 0 || resultado.erros.length > 0) && (
        <div className="space-y-2 rounded-[3px] border border-grade p-3">
          <p className="text-sm">
            {resultado.conferidos} conferidos · <strong>{resultado.divergentes.length}</strong> com diferença · <strong>{resultado.naoEncontrados.length}</strong> não encontrados no Consistem
          </p>
          {resultado.divergentes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Fornecedor</TableHead><TableHead>Campo</TableHead><TableHead>Aqui</TableHead><TableHead>No Consistem</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {resultado.divergentes.map((d) => (
                  <Fragment key={d.id}>
                    {d.itens.map((i, n) => (
                      <TableRow key={`${d.id}-${i.campo}`}>
                        <TableCell>{n === 0 ? `${d.cod_fornecedor} · ${d.nome}` : ""}</TableCell>
                        <TableCell>{ROTULO_CAMPO[i.campo]}</TableCell>
                        <TableCell>{i.aqui}</TableCell>
                        <TableCell>{i.consistem}</TableCell>
                        <TableCell>
                          {n === 0 && d.itens.some((x) => x.campo !== "situacao") && (
                            <Button variant="ghost" size="sm" onClick={() => aplicar(d.id)} disabled={trabalhando}>{aplicando === d.id ? "Gravando…" : "Usar o do Consistem"}</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
          {resultado.naoEncontrados.length > 0 && (
            <p className="text-sm text-destructive">Não encontrados no Consistem: {resultado.naoEncontrados.map((c) => `${c.cod_fornecedor} (${c.nome})`).join(", ")}. Confira o código.</p>
          )}
          {resultado.erros.map((e) => <p key={e} className="text-sm text-destructive">{e}</p>)}
        </div>
      )}
    </div>
  );
}
