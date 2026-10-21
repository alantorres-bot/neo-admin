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
import { CAMPOS_COMPRA, CAMPOS_PADRAO_CARTAO, conferirContas, lerCampos, montarTitulosCompra, ROTULO_CAMPO_COMPRA } from "@/lib/modulos/financeiro/cartao/lancamento-compras";
import { chaveTitulo, CONFERIR } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { aVista, camposDaSelecao } from "@/lib/modulos/financeiro/cartao/lancamento-agrupado";
import { comMarcasDaFatura, titulosParaTrocar } from "@/lib/modulos/financeiro/cartao/portador-fatura";
import type { ResultadoConciliacao } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { normalizar } from "@/lib/modulos/financeiro/cartao/texto";
import { categoriasDosFornecedores, codigoDoLancamento, conciliacaoDaRequisicao, lerCartoes, lerCiclo, lerCompras, lerDesdobrar, lerDetalheDoConsistem, lerEncargos, lerEstabelecimentos, lerProvisorio, paraCartaoInfo, type FotoFechamento } from "./dados";
import { montarDesdobramento } from "@/lib/modulos/financeiro/cartao/desdobramento";
import { motivoNaoEhOMesmo, recusaDeLancamento, travaDeLancamento } from "@/lib/modulos/financeiro/cartao/roteiro";

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
  const portadorBruto = texto(dados, "portadorFatura");
  if (portadorBruto !== "" && (!/^\d{1,9}$/.test(portadorBruto) || Number(portadorBruto) <= 0)) return { erro: "Banco da fatura no Consistem: informe o código (número), ou deixe vazio." };
  const historicoBruto = texto(dados, "historicoFatura");
  if (historicoBruto !== "" && (!/^\d{1,9}$/.test(historicoBruto) || Number(historicoBruto) <= 0)) return { erro: "Histórico da fatura no Consistem: informe o código (número), ou deixe vazio." };
  const d = v.data;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_salvar_cartao", {
    p_codigo: d.codigo, p_nome: d.nome, p_banco: d.banco, p_tipo_pessoa: d.tipoPessoa, p_dia_fechamento: d.diaFechamento, p_dia_vencimento: d.diaVencimento,
    p_tipo_titulo: d.tipoTitulo, p_leitor: d.leitor, p_pasta_faturas: d.pastaFaturas || null, p_ativo: d.ativo, p_observacao: d.observacao || null,
  });
  if (error) return { erro: mensagemDeErro(error) };
  const { error: erroCodigos } = await supabase.from("crt_cartoes").update({ lancamento_encargos: codigos.valor, lancamento_compras: compras.valor, portador_fatura: portadorBruto ? Number(portadorBruto) : null, historico_fatura: historicoBruto ? Number(historicoBruto) : null }).eq("codigo", d.codigo);
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
  const bloqueio = bloqueioDoFechamento({ itensALancar: c.resultado.pendentes, residuoCentavos: c.resultado.residuoCentavos, aDesdobrar: c.resultado.aDesdobrar?.length });
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
  // Provisório da fatura (regra 54): se a conciliação não achou um, cria no Consistem. Falha não desfaz o fechamento.
  let avisoProvisorio = " Quando o título provisório sair do Consistem, o mês passa a Paga.";
  if (!provisorio) {
    const r = await criarProvisorioDoCiclo(supabase, ciclo);
    avisoProvisorio = r.ok
      ? ` Provisório criado no Consistem: lançamento ${r.cod}. Quando ele sair do Consistem, o mês passa a Paga.`
      : ` O provisório NÃO foi criado (${r.erro}): pendência "Criar o provisório" aberta.`;
  }
  // Banco da fatura nos títulos (regra 56): falha não desfaz o fechamento (vira a pendência "Trocar o banco dos títulos").
  let avisoPortador = "";
  if (c.cartao.portador_fatura) {
    const t = await trocarPortadorDoCiclo(supabase, ciclo.id, c.resultado, { portador: c.cartao.portador_fatura, historico: c.cartao.historico_fatura }, provisorio);
    avisoPortador = ` ${t.aviso}`;
  }
  revalidatePath(ROTA_CARTAO, "layout");
  revalidatePath("/financeiro/recebiveis/fila");
  return { ok: true, aviso: `Fatura ${ciclo.cartao_nome} ${rotuloCompetencia(ciclo.competencia)} fechada.${avisoProvisorio}${avisoPortador}${avisoAnexo}` };
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

