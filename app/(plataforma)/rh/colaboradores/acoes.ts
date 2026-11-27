"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { casarComCadastro, type Casamento, type FuncionarioControlId } from "@/lib/modulos/rh/colaboradores/controlid";
import { divergencias, lerTarifa, normalizarAgencia, normalizarCodFornecedor, normalizarConta, normalizarCpf, type Divergencia, type FornecedorConsistem } from "@/lib/modulos/rh/colaboradores/cadastro";
import { ehFormaPagamento, ROTA_COLABORADORES } from "@/lib/modulos/rh/colaboradores/modulo";
import { lerFichaRegistro } from "@/lib/modulos/rh/colaboradores/ficha-registro";
import { extrairPaginasDoPdf } from "@/lib/modulos/financeiro/cartao/fatura-pdf";
import { lerReais } from "@/lib/modulos/rh/folha/modulo";
import { ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { COLUNAS_COLABORADOR, paraColaborador, type ColaboradorLinha, type RascunhoColaborador } from "./dados";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const texto = (d: FormData, nome: string) => String(d.get(nome) ?? "").trim();
const SEM_PERMISSAO = "Somente operador do RH (ou acima) altera o cadastro de colaboradores.";
const revalidar = () => { revalidatePath(ROTA_COLABORADORES, "layout"); revalidatePath(ROTA_VT, "layout"); };

// ---------------------------------------------------------------- cadastro

const esquemaColaborador = z.object({
  id: z.string().uuid().nullable(),
  empresaId: z.string().uuid("Escolha a empresa do Consistem."),
  empregador: z.string().trim().min(2, "Informe a empresa empregadora.").max(40),
  nome: z.string().trim().min(3, "Informe o nome.").max(120),
  passagensDia: z.coerce.number().int().min(1, "Passagens por dia: de 1 a 8.").max(8, "Passagens por dia: de 1 a 8."),
  observacao: z.string().trim().max(300),
});

export async function salvarColaborador(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "operador")) return { erro: SEM_PERMISSAO };
  const v = esquemaColaborador.safeParse({
    id: texto(dados, "id") || null, empresaId: texto(dados, "empresaId"), empregador: texto(dados, "empregador"), nome: texto(dados, "nome"),
    passagensDia: texto(dados, "passagensDia") || "2", observacao: texto(dados, "observacao"),
  });
  if (!v.success) return { erro: v.error.issues[0].message };
  const cod = normalizarCodFornecedor(texto(dados, "codFornecedor"));
  if (!cod.ok) return { erro: cod.erro };
  const cpf = normalizarCpf(texto(dados, "cpf"));
  if (!cpf.ok) return { erro: cpf.erro };
  const agencia = normalizarAgencia(texto(dados, "agencia"));
  if (!agencia.ok) return { erro: agencia.erro };
  const conta = normalizarConta(texto(dados, "conta"));
  if (!conta.ok) return { erro: conta.erro };
  const forma = texto(dados, "formaPagamento");
  if (!ehFormaPagamento(forma)) return { erro: "Escolha a forma de pagamento." };
  const recebeVt = dados.get("recebeVt") === "on";
  const matricula = texto(dados, "matriculaEscritorio").replace(/^0+(?=\d)/, "");
  if (matricula && !/^\d{1,9}$/.test(matricula)) return { erro: "Matrícula do escritório: só números." };
  const tarifaBruta = recebeVt ? texto(dados, "tarifa") : "";
  const tarifa = tarifaBruta ? lerTarifa(tarifaBruta) : null;
  if (tarifaBruta && tarifa === null) return { erro: "Valor da passagem inválido (ex.: 4,95)." };
  const fixoBruto = recebeVt ? texto(dados, "valorFixo") : "";
  const valorFixo = fixoBruto ? lerTarifa(fixoBruto) : null;
  if (fixoBruto && valorFixo === null) return { erro: "Valor fixo mensal inválido (ex.: 800,00)." };
  if (recebeVt && tarifa === null && valorFixo === null) return { erro: "Quem recebe VT precisa do valor da passagem (ex.: 4,95) ou do valor fixo mensal." };
  const ficha = lerDadosFicha(dados);
  if (!ficha.ok) return { erro: ficha.erro };
  const d = v.data;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_salvar_colaborador", {
    p_id: d.id, p_empresa: d.empresaId, p_empregador: d.empregador, p_cod_fornecedor: cod.valor, p_nome: d.nome, p_cpf: cpf.valor,
    p_agencia: agencia.valor, p_conta: conta.valor, p_forma_pagamento: forma, p_ativo: dados.get("ativo") === "on", p_observacao: d.observacao || null,
    p_recebe_vt: recebeVt, p_tarifa: tarifa, p_valor_fixo: valorFixo, p_passagens_dia: d.passagensDia, p_matricula_escritorio: matricula || null, ...ficha.parametros,
  });
  if (error) return { erro: mensagemDeErro(error) };
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------- dados da ficha de registro (0532)

