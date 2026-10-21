"use server";

// Formulário público do ponto: quem tem o link (chave secreta do lote) preenche, sem login. Tudo passa por
// rh_pt_link_salvar, que confere a chave e a situação do lote; o nome de quem envia e o IP ficam gravados como prova.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROTA_JUSTIFICAR, TIPOS } from "@/lib/modulos/rh/ponto/modulo";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };

const esquema = z.object({
  chave: z.string().regex(/^[0-9a-f]{64}$/, "Link inválido."),
  nome: z.string().trim().max(120),
  itens: z.array(z.object({
    id: z.string().uuid(),
    tipo: z.enum(TIPOS).nullable(),
    horario: z.string().trim().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, "Horário inválido (use hh:mm).").nullable(),
    observacao: z.string().trim().max(500).nullable(),
  })).max(500),
});

export async function salvarPeloLink(entrada: z.input<typeof esquema>, enviar: boolean): Promise<Resultado> {
  const d = esquema.safeParse(entrada);
  if (!d.success) return { ok: false, erro: d.error.issues[0].message };
  if (enviar && d.data.nome.length < 3) return { ok: false, erro: "Informe o seu nome para enviar." };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_pt_link_salvar", { p_chave: d.data.chave, p_itens: d.data.itens, p_enviar: enviar, p_nome: d.data.nome, p_ip: ip });
  if (error) return { ok: false, erro: error.code === "P0001" ? error.message : "Não foi possível salvar. Tente novamente." };
  revalidatePath(`${ROTA_JUSTIFICAR}/${d.data.chave}`);
  return { ok: true, aviso: enviar ? "Justificativas enviadas ao RH. Obrigado!" : "Salvo. Falta enviar." };
}
