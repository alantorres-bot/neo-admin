"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { lerBuffer } from "@/lib/integracoes/importador/ler-arquivo";
import { extrairPaginasDoPdf } from "@/lib/modulos/financeiro/cartao/fatura-pdf";
import { lerFatura, paginaDeMatriz, type LinhaLida, type PaginaTexto } from "@/lib/modulos/financeiro/cartao/leitores";
import { somaLinhas } from "@/lib/modulos/financeiro/cartao/leitores/comum";
import { ehLeitor, MODULO_CARTAO, ROTA_CARTAO, TAMANHO_MAXIMO_FATURA, type CodigoLeitor } from "@/lib/modulos/financeiro/cartao/modulo";
import { paraCentavos } from "@/lib/modulos/financeiro/cartao/texto";
import { enviarAnexo } from "@/lib/nucleo/anexos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { gerarPlanilha, nomeDaPlanilha } from "@/lib/modulos/financeiro/cartao/planilha";
import { bloqueioDoFechamento, rotuloCompetencia } from "@/lib/modulos/financeiro/cartao/ciclos";
import { codigoDoLancamento, conciliacaoDaRequisicao, lerCartoes, lerCiclo, type FotoFechamento } from "./dados";

const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const texto = (d: FormData, nome: string) => String(d.get(nome) ?? "").trim();

// ---------------------------------------------------------------- importar fatura

export type Previa = {
  leitor: CodigoLeitor;
  linhas: LinhaLida[];
  somaCentavos: number;
  totalInformadoCentavos: number;
  integridadeOk: boolean;
  totalImpressoCentavos: number | null;
  vencimentoImpresso: string | null;
  avisos: string[];
  arquivo: string;
};
export type RespostaLeitura =
  | { ok: true; etapa: "previa"; previa: Previa }
  | { ok: true; etapa: "importada"; id: string; cicloId: string | null; aviso: string }
  | { ok: false; erro: string; precisaSenha?: boolean };

const esquemaCabecalho = z.object({
  empresaId: z.string().uuid("Escolha a empresa."),
  cartao: z.string().trim().min(1, "Escolha o cartão."),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe o vencimento efetivo da fatura."),
  totalCentavos: z.number().int().min(0, "Informe o total da fatura.").max(100_000_000_00, "Total acima do limite."),
  observacao: z.string().trim().max(300, "A observação pode ter até 300 caracteres."),
});

/**
 * Lê a fatura enviada (PDF ou CSV) com o leitor do cartão e devolve a pré-visualização; com `confirmar=1`, lê de novo
 * (o resultado é determinístico), grava pela função `crt_importar_fatura` (que recusa soma ≠ total) e anexa o arquivo.
 * A senha do PDF só é usada para abrir o arquivo; não é gravada.
 */