/**
 * "Não é o mesmo" (regra 67): a pessoa conferiu que o possível título já lançado não é a compra da linha. Registra a observação
 * "Conferido: não é o título <código>" na linha, que libera o botão Lançar dela. Recalcula para confirmar que o título ainda é
 * candidato da linha.
 */
export async function conferirNaoEhOMesmo(entrada: { faturaId: string; linhaId: string; titulo: string }): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) registra decisões." };
  if (!z.string().uuid().safeParse(entrada.faturaId).success || !z.string().uuid().safeParse(entrada.linhaId).success) return { ok: false, erro: "Dados inválidos." };
  const c = await conciliacaoDaRequisicao(entrada.faturaId);
  if (!c) return { ok: false, erro: "Fatura não encontrada." };
  const t = travaDeLancamento(c.resultado, c.outros).possiveis.get(entrada.linhaId)?.find((x) => chaveTitulo(x) === entrada.titulo);
  if (!t) return { ok: false, erro: "Este título não aparece mais como possível lançamento da linha. Recarregue a página." };
  return registrarDecisao({ faturaId: entrada.faturaId, tipo: "observar", linhas: [entrada.linhaId], titulos: [], motivo: motivoNaoEhOMesmo(t) });
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
 * Lança no Consistem os encargos da fatura, UM TÍTULO POR LINHA (operador ou acima; regra 31 desde 21/10/2026). Recalcula a
 * conciliação na hora (não confia na tela), confere que as linhas são as que a pessoa viu, reserva o lote
 * (crt_reservar_lancamentos_encargos) e envia em ordem, um título de cada vez (Edge Function crt-lancar-no-consistem).
 */
export async function lancarEncargos(entrada: { faturaId: string; linhas: string[] }): Promise<Resultado> {
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
  const t = q.titulos;
  if (!t.ok) return { ok: false, erro: t.erro };
  const mesmas = t.titulos.map((x) => x.item.linha.id).sort().join(",") === [...entrada.linhas].sort().join(",");
  if (!mesmas) return { ok: false, erro: "Os encargos mudaram desde que a tela foi aberta. Recarregue e confira de novo." };

  const { data: lote, error } = await supabase.rpc("crt_reservar_lancamentos_encargos", {
    p_fatura: c.fatura.id, p_titulos: t.titulos.map((x) => ({ linha: x.item.linha.id, payload: x.payload })),
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const envio = await enviarLote(supabase, lote as string);
  revalidatePath(ROTA_CARTAO, "layout");
  if (!envio.ok) return { ok: false, erro: envio.erro };
  const n = envio.codigos.length;
  return { ok: true, aviso: `${n === 1 ? "Encargo lançado" : `${n} encargos lançados`} no Consistem: ${envio.codigos.join(", ")}. Cada linha foi casada com o seu título.` };
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
    return { ok: false, erro: tipo === "incerto" ? `${mensagem} Depois de conferir, use “Resolver” na lista de lançamentos.` : mensagem };
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
  const travada = recusaDeLancamento(travaDeLancamento(c.resultado, c.outros), [d.linhaId]);
  if (travada) return { ok: false, erro: travada };
  const contas = conferirContas(lerCampos(d.campos), q.creditoPadrao);
  if (contas) return { ok: false, erro: contas };
  const camposCompra = comMarcasDaFatura(await comCategoriaDoFornecedor(supabase, c.fatura.empresa_id, lerCampos(d.campos)), { portador: c.cartao.portador_fatura, historico: c.cartao.historico_fatura });
  const t = montarTitulosCompra({ linha: item.linha, cartao: paraCartaoInfo(c.cartao), campos: camposCompra, vencimentoFatura: c.fatura.vencimento, competencia: q.competencia });
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
export async function buscarFornecedores(entrada: { empresaId: string; termo: string }): Promise<{ cod: number; nome: string; categoria: number | null }[]> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "consulta")) return [];
  const termo = entrada.termo.trim();
  if (!z.string().uuid().safeParse(entrada.empresaId).success || termo.length < 2) return [];
  const supabase = await criarClienteServidor();
  let consulta = supabase.from("cap_fornecedores").select("cod_fornecedor, nome, cod_categoria").eq("empresa_id", entrada.empresaId).limit(20);
  consulta = /^\d+$/.test(termo) ? consulta.eq("cod_fornecedor", termo) : consulta.ilike("nome", `%${termo.replace(/[%_]/g, "")}%`);
  const { data } = await consulta.order("nome");
  return (data ?? []).map((f) => ({ cod: Number(f.cod_fornecedor), nome: f.nome as string, categoria: f.cod_categoria === null ? null : Number(f.cod_categoria) }))
    .filter((f) => Number.isInteger(f.cod) && f.cod > 0);
}

