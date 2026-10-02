import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FUSO, descreverPrazo, estaAtrasada, hojeEmCuiaba, ordenarFila } from "@/lib/nucleo/fila";
import { areasComNivel, modulosComNivel, nivelAtinge, nivelNaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import type { Criticidade } from "@/lib/nucleo/tipos";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ItemPendencia, type ItemFila } from "./item-pendencia";

export const metadata: Metadata = { title: "Início" };

type LinhaPendencia = {
  id: string; modulo: string; titulo: string; descricao: string | null; prazo: string | null;
  criticidade: Criticidade; status: string; responsavel_id: string | null; link: string | null; criado_em: string;
  contraparte: { nome: string } | null;
  responsavel: { nome: string } | null;
};

const CAMPOS =
  "id, modulo, titulo, descricao, prazo, criticidade, status, responsavel_id, link, criado_em, " +
  "contraparte:contrapartes(nome), responsavel:perfis!pendencias_responsavel_id_fkey(nome)";

const aspas = (codigos: string[]) => codigos.map((c) => `"${c}"`).join(",");

export default async function PaginaInicio({ searchParams }: PageProps<"/inicio">) {
  const sessao = await exigirSessao();
  const { visao } = await searchParams;
  const supabase = await criarClienteServidor();

  const areasGestor = areasComNivel(sessao.acesso, sessao.areas, "gestor");
  const ehGestor = areasGestor.length > 0;
  const modo: "minha" | "equipe" = visao === "equipe" && ehGestor ? "equipe" : "minha";

  const modulosOperador = modulosComNivel(sessao.acesso, sessao.modulos, "operador");
  const modulosGestor = modulosComNivel(sessao.acesso, sessao.modulos, "gestor");

  let consulta = supabase.from("pendencias").select(CAMPOS).in("status", ["aberta", "em_andamento"]).limit(500);
  if (modo === "equipe") {
    consulta = consulta.in("modulo", modulosGestor);
  } else {
    // Minhas + as sem responsável nas áreas em que sou operador ou acima.
    const condicoes = [`responsavel_id.eq.${sessao.userId}`];
    if (modulosOperador.length > 0) condicoes.push(`and(responsavel_id.is.null,modulo.in.(${aspas(modulosOperador)}))`);
    consulta = consulta.or(condicoes.join(","));
  }

  const [pendencias, candidatosPorArea] = await Promise.all([
    consulta,
    // Gestor reatribui: busca quem pode receber pendência em cada área que ele gerencia.
    Promise.all(
      areasGestor.map(async (area) => {
        const r = await supabase.rpc("usuarios_da_area", { p_area: area });
        return [area, (r.data ?? []) as { id: string; nome: string }[]] as const;
      }),
    ),
  ]);
  if (pendencias.error) throw new Error(`Falha ao ler as pendências: ${pendencias.error.message}`);

  const candidatos = new Map(candidatosPorArea);
  const moduloPorCodigo = new Map(sessao.modulos.map((m) => [m.codigo, m]));
  const hoje = hojeEmCuiaba();
  const linhas = ordenarFila((pendencias.data ?? []) as unknown as LinhaPendencia[], hoje);

  const itens: ItemFila[] = linhas.map((p) => {
    const modulo = moduloPorCodigo.get(p.modulo);
    const area = modulo?.area ?? "";
    const nivel = nivelNaArea(sessao.acesso, area);
    const gestor = nivelAtinge(nivel, "gestor");
    const operador = nivelAtinge(nivel, "operador");
    const minha = p.responsavel_id === sessao.userId;
    return {
      id: p.id,
      titulo: p.titulo,
      descricao: p.descricao,
      moduloNome: modulo?.nome ?? p.modulo,
      criticidade: p.criticidade,
      prazoTexto: descreverPrazo(p.prazo, hoje),
      atrasada: estaAtrasada(p.prazo, hoje),
      contraparte: p.contraparte?.nome ?? null,
      responsavelId: p.responsavel_id,
      responsavelNome: p.responsavel?.nome ?? null,
      link: p.link,
      podeConcluir: gestor || (operador && (minha || p.responsavel_id === null)),
      podeAssumir: operador && p.responsavel_id === null,
      candidatos: gestor ? (candidatos.get(area) ?? []) : null,
    };
  });

  const atrasadas = linhas.filter((p) => estaAtrasada(p.prazo, hoje)).length;
  const venceHoje = linhas.filter((p) => p.prazo === hoje).length;
  const dataExtenso = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fila do dia</h1>
          <p className="text-sm capitalize text-muted-foreground">{dataExtenso}</p>
        </div>
        {ehGestor && (
          <nav aria-label="Visão da fila" className="flex gap-1 rounded-lg border p-0.5">
            <Button size="sm" variant={modo === "minha" ? "secondary" : "ghost"} render={<Link href="/inicio" />}>Minha fila</Button>
            <Button size="sm" variant={modo === "equipe" ? "secondary" : "ghost"} render={<Link href="/inicio?visao=equipe" />}>Minha equipe</Button>
          </nav>
        )}
      </header>

      <dl className="grid grid-cols-3 gap-3 text-center">
        {[
          ["Em aberto", linhas.length, ""],
          ["Atrasadas", atrasadas, atrasadas > 0 ? "text-destructive" : ""],
          ["Vencem hoje", venceHoje, ""],
        ].map(([rotulo, valor, cor]) => (
          <div key={rotulo as string} className="rounded-lg border bg-card p-3">
            <dd className={`text-2xl font-semibold ${cor}`}>{valor}</dd>
            <dt className="text-xs text-muted-foreground">{rotulo}</dt>
          </div>
        ))}
      </dl>

      {itens.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">Nada pendente por aqui.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {modo === "equipe"
              ? "Não há pendências abertas nas áreas em que você é gestor."
              : "As pendências dos módulos em que você atua aparecem nesta lista."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {itens.map((item) => (
            <ItemPendencia key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
