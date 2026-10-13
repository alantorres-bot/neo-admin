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
import { CAMPOS_CONFIG_ENCARGOS, ROTULO_CAMPO_CONFIG } from "@/lib/modulos/financeiro/cartao/lancamento-encargos";
import { CAMPOS_COMPRA, CAMPOS_PADRAO_CARTAO, lerCampos, montarTitulosCompra, ROTULO_CAMPO_COMPRA } from "@/lib/modulos/financeiro/cartao/lancamento-compras";
import { CONFERIR } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { normalizar } from "@/lib/modulos/financeiro/cartao/texto";
import { codigoDoLancamento, conciliacaoDaRequisicao, lerCartoes, lerCiclo, lerCompras, lerEncargos, lerEstabelecimentos, paraCartaoInfo, type FotoFechamento } from "./dados";

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

/** Códigos do Consistem num formulário (prefixo + campo). `todos` = todos ou nenhum; senão, cada um é opcional. */
function lerCodigos(dados: FormData, prefixo: string, campos: readonly string[], todos: boolean, rotulo: string): { ok: true; valor: Record<string, number> | null } | { ok: false; erro: string } {
  const brutos = campos.map((k) => [k, texto(dados, `${prefixo}${k}`)] as const);
  if (brutos.every(([, v]) => v === "")) return { ok: true, valor: null };
  const valor: Record<string, number> = {};
  for (const [k, v] of brutos) {
    if (v === "" && !todos) continue;
    if (!/^\d{1,9}$/.test(v) || Number(v) <= 0) {
      return { ok: false, erro: `${rotulo}: informe ${ROTULO_CAMPO_COMPRA[k as keyof typeof ROTULO_CAMPO_COMPRA].toLowerCase()} (número)${todos ? ", ou deixe todos vazios" : ""}.` };
    }
    valor[k] = Number(v);
  }
  return { ok: true, valor };
}

/** Códigos do Consistem do título de encargos: todos preenchidos (inteiros positivos) ou todos vazios. */
function lerCodigosEncargos(dados: FormData): { ok: true; valor: Record<string, number> | null } | { ok: false; erro: string } {
  const brutos = CAMPOS_CONFIG_ENCARGOS.map((k) => [k, texto(dados, `enc_${k}`)] as const);
  if (brutos.every(([, v]) => v === "")) return { ok: true, valor: null };
  const valor: Record<string, number> = {};
  for (const [k, v] of brutos) {
    if (!/^\d{1,9}$/.test(v) || Number(v) <= 0) return { ok: false, erro: `Encargos no Consistem: informe ${ROTULO_CAMPO_CONFIG[k].toLowerCase()} (número), ou deixe todos os códigos vazios.` };
    valor[k] = Number(v);
  }
  return { ok: true, valor };
}

