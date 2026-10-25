// Edge Function do núcleo: indexação do GED (só METADADOS do Drive, especificação 5.3). Só liga as peças: a lógica, testada no
// Vitest, está em _shared/ged.ts (tratarIndexacao). Gravação: migration 0806 (ged_iniciar_indexacao, ged_gravar_indice,
// ged_concluir_indexacao, ged_estado_indice).
//
//  POST com `x-sincronizacao-segredo` = SINCRONIZACAO_SEGREDO (agendamento do banco). Não há chamada por usuário: "Atualizar índice
//  agora" depende do PENDENTE 16. Nada roda com administrativo.ged.indexar = false (o banco recusa abrir a rodada antes de qualquer
//  chamada ao Google). Resposta e log só com contagens e códigos.
// Segredos: os da nucleo-ged-conectar (GED_DRIVE_*), NEO_ADMIN_URL e SINCRONIZACAO_SEGREDO.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { tratarIndexacao, type DepsIndexacao, type RespostaGed } from "../_shared/ged.ts";

const responder = (r: RespostaGed) =>
  new Response(r.corpo ?? null, { status: r.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveServico) return responder({ status: 500, corpo: JSON.stringify({ erro: "nao_configurada" }) });

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  return responder(
    await tratarIndexacao({ method: req.method, segredo: req.headers.get("x-sincronizacao-segredo") }, {
      env: (k: string) => Deno.env.get(k),
      rpc: async (nome: string, args: Record<string, unknown>) => {
        const { data, error } = await banco.rpc(nome, args);
        return { data, error: error ? { message: error.message } : null };
      },
      fetch: (u: string, init: RequestInit) => fetch(u, init),
      agoraSeg: () => Math.floor(Date.now() / 1000),
      perfilAdmin: async () => null, // não há chamada por usuário nesta função
      raizesAtivas: async (): ReturnType<DepsIndexacao["raizesAtivas"]> => {
        const { data, error } = await banco.from("ged_pastas_raiz")
          .select("id, drive_id, drive_compartilhado_id, page_token, indexada_em, reconciliada_em").eq("situacao", "ativa").order("finalidade");
        if (error) throw new Error("ged:banco");
        return (data ?? []).map((r) => ({
          id: r.id, driveId: r.drive_id, driveIdCompartilhado: r.drive_compartilhado_id, pageToken: r.page_token,
          indexadaEm: r.indexada_em, reconciliadaEm: r.reconciliada_em,
        }));
      },
      log: (m) => console.log(m),
    }),
  );
});
