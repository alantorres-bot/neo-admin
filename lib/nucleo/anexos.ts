// Anexos: arquivo no bucket privado `anexos` (Supabase Storage) + registro na tabela `anexos`.
// A RLS do Storage lê o módulo do 1º segmento do caminho (migration 0004), por isso o caminho
// segue sempre: <modulo>/<referencia_tabela>/<referencia_id>/<uuid>-<nome>.
// Anexo é prova: não há rotina de exclusão. Para substituir, envie outro e use o mais recente.
import type { SupabaseClient } from "@supabase/supabase-js";

export const LIMITE_BYTES_ANEXO = 25 * 1024 * 1024; // igual ao file_size_limit do bucket
export const BUCKET_ANEXOS = "anexos";

/** Remove acento e caracteres que o Storage rejeita, preservando a extensão. */
export function nomeSeguro(nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_*\._*/g, ".")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  const final = limpo.slice(-120).replace(/^[._]+/, "");
  return final === "" ? "arquivo" : final;
}

export type DadosAnexo = {
  /** código do módulo, ex.: 'financeiro.recebiveis' */
  modulo: string;
  /** tabela do registro ao qual o anexo se refere, ex.: 'rec_titulos' */
  referenciaTabela: string;
  referenciaId: string;
};

export function montarCaminhoAnexo(dados: DadosAnexo, nomeArquivo: string, uuid: string = crypto.randomUUID()): string {
  return `${dados.modulo}/${dados.referenciaTabela}/${dados.referenciaId}/${uuid}-${nomeSeguro(nomeArquivo)}`;
}

export type ResultadoEnvio = { ok: true; anexoId: string; caminho: string } | { ok: false; erro: string };

/**
 * Envia o arquivo e registra o anexo. Usa o cliente do usuário (RLS vale nas duas etapas).
 * Se o registro falhar depois do upload, o arquivo fica órfão no bucket (o usuário não tem
 * permissão de apagar); isso é aceito para nunca existir registro apontando para arquivo ausente.
 */
export async function enviarAnexo(
  supabase: SupabaseClient,
  dados: DadosAnexo,
  arquivo: File,
  tipo?: string,
): Promise<ResultadoEnvio> {
  if (arquivo.size === 0) return { ok: false, erro: "O arquivo está vazio." };
  if (arquivo.size > LIMITE_BYTES_ANEXO) return { ok: false, erro: "O arquivo passa do limite de 25 MB." };

  const caminho = montarCaminhoAnexo(dados, arquivo.name);
  const upload = await supabase.storage.from(BUCKET_ANEXOS).upload(caminho, arquivo, {
    contentType: arquivo.type || undefined,
    upsert: false,
  });
  if (upload.error) return { ok: false, erro: `Não foi possível enviar o arquivo: ${upload.error.message}` };

  const { data: usuario } = await supabase.auth.getUser();
  const registro = await supabase
    .from("anexos")
    .insert({
      modulo: dados.modulo,
      referencia_tabela: dados.referenciaTabela,
      referencia_id: dados.referenciaId,
      arquivo_path: caminho,
      nome_arquivo: arquivo.name,
      tipo: tipo ?? null,
      enviado_por: usuario.user?.id,
    })
    .select("id")
    .single();
  if (registro.error) return { ok: false, erro: `Arquivo enviado, mas o registro falhou: ${registro.error.message}` };
  return { ok: true, anexoId: registro.data.id, caminho };
}

/** URL assinada de curta duração (o bucket é privado). A RLS do Storage decide se o usuário pode. */
export async function urlAssinadaAnexo(
  supabase: SupabaseClient,
  caminho: string,
  segundos = 60,
): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  const r = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(caminho, segundos);
  if (r.error || !r.data) return { ok: false, erro: r.error?.message ?? "Não foi possível gerar o link." };
  return { ok: true, url: r.data.signedUrl };
}
