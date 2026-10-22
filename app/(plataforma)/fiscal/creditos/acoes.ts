"use server";

// Ações do Fiscal Control. Todas: exigem sessão e acesso ao módulo, validam e convertem os dados no SERVIDOR (zod + formatos
// brasileiros) e chamam as funções fis_* do banco, que conferem papel, escopo da empresa e regras numa transação.
// Assinatura única (anterior, FormData) para servir tanto a formulários quanto a botões.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { lerBuffer } from "@/lib/integracoes/importador/ler-arquivo";
import { nomeSeguroArquivo, sha256, validarArquivo } from "@/lib/modulos/fiscal/creditos/arquivos";
import { decimal, lerCompetencia, lerData, lerValor } from "@/lib/modulos/fiscal/creditos/formatos";
import { mapearAutomatico, prepararLinhas, type TipoImportacao } from "@/lib/modulos/fiscal/creditos/importacao";
import { MODULO_CREDITOS, ROTA_CREDITOS } from "@/lib/modulos/fiscal/creditos/modulo";
import { lerSaldosEfdIcmsIpi } from "@/lib/modulos/fiscal/creditos/sped";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: boolean; erro?: string; mensagem?: string; id?: string; dados?: unknown };

const BUCKET = "fiscal";

async function cliente() {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_CREDITOS)) throw new Error("Sem acesso ao Fiscal Control.");
  return criarClienteServidor();
}

/** Chama uma função do banco e traduz o erro. */
async function rpc(fn: string, args: Record<string, unknown>, sucesso?: string): Promise<Resultado> {
  try {
    const supabase = await cliente();
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      console.warn(`[fiscal] ${fn}: ${error.code ?? ""} ${error.message.slice(0, 200)}`);
      return { ok: false, erro: mensagemDeErroBanco(error, "Registro duplicado.") };
    }
    revalidatePath(ROTA_CREDITOS, "layout");
    return { ok: true, mensagem: sucesso, id: typeof data === "string" ? data : undefined, dados: data };
  } catch (e) {
    console.error(`[fiscal] ${fn}: falha inesperada`, (e as Error).message);
    return { ok: false, erro: "Não foi possível concluir. Tente novamente." };
  }
}

const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => t(fd, k) || null;
const id = z.string().uuid("Registro inválido.");
const falha = (erro: string): Resultado => ({ ok: false, erro });
const primeiroErro = (e: z.ZodError) => e.issues[0]?.message ?? "Dados inválidos.";

/** Valor monetário do formulário -> '1234.56' (ou erro em português). */
function valor(fd: FormData, k: string, rotulo: string, opcoes: { opcional?: boolean; zero?: boolean; negativo?: boolean } = {}): { ok: true; v: string | null } | { ok: false; erro: string } {
  const bruto = t(fd, k);
  if (!bruto && opcoes.opcional) return { ok: true, v: null };
  const r = lerValor(bruto, { permitirZero: opcoes.zero, permitirNegativo: opcoes.negativo });
  return r.ok ? { ok: true, v: decimal(r.centavos) } : { ok: false, erro: `${rotulo}: ${r.erro}` };
}
function dataObrig(fd: FormData, k: string, rotulo: string): { ok: true; v: string } | { ok: false; erro: string } {
  const d = lerData(t(fd, k));
  return d ? { ok: true, v: d } : { ok: false, erro: `${rotulo}: informe uma data válida.` };
}
function compObrig(fd: FormData, k: string, rotulo = "Competência"): { ok: true; v: string } | { ok: false; erro: string } {
  const c = lerCompetencia(t(fd, k));
  return c ? { ok: true, v: c } : { ok: false, erro: `${rotulo}: informe no formato MM/AAAA.` };
}