export async function lerFaturaEnviada(formData: FormData): Promise<RespostaLeitura> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode importar a fatura." };

  const cab = esquemaCabecalho.safeParse({
    empresaId: texto(formData, "empresaId"), cartao: texto(formData, "cartao"), vencimento: texto(formData, "vencimento"),
    totalCentavos: paraCentavos(texto(formData, "total")) ?? -1, observacao: texto(formData, "observacao"),
  });
  if (!cab.success) return { ok: false, erro: cab.error.issues[0].message };
  const { empresaId, cartao: codigoCartao, vencimento, totalCentavos, observacao } = cab.data;
  const senha = texto(formData, "senha") || null;
  const cicloId = texto(formData, "ciclo") || null;
  if (cicloId && !z.string().uuid().safeParse(cicloId).success) return { ok: false, erro: "Mês do cartão inválido." };
  const confirmar = texto(formData, "confirmar") === "1";

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Escolha o arquivo da fatura (PDF ou CSV)." };
  if (arquivo.size > TAMANHO_MAXIMO_FATURA) return { ok: false, erro: "O arquivo passa de 8 MB." };

  const supabase = await criarClienteServidor();
  const cartao = (await lerCartoes(supabase)).find((c) => c.codigo === codigoCartao && c.ativo);
  if (!cartao) return { ok: false, erro: "Cartão não encontrado ou inativo." };
  const leitor: CodigoLeitor = ehLeitor(cartao.leitor) ? cartao.leitor : "generico";

  let paginas: PaginaTexto[];
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith(".pdf") || arquivo.type === "application/pdf") {
    const ex = await extrairPaginasDoPdf(await arquivo.arrayBuffer(), senha);
    if (!ex.ok) return { ok: false, erro: ex.erro, precisaSenha: ex.precisaSenha };
    paginas = ex.paginas;
  } else if (/\.(csv|txt|xlsx|xls)$/.test(nome)) {
    const lido = await lerBuffer(await arquivo.arrayBuffer(), arquivo.name);
    if (!lido.ok) return { ok: false, erro: lido.erro };
    paginas = lido.planilhas.map((p, i) => ({ ...paginaDeMatriz(p.matriz), numero: i + 1 }));
  } else {
    return { ok: false, erro: "Formato não reconhecido: envie o PDF da fatura ou um CSV." };
  }

  const leituraLeitor = nome.endsWith(".pdf") ? leitor : "generico";
  const r = lerFatura(leituraLeitor, paginas, { vencimento });
  const somaCentavos = somaLinhas(r.linhas);
  const previa: Previa = {
    leitor: leituraLeitor, linhas: r.linhas, somaCentavos, totalInformadoCentavos: totalCentavos, integridadeOk: somaCentavos === totalCentavos,
    totalImpressoCentavos: r.totalImpressoCentavos, vencimentoImpresso: r.vencimentoImpresso, avisos: r.avisos, arquivo: arquivo.name,
  };
  if (!confirmar) return { ok: true, etapa: "previa", previa };
  if (!previa.integridadeOk) return { ok: false, erro: "A soma das linhas lidas não bate com o total informado: a importação não pode ser confirmada." };
  if (r.linhas.length === 0) return { ok: false, erro: "Nenhuma linha de transação foi lida." };

  const { data: id, error } = await supabase.rpc("crt_importar_fatura", {
    p_empresa: empresaId, p_cartao: cartao.codigo, p_vencimento: vencimento, p_total: totalCentavos / 100, p_leitor: leituraLeitor, p_arquivo: arquivo.name,
    p_linhas: r.linhas.map((l) => ({
      ordem: l.ordem, pagina: l.pagina, data_compra: l.dataCompra, descricao: l.descricao, valor: l.valorCentavos / 100, parcela_num: l.parcelaNum,
      parcela_total: l.parcelaTotal, descartada: l.descartada, motivo_descarte: l.motivoDescarte, texto_origem: l.textoOrigem,
    })),
    p_observacao: observacao || null,
    p_ciclo: cicloId,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };

  // O arquivo é prova: fica no Storage ligado à fatura. Falha no anexo não desfaz a importação (avisa).
  const anexo = await enviarAnexo(supabase, { modulo: MODULO_CARTAO, referenciaTabela: "crt_faturas", referenciaId: id as string }, arquivo, "fatura");
  revalidatePath(ROTA_CARTAO, "layout");
  const { data: faturaGravada } = await supabase.from("crt_faturas").select("ciclo_id").eq("id", id as string).maybeSingle();
  const uteis = r.linhas.filter((l) => !l.descartada).length;
  return {
    ok: true, etapa: "importada", id: id as string, cicloId: (faturaGravada?.ciclo_id as string | null) ?? null,
    aviso: `Fatura ${cartao.nome} importada: ${uteis} ${uteis === 1 ? "linha" : "linhas"} de despesa${anexo.ok ? "" : ` (o arquivo não foi anexado: ${anexo.erro})`}.`,
  };
}

// ---------------------------------------------------------------- cancelar

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };
const esquemaCancelar = z.object({ id: z.string().uuid(), motivo: z.string().trim().min(3, "Informe o motivo do cancelamento.").max(300) });

export async function cancelarFatura(entrada: z.input<typeof esquemaCancelar>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode cancelar a fatura." };
  const dados = esquemaCancelar.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_cancelar_fatura", { p_id: dados.data.id, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true, aviso: "Fatura cancelada. Para refazer, importe-a de novo." };
}

// ---------------------------------------------------------------- cadastros

const esquemaCartao = z.object({
  codigo: z.string().trim().min(2, "Informe o código (ex.: NUBANK PF).").max(30),
  nome: z.string().trim().min(2, "Informe o nome.").max(40),
  banco: z.string().trim().min(2, "Informe o banco.").max(40),
  tipoPessoa: z.enum(["PF", "PJ"], { message: "Escolha PF ou PJ." }),
  diaFechamento: z.coerce.number().int().min(1, "Dia de fechamento entre 1 e 31.").max(31, "Dia de fechamento entre 1 e 31."),
  diaVencimento: z.coerce.number().int().min(1, "Dia de vencimento entre 1 e 31.").max(31, "Dia de vencimento entre 1 e 31."),
  tipoTitulo: z.string().trim().regex(/^\d{0,4}$/, "Tipo de título é um número.").transform((v) => (v ? Number(v) : null)),
  leitor: z.string().refine(ehLeitor, "Escolha o leitor."),
  pastaFaturas: z.string().trim().max(80),
  ativo: z.boolean(),
  observacao: z.string().trim().max(300),
});