export async function salvarCartao(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { erro: "Somente gestor do Financeiro (ou acima) pode alterar os cartões." };
  const v = esquemaCartao.safeParse({
    codigo: texto(dados, "codigo"), nome: texto(dados, "nome"), banco: texto(dados, "banco"), tipoPessoa: texto(dados, "tipoPessoa"),
    diaFechamento: texto(dados, "diaFechamento"), diaVencimento: texto(dados, "diaVencimento"), tipoTitulo: texto(dados, "tipoTitulo"), leitor: texto(dados, "leitor"),
    pastaFaturas: texto(dados, "pastaFaturas"), ativo: dados.get("ativo") === "on", observacao: texto(dados, "observacao"),
  });
  if (!v.success) return { erro: v.error.issues[0].message };
  const codigos = lerCodigosEncargos(dados);
  if (!codigos.ok) return { erro: codigos.erro };
  const compras = lerCodigos(dados, "cmp_", CAMPOS_PADRAO_CARTAO, true, "Padrões de compra");
  if (!compras.ok) return { erro: compras.erro };
  const d = v.data;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_salvar_cartao", {
    p_codigo: d.codigo, p_nome: d.nome, p_banco: d.banco, p_tipo_pessoa: d.tipoPessoa, p_dia_fechamento: d.diaFechamento, p_dia_vencimento: d.diaVencimento,
    p_tipo_titulo: d.tipoTitulo, p_leitor: d.leitor, p_pasta_faturas: d.pastaFaturas || null, p_ativo: d.ativo, p_observacao: d.observacao || null,
  });
  if (error) return { erro: mensagemDeErro(error) };
  const { error: erroCodigos } = await supabase.from("crt_cartoes").update({ lancamento_encargos: codigos.valor, lancamento_compras: compras.valor }).eq("codigo", d.codigo);
  if (erroCodigos) return { erro: `Cartão salvo, mas os códigos de encargos não: ${mensagemDeErro(erroCodigos)}` };
  revalidatePath(ROTA_CARTAO, "layout");
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
  const codigos = lerCodigos(dados, "erp_", CAMPOS_COMPRA, false, "Lançamento no Consistem");
  if (!codigos.ok) return { erro: codigos.erro };
  const { data: id, error } = await supabase.rpc("crt_salvar_estabelecimento", { p_padrao: v.data.padrao, p_categoria: v.data.categoria, p_conta_fluxo: v.data.contaFluxo || null, p_ativo: v.data.ativo });
  if (error) return { erro: mensagemDeErro(error) };
  const marketplace = dados.get("marketplace") === "on";
  const porCompra = dados.get("fornecedorPorCompra") === "on";
  const semFornecedorFixo = (marketplace || porCompra) && codigos.valor ? { ...codigos.valor, codFornecedor: undefined } : codigos.valor;
  const { error: erroCodigos } = await supabase.from("crt_estabelecimentos").update({ lancamento_erp: semFornecedorFixo, marketplace, fornecedor_por_compra: porCompra }).eq("id", id as string);
  if (erroCodigos) return { erro: `Estabelecimento salvo, mas os códigos do Consistem não: ${mensagemDeErro(erroCodigos)}` };
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


// ---------------------------------------------------------------- lançar encargos no Consistem (0137)

async function mensagemDaFuncao(error: unknown, padrao: string): Promise<{ mensagem: string; tipo: string | null }> {
  const resposta = (error as { context?: Response }).context;
  if (resposta && typeof resposta.json === "function") {
    try {
      const j = (await resposta.json()) as { erro?: string; mensagem?: string; tipo?: string };
      return { mensagem: j.mensagem ?? j.erro ?? padrao, tipo: j.tipo ?? null };
    } catch { /* mantém */ }
  }
  return { mensagem: padrao, tipo: null };
}

/**
 * Lança no Consistem o título com a soma dos encargos da fatura (operador ou acima). Recalcula a conciliação na hora (não
 * confia na tela), confere que o título é o mesmo que a pessoa viu (valor e linhas), reserva (crt_reservar_lancamento_encargos)
 * e chama a Edge Function crt-lancar-encargos, que envia uma vez só.
 */
