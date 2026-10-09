"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Check, ExternalLink, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { assumirPendencia, concluirPendencia, reatribuirPendencia, type Resultado } from "./acoes";

export type ItemFila = {
  id: string;
  titulo: string;
  descricao: string | null;
  moduloNome: string;
  criticidade: "critica" | "alta" | "normal";
  prazoTexto: string;
  atrasada: boolean;
  contraparte: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  link: string | null;
  podeConcluir: boolean;
  podeAssumir: boolean;
  /** preenchido só para gestor da área: quem pode receber a pendência */
  candidatos: { id: string; nome: string }[] | null;
};

const ROTULO_CRITICIDADE = { critica: "Crítica", alta: "Alta", normal: "Normal" } as const;

export function ItemPendencia({ item }: { item: ItemFila }) {
  const [pendente, iniciar] = useTransition();

  function executar(acao: () => Promise<Resultado>, sucesso: string) {
    iniciar(async () => {
      const r = await acao();
      if (r.ok) toast.success(sucesso);
      else toast.error(r.erro);
    });
  }

  return (
    <li className={cn("rounded-lg border bg-card p-3 sm:p-4", item.atrasada && "border-destructive/40")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{item.moduloNome}</Badge>
            {item.criticidade !== "normal" && (
              <Badge variant={item.criticidade === "critica" ? "destructive" : "secondary"}>{ROTULO_CRITICIDADE[item.criticidade]}</Badge>
            )}
            <span className={cn("text-xs", item.atrasada ? "font-medium text-destructive" : "text-muted-foreground")}>{item.prazoTexto}</span>
          </div>
          <p className="font-medium leading-snug">{item.titulo}</p>
          {item.descricao && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{item.descricao}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {item.contraparte ? `${item.contraparte} · ` : ""}
            {item.responsavelNome ? `Responsável: ${item.responsavelNome}` : "Sem responsável"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {item.candidatos && (
            <select
              aria-label="Reatribuir pendência"
              className="h-7 rounded-md border bg-background px-2 text-xs"
              value={item.responsavelId ?? ""}
              disabled={pendente}
              onChange={(e) => executar(() => reatribuirPendencia(item.id, e.target.value || null), "Pendência reatribuída.")}
            >
              <option value="">Sem responsável</option>
              {item.candidatos.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          )}
          {item.podeAssumir && (
            <Button size="sm" variant="outline" disabled={pendente} onClick={() => executar(() => assumirPendencia(item.id), "Pendência assumida.")}>
              <UserPlus /> Assumir
            </Button>
          )}
          {item.link && item.link.startsWith("/") && !item.link.startsWith("//") && (
            <Button size="sm" variant="outline" render={<Link href={item.link} />}>
              <ExternalLink /> Abrir
            </Button>
          )}
          {item.podeConcluir && (
            <Button size="sm" disabled={pendente} onClick={() => executar(() => concluirPendencia(item.id), "Pendência concluída.")}>
              <Check /> Concluir
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
