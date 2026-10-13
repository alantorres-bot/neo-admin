// Abas do Faturamento Filial, na ordem do trabalho (mesmo padrão da Cobrança): a tela abre na primeira etapa com pendência.
import { ROTA_FILIAL, type EstagioKit } from "./arquivos";

export type AbaFilial = { href: string; rotulo: string; estagio: EstagioKit | null; contar: boolean };

export const ABAS_FILIAL: readonly AbaFilial[] = [
  { href: `${ROTA_FILIAL}/a-implantar`, rotulo: "A implantar", estagio: "recebida", contar: true },
  { href: `${ROTA_FILIAL}/boletos-a-anexar`, rotulo: "Boletos a anexar", estagio: "implantada", contar: true },
  { href: `${ROTA_FILIAL}/a-enviar`, rotulo: "A enviar ao cliente", estagio: "pronta", contar: true },
  { href: `${ROTA_FILIAL}/enviadas`, rotulo: "Enviadas", estagio: "enviada", contar: false },
  { href: `${ROTA_FILIAL}/remessas`, rotulo: "Remessas", estagio: null, contar: false },
];

/** Primeira etapa com kits pendentes; sem nada pendente, "A enviar ao cliente" (a última etapa de trabalho). */
export function abaInicialDaFilial(contagens: Partial<Record<EstagioKit, number>>): string {
  return ABAS_FILIAL.find((a) => a.contar && a.estagio && (contagens[a.estagio] ?? 0) > 0)?.href ?? ABAS_FILIAL[2].href;
}

/** O que fazer em cada etapa (frase do topo da aba). */
export const EXPLICACAO_ETAPA: Record<"recebida" | "implantada" | "pronta" | "enviada", string> = {
  recebida: "Notas enviadas pela filial que ainda não estão no Consistem. Implante pela remessa (relatório da CCFT040); a NF sai daqui sozinha quando o título aparecer.",
  implantada: "NFs já no Consistem esperando o boleto (e a carta de cessão, quando o cliente pede). Com o boleto anexado, a NF passa para \"A enviar ao cliente\".",
  pronta: "Notas com o boleto pronto. Abra, crie o e-mail no seu Gmail com os anexos, envie e marque \"Enviado ao cliente\". Se faltar demonstrativo ou comodato, anexe antes.",
  enviada: "Kits já enviados ao cliente. Daqui em diante a cobrança segue a régua normal.",
};