const dataOpcional = (d: FormData, nome: string) => {
  const t = texto(d, nome);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

/** Função, admissão, salário e dados pessoais do formulário (a caixa `dadosFicha` diz que o formulário novo os mandou). */
function lerDadosFicha(d: FormData): { ok: true; parametros: Record<string, string | number | boolean | null> } | { ok: false; erro: string } {
  if (d.get("dadosFicha") !== "1") return { ok: true, parametros: {} };
  const salarioTexto = texto(d, "salario");
  const salario = salarioTexto ? lerReais(salarioTexto) : null;
  if (salario !== null && !(salario > 0)) return { ok: false, erro: "Salário inválido (ex.: 2.145,87)." };
  const pis = texto(d, "pis").replace(/\D/g, "");
  if (pis && pis.length !== 11) return { ok: false, erro: "PIS: 11 dígitos." };
  const telefone = texto(d, "telefone");
  if (telefone && !/^[0-9 ()+-]{8,20}$/.test(telefone)) return { ok: false, erro: "Telefone inválido (só números, espaço, parênteses e hífen)." };
  const rg = texto(d, "rg").replace(/\s/g, "").toUpperCase();
  if (rg && !/^[0-9A-Z.-]{3,20}$/.test(rg)) return { ok: false, erro: "RG inválido." };
  const ctps = texto(d, "ctps").replace(/\D/g, ""), serie = texto(d, "ctpsSerie").replace(/\D/g, ""), uf = texto(d, "ctpsUf").toUpperCase();
  if (ctps.length > 11 || serie.length > 6) return { ok: false, erro: "CTPS: número até 11 dígitos e série até 6." };
  if (uf && !/^[A-Z]{2}$/.test(uf)) return { ok: false, erro: "UF da CTPS: duas letras (ex.: MT)." };
  const limite = (nome: string, max: number) => texto(d, nome).slice(0, max) || null;
  return { ok: true, parametros: {
    p_dados_ficha: true, p_funcao: limite("funcao", 60), p_data_admissao: dataOpcional(d, "dataAdmissao"), p_salario: salario,
    p_data_nascimento: dataOpcional(d, "dataNascimento"), p_telefone: telefone || null, p_endereco: limite("endereco", 200), p_pis: pis || null,
    p_rg: rg || null, p_rg_orgao: limite("rgOrgao", 20), p_rg_emissao: dataOpcional(d, "rgEmissao"), p_ctps: ctps || null, p_ctps_serie: serie || null,
    p_ctps_uf: uf || null, p_nome_pai: limite("nomePai", 120), p_nome_mae: limite("nomeMae", 120),
  } };
}

export type RespostaFicha =
  | { ok: true; rascunho: RascunhoColaborador; avisos: string[] }
  | { ok: false; erro: string; existente?: { id: string; nome: string } };

/**
 * Lê a Ficha Registro de Empregado (PDF do escritório) e devolve o rascunho do novo colaborador para o formulário. Nada é
 * gravado e o PDF não é guardado (decisão de 27/11/2026). CPF já cadastrado: devolve quem é, para editar em vez de duplicar.
 */
export async function lerFicha(dados: FormData): Promise<RespostaFicha> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "operador")) return { ok: false, erro: SEM_PERMISSAO };
  const arquivo = dados.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Escolha o PDF da ficha de registro." };
  if (arquivo.size > 5 * 1024 * 1024) return { ok: false, erro: "O PDF passa de 5 MB." };
  if (!/\.pdf$/i.test(arquivo.name) && arquivo.type !== "application/pdf") return { ok: false, erro: "A ficha tem de ser um PDF." };
  const ext = await extrairPaginasDoPdf(await arquivo.arrayBuffer());
  if (!ext.ok) return { ok: false, erro: ext.erro.includes("não tem texto") ? "Este PDF não tem texto (foi digitalizado como imagem): use a ficha em PDF que o escritório envia, ou cadastre digitando." : ext.erro };
  const r = lerFichaRegistro(ext.paginas);
  if (!r.ok) return r;
  const f = r.dados;
  const supabase = await criarClienteServidor();
  if (f.cpf) {
    const { data: existente } = await supabase.from("rh_colaboradores").select("id, nome").eq("cpf", f.cpf).maybeSingle();
    if (existente) return { ok: false, erro: `${existente.nome} já está cadastrado com este CPF: use "Editar" na linha dele.`, existente: { id: existente.id as string, nome: existente.nome as string } };
  }
  // empresa do Consistem sugerida: a mais comum entre quem tem a mesma empregadora (mesma regra da 0520)
  let empresaId: string | undefined;
  if (f.empregador) {
    const { data } = await supabase.from("rh_colaboradores").select("empresa_id").eq("empregador", f.empregador);
    const contagem = new Map<string, number>();
    for (const c of data ?? []) contagem.set(c.empresa_id as string, (contagem.get(c.empresa_id as string) ?? 0) + 1);
    empresaId = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  return {
    ok: true, avisos: r.avisos,
    rascunho: {
      empresa_id: empresaId, empregador: f.empregador ?? undefined, nome: f.nome ?? undefined, cpf: f.cpf, matricula_escritorio: f.matriculaEscritorio,
      data_admissao: f.dataAdmissao, salario: f.salario, funcao: f.funcao, data_nascimento: f.dataNascimento, telefone: f.telefone, endereco: f.endereco,
      pis: f.pis, rg: f.rg, rg_orgao: f.rgOrgao, rg_emissao: f.rgEmissao, ctps: f.ctps, ctps_serie: f.ctpsSerie, ctps_uf: f.ctpsUf,
      nome_pai: f.nomePai, nome_mae: f.nomeMae, ativo: true,
    },
  };
}

