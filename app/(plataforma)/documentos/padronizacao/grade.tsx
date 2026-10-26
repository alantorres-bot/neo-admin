"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { criarTrava } from "@/lib/nucleo/ged/conexao-tela";
import { CONFIANCAS, SITUACOES_ANALISE, type Confianca, type SituacaoAnalise } from "@/lib/nucleo/ged/padronizacao";
import { analisarProximos, decidirAnalise } from "./acoes";

type Campo = { valor: string; evidencia: string[] } | null;
export type LinhaAnalise = {
  documento_id: string; situacao: SituacaoAnalise; tipo: string | null; tipo_nome: string | null; nome_atual: string; nome_sugerido: string | null;
  nome_final: string | null; confianca: Confianca | null; justificativa: string | null; erro: string | null; extensao: string;
  raiz: string; link: string | null; campos: { numero?: Campo; assunto?: Campo; cliente?: Campo; data?: Campo; cnpj?: Campo };
  historico: { em: string; acao: string; situacao: string | null; motivo: string | null }[];
};

const EVIDENCIA: Record<string, string> = { nome: "nome do arquivo", pasta: "pasta", texto: "conteúdo", cadastro: "cadastro" };
const corConfianca = (c: Confianca | null) => (c === "alta" ? "default" : c === "media" ? "secondary" : "outline");

export function BotaoAnalisar() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const trava = useRef(criarTrava());
  return (
    <Button disabled={pendente} onClick={() => iniciar(async () => void (await trava.current(async () => {
      const r = await analisarProximos();
      if (!r.ok) return void toast.error(r.erro);
      toast.success(r.mensagem ?? "Análise concluída.");
      router.refresh();
    })))}>
      {pendente ? "Analisando…" : "Analisar próximos 20"}
    </Button>
  );
}

/** Grade das análises: nome atual × sugerido, campos com evidência e as decisões (aprovar, editar, rejeitar). */
export function GradeAnalises({ linhas }: { linhas: LinhaAnalise[] }) {
  const [aberta, setAberta] = useState<string | null>(null);
  return (
    <Table className="cartoes">
      <TableHeader>
        <TableRow>
          <TableHead>Nome atual</TableHead>
          <TableHead>Nome sugerido</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Raiz</TableHead>
          <TableHead>Confiança</TableHead>
          <TableHead>Situação</TableHead>
          <TableHead>Detalhe</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map((l) => (
          <Fragment key={l.documento_id}>
            <TableRow>
              <TableCell className="max-w-72 break-words">{l.nome_atual}</TableCell>
              <TableCell className="max-w-96 break-words font-medium">{l.nome_final ?? l.nome_sugerido ?? "—"}</TableCell>
              <TableCell>{l.tipo_nome ?? "—"}</TableCell>
              <TableCell>{l.raiz}</TableCell>
              <TableCell>{l.confianca ? <Badge variant={corConfianca(l.confianca)}>{CONFIANCAS[l.confianca]}</Badge> : "—"}</TableCell>
              <TableCell>{SITUACOES_ANALISE[l.situacao]}</TableCell>
              <TableCell>
                <Button size="sm" variant="ghost" aria-expanded={aberta === l.documento_id} onClick={() => setAberta(aberta === l.documento_id ? null : l.documento_id)}>
                  {aberta === l.documento_id ? "Fechar" : "Abrir"}
                </Button>
              </TableCell>
            </TableRow>
            {aberta === l.documento_id && (
              <TableRow>
                <TableCell colSpan={7}><Detalhe linha={l} /></TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function Detalhe({ linha: l }: { linha: LinhaAnalise }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [nome, setNome] = useState(l.nome_final ?? l.nome_sugerido ?? "");
  const [motivo, setMotivo] = useState("");
  const trava = useRef(criarTrava());
  const decidir = (decisao: "aprovar" | "editar" | "rejeitar") => iniciar(async () => void (await trava.current(async () => {
    const r = await decidirAnalise(l.documento_id, decisao, nome, l.extensao, motivo);
    if (!r.ok) return void toast.error(r.erro);
    toast.success(decisao === "aprovar" ? "Nome aprovado." : decisao === "editar" ? "Nome editado e aprovado." : "Sugestão rejeitada.");
    router.refresh();
  })));
  const campos: [string, Campo | undefined][] = [["Número", l.campos.numero], ["Assunto", l.campos.assunto], ["Cliente", l.campos.cliente], ["Data", l.campos.data], ["CNPJ", l.campos.cnpj]];
  return (
    <div className="space-y-3 py-2 text-sm">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        {campos.map(([rotulo, c]) => (
          <Fragment key={rotulo}>
            <dt className="text-muted-foreground">{rotulo}</dt>
            <dd>{c ? `${c.valor} (pelo ${c.evidencia.map((e) => EVIDENCIA[e] ?? e).join(" e ")})` : "não identificado"}</dd>
          </Fragment>
        ))}
        <dt className="text-muted-foreground">Justificativa</dt>
        <dd>{l.justificativa ?? "—"}{l.erro ? ` (código: ${l.erro})` : ""}</dd>
        <dt className="text-muted-foreground">Arquivo</dt>
        <dd>{l.link ? <a href={l.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">Abrir no Drive <ExternalLink className="size-3.5" aria-hidden /></a> : "—"}</dd>
      </dl>
      <p className="text-muted-foreground">Aprovar só registra o nome no Neo Admin: nada é renomeado no Google Drive.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Button size="sm" disabled={pendente || !l.nome_sugerido} onClick={() => decidir("aprovar")}>Aprovar sugestão</Button>
        <div className="min-w-0 flex-1 space-y-1">
          <label className="text-muted-foreground" htmlFor={`nome-${l.documento_id}`}>Nome editado</label>
          <Input id={`nome-${l.documento_id}`} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={160} disabled={pendente} />
        </div>
        <Button size="sm" variant="outline" disabled={pendente || !nome.trim()} onClick={() => decidir("editar")}>Salvar nome editado</Button>
        <div className="min-w-0 flex-1 space-y-1">
          <label className="text-muted-foreground" htmlFor={`motivo-${l.documento_id}`}>Motivo da rejeição</label>
          <Input id={`motivo-${l.documento_id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} disabled={pendente} />
        </div>
        <Button size="sm" variant="destructive" disabled={pendente || !motivo.trim()} onClick={() => decidir("rejeitar")}>Rejeitar</Button>
      </div>
      {l.historico.length > 0 && (
        <div>
          <p className="font-medium">Histórico</p>
          <ul className="list-disc pl-5">
            {l.historico.map((h, i) => <li key={i}>{h.em}: {h.acao}{h.situacao ? ` → ${h.situacao}` : ""}{h.motivo ? ` (${h.motivo})` : ""}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