// ---------------------------------------------------------------- fornecedor "Outros" no Consistem (0140)

const esquemaCadastroFornecedor = z.object({
  empresaId: z.string().uuid(),
  nome: z.string().trim().min(2, "Informe o nome do fornecedor.").max(60),
  categoria: z.number().int().min(1, "Categoria de 1 a 99.").max(99, "Categoria de 1 a 99."),
  grupo: z.number({ message: "Escolha a conta de fluxo." }).int().min(1, "Escolha a conta de fluxo.").max(999),
  item: z.number({ message: "Escolha a conta de fluxo." }).int().min(1, "Escolha a conta de fluxo.").max(999),
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
    p_empresa: d.empresaId, p_nome: d.nome, p_categoria: d.categoria, p_grupo: d.grupo, p_item: d.item, p_estabelecimento: d.estabelecimentoId,
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

// ---------------------------------------------------------------- lançar selecionadas: um título por linha (0175)

const esquemaSelecionadas = z.object({
  faturaId: z.string().uuid(),
  linhas: z.array(z.string().uuid()).min(1, "Escolha as linhas.").max(200),
  /** Códigos do diálogo: só completam o que faltar na sugestão de cada linha. */
  campos: z.object(Object.fromEntries(CAMPOS_COMPRA.map((k) => [k, codigoCampo])) as Record<(typeof CAMPOS_COMPRA)[number], typeof codigoCampo>),
});

/**
 * "Lançar selecionadas" (regra 52, desde 21/10/2026): várias linhas à vista, UM TÍTULO POR LINHA, cada uma com a sua descrição e
 * os seus códigos. Recalcula e confere tudo antes de começar; depois lança uma linha de cada vez (cada uma num lote próprio, pela
 * mesma reserva da compra) e para na primeira que não lançar — as já lançadas ficam casadas e não se repetem.
 */
export async function lancarSelecionadas(entrada: z.input<typeof esquemaSelecionadas>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) lança compras no Consistem." };
  const dados = esquemaSelecionadas.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const d = dados.data;
  const c = await conciliacaoDaRequisicao(d.faturaId);
  if (!c) return { ok: false, erro: "Fatura não encontrada." };
  if (c.origemTitulos !== "consistem") return { ok: false, erro: `Não foi possível consultar o Consistem agora (${c.avisoOrigem}). Tente de novo.` };
  const supabase = await criarClienteServidor();
  const q = await lerCompras(supabase, c);
  if (!q.ligado) return { ok: false, erro: "O lançamento no Consistem está desligado." };
  if (!q.mesAberto || !q.competencia) return { ok: false, erro: "Só se lançam compras de fatura de um mês em conciliação." };
  const travada = recusaDeLancamento(travaDeLancamento(c.resultado, c.outros), d.linhas);
  if (travada) return { ok: false, erro: travada };

  // Monta e confere todos os títulos antes de enviar o primeiro.
  const comuns = lerCampos(d.campos);
  const preparados: { linhaId: string; descricao: string; titulos: { parcela: number; vencimento: string; payload: unknown }[] }[] = [];
  for (const id of new Set(d.linhas)) {
    const item = c.resultado.aLancar.find((a) => a.linha.id === id);
    const proposta = q.propostas[id];
    if (!item || !proposta || !aVista(item.linha)) return { ok: false, erro: "Uma das linhas não está mais entre as compras à vista a lançar. Recarregue a página." };
    const campos = camposDaSelecao(proposta.sugestao.campos, comuns);
    const contas = conferirContas(campos, q.creditoPadrao);
    if (contas) return { ok: false, erro: `${item.linha.descricao}: ${contas}` };
    const comMarcas = comMarcasDaFatura(await comCategoriaDoFornecedor(supabase, c.fatura.empresa_id, campos), { portador: c.cartao.portador_fatura, historico: c.cartao.historico_fatura });
    const t = montarTitulosCompra({ linha: item.linha, cartao: paraCartaoInfo(c.cartao), campos: comMarcas, vencimentoFatura: c.fatura.vencimento, competencia: q.competencia });
    if (!t.ok) return { ok: false, erro: `${item.linha.descricao}: ${t.erro}` };
    preparados.push({ linhaId: id, descricao: item.linha.descricao, titulos: t.titulos.map((x) => ({ parcela: x.parcela, vencimento: x.vencimento, payload: x.payload })) });
  }

  const codigos: string[] = [];
  for (const p of preparados) {
    const { data: lote, error } = await supabase.rpc("crt_reservar_lancamento_compra", { p_fatura: c.fatura.id, p_linha: p.linhaId, p_titulos: p.titulos });
    const envio = error ? { ok: false as const, erro: mensagemDeErro(error) } : await enviarLote(supabase, lote as string);
    if (!envio.ok) {
      revalidatePath(ROTA_CARTAO, "layout");
      const feitos = codigos.length ? `${codigos.length} ${codigos.length === 1 ? "título lançado" : "títulos lançados"} (${codigos.join(", ")}); ` : "";
      return { ok: false, erro: `${feitos}parou em “${p.descricao}”: ${envio.erro}` };
    }
    codigos.push(...envio.codigos);
  }
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true, aviso: `${codigos.length} ${codigos.length === 1 ? "título lançado" : "títulos lançados"} no Consistem, um por linha: ${codigos.join(", ")}.` };
}