// ---------------------------------------------------------------- CRÉDITOS
export async function criarCredito(_: unknown, fd: FormData): Promise<Resultado> {
  const e = z.object({
    estabelecimento_id: id, tributo_id: id, categoria_id: id,
    origem: z.string().min(2, "Escolha a origem."),
    descricao: z.string().trim().min(3, "Descreva o crédito (mínimo 3 caracteres).").max(500),
    tipo_entrada: z.enum(["saldo_inicial", "credito_apurado", "credito_reconhecido"]),
  }).safeParse(Object.fromEntries(fd));
  if (!e.success) return falha(primeiroErro(e.error));
  const comp = compObrig(fd, "competencia_origem", "Competência de origem");
  if (!comp.ok) return falha(comp.erro);
  const v = valor(fd, "valor_original", "Valor original");
  if (!v.ok) return falha(v.erro);
  const dataEntrada = t(fd, "data_entrada") ? lerData(t(fd, "data_entrada")) : null;
  if (t(fd, "data_entrada") && !dataEntrada) return falha("Data do lançamento inicial inválida.");
  const dataRec = t(fd, "data_reconhecimento") ? lerData(t(fd, "data_reconhecimento")) : null;
  if (t(fd, "data_reconhecimento") && !dataRec) return falha("Data de reconhecimento inválida.");
  const limite = t(fd, "data_limite_aproveitamento") ? lerData(t(fd, "data_limite_aproveitamento")) : null;
  return rpc("fis_credito_criar", { p: {
    ...e.data, competencia_origem: comp.v, valor_original: v.v, data_entrada: dataEntrada, data_reconhecimento: dataRec, data_limite_aproveitamento: limite,
    numero_processo: opt(fd, "numero_processo"), documento_ref: opt(fd, "documento_ref"), observacoes: opt(fd, "observacoes"),
    responsavel_id: opt(fd, "responsavel_id"), chave_idempotencia: opt(fd, "chave"),
  } }, "Crédito cadastrado. Anexe a documentação e peça a validação.");
}

export async function atualizarCredito(_: unknown, fd: FormData): Promise<Resultado> {
  const cid = id.safeParse(t(fd, "id"));
  if (!cid.success) return falha("Crédito inválido.");
  const p: Record<string, unknown> = {};
  for (const k of ["descricao", "observacoes", "numero_processo", "documento_ref", "responsavel_id", "categoria_id", "origem"]) if (fd.has(k)) p[k] = t(fd, k);
  for (const k of ["data_reconhecimento", "data_limite_aproveitamento"]) {
    if (!fd.has(k)) continue;
    const d = t(fd, k) ? lerData(t(fd, k)) : "";
    if (d === null) return falha("Data inválida.");
    p[k] = d;
  }
  return rpc("fis_credito_atualizar", { p_id: cid.data, p }, "Crédito atualizado.");
}

export async function validarCredito(_: unknown, fd: FormData): Promise<Resultado> {
  const cid = id.safeParse(t(fd, "id"));
  if (!cid.success) return falha("Crédito inválido.");
  const decisao = z.enum(["validado", "em_analise", "rejeitado", "contestado"]).safeParse(t(fd, "decisao"));
  if (!decisao.success) return falha("Escolha a decisão.");
  const v = valor(fd, "valor_reconhecido", "Valor reconhecido", { opcional: true, zero: true });
  if (!v.ok) return falha(v.erro);
  return rpc("fis_credito_validar", { p_id: cid.data, p_decisao: decisao.data, p_valor_reconhecido: v.v, p_justificativa: opt(fd, "justificativa") }, "Decisão registrada.");
}

export async function bloquearCredito(_: unknown, fd: FormData): Promise<Resultado> {
  const cid = id.safeParse(t(fd, "id"));
  if (!cid.success) return falha("Crédito inválido.");
  return rpc("fis_credito_bloquear", { p_id: cid.data, p_bloquear: t(fd, "bloquear") === "sim", p_motivo: t(fd, "motivo") },
    t(fd, "bloquear") === "sim" ? "Crédito bloqueado." : "Crédito desbloqueado.");
}

export async function arquivarCredito(_: unknown, fd: FormData): Promise<Resultado> {
  const cid = id.safeParse(t(fd, "id"));
  if (!cid.success) return falha("Crédito inválido.");
  return rpc("fis_credito_arquivar", { p_id: cid.data, p_motivo: t(fd, "motivo"), p_estornar_entradas: t(fd, "estornar") === "on" }, "Crédito arquivado.");
}

// ---------------------------------------------------------------- MOVIMENTAÇÕES
export async function registrarMovimento(_: unknown, fd: FormData): Promise<Resultado> {
  const cid = id.safeParse(t(fd, "credito_id"));
  if (!cid.success) return falha("Escolha o crédito.");
  const tipo = t(fd, "tipo");
  if (!/^[a-z0-9_]{2,40}$/.test(tipo)) return falha("Escolha o tipo de movimentação.");
  const v = valor(fd, "valor", "Valor");
  if (!v.ok) return falha(v.erro);
  const d = dataObrig(fd, "data", "Data");
  if (!d.ok) return falha(d.erro);
  const c = compObrig(fd, "competencia");
  if (!c.ok) return falha(c.erro);
  if (t(fd, "descricao").length < 3) return falha("Descreva a movimentação.");
  return rpc("fis_movimento_registrar", { p: {
    credito_id: cid.data, tipo, valor: v.v, data: d.v, competencia: c.v, descricao: t(fd, "descricao"),
    documento_ref: opt(fd, "documento_ref"), protocolo: opt(fd, "protocolo"), processo: opt(fd, "processo"), chave_idempotencia: opt(fd, "chave"),
  } }, "Movimentação registrada.");
}