// ---------------------------------------------------------------- Consistem (só leitura)

type RespostaConsulta = { fornecedores: FornecedorConsistem[]; naoEncontrados: string[]; erros: { codigo: string; mensagem: string }[] };

async function mensagemDaFuncao(error: unknown, padrao: string): Promise<string> {
  const resposta = (error as { context?: Response }).context;
  if (resposta && typeof resposta.json === "function") {
    try {
      const j = (await resposta.json()) as { erro?: string; mensagem?: string };
      return j.mensagem ?? j.erro ?? padrao;
    } catch { /* mantém */ }
  }
  return padrao;
}

async function consultar(supabase: Cliente, empresaId: string, codigos: string[]): Promise<{ ok: true; valor: RespostaConsulta } | { ok: false; erro: string }> {
  const { data, error } = await supabase.functions.invoke("rh-vt-consultar-fornecedor", { body: { empresa_id: empresaId, codigos } });
  if (error) return { ok: false, erro: await mensagemDaFuncao(error, "Não foi possível consultar o Consistem.") };
  return { ok: true, valor: data as RespostaConsulta };
}

/** Busca nome e CPF de um fornecedor (botão do formulário). */
export async function buscarFornecedor(entrada: { empresaId: string; codFornecedor: string }): Promise<{ ok: true; fornecedor: FornecedorConsistem } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "operador")) return { ok: false, erro: SEM_PERMISSAO };
  if (!z.string().uuid().safeParse(entrada.empresaId).success) return { ok: false, erro: "Escolha a empresa do Consistem." };
  const cod = normalizarCodFornecedor(entrada.codFornecedor);
  if (!cod.ok) return { ok: false, erro: cod.erro };
  const r = await consultar(await criarClienteServidor(), entrada.empresaId, [cod.valor]);
  if (!r.ok) return r;
  const f = r.valor.fornecedores[0];
  if (f) return { ok: true, fornecedor: f };
  return { ok: false, erro: r.valor.erros[0]?.mensagem ?? `Fornecedor ${cod.valor} não encontrado no Consistem.` };
}

