"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { criarTrava, type VerificacaoRaiz } from "@/lib/nucleo/ged/conexao-tela";
import { RAIZES_CANDIDATAS, type IdRaizCandidata } from "@/supabase/functions/_shared/ged";
import { verificarRaizGed } from "./acoes";

const lista = (itens: string[]) => (itens.length ? itens.join(" · ") : "—");

/**
 * Verificação das raízes candidatas (A0, especificação 5.2.4): só metadados, só para o admin geral, sem gravar nada (5.2.4.4).
 * Serve para o responsável confirmar IDs, finalidade e estrutura [PENDENTE 1]. Ao sair da tela, o resultado some.
 */
export function VerificacaoRaizes() {
  const [pendente, iniciar] = useTransition();
  const [emCurso, setEmCurso] = useState<IdRaizCandidata | null>(null);
  const [resultados, setResultados] = useState<Partial<Record<IdRaizCandidata, VerificacaoRaiz>>>({});
  const trava = useRef(criarTrava());

  const verificar = (id: IdRaizCandidata) => {
    setEmCurso(id); // fora da transição: o rótulo "Verificando…" aparece já no clique
    iniciar(async () => void (await trava.current(async () => {
      const r = await verificarRaizGed(id);
      setEmCurso(null);
      if (!r.ok) return void toast.error(r.erro);
      setResultados((atual) => ({ ...atual, [id]: r.verificacao }));
    })));
  };

  return (
    <div className="space-y-3 border-t pt-3">
      <div>
        <p className="font-medium">Verificação das raízes candidatas</p>
        <p className="text-muted-foreground">
          Lista a estrutura de cada pasta candidata (só nomes de pastas e contagens), para confirmar qual raiz o GED vai usar. Nada é
          gravado: o resultado aparece só aqui e some ao sair da tela.
        </p>
      </div>
      {(Object.keys(RAIZES_CANDIDATAS) as IdRaizCandidata[]).map((id) => {
        const v = resultados[id];
        return (
          <div key={id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{RAIZES_CANDIDATAS[id].rotulo}</span>
              <Button variant="outline" onClick={() => verificar(id)} disabled={pendente}>
                {emCurso === id ? "Verificando…" : v ? "Verificar de novo" : "Verificar"}
              </Button>
            </div>
            {v && (
              <div className="space-y-2">
                <p role="status">
                  {v.itens.toLocaleString("pt-BR")} itens lidos até o nível {v.limites.profundidadeMax}.
                  {v.truncada &&
                    ` Leitura incompleta: parou num limite (${v.limites.maxItens.toLocaleString("pt-BR")} itens, ${v.limites.maxPastasAbertas} pastas abertas${v.limites.prazoMs ? ` ou ${v.limites.prazoMs / 1000} s` : ""}).`}
                </p>
                {v.candidatasDentro.length > 0 && <p className="text-amber-700">Contém outra candidata: {lista(v.candidatasDentro)}. Raízes sobrepostas são recusadas (5.2.3).</p>}
                <Table interativa={false}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nível</TableHead>
                      <TableHead className="text-right">Pastas</TableHead>
                      <TableHead className="text-right">Arquivos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {v.porNivel.map((n) => (
                      <TableRow key={n.profundidade}>
                        <TableCell>{n.profundidade === 0 ? "Raiz" : n.profundidade}</TableCell>
                        <TableCell className="text-right">{n.pastas}</TableCell>
                        <TableCell className="text-right">{n.arquivos}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Subpastas do 1º nível</dt>
                  <dd>{lista(v.subpastasNivel1)}</dd>
                  <dt className="text-muted-foreground">Subpastas do 2º nível</dt>
                  <dd>{lista(v.subpastasNivel2)}</dd>
                  <dt className="text-muted-foreground">Extensões mais comuns</dt>
                  <dd>{v.extensoes.length ? v.extensoes.map((e) => `${e.extensao} ${e.quantidade}`).join(" · ") : "—"}</dd>
                  <dt className="text-muted-foreground">Temporários</dt>
                  <dd>{v.temporarios.length ? `${v.temporarios.length}: ${lista(v.temporarios.slice(0, 10))}` : "nenhum"}</dd>
                </dl>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