export async function salvarCartao(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { erro: "Somente gestor do Financeiro (ou acima) pode alterar os cartões." };
  const v = esquemaCartao.safeParse({
    codigo: texto(dados, "codigo"), nome: texto(dados, "nome"), banco: texto(dados, "banco"), tipoPessoa: texto(dados, "tipoPessoa"),
    diaFechamento: texto(dados, "diaFechamento"), diaVencimento: texto(dados, "diaVencimento"), tipoTitulo: texto(dados, "tipoTitulo"), leitor: texto(dados, "leitor"),
    pastaFaturas: texto(dados, "pastaFaturas"), ativo: dados.get("ativo") === "on", observacao: texto(dados, "observacao"),
  });
  if (!v.success) return { erro: v.error.issues[0].message };
  const d = v.data;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_salvar_cartao", {
    p_codigo: d.codigo, p_nome: d.nome, p_banco: d.banco, p_tipo_pessoa: d.tipoPessoa, p_dia_fechamento: d.diaFechamento, p_dia_vencimento: d.diaVencimento,
    p_tipo_titulo: d.tipoTitulo, p_leitor: d.leitor, p_pasta_faturas: d.pastaFaturas || null, p_ativo: d.ativo, p_observacao: d.observacao || null,
  });
  if (error) return { erro: mensagemDeErro(error) };
  revalidatePath(`${ROTA_CARTAO}/cartoes`);
  return { ok: true };
}

const esquemaEstab = z.object({
  padrao: z.string().trim().min(2, "Informe o trecho do estabelecimento como aparece na fatura.").max(60),
  categoria: z.string().trim().min(2, "Informe a categoria.").max(60),
  contaFluxo: z.string().trim().max(60),
  ativo: z.boolean(),
});

export async function salvarEstabelecimento(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { erro: "Somente operador do Financeiro (ou acima) pode alterar o dicionário." };
  const v = esquemaEstab.safeParse({ padrao: texto(dados, "padrao"), categoria: texto(dados, "categoria"), contaFluxo: texto(dados, "contaFluxo"), ativo: dados.get("ativo") === "on" });
  if (!v.success) return { erro: v.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_salvar_estabelecimento", { p_padrao: v.data.padrao, p_categoria: v.data.categoria, p_conta_fluxo: v.data.contaFluxo || null, p_ativo: v.data.ativo });
  if (error) return { erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true };
}

// ---------------------------------------------------------------- fechar e reabrir o mês do cartão

/**
 * Fecha o mês do cartão (só gestor). Recalcula a conciliação na hora (não confia no que a tela mostrou), exige nada a lançar e
 * diferença não justificada zero, grava a foto do resultado (crt_fechar_ciclo) e anexa a planilha do fechamento como prova.
 */
export async function fecharCiclo(entrada: { id: string }): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) pode fechar o mês do cartão." };
  if (!z.string().uuid().safeParse(entrada.id).success) return { ok: false, erro: "Mês do cartão inválido." };
  const supabase = await criarClienteServidor();
  const lido = await lerCiclo(supabase, entrada.id);
  if (!lido) return { ok: false, erro: "Mês do cartão não encontrado." };
  const { ciclo } = lido;
  if (ciclo.situacao !== "em_conciliacao" || !ciclo.fatura_id) return { ok: false, erro: "Só um mês em conciliação, com fatura importada, pode ser fechado." };
  const c = await conciliacaoDaRequisicao(ciclo.fatura_id);
  if (!c) return { ok: false, erro: "Fatura do mês não encontrada." };
  if (c.origemTitulos !== "consistem") return { ok: false, erro: `Não foi possível consultar o Consistem agora (${c.avisoOrigem}); o fechamento precisa dos títulos lidos do ERP. Tente de novo.` };
  const bloqueio = bloqueioDoFechamento({ itensALancar: c.resultado.pendentes, residuoCentavos: c.resultado.residuoCentavos });
  if (bloqueio) return { ok: false, erro: bloqueio };

  const foto: FotoFechamento = { resultado: c.resultado, outros: c.outros, tituloDaFatura: c.tituloDaFatura, origemTitulos: c.origemTitulos };
  const provisorio = c.tituloDaFatura ? codigoDoLancamento(c.tituloDaFatura) : null;
  const { data: fechamentoId, error } = await supabase.rpc("crt_fechar_ciclo", {
    p_ciclo: ciclo.id, p_resultado: foto, p_itens: c.resultado.pendentes, p_residuo: c.resultado.residuoCentavos / 100,
    p_total_fatura: c.resultado.totalInformadoCentavos / 100, p_total_titulos: c.resultado.totalTitulosCentavos / 100, p_provisorio: provisorio,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };

  // Planilha do fechamento como anexo (prova). Falha aqui não desfaz o fechamento: a foto já está gravada.
  let avisoAnexo = "";
  try {
    const bytes = await gerarPlanilha(c.resultado);
    const arquivo = new File([bytes as BlobPart], nomeDaPlanilha(c.resultado), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const anexo = await enviarAnexo(supabase, { modulo: MODULO_CARTAO, referenciaTabela: "crt_fechamentos", referenciaId: fechamentoId as string }, arquivo, "planilha_fechamento");
    if (!anexo.ok) avisoAnexo = ` A planilha não foi anexada: ${anexo.erro}`;
  } catch (e) {
    avisoAnexo = ` A planilha não foi anexada: ${(e as Error).message}`;
  }
  revalidatePath(ROTA_CARTAO, "layout");
  revalidatePath("/financeiro/recebiveis/fila");
  return {
    ok: true,
    aviso: `Fatura ${ciclo.cartao_nome} ${rotuloCompetencia(ciclo.competencia)} fechada.${provisorio ? " Quando o título provisório sair do Consistem, o mês passa a Paga." : " Sem título provisório identificado: a situação Paga não será detectada sozinha."}${avisoAnexo}`,
  };
}

const esquemaReabrir = z.object({ id: z.string().uuid(), motivo: z.string().trim().min(3, "Informe o motivo da reabertura.").max(300) });

export async function reabrirCiclo(entrada: z.input<typeof esquemaReabrir>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) pode reabrir o mês do cartão." };
  const dados = esquemaReabrir.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_reabrir_ciclo", { p_ciclo: dados.data.id, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true, aviso: "Mês reaberto. A conciliação volta a ser calculada ao vivo; feche de novo quando estiver zerada." };
}

