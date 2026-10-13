// Abas do Faturamento Filial, na ordem do trabalho (mesmo padrão da Cobrança): tudo começa na Remessa; depois implantar,
// boleto e envio ao cliente. A filial (usuário restrito) vê as etapas de Cuiabá pelo lado dela: "Em implantação" e
// "Boletos a receber" (Cuiabá anexa; ela recebe).
import { ROTA_FILIAL, type EstagioKit } from "./arquivos";

export type AbaFilial = { href: string; rotulo: string; estagio: EstagioKit | null; contar: boolean };

export function abasFilial(filial = false): AbaFilial[] {
  return [
    { href: `${ROTA_FILIAL}/remessas`, rotulo: "Remessas", estagio: null, contar: false },
    { href: `${ROTA_FILIAL}/a-implantar`, rotulo: filial ? "Em implantação" : "A implantar", estagio: "recebida", contar: true },
    { href: `${ROTA_FILIAL}/boletos-a-anexar`, rotulo: filial ? "Boletos a receber" : "Boletos a anexar", estagio: "implantada", contar: true },
    { href: `${ROTA_FILIAL}/a-enviar`, rotulo: "A enviar ao cliente", estagio: "pronta", contar: true },
    { href: `${ROTA_FILIAL}/enviadas`, rotulo: "Enviadas", estagio: "enviada", contar: false },
  ];
}

/** Para Cuiabá (as rotas e rótulos padrão). */
export const ABAS_FILIAL: readonly AbaFilial[] = abasFilial(false);

/** A tela abre na Remessa: é onde tudo começa (o envio da filial). */
export const ABA_INICIAL_FILIAL = `${ROTA_FILIAL}/remessas`;

type Etapa = "recebida" | "implantada" | "pronta" | "enviada";

/** O que fazer em cada etapa (frase do topo da aba), do ponto de vista de quem está vendo. */
export function explicacaoDaEtapa(etapa: Etapa, filial = false): string {
  if (etapa === "recebida") {
    return filial
      ? "Notas que você enviou e que Cuiabá ainda está implantando no Consistem. Quando o título aparecer, a nota passa sozinha para \"Boletos a receber\"."
      : "Notas enviadas pela filial que ainda não estão no Consistem. Implante pela remessa (relatório da CCFT040); a NF sai daqui sozinha quando o título aparecer.";
  }
  if (etapa === "implantada") {
    return filial
      ? "Notas já implantadas: Cuiabá está anexando os boletos. Quando o boleto chegar, a nota passa para \"A enviar ao cliente\"."
      : "NFs já no Consistem esperando o boleto (e a carta de cessão, quando o cliente pede). Com o boleto anexado, a NF passa para \"A enviar ao cliente\".";
  }
  if (etapa === "pronta") {
    return "Notas com o boleto pronto. Abra, crie o e-mail no seu Gmail com os anexos, envie e marque \"Enviado ao cliente\". Se faltar demonstrativo ou comodato, anexe antes.";
  }
  return "Kits já enviados ao cliente. Daqui em diante a cobrança segue a régua normal.";
}
