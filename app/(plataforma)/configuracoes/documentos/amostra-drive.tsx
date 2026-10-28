"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarDataHora } from "@/lib/nucleo/fila";
import { criarTrava, LIMITE_TOTAL_METADADOS, rotuloTipoArquivo } from "@/lib/nucleo/ged/conexao-tela";
import type { ConsultaMetadados } from "@/supabase/functions/_shared/ged";
import { consultarMetadadosGed } from "./acoes";

const tamanho = (b: number | null) =>
  b === null ? "—" : b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

/** Primeira leitura controlada: só metadados do que a conta conectada enxerga (sem abrir arquivos, sem indexar). */
export function AmostraDrive() {
  const [pendente, iniciar] = useTransition();
  const [consulta, setConsulta] = useState<ConsultaMetadados | null>(null);
  const trava = useRef(criarTrava());

  const consultar = () =>
    iniciar(async () => void (await trava.current(async () => {
      const r = await consultarMetadadosGed();
      if (!r.ok) return void toast.error(r.erro);
      setConsulta(r.consulta);
    })));

  const tipos = consulta ? Object.entries(consulta.por_tipo).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={consultar} disabled={pendente}>{pendente ? "Consultando o Drive…" : "Consultar arquivos (amostra)"}</Button>
        <span className="text-muted-foreground">Só nomes, tipos e datas; nenhum arquivo é aberto ou copiado.</span>
      </div>
      {consulta && (
        <>
          <p role="status">
            {consulta.itens.toLocaleString("pt-BR")} {consulta.itens === 1 ? "item encontrado" : "itens encontrados"}
            {consulta.limite_atingido ? ` (consulta limitada aos ${LIMITE_TOTAL_METADADOS} mais recentes; há mais no Drive)` : ""}.
            {tipos.length > 0 && ` Tipos: ${tipos.map(([t, n]) => `${rotuloTipoArquivo(t)} ${n}`).join(" · ")}.`}
          </p>
          {consulta.amostra.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Modificado em</TableHead>
                  <TableHead className="text-right">Tamanho</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consulta.amostra.map((i, n) => (
                  <TableRow key={n}>
                    <TableCell className="max-w-[320px] truncate" title={i.nome}>{i.nome}</TableCell>
                    <TableCell>{rotuloTipoArquivo(i.tipo)}</TableCell>
                    <TableCell>{formatarDataHora(i.modificado_em)}</TableCell>
                    <TableCell className="text-right">{tamanho(i.tamanho)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
