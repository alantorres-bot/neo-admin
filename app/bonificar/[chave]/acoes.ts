"use server";

// Formulário público da bonificação: quem tem o link (chave secreta do lote) lança, sem login. Tudo passa por
// rh_bo_link_salvar, que confere a chave, a situação do lote e o setor das pessoas; o nome de quem envia e o IP ficam gravados.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PCTS, ROTA_BONIFICAR } from "@/lib/modulos/rh/bonificacoes/modulo";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

const esquema = z.object({
  chave: z.string().regex(/^[0-9a-f]{64}$/, "Link inválido."),
  nome: z.string().trim().min(3, "Informe o seu nome para enviar.").max(120),
  itens: z.array(z.object({ colaborador_id: z.string().uuid(), pct: z.number().refine((p) => (PCTS as readonly number[]).includes(p), "Percentual inválido.") })).max(500),
});

export async function enviarBonificacao(entrada: z.input<typeof esquema>): Promise<Resultado> {
  const d = esquema.safeParse(entrada);
  if (!d.success) return { ok: false, erro: d.error.issues[0].message };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rh_bo_link_salvar", { p_chave: d.data.chave, p_itens: d.data.itens, p_nome: d.data.nome, p_ip: ip });
  if (error) return { ok: false, erro: error.code === "P0001" ? error.message : "Não foi possível enviar. Tente novamente." };
  revalidatePath(`${ROTA_BONIFICAR}/${d.data.chave}`);
  return { ok: true, aviso: `Bonificação enviada ao RH (${data} funcionário(s)). Obrigado!` };
}