export type DivergenciaColaborador = { id: string; cod_fornecedor: string; nome: string; itens: Divergencia[] };
export type ResultadoConferencia =
  | { ok: true; conferidos: number; divergentes: DivergenciaColaborador[]; naoEncontrados: { id: string; cod_fornecedor: string; nome: string }[]; erros: string[] }
  | { ok: false; erro: string };

/** Confere todos os ativos com o Consistem (nome, CPF, situação). Não grava nada. */
export async function conferirNoConsistem(): Promise<ResultadoConferencia> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "operador")) return { ok: false, erro: SEM_PERMISSAO };
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("rh_colaboradores").select(COLUNAS_COLABORADOR).eq("ativo", true);
  // sem nº de fornecedor (incluído pelo Control iD) não há o que conferir no Consistem
  const ativos = (data ?? []).map(paraColaborador).filter((c): c is ColaboradorLinha & { cod_fornecedor: string } => !!c.cod_fornecedor);
  if (ativos.length === 0) return { ok: false, erro: "Nenhum colaborador ativo para conferir." };
  const porEmpresa = new Map<string, (ColaboradorLinha & { cod_fornecedor: string })[]>();
  for (const c of ativos) porEmpresa.set(c.empresa_id, [...(porEmpresa.get(c.empresa_id) ?? []), c]);
  const divergentes: DivergenciaColaborador[] = [];
  const naoEncontrados: { id: string; cod_fornecedor: string; nome: string }[] = [];
  const erros: string[] = [];
  for (const [empresaId, lista] of porEmpresa) {
    const r = await consultar(supabase, empresaId, lista.map((c) => c.cod_fornecedor));
    if (!r.ok) return r;
    const achados = new Map(r.valor.fornecedores.map((f) => [f.codFornecedor, f]));
    const ausentes = new Set(r.valor.naoEncontrados);
    for (const e of r.valor.erros) erros.push(`Fornecedor ${e.codigo}: ${e.mensagem}`);
    for (const c of lista) {
      const f = achados.get(c.cod_fornecedor);
      if (f) {
        const itens = divergencias(c, f);
        if (itens.length) divergentes.push({ id: c.id, cod_fornecedor: c.cod_fornecedor, nome: c.nome, itens });
      } else if (ausentes.has(c.cod_fornecedor)) naoEncontrados.push({ id: c.id, cod_fornecedor: c.cod_fornecedor, nome: c.nome });
    }
  }
  return { ok: true, conferidos: ativos.length, divergentes, naoEncontrados, erros };
}

