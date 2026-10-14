"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { divergencias, lerTarifa, normalizarAgencia, normalizarCodFornecedor, normalizarConta, normalizarCpf, type Divergencia, type FornecedorConsistem } from "@/lib/modulos/rh/vale-transporte/cadastro";
import { ehFormaPagamento, ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { COLUNAS_COLABORADOR, paraColaborador, type ColaboradorLinha } from "./dados";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const texto = (d: FormData, nome: string) => String(d.get(nome) ?? "").trim();
const SEM_PERMISSAO = "Somente operador do RH (ou acima) altera o cadastro do vale-transporte.";

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
  const tarifaBruta = texto(dados, "tarifa");
  const tarifa = tarifaBruta ? lerTarifa(tarifaBruta) : null;
  if (tarifaBruta && tarifa === null) return { erro: "Valor da passagem inválido (ex.: 4,95)." };
  const fixoBruto = texto(dados, "valorFixo");
  const valorFixo = fixoBruto ? lerTarifa(fixoBruto) : null;
  if (fixoBruto && valorFixo === null) return { erro: "Valor fixo mensal inválido (ex.: 800,00)." };
  if (tarifa === null && valorFixo === null) return { erro: "Informe o valor da passagem (ex.: 4,95) ou o valor fixo mensal." };
  const d = v.data;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_vt_salvar_colaborador", {
    p_id: d.id, p_empresa: d.empresaId, p_empregador: d.empregador, p_cod_fornecedor: cod.valor, p_nome: d.nome, p_cpf: cpf.valor,
    p_agencia: agencia.valor, p_conta: conta.valor, p_forma_pagamento: forma, p_tarifa: tarifa, p_passagens_dia: d.passagensDia,
    p_ativo: dados.get("ativo") === "on", p_observacao: d.observacao || null, p_valor_fixo: valorFixo,
  });
  if (error) return { erro: mensagemDeErro(error) };
  revalidatePath(ROTA_VT, "layout");
  return { ok: true };
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
  const { data } = await supabase.from("rh_vt_colaboradores").select(COLUNAS_COLABORADOR).eq("ativo", true);
  const ativos = (data ?? []).map(paraColaborador);
  if (ativos.length === 0) return { ok: false, erro: "Nenhum colaborador ativo para conferir." };
  const porEmpresa = new Map<string, ColaboradorLinha[]>();
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
  const { data } = await supabase.from("rh_vt_colaboradores").select(COLUNAS_COLABORADOR).eq("id", id).maybeSingle();
  const c = data ? paraColaborador(data) : null;
  if (!c) return { ok: false, erro: "Colaborador não encontrado." };
  const r = await consultar(supabase, c.empresa_id, [c.cod_fornecedor]);
  if (!r.ok) return r;
  const f = r.valor.fornecedores[0];
  if (!f) return { ok: false, erro: `Fornecedor ${c.cod_fornecedor} não encontrado no Consistem.` };
  const { error } = await supabase.rpc("rh_vt_salvar_colaborador", {
    p_id: c.id, p_empresa: c.empresa_id, p_empregador: c.empregador, p_cod_fornecedor: c.cod_fornecedor, p_nome: f.nome, p_cpf: f.cpf ?? c.cpf,
    p_agencia: c.agencia, p_conta: c.conta, p_forma_pagamento: c.forma_pagamento, p_tarifa: c.tarifa, p_passagens_dia: c.passagens_dia,
    p_ativo: c.ativo, p_observacao: c.observacao, p_valor_fixo: c.valor_fixo,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_VT, "layout");
  return { ok: true };
}