export async function lancarEncargos(entrada: { faturaId: string; valorCentavos: number; linhas: string[] }): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) lança encargos no Consistem." };
  if (!z.string().uuid().safeParse(entrada.faturaId).success) return { ok: false, erro: "Fatura inválida." };
  const c = await conciliacaoDaRequisicao(entrada.faturaId);
  if (!c) return { ok: false, erro: "Fatura não encontrada." };
  if (c.origemTitulos !== "consistem") return { ok: false, erro: `Não foi possível consultar o Consistem agora (${c.avisoOrigem}). Tente de novo.` };
  const supabase = await criarClienteServidor();
  const q = await lerEncargos(supabase, c);
  if (!q.ligado) return { ok: false, erro: "O lançamento de encargos no Consistem está desligado." };
  if (!q.mesAberto) return { ok: false, erro: "Só se lançam encargos de fatura de um mês em conciliação." };
  if (q.ativo) return { ok: false, erro: `Este mês já tem lançamento de encargos (${q.ativo.cod_lancamento_erp ?? q.ativo.situacao}).` };
  const t = q.titulo;
  if (!t.ok) return { ok: false, erro: t.erro };
  const mesmas = [...t.linhas.map((a) => a.linha.id)].sort().join(",") === [...entrada.linhas].sort().join(",");
  if (t.valorCentavos !== entrada.valorCentavos || !mesmas) return { ok: false, erro: "Os encargos mudaram desde que a tela foi aberta. Recarregue e confira de novo." };

  const { data: id, error } = await supabase.rpc("crt_reservar_lancamento_encargos", {
    p_fatura: c.fatura.id, p_linhas: t.linhas.map((a) => a.linha.id), p_valor: t.valorCentavos / 100, p_complemento: t.complemento, p_payload: t.payload,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const { data, error: erroFuncao } = await supabase.functions.invoke("crt-lancar-no-consistem", { body: { id } });
  revalidatePath(ROTA_CARTAO, "layout");
  if (erroFuncao) {
    const { mensagem, tipo } = await mensagemDaFuncao(erroFuncao, "Não foi possível falar com a função de lançamento.");
    return { ok: false, erro: tipo === "incerto" ? `${mensagem} Depois de conferir, use “Resolver” na lista de lançamentos.` : mensagem };
  }
  const r = data as { codLancamento?: string } | null;
  return { ok: true, aviso: `Encargos lançados no Consistem: lançamento ${r?.codLancamento ?? "?"} (${(t.valorCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}). As linhas foram casadas com o título.` };
}

const esquemaResolver = z.object({
  id: z.string().uuid(),
  codLancamento: z.string().trim().regex(/^\d{0,12}$/, "O código do lançamento é só números.").transform((v) => v || null),
  motivo: z.string().trim().min(3, "Informe o que foi conferido no Consistem.").max(300),
});

/** Resolve à mão um lançamento sem resposta, depois de conferir no Consistem (com o código, ou "não foi criado"). */
export async function resolverLancamentoEncargos(entrada: z.input<typeof esquemaResolver>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) resolve lançamentos." };
  const dados = esquemaResolver.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_resolver_lancamento_encargos", { p_id: dados.data.id, p_cod: dados.data.codLancamento, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true, aviso: dados.data.codLancamento ? `Registrado como lançado (${dados.data.codLancamento}); as linhas foram casadas com o título.` : "Registrado como não criado. O lançamento pode ser feito de novo." };
}

// ---------------------------------------------------------------- lançar compras no Consistem (0138)

const codigoCampo = z.number().int().positive().max(999_999_999).optional();
const esquemaCompra = z.object({
  faturaId: z.string().uuid(),
  linhaId: z.string().uuid(),
  campos: z.object(Object.fromEntries(CAMPOS_COMPRA.map((k) => [k, codigoCampo])) as Record<(typeof CAMPOS_COMPRA)[number], typeof codigoCampo>),
  /** Lembrar a escolha para as próximas compras do estabelecimento (trecho da descrição). */
  lembrar: z.object({ padrao: z.string().trim().min(2, "Informe o trecho do estabelecimento.").max(60) }).nullable(),
});

async function enviarLote(supabase: Awaited<ReturnType<typeof criarClienteServidor>>, lote: string): Promise<{ ok: true; codigos: string[] } | { ok: false; erro: string }> {
  const { data, error } = await supabase.functions.invoke("crt-lancar-no-consistem", { body: { lote } });
  if (error) {
    const { mensagem, tipo } = await mensagemDaFuncao(error, "Não foi possível falar com a função de lançamento.");
    return { ok: false, erro: tipo === "incerto" ? `${mensagem} Depois de conferir, use “Resolver” na lista de compras lançadas.` : mensagem };
  }
  const r = data as { lancados?: { codLancamento: string }[] } | null;
  return { ok: true, codigos: (r?.lancados ?? []).map((x) => x.codLancamento) };
}

