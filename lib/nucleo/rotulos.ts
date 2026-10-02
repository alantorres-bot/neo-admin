import type { Canal, TipoContraparte } from "./tipos";

export const ROTULO_TIPO_CONTRAPARTE: Record<TipoContraparte, string> = {
  cliente: "Cliente",
  fornecedor: "Fornecedor",
  orgao_publico: "Órgão público",
  tribunal: "Tribunal",
  escritorio: "Escritório",
  banco: "Banco",
  colaborador: "Colaborador",
  outro: "Outro",
};

export const TIPOS_CONTRAPARTE = Object.keys(ROTULO_TIPO_CONTRAPARTE) as TipoContraparte[];

export const ROTULO_CANAL: Record<Canal, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  telefone: "Telefone",
  interno: "Interno",
};

/** Canais que fazem sentido como preferência de contato. */
export const CANAIS_DE_CONTATO: Canal[] = ["email", "whatsapp", "telefone"];