export async function estornarMovimento(_: unknown, fd: FormData): Promise<Resultado> {
  const mid = id.safeParse(t(fd, "id"));
  if (!mid.success) return falha("Movimentação inválida.");
  return rpc("fis_movimento_estornar", { p_id: mid.data, p_motivo: t(fd, "motivo"), p_chave: opt(fd, "chave") }, "Estorno registrado.");
}

export async function corrigirMovimento(_: unknown, fd: FormData): Promise<Resultado> {
  const mid = id.safeParse(t(fd, "id"));
  if (!mid.success) return falha("Movimentação inválida.");
  const v = valor(fd, "valor", "Valor", { opcional: true });
  if (!v.ok) return falha(v.erro);
  const d = t(fd, "data") ? lerData(t(fd, "data")) : null;
  if (t(fd, "data") && !d) return falha("Data inválida.");
  const c = t(fd, "competencia") ? lerCompetencia(t(fd, "competencia")) : null;
  if (t(fd, "competencia") && !c) return falha("Competência inválida (MM/AAAA).");
  if (t(fd, "motivo").length < 10) return falha("Informe o motivo da correção (mínimo 10 caracteres).");
  return rpc("fis_movimento_corrigir", { p_id: mid.data, p_motivo: t(fd, "motivo"), p: {
    valor: v.v, data: d, competencia: c, descricao: opt(fd, "descricao"), protocolo: opt(fd, "protocolo"), chave_idempotencia: opt(fd, "chave"),
  } }, "Lançamento corrigido (estorno + novo lançamento).");
}

export async function decidirMovimento(_: unknown, fd: FormData): Promise<Resultado> {
  const mid = id.safeParse(t(fd, "id"));
  if (!mid.success) return falha("Movimentação inválida.");
  const aprovar = t(fd, "decisao") === "aprovar";
  return rpc("fis_movimento_decidir", { p_id: mid.data, p_aprovar: aprovar, p_motivo: opt(fd, "motivo") }, aprovar ? "Lançamento aprovado." : "Lançamento rejeitado.");
}

export async function transferir(_: unknown, fd: FormData): Promise<Resultado> {
  const o = id.safeParse(t(fd, "origem_id")), dd = id.safeParse(t(fd, "destino_id"));
  if (!o.success || !dd.success) return falha("Escolha os créditos de origem e de destino.");
  const v = valor(fd, "valor", "Valor");
  if (!v.ok) return falha(v.erro);
  const d = dataObrig(fd, "data", "Data");
  if (!d.ok) return falha(d.erro);
  const c = compObrig(fd, "competencia");
  if (!c.ok) return falha(c.erro);
  return rpc("fis_transferir", { p: {
    origem_id: o.data, destino_id: dd.data, valor: v.v, data: d.v, competencia: c.v, fundamento: t(fd, "fundamento"),
    documento_ref: opt(fd, "documento_ref"), protocolo: opt(fd, "protocolo"), chave_idempotencia: opt(fd, "chave"),
  } }, "Transferência registrada: aguarda aprovação de um revisor.");
}

// ---------------------------------------------------------------- COMPETÊNCIAS
function chavePeriodo(fd: FormData) {
  const estab = id.safeParse(t(fd, "estabelecimento_id")), trib = id.safeParse(t(fd, "tributo_id"));
  const comp = lerCompetencia(t(fd, "competencia"));
  if (!estab.success || !trib.success || !comp) return null;
  return { p_estab: estab.data, p_tributo: trib.data, p_comp: comp };
}

export async function enviarRevisao(_: unknown, fd: FormData): Promise<Resultado> {
  const k = chavePeriodo(fd);
  if (!k) return falha("Competência inválida.");
  return rpc("fis_periodo_enviar_revisao", { ...k, p_obs: opt(fd, "observacao") }, "Competência enviada para revisão.");
}

export async function informarSaldos(_: unknown, fd: FormData): Promise<Resultado> {
  const k = chavePeriodo(fd);
  if (!k) return falha("Competência inválida.");
  const p: Record<string, unknown> = {};
  for (const [campo, rotulo] of [["saldo_oficial", "Saldo oficial"], ["saldo_declarado", "Saldo declarado"]] as const) {
    if (!fd.has(campo)) continue;
    const v = valor(fd, campo, rotulo, { opcional: true, zero: true });
    if (!v.ok) return falha(v.erro);
    p[campo] = v.v;
  }
  for (const campo of ["saldo_oficial_fonte", "saldo_declarado_fonte", "diferenca_justificativa"]) if (fd.has(campo)) p[campo] = t(fd, campo);
  return rpc("fis_periodo_informar_saldos", { ...k, p }, "Saldos informados.");
}

