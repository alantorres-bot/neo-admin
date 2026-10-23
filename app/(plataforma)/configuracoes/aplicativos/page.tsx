import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTULO_ABRIR, rotaDoAplicativo } from "@/lib/nucleo/aplicativos";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import type { Aplicativo } from "@/lib/nucleo/tipos";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { DialogoAplicativo } from "./form-aplicativo";
import { DialogoPendencias, LerAgora, type ConfigPendencias } from "./pendencias-aplicativo";

export const metadata: Metadata = { title: "Aplicativos" };

export default async function PaginaAplicativos() {
  const sessao = await exigirAdminGeral();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("aplicativos")
    .select("id, codigo, nome, descricao, area, url, abrir, icone, ordem, ativo, pendencias_ligado, pendencias_url, pendencias_modulo, pendencias_segredo, pendencias_responsaveis")
    .order("ativo", { ascending: false })
    .order("area")
    .order("ordem")
    .order("nome");
  if (error) throw new Error(`Falha ao ler os aplicativos: ${error.message}`);
  const aplicativos = (data ?? []) as (Aplicativo & ColunasPendencias)[];
  const nomeDaArea = new Map(sessao.areas.map((a) => [a.codigo, a.nome]));
  const pendencias = await lerConfigPendencias(supabase, aplicativos.filter((a) => a.pendencias_modulo));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Sistemas de outras áreas que aparecem no menu e no Início do painel (Vigilância Fiscal, NEOControl, apps de Produção…).
          Cada um continua separado, com o próprio login; aqui fica só o cadastro. Quem tem acesso à área escolhida vê o aplicativo.
        </p>
        <DialogoAplicativo areas={sessao.areas} />
      </div>

      {aplicativos.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum aplicativo cadastrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Área</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead>Abre</TableHead>
                <TableHead className="text-right">Ordem</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Pendências na Central</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {aplicativos.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={rotaDoAplicativo(a.codigo)} className="font-medium text-elo underline-offset-2 hover:underline">{a.nome}</Link>
                    <div className="text-xs text-muted-foreground">/apps/{a.codigo}</div>
                  </TableCell>
                  <TableCell>{nomeDaArea.get(a.area) ?? a.area}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs" title={a.url}>{a.url}</TableCell>
                  <TableCell>{ROTULO_ABRIR[a.abrir]}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.ordem}</TableCell>
                  <TableCell>{a.ativo ? <Badge variant="secondary">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}</TableCell>
                  <TableCell>
                    {pendencias.has(a.id) ? (
                      <div className="flex flex-wrap items-start gap-2">
                        {a.pendencias_ligado ? <Badge variant="secondary">Ligada</Badge> : <Badge variant="outline">Desligada</Badge>}
                        <LerAgora codigo={a.codigo} ultima={pendencias.get(a.id)!.cfg.ultima} />
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <DialogoAplicativo aplicativo={a} areas={sessao.areas} />
                    {pendencias.has(a.id) && <DialogoPendencias cfg={pendencias.get(a.id)!.cfg} pessoas={pendencias.get(a.id)!.pessoas} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

type ColunasPendencias = {
  pendencias_ligado: boolean; pendencias_url: string | null; pendencias_modulo: string | null; pendencias_segredo: string | null;
  pendencias_responsaveis: Record<string, string> | null;
};

/** Configuração da leitura, última rodada (e os tipos da última com sucesso) e quem pode ser responsável (área do app). */
async function lerConfigPendencias(supabase: Awaited<ReturnType<typeof criarClienteServidor>>, apps: (Aplicativo & ColunasPendencias)[]) {
  const mapa = new Map<string, { cfg: ConfigPendencias; pessoas: { id: string; nome: string }[] }>();
  await Promise.all(apps.map(async (a) => {
    const [rodadas, pessoas] = await Promise.all([
      supabase.from("apps_pendencias_rodadas").select("iniciado_em, ok, erro, tipos").eq("aplicativo_id", a.id).order("iniciado_em", { ascending: false }).limit(20),
      supabase.rpc("usuarios_da_area", { p_area: a.area }),
    ]);
    const lista = (rodadas.data ?? []) as { iniciado_em: string; ok: boolean; erro: string | null; tipos: ConfigPendencias["tipos"] }[];
    const ultima = lista[0] ?? null;
    mapa.set(a.id, {
      cfg: {
        id: a.id, codigo: a.codigo, nome: a.nome, ligado: a.pendencias_ligado, url: a.pendencias_url ?? "", segredo: a.pendencias_segredo ?? "",
        responsaveis: a.pendencias_responsaveis ?? {}, tipos: lista.find((r) => r.ok)?.tipos ?? [],
        ultima: ultima && { em: ultima.iniciado_em, ok: ultima.ok, erro: ultima.erro },
      },
      pessoas: ((pessoas.data ?? []) as { id: string; nome: string }[]).map((p) => ({ id: p.id, nome: p.nome })),
    });
  }));
  return mapa;
}