/** Copia nome e CPF do Consistem para o cadastro (consulta de novo na hora; não confia na tela). */
export async function aplicarDoConsistem(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "operador")) return { ok: false, erro: SEM_PERMISSAO };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, erro: "Colaborador inválido." };
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("rh_colaboradores").select(COLUNAS_COLABORADOR).eq("id", id).maybeSingle();
  const c = data ? paraColaborador(data) : null;
  if (!c) return { ok: false, erro: "Colaborador não encontrado." };
  if (!c.cod_fornecedor) return { ok: false, erro: "Informe antes o nº de fornecedor do Consistem." };
  const r = await consultar(supabase, c.empresa_id, [c.cod_fornecedor]);
  if (!r.ok) return r;
  const f = r.valor.fornecedores[0];
  if (!f) return { ok: false, erro: `Fornecedor ${c.cod_fornecedor} não encontrado no Consistem.` };
  const { error } = await supabase.rpc("rh_salvar_colaborador", {
    p_id: c.id, p_empresa: c.empresa_id, p_empregador: c.empregador, p_cod_fornecedor: c.cod_fornecedor, p_nome: f.nome, p_cpf: f.cpf ?? c.cpf,
    p_agencia: c.agencia, p_conta: c.conta, p_forma_pagamento: c.forma_pagamento, p_ativo: c.ativo, p_observacao: c.observacao,
    p_recebe_vt: c.recebe_vt, p_tarifa: c.tarifa, p_valor_fixo: c.valor_fixo, p_passagens_dia: c.passagens_dia, p_matricula_escritorio: c.matricula_escritorio,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------- cadastro do Control iD / RHiD (decisão de 21/10/2026)

const esquemaControlId = z.array(z.object({
  rhid: z.string().regex(/^\d{1,9}$/), cpf: z.string().regex(/^\d{11}$/), nome: z.string().trim().min(2).max(120),
  empregador: z.string().trim().min(2).max(40), departamento: z.string().trim().max(60).nullable(),
  cargo: z.string().trim().max(80).nullable(), admissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})).min(1).max(2000);

async function casar(supabase: Cliente, itens: FuncionarioControlId[]): Promise<Casamento[]> {
  const { data } = await supabase.from("rh_colaboradores").select("id, nome, cpf, id_rhid, cod_fornecedor, empregador, departamento, funcao, data_admissao");
  return casarComCadastro(itens, (data ?? []) as Parameters<typeof casarComCadastro>[1]);
}

export type PreviaControlId = { casamentos: Casamento[] };

/** Mostra o que a importação faria (não grava nada). Os itens chegam lidos no navegador, só com os campos necessários. */
export async function previaControlId(itens: FuncionarioControlId[]): Promise<{ ok: true; previa: PreviaControlId } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "operador")) return { ok: false, erro: SEM_PERMISSAO };
  const d = esquemaControlId.safeParse(itens);
  if (!d.success) return { ok: false, erro: "Arquivo inválido." };
  return { ok: true, previa: { casamentos: await casar(await criarClienteServidor(), d.data) } };
}

/** Grava: completa o que está vazio nos cadastros casados e inclui os novos. Refaz o casamento (não confia na tela). */
export async function gravarControlId(itens: FuncionarioControlId[]): Promise<{ ok: true; aviso: string } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "operador")) return { ok: false, erro: SEM_PERMISSAO };
  const d = esquemaControlId.safeParse(itens);
  if (!d.success) return { ok: false, erro: "Arquivo inválido." };
  const supabase = await criarClienteServidor();
  const cs = await casar(supabase, d.data);
  const cpf = (c: string) => c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  const { data, error } = await supabase.rpc("rh_col_importar_controlid", {
    p_atualizar: cs.filter((c) => c.colaborador && Object.keys(c.completa).length).map((c) => ({ id: c.colaborador!.id, ...c.completa })),
    p_incluir: cs.filter((c) => c.como === "novo").map(({ item: i }) => ({
      nome: i.nome, cpf: cpf(i.cpf), id_rhid: i.rhid, empregador: i.empregador, departamento: i.departamento, funcao: i.cargo, data_admissao: i.admissao,
    })),
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidar();
  revalidatePath("/rh/banco_horas", "layout");
  const r = data as { atualizados: number; incluidos: number };
  return { ok: true, aviso: `${r.atualizados} cadastro(s) completado(s) e ${r.incluidos} incluído(s). Os incluídos estão marcados "Completar cadastro".` };
}
