"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const SITUACAO: Record<string, string> = { reservado: "Reservado", enviando: "Sem resposta — conferir no Consistem", lancado: "Lançado", erro: "Erro" };

export type LinhaConsistem = {
  chave: string; cod_fornecedor: string; nome: string; tipo?: string; portador: number | null; valor: number;
  lancamento: { id: string; situacao: string; cod: string | null; erro: string | null } | null;
};

/**
 * Títulos do mês no Consistem (folha e VT): o que falta lançar, o que já foi (código), erros e respostas incertas a resolver.
 * Uma linha sem portador/códigos nos Parâmetros trava o botão (a reserva no banco recusaria o lote inteiro).
 */
export function PainelConsistem({ id, linhas, ligado, parametrosHref, descricao, lancar, resolver, podeLancar }: {
  id: string; linhas: LinhaConsistem[]; ligado: boolean; parametrosHref: string; descricao: string; podeLancar: boolean;
  lancar: (id: string, esperado: { quantidade: number; totalCentavos: number; chaves: string[] }) => Promise<Resultado>;
  resolver: (idLancamento: string, cod: string, motivo: string) => Promise<Resultado>;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const [cod, setCod] = useState("");
  const [motivo, setMotivo] = useState("");
  // Desmarcadas (e não marcadas): o que volta a "erro" depois de um envio já entra marcado.
  const [fora, setFora] = useState<ReadonlySet<string>>(new Set());
  const rodar = (acao: () => Promise<Resultado>, sucesso: string, depois?: () => void) => iniciar(async () => {
    const r = await acao();
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso ?? sucesso);
    depois?.();
    router.refresh();
  });
  const lancavel = (l: LinhaConsistem) => l.valor > 0 && (!l.lancamento || l.lancamento.situacao === "erro");
  const aLancar = linhas.filter((l) => lancavel(l) && !fora.has(l.chave));
  const totalLancavel = linhas.filter(lancavel).length;
  const semCodigos = aLancar.filter((l) => l.portador === null);
  const totalCentavos = aLancar.reduce((s, l) => s + Math.round(l.valor * 100), 0);
  const comTipo = linhas.some((l) => l.tipo);
  const escolhe = ligado && podeLancar && totalLancavel > 0;
  const marcar = (chave: string, sim: boolean) => setFora((s) => { const n = new Set(s); if (sim) n.delete(chave); else n.add(chave); return n; });
  return (
    <div className="space-y-3">
      {!ligado ? (
        <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">
          O lançamento no Consistem está desligado. O gestor configura em <a href={parametrosHref} className="text-elo hover:underline">Parâmetros</a>.
        </p>
      ) : semCodigos.length > 0 ? (
        <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">
          {semCodigos.length} título(s) marcado(s) sem códigos ou portador nos <a href={parametrosHref} className="text-elo hover:underline">Parâmetros</a>. Complete ou desmarque antes de lançar.
        </p>
      ) : podeLancar && aLancar.length > 0 && (
        <Dialog open={confirmando} onOpenChange={setConfirmando}>
          <DialogTrigger render={<Button size="sm" />}><Upload /> Lançar {aLancar.length}{aLancar.length < totalLancavel ? ` de ${totalLancavel}` : ""} título(s) no Consistem</DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Lançar no Consistem</DialogTitle>
              <DialogDescription>{descricao} Cada título é enviado uma única vez.</DialogDescription>
            </DialogHeader>
            <p className="text-sm">{aLancar.length} título(s) · total <strong>{reais(totalCentavos / 100)}</strong></p>
            <div className="flex justify-end">
              <Button disabled={pendente} onClick={() => rodar(() => lancar(id, { quantidade: aLancar.length, totalCentavos, chaves: aLancar.map((l) => l.chave) }), "Títulos lançados.", () => setConfirmando(false))}>
                {pendente ? "Lançando…" : "Confirmar e lançar"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {escolhe && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {aLancar.length} de {totalLancavel} marcado(s) para lançar.
          <Button variant="ghost" size="sm" onClick={() => setFora(new Set())}>Marcar todos</Button>
          <Button variant="ghost" size="sm" onClick={() => setFora(new Set(linhas.filter(lancavel).map((l) => l.chave)))}>Desmarcar todos</Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {escolhe && <TableHead>Lançar</TableHead>}
            <TableHead>Nº</TableHead><TableHead>Funcionário</TableHead>{comTipo && <TableHead>Tipo</TableHead>}<TableHead>Portador</TableHead>
            <TableHead className="text-right">Valor</TableHead><TableHead>Situação</TableHead><TableHead>Código no Consistem</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.filter((l) => l.valor > 0 || l.lancamento).map((l) => (
            <TableRow key={l.chave}>
              {escolhe && (
                <TableCell>
                  {lancavel(l) && <input type="checkbox" checked={!fora.has(l.chave)} onChange={(e) => marcar(l.chave, e.target.checked)} aria-label={`Lançar ${l.nome}${l.tipo ? ` (${l.tipo})` : ""}`} className="size-4" />}
                </TableCell>
              )}
              <TableCell className="tabular-nums">{l.cod_fornecedor}</TableCell>
              <TableCell>{l.nome}</TableCell>
              {comTipo && <TableCell className="text-xs">{l.tipo}</TableCell>}
              <TableCell className={l.portador === null ? "text-destructive" : "tabular-nums"}>{l.portador ?? "Falta nos Parâmetros"}</TableCell>
              <TableCell className="text-right tabular-nums">{reais(l.valor)}</TableCell>
              <TableCell className={l.lancamento?.situacao === "erro" || l.lancamento?.situacao === "enviando" ? "text-destructive" : ""}>
                {l.lancamento ? SITUACAO[l.lancamento.situacao] : "A lançar"}{l.lancamento?.erro ? ` — ${l.lancamento.erro}` : ""}
              </TableCell>
              <TableCell className="tabular-nums">{l.lancamento?.cod ?? ""}</TableCell>
              <TableCell>
                {podeLancar && l.lancamento && (l.lancamento.situacao === "enviando" || l.lancamento.situacao === "reservado") && (
                  <Button variant="ghost" size="sm" onClick={() => { setResolvendo(l.lancamento!.id); setCod(""); setMotivo(""); }}>Resolver</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={!!resolvendo} onOpenChange={(v) => { if (!v) setResolvendo(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolver título sem resposta</DialogTitle>
            <DialogDescription>Confira no Consistem. Se o título foi criado, informe o código do lançamento; se não foi, deixe o código vazio.</DialogDescription>
          </DialogHeader>
          <Input value={cod} onChange={(e) => setCod(e.target.value)} inputMode="numeric" placeholder="Código do lançamento (vazio = não foi criado)" />
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="O que foi conferido" />
          <div className="flex justify-end">
            <Button disabled={pendente || motivo.trim().length < 3} onClick={() => rodar(() => resolver(resolvendo!, cod, motivo), "Título resolvido.", () => setResolvendo(null))}>Gravar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
