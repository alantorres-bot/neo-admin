// Central de Gestão > Atividades: leitura dos filtros da URL e textos do relatório (regras puras).
// Especificação: docs/modulos/administrativo-gestao.md, seção 5.9.
import { diferencaDias } from "../fila";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export type FiltrosAtividades = { pessoa: string | null; de: string; ate: string; acessos: boolean; ref: string | null; modulo: string | null };

/** Período padrão: os últimos 7 dias, hoje incluído. Período máximo: 366 dias. */
export const DIAS_PADRAO = 7;
export const DIAS_MAXIMO = 366;

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const data = (v: string | undefined) => (v && DATA.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined);

/**
 * Lê os filtros. Quem não acompanha a equipe vê só as próprias atividades (a pessoa pedida é ignorada; o banco também
 * barra). Datas invertidas são trocadas e o período é limitado a 366 dias.
 */
export function lerFiltrosAtividades(
  sp: Record<string, string | string[] | undefined>, hoje: string, eu: string, acompanha: boolean,
): FiltrosAtividades {
  const pessoaPedida = um(sp.pessoa);
  const pessoa = acompanha ? (pessoaPedida && UUID.test(pessoaPedida) ? pessoaPedida : null) : eu;
  let ate = data(um(sp.ate)) ?? hoje;
  let de = data(um(sp.de)) ?? somarDias(ate, -(DIAS_PADRAO - 1));
  if (de > ate) [de, ate] = [ate, de];
  if (diferencaDias(ate, de) > DIAS_MAXIMO - 1) de = somarDias(ate, -(DIAS_MAXIMO - 1));
  const ref = um(sp.ref);
  const modulo = um(sp.modulo);
  return {
    pessoa, de, ate,
    acessos: um(sp.acessos) !== "nao",
    ref: ref && UUID.test(ref) ? ref : null,
    modulo: modulo && /^[a-z_]+\.[a-z_-]+$/.test(modulo) ? modulo : null,
  };
}

export function hrefAtividades(f: FiltrosAtividades, mudancas: Partial<FiltrosAtividades> = {}, base = "/gestao/atividades"): string {
  const j = { ...f, ...mudancas };
  const p = new URLSearchParams();
  if (j.pessoa) p.set("pessoa", j.pessoa);
  p.set("de", j.de);
  p.set("ate", j.ate);
  if (!j.acessos) p.set("acessos", "nao");
  if (j.ref) p.set("ref", j.ref);
  if (j.modulo) p.set("modulo", j.modulo);
  return `${base}?${p.toString()}`;
}

/** Tempo médio até concluir: horas até 48 h; acima disso, dias com uma casa. */
export function descreverDuracao(horas: number | string | null): string {
  if (horas === null || horas === undefined) return "—";
  const h = Number(horas);
  if (!Number.isFinite(h)) return "—";
  if (h < 1) return "menos de 1 h";
  if (h <= 48) return `${Math.round(h)} h`;
  return `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
}

/** Os tipos de ação mais frequentes, em texto: "Confirmou pagamento: 12 · Anexou boleto: 5". */
export function resumirTipos(porTipo: Record<string, number>, nomes: ReadonlyMap<string, string>, limite = 4): string {
  const itens = Object.entries(porTipo).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (itens.length === 0) return "—";
  const visiveis = itens.slice(0, limite).map(([c, n]) => `${nomes.get(c) ?? c}: ${n}`);
  if (itens.length > limite) visiveis.push(`+${itens.length - limite} tipos`);
  return visiveis.join(" · ");
}
