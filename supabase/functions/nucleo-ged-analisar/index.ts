// Edge Function do núcleo: padronização de nomes do GED (especificação 5.12; migration 0811). Só liga as peças: a lógica, testada
// no Vitest, está em _shared/ged.ts (tratarAnalise, analisarDocumento, montarNomePadrao, extrairTexto).
//
//  POST (Authorization: Bearer <JWT do admin geral>)  { "limite": 1..20 }  ou  { "documentos": [ids, até 20] }
//   -> { analisados, sugerida, sem_texto, nao_suportado, erro, pendentes }
// Baixa o conteúdo (GET alt=media, até 15 MB) só de PDF, DOCX, XLSX e XML; extrai o texto AQUI (sem serviço externo), sugere o nome e
// grava só os campos derivados (o texto não é gravado nem vai a log). Não renomeia nada no Drive e não toca na indexação.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getDocumentProxy } from "npm:unpdf@1.8.1";
import JSZip from "npm:jszip@3.10.2";
import { criarExtratores, tratarAnalise, type ClienteCadastro, type DepsAnalise, type RespostaGed } from "../_shared/ged.ts";

const responder = (r: RespostaGed) =>
  new Response(r.corpo ?? null, { status: r.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const chaveAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !chaveServico || !chaveAnon) return responder({ status: 500, corpo: JSON.stringify({ erro: "nao_configurada" }) });

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || null;
  const corpo = await req.json().catch(() => null);
  const deps: DepsAnalise = {
    env: (k: string) => Deno.env.get(k),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      const { data, error } = await banco.rpc(nome, args);
      return { data, error: error ? { message: error.message } : null };
    },
    fetch: (u: string, init: RequestInit) => fetch(u, init),
    agoraSeg: () => Math.floor(Date.now() / 1000),
    perfilAdmin: async (token) => {
      const usuario = createClient(url, chaveAnon, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data } = await usuario.rpc("ged_perfil_admin_atual");
      return typeof data === "string" ? data : null;
    },
    cadastros: async () => {
      const [c, e] = await Promise.all([
        banco.from("contrapartes").select("id, nome, documento").contains("tipos", ["cliente"]).eq("ativo", true).limit(5000),
        banco.from("empresas").select("cnpj"),
      ]);
      return {
        clientes: (c.data ?? []) as ClienteCadastro[],
        cnpjsProprios: (e.data ?? []).map((x) => String(x.cnpj ?? "").replace(/\D/g, "")).filter(Boolean),
      };
    },
    extratores: criarExtratores({
      abrirPdf: (b) => getDocumentProxy(b),
      abrirZip: (b) => JSZip.loadAsync(b),
    }),
    log: (m) => console.log(m),
  };
  return responder(await tratarAnalise({ method: req.method, jwt, corpo }, deps));
});
