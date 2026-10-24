// GED — cliente HTTP da Drive API, só leitura (docs/modulos/administrativo-ged.md, 4.1 e 5.1).
// Qualquer método diferente de GET, ou endereço fora de www.googleapis.com/drive/v3, falha ANTES do fetch.
// O token nunca aparece em mensagem de erro. Quem chama (a Edge Function) obtém o token; aqui ele só entra no cabeçalho.

export const DRIVE_BASE = "https://www.googleapis.com/drive/v3/";

export class ErroDrive extends Error {
  constructor(mensagem: string, readonly status: number | null = null) {
    super(mensagem);
    this.name = "ErroDrive";
  }
}

type Fetch = (url: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<Response>;

export function criarClienteDrive(obterToken: () => Promise<string>, fazerFetch: Fetch = fetch) {
  async function requisitar(metodo: string, caminho: string, params: Record<string, string> = {}): Promise<unknown> {
    if (metodo.toUpperCase() !== "GET") throw new ErroDrive(`O GED só lê o Drive: o método ${metodo} foi recusado.`);
    const url = new URL(caminho, DRIVE_BASE);
    if (url.origin !== "https://www.googleapis.com" || !url.pathname.startsWith("/drive/v3/")) {
      throw new ErroDrive("O GED só acessa a Drive API v3.");
    }
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const token = await obterToken();
    const resposta = await fazerFetch(url.toString(), { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    if (!resposta.ok) {
      let motivo = "";
      try {
        const corpo = (await resposta.json()) as { error?: { status?: string; message?: string } };
        motivo = corpo.error?.status ?? corpo.error?.message ?? "";
      } catch {
        // corpo sem JSON: fica só o status HTTP
      }
      const mensagem = `Drive respondeu ${resposta.status}${motivo ? ` (${motivo})` : ""}.`;
      throw new ErroDrive(token ? mensagem.split(token).join("***") : mensagem, resposta.status);
    }
    return resposta.json();
  }

  return { requisitar, get: (caminho: string, params?: Record<string, string>) => requisitar("GET", caminho, params) };
}
