"use client";

// Pendências do aplicativo na Central de Gestão (docs/modulos/administrativo-gestao-aplicativos.md): ligar a leitura,
// endereço da função neo-admin-pendencias do aplicativo, nome do segredo e responsável padrão por tipo.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListChecks, RefreshCw } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lerPendenciasAgora, salvarPendenciasApp } from "./acoes";

const SELECAO = "h-8 rounded-lg border bg-background px-2 text-sm";

export type ConfigPendencias = {
  id: string; codigo: string; nome: string; ligado: boolean; url: string; segredo: string; responsaveis: Record<string, string>;
  /** Tipos da última leitura com sucesso (para escolher os responsáveis). */
  tipos: { codigo: string; titulo: string; quantidade: number }[];
  ultima: { em: string; ok: boolean; erro: string | null } | null;
};

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function DialogoPendencias({ cfg, pessoas }: { cfg: ConfigPendencias; pessoas: { id: string; nome: string }[] }) {
  // Tipos já configurados que não vieram na última leitura continuam na lista (para poder tirar o responsável).
  const tipos = [...cfg.tipos, ...Object.keys(cfg.responsaveis).filter((c) => !cfg.tipos.some((t) => t.codigo === c)).map((c) => ({ codigo: c, titulo: c, quantidade: 0 }))];
  return (
    <DialogoFormulario
      titulo={`Pendências do ${cfg.nome} na Central`}
      descricao="Um resumo por tipo entra na Central de Gestão e é atualizado a cada 30 minutos. Só contagens e datas atravessam os sistemas."
      botao={<><ListChecks /> Pendências</>}
      variante="ghost"
      tamanho="sm"
      mensagemSucesso="Configuração salva."
      acao={salvarPendenciasApp}
    >
      <input type="hidden" name="id" value={cfg.id} />
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" name="ligado" defaultChecked={cfg.ligado} className="mt-0.5 size-4" />
        <span>Trazer as pendências para a Central
          <span className="block text-xs font-normal text-muted-foreground">Desligado, o botão &quot;Ler agora&quot; só testa a leitura e mostra os tipos, sem publicar.</span>
        </span>
      </label>
      <Campo id={`pend-url-${cfg.id}`} rotulo="Endereço da função do aplicativo" dica="https://<projeto>.supabase.co/functions/v1/neo-admin-pendencias">
        <Input id={`pend-url-${cfg.id}`} name="url" type="url" defaultValue={cfg.url} placeholder="https://..." inputMode="url" />
      </Campo>
      <Campo id={`pend-seg-${cfg.id}`} rotulo="Nome do segredo (Edge Functions do Neo Admin)" dica="Só o nome; o valor fica nos segredos do Supabase, igual ao NEO_ADMIN_SEGREDO do aplicativo.">
        <Input id={`pend-seg-${cfg.id}`} name="segredo" defaultValue={cfg.segredo} placeholder="NEOCONTROL_SEGREDO" />
      </Campo>
      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="px-1 text-xs text-muted-foreground">Responsável padrão por tipo</legend>
        {tipos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Os tipos aparecem depois da primeira leitura (botão &quot;Ler agora&quot; na lista).</p>
        ) : tipos.map((t) => (
          <label key={t.codigo} className="grid gap-1 text-sm sm:grid-cols-[1fr_14rem] sm:items-center">
            <span>{t.titulo} <span className="text-xs text-muted-foreground">({t.quantidade} hoje)</span></span>
            <select name={`resp_${t.codigo}`} defaultValue={cfg.responsaveis[t.codigo] ?? ""} className={SELECAO}>
              <option value="">Sem responsável (precisa distribuir)</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">Vale para a pendência que nascer sem responsável; quem o gestor já atribuiu na Central continua com ela.</p>
      </fieldset>
    </DialogoFormulario>
  );
}

export function LerAgora({ codigo, ultima }: { codigo: string; ultima: ConfigPendencias["ultima"] }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant="outline" disabled={pendente} onClick={() => iniciar(async () => {
        const r = await lerPendenciasAgora(codigo);
        if (r.ok) toast.success(r.aviso); else toast.error(r.erro);
        router.refresh();
      })}>
        <RefreshCw /> {pendente ? "Lendo…" : "Ler agora"}
      </Button>
      {ultima && (
        <span className={`text-xs ${ultima.ok ? "text-muted-foreground" : "text-destructive"}`} title={ultima.erro ?? undefined}>
          {ultima.ok ? "Última leitura" : "Falhou"} em {dataHora(ultima.em)}{!ultima.ok && ultima.erro ? `: ${ultima.erro}` : ""}
        </span>
      )}
    </div>
  );
}