export async function fecharPeriodo(_: unknown, fd: FormData): Promise<Resultado> {
  const k = chavePeriodo(fd);
  if (!k) return falha("Competência inválida.");
  return rpc("fis_periodo_fechar", { ...k, p_justificativa: opt(fd, "justificativa"), p_aceitar_divergencias: t(fd, "aceitar") === "on" }, "Competência fechada.");
}

export async function reabrirPeriodo(_: unknown, fd: FormData): Promise<Resultado> {
  const pid = id.safeParse(t(fd, "id"));
  if (!pid.success) return falha("Competência inválida.");
  const r = await rpc("fis_periodo_reabrir", { p_id: pid.data, p_motivo: t(fd, "motivo") });
  if (!r.ok) return r;
  const posteriores = ((r.dados as { posteriores_fechadas?: string[] } | null)?.posteriores_fechadas ?? []);
  return {
    ok: true,
    mensagem: posteriores.length
      ? `Competência reaberta. Atenção: ${posteriores.join(", ")} já estão fechadas e precisarão de reconciliação se o saldo mudar.`
      : "Competência reaberta.",
  };
}

export async function reconciliarPeriodo(_: unknown, fd: FormData): Promise<Resultado> {
  const pid = id.safeParse(t(fd, "id"));
  if (!pid.success) return falha("Competência inválida.");
  return rpc("fis_periodo_reconciliar", { p_id: pid.data, p_obs: t(fd, "observacao") }, "Competência reconciliada.");
}

/** Lê o saldo credor a transportar da EFD ICMS/IPI (E110/E520) e informa como saldo oficial do ICMS e do IPI do estabelecimento. */
export async function lerEfdIcmsIpi(_: unknown, fd: FormData): Promise<Resultado> {
  const arquivo = fd.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha o arquivo da EFD ICMS/IPI (.txt).");
  if (arquivo.size > 9 * 1024 * 1024) return falha("Arquivo acima de 9 MB.");
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const r = lerSaldosEfdIcmsIpi(new TextDecoder("latin1").decode(bytes));
  if (!r.ok) return falha(r.erro);
  const supabase = await cliente();
  const [{ data: estab }, { data: tribs }] = await Promise.all([
    supabase.from("fis_estabelecimentos").select("id").eq("cnpj", r.saldos.cnpj).maybeSingle(),
    supabase.from("fis_tributos").select("id, codigo").in("codigo", ["ICMS", "IPI"]),
  ]);
  if (!estab) return falha(`CNPJ ${r.saldos.cnpj} do arquivo não é de um estabelecimento cadastrado (ou fora do seu escopo).`);
  const feitos: string[] = [];
  for (const [codigo, v] of [["ICMS", r.saldos.icmsSaldoCredorTransportar], ["IPI", r.saldos.ipiSaldoCredor]] as const) {
    const trib = (tribs ?? []).find((x) => x.codigo === codigo);
    if (!trib || v === null) continue;
    const res = await rpc("fis_periodo_informar_saldos", {
      p_estab: estab.id, p_tributo: trib.id, p_comp: r.saldos.competencia,
      p: { saldo_oficial: decimal(v), saldo_oficial_fonte: `EFD ICMS/IPI ${r.saldos.competencia.slice(5, 7)}/${r.saldos.competencia.slice(0, 4)} (arquivo ${arquivo.name.slice(0, 80)})` },
    });
    if (!res.ok) return falha(`${codigo}: ${res.erro}`);
    feitos.push(codigo);
  }
  if (feitos.length === 0) return falha(["Nenhum saldo lido.", ...r.saldos.avisos].join(" "));
  return { ok: true, mensagem: `Saldo oficial informado (${feitos.join(" e ")}) para ${r.saldos.competencia.slice(5, 7)}/${r.saldos.competencia.slice(0, 4)}. ${r.saldos.avisos.join(" ")}`.trim() };
}

// ---------------------------------------------------------------- OBRIGAÇÕES
export async function salvarObrigacao(_: unknown, fd: FormData): Promise<Resultado> {
  const venc = t(fd, "vencimento") ? lerData(t(fd, "vencimento")) : null;
  if (t(fd, "vencimento") && !venc) return falha("Vencimento inválido.");
  const p: Record<string, unknown> = {
    id: opt(fd, "id"), vencimento: venc, vencimento_confirmado: t(fd, "vencimento_confirmado") === "on", vencimento_fonte: opt(fd, "vencimento_fonte"),
    responsavel_id: opt(fd, "responsavel_id"), contador_responsavel: opt(fd, "contador_responsavel"), observacoes: opt(fd, "observacoes"),
  };
  if (!p.id) {
    const c = compObrig(fd, "competencia");
    if (!c.ok) return falha(c.erro);
    if (!id.safeParse(t(fd, "tipo_id")).success || !id.safeParse(t(fd, "estabelecimento_id")).success) return falha("Escolha o tipo e o estabelecimento.");
    Object.assign(p, { tipo_id: t(fd, "tipo_id"), estabelecimento_id: t(fd, "estabelecimento_id"), tributo_id: opt(fd, "tributo_id"), competencia: c.v });
  }
  return rpc("fis_obrigacao_salvar", { p }, "Obrigação salva.");
}