// ---------------------------------------------------------------- provisório da fatura (0154)

/** Monta, reserva e envia o provisório do mês fechado; em falha abre a pendência "Criar o provisório". */
async function criarProvisorioDoCiclo(supabase: Awaited<ReturnType<typeof criarClienteServidor>>, ciclo: { id: string; cartao: string; competencia: string; fatura_id: string | null }): Promise<{ ok: true; cod: string } | { ok: false; erro: string }> {
  const falhar = async (erro: string) => {
    await supabase.rpc("crt_pendencia_provisorio", { p_ciclo: ciclo.id, p_motivo: erro });
    return { ok: false as const, erro };
  };
  const q = await lerProvisorio(supabase, ciclo);
  if (!q) return falhar("fatura ou cartão não encontrados");
  if (!q.ligado) return falhar("o lançamento no Consistem está desligado");
  if (!q.titulo.ok) return falhar(q.titulo.erro);
  const { data: lote, error } = await supabase.rpc("crt_reservar_provisorio", { p_ciclo: ciclo.id, p_payload: q.titulo.payload });
  if (error) return falhar(mensagemDeErro(error));
  const envio = await enviarLote(supabase, lote as string);
  if (!envio.ok) return falhar(envio.erro);
  return { ok: true, cod: envio.codigos[0] ?? "?" };
}

