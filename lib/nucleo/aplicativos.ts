// Aplicativos externos (super painel): regras puras do cadastro. Quem protege os dados é a RLS de `aplicativos`.
import type { Aplicativo, ModoAbrir } from "./tipos";

/** Ícones que o cadastro aceita (nomes fixos; o desenho fica em components/plataforma/icones.tsx). */
export const ICONES_APP = [
  "file-text", "hard-hat", "shield-check", "factory", "package", "truck", "wrench", "clipboard-list", "wallet", "calculator",
  "chart-column", "users",
] as const;
export type IconeApp = (typeof ICONES_APP)[number];

export const ROTULO_ICONE: Record<IconeApp, string> = {
  "file-text": "Documento", "hard-hat": "Capacete", "shield-check": "Escudo", factory: "Fábrica", package: "Caixa", truck: "Caminhão",
  wrench: "Chave", "clipboard-list": "Prancheta", wallet: "Carteira", calculator: "Calculadora", "chart-column": "Gráfico", users: "Pessoas",
};

export const MODOS_ABRIR: readonly ModoAbrir[] = ["embutido", "nova_aba"];
export const ROTULO_ABRIR: Record<ModoAbrir, string> = { embutido: "Embutido no painel", nova_aba: "Em nova aba" };

/** '/apps/vigilancia_fiscal' */
export function rotaDoAplicativo(codigo: string): string {
  return `/apps/${codigo}`;
}

export type EntradaAplicativo = {
  codigo: string; nome: string; descricao: string; area: string; url: string; abrir: string; icone: string; ordem: string; ativo: boolean;
};

export type AplicativoValidado = Omit<Aplicativo, "id">;

const CODIGO = /^[a-z0-9_]{2,40}$/;
const URL_SEGURA = /^https:\/\/\S+$/;

/** Confere o que vem do formulário. Devolve o registro pronto para gravar ou a primeira mensagem de erro. */
export function validarAplicativo(entrada: EntradaAplicativo, areasExistentes: readonly string[]):
  { ok: true; valor: AplicativoValidado } | { ok: false; erro: string } {
  const codigo = entrada.codigo.trim().toLowerCase();
  if (!CODIGO.test(codigo)) return { ok: false, erro: "O código deve ter de 2 a 40 caracteres: letras minúsculas, números ou _." };
  const nome = entrada.nome.trim();
  if (nome.length < 2 || nome.length > 80) return { ok: false, erro: "Informe o nome do aplicativo (2 a 80 caracteres)." };
  if (!areasExistentes.includes(entrada.area)) return { ok: false, erro: "Escolha a área do aplicativo." };
  const url = entrada.url.trim();
  if (!URL_SEGURA.test(url)) return { ok: false, erro: "O endereço deve começar com https:// e não pode ter espaços." };
  if (!MODOS_ABRIR.includes(entrada.abrir as ModoAbrir)) return { ok: false, erro: "Escolha como o aplicativo abre." };
  const icone = entrada.icone.trim();
  if (icone && !(ICONES_APP as readonly string[]).includes(icone)) return { ok: false, erro: "Ícone desconhecido." };
  const ordem = entrada.ordem.trim() === "" ? 0 : Number(entrada.ordem);
  if (!Number.isInteger(ordem) || ordem < 0 || ordem > 999) return { ok: false, erro: "A ordem deve ser um número inteiro de 0 a 999." };
  return {
    ok: true,
    valor: {
      codigo, nome, descricao: entrada.descricao.trim().slice(0, 300) || null, area: entrada.area, url,
      abrir: entrada.abrir as ModoAbrir, icone: icone || null, ordem, ativo: entrada.ativo,
    },
  };
}