export async function gerarObrigacoes(_: unknown, fd: FormData): Promise<Resultado> {
  const c = compObrig(fd, "competencia");
  if (!c.ok) return falha(c.erro);
  const r = await rpc("fis_obrigacoes_gerar", { p_comp: c.v, p_empresa: opt(fd, "empresa_id") });
  return r.ok ? { ok: true, mensagem: `${r.dados ?? 0} obrigação(ões) gerada(s) a partir do perfil tributário.` } : r;
}

export async function mudarSituacaoObrigacao(_: unknown, fd: FormData): Promise<Resultado> {
  const oid = id.safeParse(t(fd, "id"));
  if (!oid.success) return falha("Obrigação inválida.");
  const para = t(fd, "para");
  const p: Record<string, unknown> = { observacao: opt(fd, "observacao"), justificativa: opt(fd, "justificativa"), numero_recibo: opt(fd, "numero_recibo") };
  if (t(fd, "data_transmissao")) {
    const d = lerData(t(fd, "data_transmissao"));
    if (!d) return falha("Data da transmissão inválida.");
    p.data_transmissao = d;
  }
  return rpc("fis_obrigacao_status", { p_id: oid.data, p_para: para, p }, "Situação atualizada.");
}

export async function retificarObrigacao(_: unknown, fd: FormData): Promise<Resultado> {
  const oid = id.safeParse(t(fd, "id"));
  if (!oid.success) return falha("Obrigação inválida.");
  return rpc("fis_obrigacao_retificar", { p_id: oid.data, p_motivo: t(fd, "motivo") }, "Retificadora criada.");
}

// ---------------------------------------------------------------- DOCUMENTOS
const ALVOS = ["credito", "movimento", "obrigacao", "periodo", "divergencia", "tarefa"] as const;

/**
 * Envio: valida extensão, tamanho e conteúdo no servidor; grava no bucket privado com a sessão do usuário (a política do
 * Storage confere o papel e a empresa) e registra o documento (versão nova quando substitui outro) com os vínculos.
 */
export async function enviarDocumento(_: unknown, fd: FormData): Promise<Resultado> {
  const arquivo = fd.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha o arquivo.");
  const empresa = id.safeParse(t(fd, "empresa_id"));
  if (!empresa.success) return falha("Escolha a empresa.");
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const v = validarArquivo(arquivo.name, bytes);
  if (!v.ok) return falha(v.erro);
  const competencia = t(fd, "competencia") ? lerCompetencia(t(fd, "competencia")) : null;
  if (t(fd, "competencia") && !competencia) return falha("Competência inválida (MM/AAAA).");
  const alvo = t(fd, "alvo");
  const alvoId = t(fd, "alvo_id");
  const vinculos = alvo && alvoId ? [{ alvo, alvo_id: alvoId }] : [];
  if (vinculos.length && (!(ALVOS as readonly string[]).includes(alvo) || !id.safeParse(alvoId).success)) return falha("Vínculo inválido.");
  let supabase;
  try { supabase = await cliente(); } catch { return falha("Sem acesso."); }
  const caminho = `fiscal.creditos/${empresa.data}/${crypto.randomUUID()}-${nomeSeguroArquivo(arquivo.name)}`;
  const envio = await supabase.storage.from(BUCKET).upload(caminho, bytes, { contentType: v.mime, upsert: false });
  if (envio.error) {
    console.warn(`[fiscal] upload: ${envio.error.message.slice(0, 200)}`);
    return falha("O armazenamento recusou o arquivo (sem permissão para esta empresa ou serviço indisponível).");
  }
  return rpc("fis_documento_registrar", { p: {
    tipo: t(fd, "tipo") || null, titulo: t(fd, "titulo") || arquivo.name, empresa_id: empresa.data, estabelecimento_id: opt(fd, "estabelecimento_id"),
    tributo_id: opt(fd, "tributo_id"), competencia, observacoes: opt(fd, "observacoes"), arquivo_path: caminho, nome_arquivo: arquivo.name.slice(0, 200),
    mime: v.mime, tamanho_bytes: bytes.length, sha256: await sha256(bytes), substitui_id: opt(fd, "substitui_id"), motivo_substituicao: opt(fd, "motivo_substituicao"),
  }, p_vinculos: vinculos }, t(fd, "substitui_id") ? "Nova versão registrada; a anterior ficou no histórico." : "Documento enviado.");
}