/** Botão "Criar provisório no Consistem" no mês fechado sem provisório (gestor). */
export async function criarProvisorio(entrada: { cicloId: string }): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) cria o provisório." };
  if (!z.string().uuid().safeParse(entrada.cicloId).success) return { ok: false, erro: "Mês do cartão inválido." };
  const supabase = await criarClienteServidor();
  const lido = await lerCiclo(supabase, entrada.cicloId);
  if (!lido) return { ok: false, erro: "Mês do cartão não encontrado." };
  if (lido.ciclo.situacao !== "fechada" || lido.ciclo.provisorio_cod_lancamento) return { ok: false, erro: "Só um mês fechado e sem provisório." };
  const r = await criarProvisorioDoCiclo(supabase, lido.ciclo);
  revalidatePath(ROTA_CARTAO, "layout");
  return r.ok ? { ok: true, aviso: `Provisório criado no Consistem: lançamento ${r.cod}.` } : { ok: false, erro: `O provisório não foi criado: ${r.erro}` };
}

/** O Consistem exige a categoria do título = a do fornecedor (regra 55): troca a categoriaDoc pela do fornecedor escolhido. */
async function comCategoriaDoFornecedor<T extends { codFornecedor?: number; categoriaDoc?: number }>(supabase: Awaited<ReturnType<typeof criarClienteServidor>>, empresaId: string, campos: T): Promise<T> {
  if (!campos.codFornecedor) return campos;
  const cat = (await categoriasDosFornecedores(supabase, empresaId, [campos.codFornecedor])).get(String(campos.codFornecedor));
  return cat ? { ...campos, categoriaDoc: cat } : campos;
}

// ---------------------------------------------------------------- banco da fatura nos títulos do Consistem (0162)

const CHAVE_TROCAR_PORTADOR = "financeiro.cartao.trocar_portador_no_erp";

/** Reserva e envia a troca do portador dos títulos conciliados do mês fechado. Nunca lança erro: devolve o aviso para a tela. */
async function trocarPortadorDoCiclo(supabase: Awaited<ReturnType<typeof criarClienteServidor>>, cicloId: string, resultado: Pick<ResultadoConciliacao, "conciliados">, marcas: { portador: number; historico: number | null }, provisorio: string | null): Promise<{ ok: boolean; aviso: string }> {
  const { portador, historico } = marcas;
  const alvo = `banco ${portador}${historico ? ` e histórico ${historico}` : ""}`;
  const { data: chave } = await supabase.from("configuracoes").select("valor").eq("chave", CHAVE_TROCAR_PORTADOR).maybeSingle();
  if ((chave as { valor: unknown } | null)?.valor !== true) return { ok: false, aviso: `A troca dos títulos para ${alvo} no Consistem está desligada.` };
  const lista = titulosParaTrocar(resultado, { portador, historico, provisorio });
  if (!lista.length) return { ok: true, aviso: `Nenhum título a trocar para ${alvo}.` };
  const { data: lote, error } = await supabase.rpc("crt_reservar_trocas", { p_ciclo: cicloId, p_titulos: lista });
  if (error) return { ok: false, aviso: `O banco dos títulos NÃO foi trocado: ${mensagemDeErro(error)}` };
  if (!lote) return { ok: true, aviso: `Os títulos já estão com ${alvo}.` };
  const { data, error: erroFuncao } = await supabase.functions.invoke("crt-trocar-portador", { body: { lote } });
  if (erroFuncao) {
    const { mensagem } = await mensagemDaFuncao(erroFuncao, "Não foi possível falar com a função de troca do banco.");
    await supabase.rpc("crt_falha_trocas", { p_lote: lote, p_motivo: mensagem });
    return { ok: false, aviso: `O banco dos títulos NÃO foi trocado (${mensagem}): pendência "Trocar o banco dos títulos" aberta.` };
  }
  const r = data as { trocados?: string[]; erros?: { cod: string; mensagem: string }[] } | null;
  const n = r?.trocados?.length ?? 0;
  const erros = r?.erros ?? [];
  const feitos = `${n} ${n === 1 ? "título passou" : "títulos passaram"} para ${alvo} no Consistem.`;
  return erros.length
    ? { ok: false, aviso: `${feitos} ${erros.length} com erro (primeiro: ${erros[0].cod} — ${erros[0].mensagem}): pendência "Trocar o banco dos títulos" aberta.` }
    : { ok: true, aviso: feitos };
}