// ---------------------------------------------------------------- decisões por item (Fase 2b)

const esquemaDecisao = z.object({
  faturaId: z.string().uuid(),
  tipo: z.enum(["classificar", "justificar", "casar", "compensar", "observar"]),
  linhas: z.array(z.string().uuid()).max(100).default([]),
  titulos: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  categoria: z.string().trim().max(60).nullable().default(null),
  contaFluxo: z.string().trim().max(60).nullable().default(null),
  motivo: z.string().trim().max(500).nullable().default(null),
  /** Classificar: grava também no dicionário (trecho da descrição como padrão). */
  lembrar: z.object({ padrao: z.string().trim().min(2).max(60) }).nullable().default(null),
});

/** Registra a decisão de uma pessoa sobre item(ns) da conciliação (operador ou acima). O banco valida as regras. */
export async function registrarDecisao(entrada: z.input<typeof esquemaDecisao>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) registra decisões." };
  const dados = esquemaDecisao.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const d = dados.data;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_registrar_decisao", {
    p_fatura: d.faturaId, p_tipo: d.tipo, p_linhas: d.linhas, p_titulos: d.titulos, p_categoria: d.categoria, p_conta_fluxo: d.contaFluxo, p_motivo: d.motivo,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  let aviso = "Decisão registrada.";
  if (d.tipo === "classificar" && d.lembrar && d.categoria) {
    const { error: erroDic } = await supabase.rpc("crt_salvar_estabelecimento", { p_padrao: d.lembrar.padrao, p_categoria: d.categoria, p_conta_fluxo: d.contaFluxo, p_ativo: true });
    aviso = erroDic ? `Decisão registrada, mas o dicionário não foi atualizado: ${mensagemDeErro(erroDic)}` : "Decisão registrada e estabelecimento gravado no dicionário.";
  }
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true, aviso };
}

const esquemaDesfazerDecisao = z.object({ id: z.string().uuid(), motivo: z.string().trim().min(3, "Informe o motivo para desfazer.").max(300) });

export async function desfazerDecisao(entrada: z.input<typeof esquemaDesfazerDecisao>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) desfaz decisões." };
  const dados = esquemaDesfazerDecisao.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_desfazer_decisao", { p_decisao: dados.data.id, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true, aviso: "Decisão desfeita. O item volta a ser calculado pelo cruzamento automático." };
}

// ---------------------------------------------------------------- regras fornecedor → cartão (Neo Fiscal)

/** Copia do Neo Fiscal as regras fornecedor → cartão (Edge Function crt-sincronizar-regras). Operador ou acima. */
export async function atualizarRegrasNeoFiscal(): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) atualiza as regras." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke("crt-sincronizar-regras", { body: { acao: "sincronizar" } });
  if (error) {
    let mensagem = "Não foi possível atualizar do Neo Fiscal.";
    const resposta = (error as { context?: Response }).context;
    if (resposta && typeof resposta.json === "function") {
      try { mensagem = ((await resposta.json()) as { erro?: string }).erro ?? mensagem; } catch { /* mantém */ }
    }
    return { ok: false, erro: mensagem };
  }
  const r = data as { recebidas?: number; novas?: number; alteradas?: number; removidas?: number } | null;
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true, aviso: `Regras do Neo Fiscal: ${r?.recebidas ?? 0} recebidas · ${r?.novas ?? 0} novas · ${r?.alteradas ?? 0} alteradas · ${r?.removidas ?? 0} removidas.` };
}