export async function vincularDocumento(_: unknown, fd: FormData): Promise<Resultado> {
  const did = id.safeParse(t(fd, "documento_id")), aid = id.safeParse(t(fd, "alvo_id"));
  if (!did.success || !aid.success || !(ALVOS as readonly string[]).includes(t(fd, "alvo"))) return falha("Vínculo inválido.");
  return rpc("fis_documento_vincular", { p_documento: did.data, p_alvo: t(fd, "alvo"), p_alvo_id: aid.data }, "Documento vinculado.");
}

export async function desvincularDocumento(_: unknown, fd: FormData): Promise<Resultado> {
  const vid = id.safeParse(t(fd, "id"));
  if (!vid.success) return falha("Vínculo inválido.");
  return rpc("fis_documento_desvincular", { p_vinculo: vid.data, p_motivo: t(fd, "motivo") }, "Vínculo removido (fica no histórico).");
}

export async function arquivarDocumento(_: unknown, fd: FormData): Promise<Resultado> {
  const did = id.safeParse(t(fd, "id"));
  if (!did.success) return falha("Documento inválido.");
  return rpc("fis_documento_arquivar", { p_id: did.data, p_motivo: t(fd, "motivo") }, "Documento arquivado.");
}

// ---------------------------------------------------------------- CONCILIAÇÃO
export async function registrarDivergencia(_: unknown, fd: FormData): Promise<Resultado> {
  const empresa = id.safeParse(t(fd, "empresa_id"));
  if (!empresa.success) return falha("Escolha a empresa.");
  if (t(fd, "motivo").length < 5) return falha("Descreva o motivo da diferença.");
  const vi = valor(fd, "valor_interno", "Valor interno", { opcional: true, zero: true, negativo: true });
  const ve = valor(fd, "valor_externo", "Valor externo", { opcional: true, zero: true, negativo: true });
  const vd = valor(fd, "valor_diferenca", "Diferença", { opcional: true, zero: true, negativo: true });
  for (const x of [vi, ve, vd]) if (!x.ok) return falha(x.erro);
  const comp = t(fd, "competencia") ? lerCompetencia(t(fd, "competencia")) : null;
  if (t(fd, "competencia") && !comp) return falha("Competência inválida (MM/AAAA).");
  const prazo = t(fd, "prazo_interno") ? lerData(t(fd, "prazo_interno")) : null;
  if (t(fd, "prazo_interno") && !prazo) return falha("Prazo interno inválido.");
  return rpc("fis_divergencia_registrar", { p: {
    empresa_id: empresa.data, estabelecimento_id: opt(fd, "estabelecimento_id"), tributo_id: opt(fd, "tributo_id"), competencia: comp,
    credito_id: opt(fd, "credito_id"), periodo_id: opt(fd, "periodo_id"), obrigacao_id: opt(fd, "obrigacao_id"), regra: opt(fd, "regra"), chave_regra: opt(fd, "chave_regra"),
    fonte_comparada: opt(fd, "fonte_comparada"), valor_interno: vi.ok ? vi.v : null, valor_externo: ve.ok ? ve.v : null, valor_diferenca: vd.ok ? vd.v : null,
    motivo: t(fd, "motivo"), providencia: opt(fd, "providencia"), responsavel_id: opt(fd, "responsavel_id"), prazo_interno: prazo,
  } }, "Divergência registrada.");
}

export async function mudarSituacaoDivergencia(_: unknown, fd: FormData): Promise<Resultado> {
  const did = id.safeParse(t(fd, "id"));
  if (!did.success) return falha("Divergência inválida.");
  return rpc("fis_divergencia_status", { p_id: did.data, p_status: t(fd, "status"), p_texto: t(fd, "texto"), p_responsavel: opt(fd, "responsavel_id") }, "Divergência atualizada.");
}

// ---------------------------------------------------------------- TAREFAS E COMENTÁRIOS
export async function criarTarefa(_: unknown, fd: FormData): Promise<Resultado> {
  if (t(fd, "titulo").length < 3) return falha("Informe o título da tarefa.");
  const prazo = t(fd, "prazo") ? lerData(t(fd, "prazo")) : null;
  if (t(fd, "prazo") && !prazo) return falha("Prazo inválido.");
  return rpc("fis_tarefa_criar", { p: {
    tipo: t(fd, "tipo") || "tarefa", titulo: t(fd, "titulo"), descricao: opt(fd, "descricao"), empresa_id: opt(fd, "empresa_id"),
    alvo: opt(fd, "alvo"), alvo_id: opt(fd, "alvo_id"), tipo_documento_solicitado: opt(fd, "tipo_documento_solicitado"),
    responsavel_id: opt(fd, "responsavel_id"), prazo,
  } }, "Tarefa criada (também aparece na Fila do dia do responsável).");
}