/** Botão "Trocar de novo" no mês fechado (operador): usa os títulos do fechamento vigente. */
export async function trocarPortador(entrada: { cicloId: string }): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) troca o banco dos títulos." };
  if (!z.string().uuid().safeParse(entrada.cicloId).success) return { ok: false, erro: "Mês do cartão inválido." };
  const supabase = await criarClienteServidor();
  const lido = await lerCiclo(supabase, entrada.cicloId);
  if (!lido) return { ok: false, erro: "Mês do cartão não encontrado." };
  const { ciclo, fechamentos } = lido;
  const vigente = fechamentos.find((f) => !f.reaberto_em);
  if ((ciclo.situacao !== "fechada" && ciclo.situacao !== "paga") || !vigente) return { ok: false, erro: "Só um mês fechado tem títulos para trocar o banco." };
  const cartao = (await lerCartoes(supabase)).find((x) => x.codigo === ciclo.cartao);
  if (!cartao?.portador_fatura) return { ok: false, erro: "O cartão não tem o banco da fatura no Consistem (cadastro de cartões)." };
  const foto = vigente.resultado;
  if (!foto?.resultado?.conciliados) return { ok: false, erro: "O fechamento não tem os títulos conciliados." };
  const r = await trocarPortadorDoCiclo(supabase, ciclo.id, foto.resultado, { portador: cartao.portador_fatura, historico: cartao.historico_fatura }, ciclo.provisorio_cod_lancamento ?? vigente.provisorio_cod_lancamento);
  revalidatePath(ROTA_CARTAO, "layout");
  return r.ok ? { ok: true, aviso: r.aviso } : { ok: false, erro: r.aviso };
}

// ---------------------------------------------------------------- compra lançada pelo total: desdobrar no Consistem (0165)

const esquemaDesdobrar = z.object({ faturaId: z.string().uuid(), linhaId: z.string().uuid(), codLancamento: z.string().regex(/^\d{1,12}$/) });

/**
 * Desdobra no Consistem a compra parcelada cuja NF foi lançada pelo total (operador ou acima): recalcula a conciliação, confere que
 * o par (linha 1/N × título cheio) ainda existe, lê o detalhe do título no Consistem, monta a alteração e as parcelas 2..N
 * (`montarDesdobramento`), reserva (crt_reservar_desdobramento) e chama a Edge Function crt-desdobrar-no-consistem.
 */