/**
 * Lança no Consistem a compra sem título (operador ou acima): recalcula a conciliação, confere que a linha ainda está a lançar,
 * monta os títulos (todas as parcelas restantes) com os códigos conferidos, reserva (crt_reservar_lancamento_compra) e envia.
 * Com "lembrar", grava os códigos como sugestão do estabelecimento.
 */
export async function lancarCompra(entrada: z.input<typeof esquemaCompra>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) lança compras no Consistem." };
  const dados = esquemaCompra.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const d = dados.data;
  const c = await conciliacaoDaRequisicao(d.faturaId);
  if (!c) return { ok: false, erro: "Fatura não encontrada." };
  if (c.origemTitulos !== "consistem") return { ok: false, erro: `Não foi possível consultar o Consistem agora (${c.avisoOrigem}). Tente de novo.` };
  const supabase = await criarClienteServidor();
  const q = await lerCompras(supabase, c);
  if (!q.ligado) return { ok: false, erro: "O lançamento no Consistem está desligado." };
  if (!q.mesAberto || !q.competencia) return { ok: false, erro: "Só se lançam compras de fatura de um mês em conciliação." };
  const proposta = q.propostas[d.linhaId];
  const item = c.resultado.aLancar.find((a) => a.linha.id === d.linhaId);
  if (!proposta || !item) return { ok: false, erro: "Esta linha não está mais entre as compras a lançar. Recarregue a página." };
  const t = montarTitulosCompra({ linha: item.linha, cartao: paraCartaoInfo(c.cartao), campos: lerCampos(d.campos), vencimentoFatura: c.fatura.vencimento, competencia: q.competencia });
  if (!t.ok) return { ok: false, erro: t.erro };

  const { data: lote, error } = await supabase.rpc("crt_reservar_lancamento_compra", {
    p_fatura: c.fatura.id, p_linha: d.linhaId, p_titulos: t.titulos.map((x) => ({ parcela: x.parcela, vencimento: x.vencimento, payload: x.payload })),
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };

  let avisoLembrar = "";
  if (d.lembrar) {
    const chave = normalizar(d.lembrar.padrao);
    const existente = (await lerEstabelecimentos(supabase)).find((e) => normalizar(e.padrao) === chave);
    const categoria = existente?.categoria ?? (item.categoria && item.categoria !== CONFERIR ? item.categoria : "Compra no cartão");
    const { data: idEstab, error: erroEstab } = await supabase.rpc("crt_salvar_estabelecimento", {
      p_padrao: d.lembrar.padrao, p_categoria: categoria, p_conta_fluxo: existente?.conta_fluxo ?? null, p_ativo: true,
    });
    const { error: erroCodigos } = erroEstab ? { error: erroEstab } : await supabase.from("crt_estabelecimentos").update({ lancamento_erp: d.campos }).eq("id", idEstab as string);
    avisoLembrar = erroCodigos ? ` A sugestão não foi gravada: ${mensagemDeErro(erroCodigos)}` : ` Sugestão gravada para ${chave}.`;
  }
  const envio = await enviarLote(supabase, lote as string);
  revalidatePath(ROTA_CARTAO, "layout");
  if (!envio.ok) return { ok: false, erro: envio.erro + avisoLembrar };
  const n = envio.codigos.length;
  return { ok: true, aviso: `${n === 1 ? "Compra lançada" : `${n} parcelas lançadas`} no Consistem: ${envio.codigos.join(", ")}. A linha foi casada com o título.${avisoLembrar}` };
}

/** Reenvia as parcelas que ficaram de fora de um lote interrompido. */
export async function reenviarLote(entrada: { lote: string }): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) reenvia lançamentos." };
  if (!z.string().uuid().safeParse(entrada.lote).success) return { ok: false, erro: "Lote inválido." };
  const supabase = await criarClienteServidor();
  const { data: novo, error } = await supabase.rpc("crt_reenviar_lancamentos", { p_lote: entrada.lote });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const envio = await enviarLote(supabase, novo as string);
  revalidatePath(ROTA_CARTAO, "layout");
  return envio.ok ? { ok: true, aviso: `Parcelas lançadas no Consistem: ${envio.codigos.join(", ")}.` } : { ok: false, erro: envio.erro };
}