export async function mudarSituacaoTarefa(_: unknown, fd: FormData): Promise<Resultado> {
  const tid = id.safeParse(t(fd, "id"));
  if (!tid.success) return falha("Tarefa inválida.");
  return rpc("fis_tarefa_status", { p_id: tid.data, p_status: t(fd, "status"), p_resposta: opt(fd, "resposta"), p_responsavel: opt(fd, "responsavel_id") }, "Tarefa atualizada.");
}

export async function comentar(_: unknown, fd: FormData): Promise<Resultado> {
  const aid = id.safeParse(t(fd, "alvo_id"));
  if (!aid.success) return falha("Registro inválido.");
  if (!t(fd, "texto")) return falha("Escreva o comentário.");
  return rpc("fis_comentar", { p_alvo: t(fd, "alvo"), p_alvo_id: aid.data, p_texto: t(fd, "texto").slice(0, 4000) }, "Comentário registrado.");
}

// ---------------------------------------------------------------- CONFIGURAÇÕES (administrador)
const lista = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);

export async function salvarEstabelecimento(_: unknown, fd: FormData): Promise<Resultado> {
  const cnpj = t(fd, "cnpj").replace(/\D/g, "");
  if (!t(fd, "id") && cnpj.length !== 14) return falha("CNPJ deve ter 14 dígitos.");
  return rpc("fis_salvar_estabelecimento", { p: {
    id: opt(fd, "id"), empresa_id: t(fd, "empresa_id"), nome: t(fd, "nome"), cnpj, uf: t(fd, "uf").toUpperCase(), inscricao_estadual: opt(fd, "inscricao_estadual"),
    matriz: t(fd, "matriz") === "on", ativo: !fd.has("inativo"),
  } }, "Estabelecimento salvo.");
}

export async function salvarTributo(_: unknown, fd: FormData): Promise<Resultado> {
  return rpc("fis_salvar_tributo", { p: { id: opt(fd, "id"), codigo: t(fd, "codigo"), nome: t(fd, "nome"), esfera: t(fd, "esfera"), observacao: opt(fd, "observacao"), ativo: !fd.has("inativo") } }, "Tributo salvo.");
}

export async function salvarCategoria(_: unknown, fd: FormData): Promise<Resultado> {
  return rpc("fis_salvar_categoria", { p: {
    id: opt(fd, "id"), codigo: t(fd, "codigo"), nome: t(fd, "nome"), tributo_id: opt(fd, "tributo_id"), natureza: t(fd, "natureza"),
    formas_utilizacao: lista(fd, "formas"), prazo_aproveitamento_meses: opt(fd, "prazo"), exige_processo: t(fd, "exige_processo") === "on",
    documentos_exigidos: lista(fd, "documentos"), observacao_legal: opt(fd, "observacao_legal"), regra_validada: t(fd, "regra_validada") === "on", ativo: !fd.has("inativo"),
  } }, "Categoria salva.");
}

export async function salvarTipoMovimento(_: unknown, fd: FormData): Promise<Resultado> {
  return rpc("fis_salvar_tipo_movimento", { p: {
    codigo: t(fd, "codigo"), nome: t(fd, "nome"), classe: t(fd, "classe"), sinal: t(fd, "sinal"), forma: opt(fd, "forma"),
    exige_aprovacao: t(fd, "exige_aprovacao") === "on", exige_protocolo: t(fd, "exige_protocolo") === "on", ativo: !fd.has("inativo"),
  } }, "Tipo de movimentação salvo.");
}

export async function salvarTipoObrigacao(_: unknown, fd: FormData): Promise<Resultado> {
  return rpc("fis_salvar_tipo_obrigacao", { p: {
    id: opt(fd, "id"), codigo: t(fd, "codigo"), nome: t(fd, "nome"), tributo_id: opt(fd, "tributo_id"), esfera: t(fd, "esfera"), periodicidade: t(fd, "periodicidade"),
    dia_vencimento: opt(fd, "dia_vencimento"), meses_apos: opt(fd, "meses_apos"), regra_vencimento_validada: t(fd, "regra_vencimento_validada") === "on",
    fonte_regra: opt(fd, "fonte_regra"), exige_recibo: t(fd, "exige_recibo") === "on", documentos_exigidos: lista(fd, "documentos"), descricao: opt(fd, "descricao"),
    ativo: !fd.has("inativo"),
  } }, "Tipo de obrigação salvo.");
}

