import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { linkDoDrive } from "@/lib/nucleo/ged/busca";
import { formatarDataHora } from "@/lib/nucleo/fila";
import {
  CONFIANCAS, LIMITE_LISTA, lerFiltros, padraoCliente, SITUACOES_ANALISE, type SituacaoAnalise,
} from "@/lib/nucleo/ged/padronizacao";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotaoAnalisar, GradeAnalises, type LinhaAnalise } from "./grade";

export const metadata: Metadata = { title: "Padronização de nomes" };

const SELECT = "h-9 rounded-md border bg-background px-2 text-sm";
const RAIZES = { dossie_cliente: "Dossiê de clientes", elaboracao: "Elaboração" } as const;
type Registro = Omit<LinhaAnalise, "tipo_nome" | "raiz" | "link" | "historico" | "extensao"> & {
  documento: { extensao: string; web_link: string | null; raiz: { finalidade: keyof typeof RAIZES } | null } | null;
};

/**
 * Padronização de nomes do GED (especificação 5.12): sugestões de nome por análise do arquivo (sem IA externa) para o admin aprovar,
 * editar ou rejeitar. Só o admin geral (a página recusa os demais e a RLS também). Nada é renomeado no Google Drive.
 */
export default async function PaginaPadronizacao({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await exigirAdminGeral();
  const supabase = await criarClienteServidor();
  const { data: tiposDados } = await supabase.from("ged_tipos").select("codigo, nome").eq("ativo", true).order("ordem");
  const tipos = (tiposDados ?? []) as { codigo: string; nome: string }[];
  const f = lerFiltros(await searchParams, tipos.map((t) => t.codigo));

  let consulta = supabase.from("ged_analises")
    .select("documento_id, situacao, tipo, nome_atual, nome_sugerido, nome_final, confianca, justificativa, erro, campos, documento:ged_documentos!inner(extensao, web_link, raiz:ged_pastas_raiz!inner(finalidade))")
    .order("analisada_em", { ascending: false })
    .limit(LIMITE_LISTA);
  if (f.finalidade) consulta = consulta.eq("documento.raiz.finalidade", f.finalidade);
  if (f.tipo) consulta = consulta.eq("tipo", f.tipo);
  if (f.situacao) consulta = consulta.eq("situacao", f.situacao);
  if (f.confianca) consulta = consulta.eq("confianca", f.confianca);
  const pc = padraoCliente(f.cliente);
  if (pc) consulta = consulta.ilike("campos->cliente->>valor", pc);
  const { data, error } = await consulta;
  const registros = (data ?? []) as unknown as Registro[];

  const ids = registros.map((r) => r.documento_id);
  const { data: hist } = ids.length
    ? await supabase.from("auditoria").select("registro_id, acao, depois, em").eq("tabela", "ged_analises").in("registro_id", ids).order("em")
    : { data: [] };
  const nomeTipo = new Map(tipos.map((t) => [t.codigo, t.nome]));
  const linhas: LinhaAnalise[] = registros.map((r) => ({
    ...r,
    tipo_nome: r.tipo ? nomeTipo.get(r.tipo) ?? r.tipo : null,
    extensao: r.documento?.extensao ?? "",
    raiz: r.documento?.raiz ? RAIZES[r.documento.raiz.finalidade] ?? "—" : "—",
    link: linkDoDrive(r.documento?.web_link),
    historico: (hist ?? []).filter((h) => h.registro_id === r.documento_id).map((h) => {
      const depois = (h.depois ?? {}) as { situacao?: string; motivo?: string };
      return { em: formatarDataHora(h.em), acao: h.acao, situacao: depois.situacao ? SITUACOES_ANALISE[depois.situacao as SituacaoAnalise] ?? depois.situacao : null, motivo: depois.motivo ?? null };
    }),
  }));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/documentos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Central de Documentos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Padronização de nomes</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          O GED lê o arquivo (PDF com texto, DOCX, XLSX e XML de nota) dentro do próprio Neo Admin, identifica tipo, número, cliente e data e
          sugere um nome no padrão <code>TIPO - Número - Assunto - Cliente - AAAA-MM-DD</code>. Campo sem evidência fica de fora. Aprovar
          só registra o nome: nada é renomeado no Google Drive.
        </p>
      </div>
      <BotaoAnalisar />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="pad-raiz">Raiz</Label>
          <select id="pad-raiz" name="raiz" defaultValue={f.finalidade ?? ""} className={SELECT}>
            <option value="">Todas</option>
            {Object.entries(RAIZES).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pad-tipo">Tipo</Label>
          <select id="pad-tipo" name="tipo" defaultValue={f.tipo ?? ""} className={SELECT}>
            <option value="">Todos</option>
            {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pad-cliente">Cliente</Label>
          <Input id="pad-cliente" name="cliente" defaultValue={f.cliente} maxLength={80} placeholder="parte do nome" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pad-situacao">Situação</Label>
          <select id="pad-situacao" name="situacao" defaultValue={f.situacao ?? ""} className={SELECT}>
            <option value="">Todas</option>
            {Object.entries(SITUACOES_ANALISE).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pad-confianca">Confiança</Label>
          <select id="pad-confianca" name="confianca" defaultValue={f.confianca ?? ""} className={SELECT}>
            <option value="">Todas</option>
            {Object.entries(CONFIANCAS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>
        <Button type="submit" variant="outline">Filtrar</Button>
      </form>

      {error && <p role="alert" className="text-sm text-destructive">Não foi possível carregar as análises.</p>}
      <p role="status" className="text-sm text-muted-foreground">
        {linhas.length === 0 ? "Nenhuma análise com esses filtros." : `${linhas.length} análise(s)${linhas.length === LIMITE_LISTA ? ` (as ${LIMITE_LISTA} mais recentes)` : ""}.`}
      </p>
      {linhas.length > 0 && <GradeAnalises linhas={linhas} />}
    </div>
  );
}