/** Busca fornecedores do Consistem (espelho cap_fornecedores) da empresa, por nome ou código. */
export async function buscarFornecedores(entrada: { empresaId: string; termo: string }): Promise<{ cod: number; nome: string }[]> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "consulta")) return [];
  const termo = entrada.termo.trim();
  if (!z.string().uuid().safeParse(entrada.empresaId).success || termo.length < 2) return [];
  const supabase = await criarClienteServidor();
  let consulta = supabase.from("cap_fornecedores").select("cod_fornecedor, nome").eq("empresa_id", entrada.empresaId).limit(20);
  consulta = /^\d+$/.test(termo) ? consulta.eq("cod_fornecedor", termo) : consulta.ilike("nome", `%${termo.replace(/[%_]/g, "")}%`);
  const { data } = await consulta.order("nome");
  return (data ?? []).map((f) => ({ cod: Number(f.cod_fornecedor), nome: f.nome as string })).filter((f) => Number.isInteger(f.cod) && f.cod > 0);
}

// ---------------------------------------------------------------- fornecedor "Outros" no Consistem (0140)

const esquemaCadastroFornecedor = z.object({
  empresaId: z.string().uuid(),
  nome: z.string().trim().min(2, "Informe o nome do fornecedor.").max(60),
  categoria: z.number().int().min(1, "Categoria de 1 a 99.").max(99, "Categoria de 1 a 99."),
  grupo: z.number().int().min(1, "Grupo de 1 a 999.").max(999, "Grupo de 1 a 999."),
  estabelecimentoId: z.string().uuid().nullable(),
});

/** Cadastra no Consistem o fornecedor "Outros" (tipo 3, endereço fixo), operador ou acima: reserva no banco e envia. */
export async function cadastrarFornecedor(entrada: z.input<typeof esquemaCadastroFornecedor>): Promise<{ ok: true; aviso: string; codFornecedor: number; nome: string } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) cadastra fornecedor no Consistem." };
  const dados = esquemaCadastroFornecedor.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const d = dados.data;
  const supabase = await criarClienteServidor();
  const { data: id, error } = await supabase.rpc("crt_reservar_cadastro_fornecedor", {
    p_empresa: d.empresaId, p_nome: d.nome, p_categoria: d.categoria, p_grupo: d.grupo, p_estabelecimento: d.estabelecimentoId,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const { data, error: erroFuncao } = await supabase.functions.invoke("crt-cadastrar-fornecedor", { body: { id } });
  revalidatePath(ROTA_CARTAO, "layout");
  if (erroFuncao) {
    const { mensagem } = await mensagemDaFuncao(erroFuncao, "Não foi possível falar com a função de cadastro.");
    return { ok: false, erro: mensagem };
  }
  const cod = Number((data as { codFornecedor?: string } | null)?.codFornecedor);
  const nome = d.nome.toUpperCase();
  return { ok: true, aviso: `Fornecedor cadastrado no Consistem: ${cod} · ${nome}.`, codFornecedor: cod, nome };
}

/** Liga o estabelecimento a um fornecedor que já existe (grava o código na sugestão). */
export async function ligarFornecedor(entrada: { estabelecimentoId: string; codFornecedor: number }): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) liga fornecedor." };
  if (!z.string().uuid().safeParse(entrada.estabelecimentoId).success || !Number.isInteger(entrada.codFornecedor)) return { ok: false, erro: "Dados inválidos." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_ligar_fornecedor", { p_estabelecimento: entrada.estabelecimentoId, p_cod_fornecedor: String(entrada.codFornecedor) });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true, aviso: `Estabelecimento ligado ao fornecedor ${entrada.codFornecedor}.` };
}