export async function definirAplicavel(_: unknown, fd: FormData): Promise<Resultado> {
  return rpc("fis_definir_aplicavel", {
    p_tipo: t(fd, "tipo_id"), p_estab: t(fd, "estabelecimento_id"), p_ativo: t(fd, "ativo") !== "nao",
    p_responsavel: opt(fd, "responsavel_id"), p_contador: opt(fd, "contador_responsavel"),
  }, "Perfil tributário atualizado.");
}

export async function definirMembro(_: unknown, fd: FormData): Promise<Resultado> {
  const pid = id.safeParse(t(fd, "perfil_id"));
  if (!pid.success) return falha("Escolha o usuário.");
  return rpc("fis_definir_membro", { p_perfil: pid.data, p_papel: opt(fd, "papel"), p_empresas: lista(fd, "empresas") }, "Papel atualizado.");
}

// ---------------------------------------------------------------- IMPORTAÇÃO
/** Passo 1: lê a planilha, aplica o mapeamento de colunas, normaliza e manda para a área de preparo (nada entra na base). */
export async function prepararImportacao(_: unknown, fd: FormData): Promise<Resultado> {
  const tipo = t(fd, "tipo") as TipoImportacao;
  if (tipo !== "creditos" && tipo !== "movimentos") return falha("Escolha o que importar.");
  const arquivo = fd.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha a planilha (.xlsx ou .csv).");
  const lido = await lerBuffer(await arquivo.arrayBuffer(), arquivo.name);
  if (!lido.ok) return falha(lido.erro);
  const planilha = lido.planilhas[0];
  if (!planilha || planilha.matriz.length < 2) return falha("A planilha precisa do cabeçalho e de ao menos uma linha.");
  const cabecalho = planilha.matriz[0].map((c) => String(c ?? ""));
  let mapa = mapearAutomatico(tipo, cabecalho);
  const manual = t(fd, "mapeamento");
  if (manual) {
    try {
      const m = JSON.parse(manual) as Record<string, number | null>;
      mapa = Object.fromEntries(Object.keys(mapa).map((k) => [k, typeof m[k] === "number" && m[k]! < cabecalho.length ? m[k] : null]));
    } catch { return falha("Mapeamento inválido."); }
  }
  const linhas = prepararLinhas(tipo, planilha.matriz.slice(1) as (string | number | Date | null)[][], mapa, 2);
  if (linhas.length === 0) return falha("Nenhuma linha com dados.");
  const mapeamento = Object.fromEntries(Object.entries(mapa).map(([k, i]) => [k, i === null ? null : cabecalho[i]]));
  const r = await rpc("fis_imp_preparar", { p_tipo: tipo, p_arquivo: arquivo.name, p_mapeamento: mapeamento, p_linhas: linhas });
  return r.ok ? { ok: true, id: r.id, mensagem: "Planilha validada. Confira a prévia e confirme para importar." } : r;
}

export async function confirmarImportacao(_: unknown, fd: FormData): Promise<Resultado> {
  const lid = id.safeParse(t(fd, "id"));
  if (!lid.success) return falha("Lote inválido.");
  const r = await rpc("fis_imp_confirmar", { p_lote: lid.data });
  if (!r.ok) return r;
  const s = r.dados as { importadas: number; rejeitadas: number; com_erro: number; duplicadas: number };
  return { ok: true, mensagem: `Importadas: ${s.importadas}. Rejeitadas na confirmação: ${s.rejeitadas}. Com erro: ${s.com_erro}. Duplicadas: ${s.duplicadas}.` };
}

export async function descartarImportacao(_: unknown, fd: FormData): Promise<Resultado> {
  const lid = id.safeParse(t(fd, "id"));
  if (!lid.success) return falha("Lote inválido.");
  return rpc("fis_imp_descartar", { p_lote: lid.data }, "Lote descartado (nada foi importado).");
}

/** Lê só o cabeçalho da planilha (para o usuário ajustar o mapeamento antes de validar). */
export async function lerCabecalho(_: unknown, fd: FormData): Promise<Resultado> {
  const arquivo = fd.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha a planilha.");
  const lido = await lerBuffer(await arquivo.arrayBuffer(), arquivo.name);
  if (!lido.ok) return falha(lido.erro);
  const cab = (lido.planilhas[0]?.matriz[0] ?? []).map((c) => String(c ?? ""));
  const tipo = (t(fd, "tipo") as TipoImportacao) === "movimentos" ? "movimentos" : "creditos";
  return { ok: true, dados: { cabecalho: cab, mapa: mapearAutomatico(tipo, cab), linhas: Math.max(0, (lido.planilhas[0]?.matriz.length ?? 1) - 1) } };
}