export async function desdobrarNoConsistem(entrada: z.input<typeof esquemaDesdobrar>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) desdobra títulos no Consistem." };
  const dados = esquemaDesdobrar.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: "Dados inválidos." };
  const d = dados.data;
  const c = await conciliacaoDaRequisicao(d.faturaId);
  if (!c) return { ok: false, erro: "Fatura não encontrada." };
  if (c.origemTitulos !== "consistem") return { ok: false, erro: `Não foi possível consultar o Consistem agora (${c.avisoOrigem}). Tente de novo.` };
  const par = (c.resultado.aDesdobrar ?? []).find((p) => p.linha.id === d.linhaId && codigoDoLancamento(p.titulo) === d.codLancamento);
  if (!par) return { ok: false, erro: "Esta compra não está mais entre as lançadas pelo total. Recarregue a página." };
  const supabase = await criarClienteServidor();
  const q = await lerDesdobrar(supabase, c);
  if (!q.ligado) return { ok: false, erro: "O desdobramento no Consistem está desligado." };
  if (!q.mesAberto || !q.competencia) return { ok: false, erro: "Só se desdobra compra de fatura de um mês em conciliação." };
  let detalhe: Record<string, unknown>;
  try {
    detalhe = await lerDetalheDoConsistem(supabase, c.fatura.empresa_id, d.codLancamento);
  } catch (e) {
    return { ok: false, erro: `Não foi possível ler o título ${d.codLancamento} no Consistem: ${(e as Error).message}. Nada foi alterado.` };
  }
  const m = montarDesdobramento({ par, detalhe, cartao: q.cartao, competencia: q.competencia, marcas: { portador: c.cartao.portador_fatura, historico: c.cartao.historico_fatura } });
  if (!m.ok) return { ok: false, erro: m.erro };

  const { data: lote, error } = await supabase.rpc("crt_reservar_desdobramento", {
    p_fatura: c.fatura.id, p_linha: d.linhaId, p_cod: d.codLancamento, p_titulo: { num_documento: par.titulo.numeroTitulo, fornecedor: par.titulo.fornecedor },
    p_antes: detalhe, p_alteracao: m.alteracao, p_parcelas: m.parcelas.map((x) => ({ parcela: x.parcela, vencimento: x.vencimento, payload: x.payload })),
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const { data, error: erroFuncao } = await supabase.functions.invoke("crt-desdobrar-no-consistem", { body: { lote } });
  revalidatePath(ROTA_CARTAO, "layout");
  if (erroFuncao) {
    const { mensagem } = await mensagemDaFuncao(erroFuncao, "Não foi possível falar com a função de desdobramento.");
    await supabase.rpc("crt_falha_desdobramento", { p_lote: lote, p_motivo: mensagem });
    return { ok: false, erro: mensagem };
  }
  const r = data as { lancados?: { codLancamento: string }[] } | null;
  const codigos = (r?.lancados ?? []).map((x) => x.codLancamento);
  return { ok: true, aviso: `Título ${d.codLancamento} desdobrado no Consistem: agora é a parcela 1 (${(par.parcelaCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}); parcelas 2 a ${par.parcelas} criadas: ${codigos.join(", ")}.` };
}

const esquemaResolverDesdobramento = z.object({ id: z.string().uuid(), motivo: z.string().trim().min(3, "Informe o que foi conferido no Consistem.").max(300) });

/** "Já está alterado no Consistem": conferido à mão, libera as parcelas para "Reenviar o que faltou". */
export async function resolverDesdobramento(entrada: z.input<typeof esquemaResolverDesdobramento>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) resolve desdobramentos." };
  const dados = esquemaResolverDesdobramento.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_resolver_desdobramento", { p_id: dados.data.id, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true, aviso: "Registrado: o título original já está alterado. Use “Reenviar o que faltou” para criar as parcelas." };
}

const esquemaExclusao = z.object({ id: z.string().uuid(), motivo: z.string().trim().min(10, "Informe o motivo (ex.: duplicava a NF 3615152).").max(500) });

/** Registra que um título lançado pelo painel foi EXCLUÍDO no Consistem (gestor). Nada é apagado no Neo Admin. */
export async function registrarExclusaoErp(entrada: z.input<typeof esquemaExclusao>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) registra a exclusão de um título no Consistem." };
  const dados = esquemaExclusao.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("crt_registrar_exclusao_erp", { p_id: dados.data.id, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CARTAO, "layout");
  return { ok: true, aviso: "Exclusão no Consistem registrada. O título deixa de contar como lançado pelo painel e as linhas dele voltam a lançar (mês em conciliação)." };
}
