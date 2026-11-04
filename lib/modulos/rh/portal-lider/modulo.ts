// RH/SST > Portal do Líder: o líder (login Google, só o seu setor) vê a equipe e faz pedidos ao RH. Ver docs/modulos/rh-portal-lider.md.
// Regras de formulário e avisos. Nenhuma regra trabalhista é calculada aqui (saldo de férias, dobra, prazos legais): o RH responde no pedido.
import { z } from "zod";
import { formatarData } from "@/lib/nucleo/fila";

export const MODULO_PORTAL_LIDER = "rh.portal_lider";
/** Tela do líder (dentro da plataforma, exige login). */
export const ROTA_PORTAL_LIDER = "/lider";
/** Tela do RH que atende os pedidos. */
export const ROTA_PEDIDOS_RH = "/rh/portal_lider";

export const TIPOS = ["ferias", "funcao", "desligamento", "atestado", "contratacao"] as const;
export type Tipo = (typeof TIPOS)[number];
export const ROTULO_TIPO: Record<Tipo, string> = {
  ferias: "Férias", funcao: "Alteração de função/salário", desligamento: "Desligamento", atestado: "Atestado", contratacao: "Contratação",
};

export const STATUS = ["enviada", "em_andamento", "concluida", "recusada", "cancelada"] as const;
export type Status = (typeof STATUS)[number];
export const ROTULO_STATUS: Record<Status, string> = {
  enviada: "Enviado ao RH", em_andamento: "Em andamento", concluida: "Concluído", recusada: "Recusado", cancelada: "Cancelado",
};

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const texto = (min = 1, max = 500) => z.string().trim().min(min, "Preencha este campo.").max(max);
const opcional = z.string().trim().max(500).optional().transform((v) => v || undefined);
const valor = z.coerce.number().positive("Informe um valor maior que zero.").max(1_000_000);

export const ESQUEMAS = {
  ferias: z.object({ inicio: data, dias: z.coerce.number().int().min(1).max(30), abono: z.boolean(), observacao: opcional }),
  funcao: z.object({ funcao_nova: texto(2, 120), salario_proposto: valor.optional(), vigencia: data, exame: z.boolean(), motivo: texto(5) }),
  desligamento: z.object({
    iniciativa: z.enum(["empregado", "empresa"]), aviso: z.enum(["trabalhado", "indenizado", "dispensado"]), data, motivo: texto(5),
  }),
  atestado: z.object({ inicio: data, fim: data, observacao: opcional }).refine((d) => d.fim >= d.inicio, { message: "O fim não pode ser antes do início.", path: ["fim"] }),
  contratacao: z.object({ nome: texto(3, 120), cargo: texto(2, 120), salario: valor, beneficios: opcional, contato: opcional, data_prevista: data }),
} satisfies Record<Tipo, z.ZodType>;

export type Dados<T extends Tipo> = z.infer<(typeof ESQUEMAS)[T]>;

const ROTULO_AVISO = { trabalhado: "trabalhado", indenizado: "indenizado", dispensado: "dispensado do cumprimento" } as const;
const sn = (b: unknown) => (b ? "Sim" : "Não");
const reais = (v: unknown) => (v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** O pedido em linhas "rótulo: valor", para o líder e para o RH. `dados` vem do banco (jsonb), por isso é tratado como solto. */
export function linhasDoPedido(tipo: Tipo, d: Record<string, unknown>): [string, string][] {
  const t = (v: unknown) => (v == null || v === "" ? "—" : String(v));
  const dt = (v: unknown) => (typeof v === "string" ? formatarData(v) : "—");
  switch (tipo) {
    case "ferias": return [["Início", dt(d.inicio)], ["Dias de gozo", t(d.dias)], ["Vende 10 dias", sn(d.abono)], ["Observação", t(d.observacao)]];
    case "funcao": return [["Função nova", t(d.funcao_nova)], ["Salário proposto", reais(d.salario_proposto)], ["Vigência", dt(d.vigencia)], ["Precisa de exame", sn(d.exame)], ["Motivo", t(d.motivo)]];
    case "desligamento": return [
      ["Iniciativa", d.iniciativa === "empregado" ? "Pedido de demissão (empregado)" : "Dispensa (empresa)"],
      ["Aviso prévio", ROTULO_AVISO[d.aviso as keyof typeof ROTULO_AVISO] ?? t(d.aviso)], ["Data", dt(d.data)], ["Motivo", t(d.motivo)],
    ];
    case "atestado": return [["Início", dt(d.inicio)], ["Fim", dt(d.fim)], ["Observação", t(d.observacao)]];
    case "contratacao": return [["Nome", t(d.nome)], ["Cargo", t(d.cargo)], ["Salário", reais(d.salario)], ["Benefícios", t(d.beneficios)], ["Contato", t(d.contato)], ["Início previsto", dt(d.data_prevista)]];
  }
}

const somarDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Avisos ao líder (não bloqueiam). Só o que o RH já pede hoje por e-mail. */
export function avisosDoPedido(tipo: Tipo, d: Record<string, unknown>, hoje: string): string[] {
  const avisos: string[] = [];
  if (tipo === "ferias" && typeof d.inicio === "string" && d.inicio < somarDias(hoje, 30)) {
    avisos.push("Menos de 30 dias até o início: o RH precisa de 30 dias de antecedência para o aviso e o pagamento das férias.");
  }
  if (tipo === "funcao" && typeof d.vigencia === "string" && !d.vigencia.endsWith("-01")) {
    avisos.push("Vigência no meio do mês: o salário do mês fica proporcional (quebrado) na folha. Se possível, use o dia 1º.");
  }
  if ((tipo === "desligamento" || tipo === "atestado") && typeof (d.data ?? d.inicio) === "string" && String(d.data ?? d.inicio) < hoje) {
    avisos.push("Data no passado: confira se está certa.");
  }
  return avisos;
}
