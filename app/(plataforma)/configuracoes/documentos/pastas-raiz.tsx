"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { criarTrava, ROTULO_SITUACAO_RAIZ, type RaizGed } from "@/lib/nucleo/ged/conexao-tela";
import { RAIZES_CANDIDATAS, RAIZES_CONFIRMADAS, type IdRaizConfirmada } from "@/supabase/functions/_shared/ged";
import { cadastrarRaizGed, definirAreasRaizGed, definirSituacaoRaizGed } from "./acoes";

const SELECT = "h-9 w-full rounded-md border bg-background px-2 text-sm";
type Area = { codigo: string; nome: string };
type Edicao = { drive: IdRaizConfirmada; raiz: RaizGed | null };

/**
 * Pastas-raiz do GED (A1a, 5.2; migration 0804). Só as duas raízes confirmadas. Cadastrar lê o nome no Drive; ativar exige a
 * verificação acima com resultado completo (o banco confere). A elaboração tem áreas fixas (só Contratos, 5.11.1).
 */
export function PastasRaiz({ raizes, areas, conectado }: { raizes: RaizGed[]; areas: Area[]; conectado: boolean }) {
  const [pendente, iniciar] = useTransition();
  const [editando, setEditando] = useState<Edicao | null>(null);
  const trava = useRef(criarTrava());
  const nomeArea = (c: string) => areas.find((a) => a.codigo === c)?.nome ?? c;
  const executar = (acao: () => Promise<{ ok: true } | { ok: false; erro: string }>, sucesso: string) =>
    iniciar(async () => void (await trava.current(async () => {
      const r = await acao();
      if (!r.ok) return void toast.error(r.erro);
      toast.success(sucesso);
      setEditando(null);
    })));

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Pastas-raiz do GED</CardTitle>
        <CardDescription>
          Cadastre as duas raízes confirmadas. Para ativar, verifique a pasta antes (Verificação das raízes candidatas, acima): a ativação
          só é aceita depois de uma verificação completa. A raiz de elaboração fica restrita à área Contratos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
      <Table interativa={false}>
        <TableHeader>
          <TableRow>
            <TableHead>Raiz</TableHead>
            <TableHead>Nome no Drive</TableHead>
            <TableHead>Áreas</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {RAIZES_CONFIRMADAS.map((drive) => {
            const { rotulo, finalidade } = RAIZES_CANDIDATAS[drive];
            const r = raizes.find((x) => x.finalidade === finalidade) ?? null; // uma raiz por finalidade (check da 0804)
            return (
              <TableRow key={drive}>
                <TableCell>{rotulo}</TableCell>
                <TableCell>{r?.nome ?? "—"}</TableCell>
                <TableCell>
                  {r ? (
                    <>
                      Dona: {nomeArea(r.area)} · Operação: {nomeArea(r.area_operacao)}
                      {r.areas_leitura.length > 0 && ` · Leitura: ${r.areas_leitura.map(nomeArea).join(", ")}`}
                    </>
                  ) : "—"}
                </TableCell>
                <TableCell>
                  {r ? <Badge variant={r.situacao === "ativa" ? "default" : "secondary"}>{ROTULO_SITUACAO_RAIZ[r.situacao]}</Badge> : "Não cadastrada"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {!r && (
                      <Button size="sm" variant="outline" disabled={pendente || !conectado} onClick={() => setEditando({ drive, raiz: null })}>
                        Cadastrar
                      </Button>
                    )}
                    {r && r.situacao !== "ativa" && (
                      <Button size="sm" disabled={pendente} onClick={() => executar(() => definirSituacaoRaizGed(r.id, "ativa"), "Raiz ativada.")}>
                        Ativar
                      </Button>
                    )}
                    {r?.situacao === "ativa" && (
                      <Button size="sm" variant="outline" disabled={pendente} onClick={() => executar(() => definirSituacaoRaizGed(r.id, "inativa"), "Raiz inativada.")}>
                        Inativar
                      </Button>
                    )}
                    {r && r.finalidade !== "elaboracao" && (
                      <Button size="sm" variant="ghost" disabled={pendente} onClick={() => setEditando({ drive, raiz: r })}>Áreas</Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {!conectado && <p className="text-muted-foreground">Para cadastrar, conecte o Drive antes: o nome da pasta é lido lá.</p>}

      {editando && (
        <DialogoAreas
          edicao={editando}
          areas={areas}
          pendente={pendente}
          fechar={() => setEditando(null)}
          salvar={(area, leitura, operacao) =>
            executar(
              () => (editando.raiz ? definirAreasRaizGed(editando.raiz.id, area, leitura, operacao) : cadastrarRaizGed(editando.drive, area, leitura, operacao)),
              editando.raiz ? "Áreas salvas." : "Raiz cadastrada (em verificação).",
            )}
        />
      )}
      </CardContent>
    </Card>
  );
}

/** Cadastro (as duas raízes) ou áreas do dossiê. Dossiê: escolha explícita, sem área pré-marcada (PENDENTE 2). */
function DialogoAreas({ edicao, areas, pendente, fechar, salvar }: {
  edicao: Edicao;
  areas: Area[];
  pendente: boolean;
  fechar: () => void;
  salvar: (area: string, leitura: string[], operacao: string) => void;
}) {
  const elaboracao = RAIZES_CANDIDATAS[edicao.drive].finalidade === "elaboracao";
  const [area, setArea] = useState(edicao.raiz?.area ?? "");
  const [operacao, setOperacao] = useState(edicao.raiz?.area_operacao ?? "");
  const [leitura, setLeitura] = useState<string[]>(edicao.raiz?.areas_leitura ?? []);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (elaboracao) return salvar("contratos", [], "contratos");
    salvar(area, leitura.filter((a) => a !== area), operacao);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !pendente) fechar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{edicao.raiz ? "Áreas da raiz" : "Cadastrar raiz"}</DialogTitle>
          <DialogDescription>{RAIZES_CANDIDATAS[edicao.drive].rotulo}</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-3 text-sm">
          {elaboracao ? (
            <p>Área dona e de operação: <strong>Contratos</strong>, sem outras áreas de leitura (fixo). Lê quem é operador em Contratos.</p>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="raiz-area">Área dona (lê)</Label>
                <select id="raiz-area" className={SELECT} value={area} required onChange={(e) => setArea(e.target.value)} disabled={pendente}>
                  <option value="">Escolha…</option>
                  {areas.map((a) => <option key={a.codigo} value={a.codigo}>{a.nome}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="raiz-operacao">Área de operação (classifica e vincula)</Label>
                <select id="raiz-operacao" className={SELECT} value={operacao} required onChange={(e) => setOperacao(e.target.value)} disabled={pendente}>
                  <option value="">Escolha…</option>
                  {areas.map((a) => <option key={a.codigo} value={a.codigo}>{a.nome}</option>)}
                </select>
              </div>
              <fieldset className="space-y-1">
                <legend className="font-medium">Outras áreas com leitura (opcional)</legend>
                {areas.filter((a) => a.codigo !== area).map((a) => (
                  <label key={a.codigo} className="flex items-center gap-2">
                    <Checkbox
                      checked={leitura.includes(a.codigo)}
                      disabled={pendente}
                      onCheckedChange={(v) => setLeitura((atual) => (v === true ? [...atual, a.codigo] : atual.filter((x) => x !== a.codigo)))}
                    />
                    {a.nome}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={fechar} disabled={pendente}>Voltar</Button>
            <Button type="submit" disabled={pendente || (!elaboracao && (!area || !operacao))}>
              {pendente ? "Salvando…" : edicao.raiz ? "Salvar áreas" : "Cadastrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
