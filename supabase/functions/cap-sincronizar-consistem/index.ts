// Edge Function do módulo Financeiro/Contas a pagar: espelha os lançamentos do contas a pagar do Consistem
// (títulos, antecipações a fornecedor e créditos) em cap_lancamentos, e o cadastro de fornecedores em cap_fornecedores.
// Mesma API já usada por Recebíveis (ver _shared/consistem-receber.ts e _shared/consistem-pagar.ts).
//
// Quem pode chamar:
//   - usuário logado com nível de OPERADOR (ou acima) na área do Financeiro — o financeiro atualiza a lista todo dia; ou
//   - agendamento do banco (pg_cron + pg_net), com o cabeçalho `x-sincronizacao-segredo` = SINCRONIZACAO_SEGREDO; ou
//   - service role no Authorization.
// Falha de atualização real vira a pendência "Falha na atualização do contas a pagar" na Fila do dia.
//
// Corpo (JSON), campo `acao`:
//   sincronizar { simular?: boolean }   lê a API e grava; com simular=true só devolve o que faria
//   medir                               lê a API e devolve tempo, páginas e contagens por tipo (sem valores por fornecedor)
//   amostra                             devolve os NOMES e tipos dos campos da API (sem valores) para conferência
//
// Regras:
//   - A API devolve a vida inteira e ignora `situacao`: em aberto = valorAtualizado > 0. Só C, A e D são gravados.
//   - Lançamento gravado que sumiu dos abertos (ou voltou com saldo zero) recebe `baixado_em` (não é apagado).
//   - Se a API devolver nenhum lançamento em aberto mas há abertos no banco, nada é alterado (provável falha).
//   - Nunca escreve no Consistem.
//
// Segredos (Supabase > Edge Functions > Secrets): CONSISTEM_API_KEY (obrigatório), SINCRONIZACAO_SEGREDO (agendamento),
// CONSISTEM_BASE_URL (opcional). O código da empresa vem de empresas.codigo_erp.
//
// Deploy: npx supabase functions deploy cap-sincronizar-consistem
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  BASE_URL_PADRAO,
  buscarObjeto,
  buscarTodasPaginas,
  ConsistemErro,
  documentoFormatado,
  PAGINACAO,
  type ConfigConsistem,
} from "../_shared/consistem-receber.ts";
import {
  LIMITE_DETALHES_POR_RODADA,
  normalizarDetalheLancamento,
  normalizarFornecedorApi,
  normalizarLancamentoPagar,
  planejarSincronizacaoPagar,
  ROTA_CONTAS_PAGAR,
  ROTA_DETALHE_LANCAMENTO,
  ROTA_FORNECEDORES,
  type FornecedorApi,
  type LancamentoBanco,
  type LancamentoPagarApi,
  type PlanoPagar,
  type TipoGravado,
} from "../_shared/consistem-pagar.ts";

const MODULO = "financeiro.contas-pagar";
const LOTE = 200;
const TITULO_FALHA = "Falha na atualização do contas a pagar";

/** Data de hoje no fuso de Cuiabá, 'aaaa-mm-dd'. */
const hojeCuiaba = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });

function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** O chamador é a service role? Igualdade com a chave injetada, ou uma operação administrativa do Auth que só ela consegue. */
async function ehServiceRole(url: string, portador: string, chaveServico: string): Promise<boolean> {
  if (portador === "") return false;
  if (iguaisSeguro(portador, chaveServico)) return true;
  const pareceChaveDeServico = portador.startsWith("sb_secret_") || (() => {
    try {
      const carga = JSON.parse(atob(portador.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return carga.role === "service_role";
    } catch {
      return false;
    }
  })();
  if (!pareceChaveDeServico) return false;
  const tentativa = createClient(url, portador, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await tentativa.auth.admin.listUsers({ page: 1, perPage: 1 });
  return !error;
}

function lotes<T>(itens: T[], tamanho = LOTE): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho));
  return saida;
}

// deno-lint-ignore no-explicit-any
type Banco = SupabaseClient<any, "public", any>;

/** PostgREST devolve no máximo 1000 linhas por consulta: lê tudo em páginas. */
// deno-lint-ignore no-explicit-any
async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    saida.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return saida;
  }
}

/** Nomes e tipos dos campos que a API devolve (sem valores): para conferir o mapeamento com segurança. */
function descreverCampos(registros: Record<string, unknown>[]): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const r of registros.slice(0, 50)) {
    for (const [k, v] of Object.entries(r)) {
      const tipo = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
      if (!campos[k] || campos[k] === "null") campos[k] = tipo;
    }
  }
  return campos;
}

type Empresa = { id: string; nome_curto: string; codigo_erp: string };
type Buscar = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;
const buscar: Buscar = (url, init) => fetch(url, init);

const reais = (centavos: number) => Math.round(centavos) / 100;
const resumoTipo = (t: { quantidade: number; centavos: number }) => ({ quantidade: t.quantidade, valor: reais(t.centavos) });

/** Lê a lista inteira do contas a pagar e normaliza. Devolve também o tempo gasto (para a ação `medir`). */
async function lerLancamentosApi(cfg: ConfigConsistem) {
  const inicio = Date.now();
  const registros = await buscarTodasPaginas(buscar, cfg, ROTA_CONTAS_PAGAR, { paginacao: PAGINACAO });
  const segundosApi = Math.round((Date.now() - inicio) / 100) / 10;
  const lancamentos: LancamentoPagarApi[] = [];
  const recusados: { codLancamento: string; motivo: string }[] = [];
  for (const r of registros) {
    const n = normalizarLancamentoPagar(r);
    if (n.ok) lancamentos.push(n.lancamento);
    else recusados.push({ codLancamento: n.codLancamento, motivo: n.motivo });
  }
  return { registros, lancamentos, recusados, segundosApi };
}

/** Fornecedores ativos e inativos (títulos antigos podem ser de fornecedor inativo). */
async function lerFornecedoresApi(cfg: ConfigConsistem): Promise<FornecedorApi[]> {
  const saida = new Map<string, FornecedorApi>();
  for (const situacao of [1, 0]) {
    const regs = await buscarTodasPaginas(buscar, cfg, ROTA_FORNECEDORES, { situacao, paginacao: PAGINACAO });
    for (const r of regs) {
      const f = normalizarFornecedorApi(r);
      if (f && !saida.has(f.codFornecedor)) saida.set(f.codFornecedor, f);
    }
  }
  return [...saida.values()];
}

type ResumoEmpresa = Record<string, unknown>;

async function sincronizarEmpresa(banco: Banco, empresa: Empresa, cfgBase: Omit<ConfigConsistem, "empresa">, simular: boolean, usuarioId: string | null): Promise<ResumoEmpresa> {
  const cfg: ConfigConsistem = { ...cfgBase, empresa: empresa.codigo_erp };
  const hoje = hojeCuiaba();
  const agora = new Date().toISOString();

  // 1) API
  const { registros, lancamentos, recusados, segundosApi } = await lerLancamentosApi(cfg);

  // 2) Banco
  type Linha = {
    id: string; cod_lancamento: string; tipo_lancamento: TipoGravado; cod_fornecedor: string | null; num_documento: string | null;
    complemento_historico: string | null; data_vencimento: string | null; valor_documento: number | string; valor_atualizado: number | string; baixado_em: string | null;
  };
  const linhas = await lerTudo<Linha>((de, ate) =>
    banco.from("cap_lancamentos")
      .select("id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, complemento_historico, data_vencimento, valor_documento, valor_atualizado, baixado_em")
      .eq("empresa_id", empresa.id).order("id").range(de, ate));
  const noBanco: LancamentoBanco[] = linhas.map((l) => ({
    id: l.id, codLancamento: l.cod_lancamento, tipo: l.tipo_lancamento, codFornecedor: l.cod_fornecedor ?? "", numDocumento: l.num_documento ?? "",
    complemento: l.complemento_historico ?? "", vencimento: l.data_vencimento, valorDocumentoCentavos: Math.round(Number(l.valor_documento) * 100),
    saldoCentavos: Math.round(Number(l.valor_atualizado) * 100), baixadoEm: l.baixado_em,
  }));

  const plano: PlanoPagar = planejarSincronizacaoPagar(lancamentos, noBanco);
  const abertosNaApi = plano.abertosPorTipo.C.quantidade + plano.abertosPorTipo.A.quantidade + plano.abertosPorTipo.D.quantidade;
  const abertosNoBanco = noBanco.filter((b) => b.baixadoEm === null).length;
  // Trava de segurança: nada em aberto na API com abertos no banco = provável falha, não "pagaram tudo".
  if (abertosNaApi === 0 && abertosNoBanco > 0) {
    throw new Error(`A API devolveu nenhum lançamento em aberto, mas há ${abertosNoBanco} abertos no banco. Nada foi alterado.`);
  }

  const resumo: ResumoEmpresa = {
    empresa: empresa.nome_curto,
    simulacao: simular,
    segundosApi,
    registrosNaApi: registros.length,
    abertos: {
      titulos: resumoTipo(plano.abertosPorTipo.C),
      antecipacoes: resumoTipo(plano.abertosPorTipo.A),
      creditos: resumoTipo(plano.abertosPorTipo.D),
      projecoes: resumoTipo(plano.abertosPorTipo.P),
    },
    novos: plano.novos.length,
    alterados: plano.alterados.length,
    baixados: plano.baixados.length,
    inalterados: plano.inalterados,
    recusados: recusados.length,
    duplicadosNaApi: plano.duplicadosApi.length,
  };
  if (simular) return resumo;

  // 3) Fornecedores: só consulta o cadastro quando aparece um código que ainda não está no espelho (ou o espelho está vazio).
  const codigosNecessarios = new Set<string>();
  for (const n of plano.novos) if (n.codFornecedor) codigosNecessarios.add(n.codFornecedor);
  for (const a of plano.alterados) if (a.campos.cod_fornecedor) codigosNecessarios.add(a.campos.cod_fornecedor);
  const conhecidos = new Set((await lerTudo<{ cod_fornecedor: string }>((de, ate) =>
    banco.from("cap_fornecedores").select("cod_fornecedor").eq("empresa_id", empresa.id).order("id").range(de, ate))).map((f) => f.cod_fornecedor));
  const faltam = [...codigosNecessarios].filter((c) => !conhecidos.has(c));
  let fornecedoresNovos = 0;
  if (faltam.length > 0 || conhecidos.size === 0) {
    try {
      const fornecedores = await lerFornecedoresApi(cfg);
      const rows = fornecedores.map((f) => ({
        empresa_id: empresa.id, cod_fornecedor: f.codFornecedor, nome: f.nome, nome_fantasia: f.nomeFantasia || null,
        documento: f.documentoBruto ? documentoFormatado(f.documentoBruto) : null, ativo: f.ativo, visto_em: agora,
      }));
      for (const lote of lotes(rows)) {
        const { error } = await banco.from("cap_fornecedores").upsert(lote, { onConflict: "empresa_id,cod_fornecedor" });
        if (error) throw new Error(error.message);
      }
      fornecedoresNovos = rows.filter((r) => !conhecidos.has(r.cod_fornecedor)).length;
      resumo.fornecedoresNovos = fornecedoresNovos;
      const aindaFaltam = faltam.filter((c) => !rows.some((r) => r.cod_fornecedor === c));
      if (aindaFaltam.length > 0) resumo.avisoFornecedores = `${aindaFaltam.length} código(s) de fornecedor não estão no cadastro do Consistem.`;
    } catch (e) {
      // O nome do fornecedor é um auxílio: sem ele a lista mostra o código. A rodada segue.
      resumo.avisoFornecedores = `Não foi possível ler o cadastro de fornecedores: ${e instanceof Error ? e.message.slice(0, 200) : "falha"}`;
    }
  }

  // 4) Lançamentos novos
  for (const lote of lotes(plano.novos)) {
    const rows = lote.map((l) => ({
      empresa_id: empresa.id,
      cod_lancamento: l.codLancamento,
      tipo_lancamento: l.tipo,
      cod_fornecedor: l.codFornecedor || null,
      num_documento: l.numDocumento || null,
      categoria_doc: l.categoriaDoc || null,
      cod_banco: l.codBanco || null,
      cod_historico: l.codHistorico || null,
      complemento_historico: l.complemento || null,
      data_emissao: l.emissao,
      data_entrada: l.entrada,
      data_vencimento: l.vencimento,
      valor_documento: reais(l.valorDocumentoCentavos),
      valor_original: l.valorOriginalCentavos === null ? null : reais(l.valorOriginalCentavos),
      valor_atualizado: reais(l.saldoCentavos),
      cod_origem: l.codOrigem || null,
      visto_em: agora,
    }));
    const { error } = await banco.from("cap_lancamentos").upsert(rows, { onConflict: "empresa_id,cod_lancamento", ignoreDuplicates: true });
    if (error) throw new Error(`Falha ao gravar lançamentos novos: ${error.message}`);
  }

  // 5) Alterados (saldo, vencimento, documento, fornecedor, histórico; ou reabertos)
  for (const lote of lotes(plano.alterados, 10)) {
    const resultados = await Promise.all(lote.map((a) => banco.from("cap_lancamentos").update({ ...a.campos, visto_em: agora }).eq("id", a.id)));
    const falha = resultados.find((r: { error: { message: string } | null }) => r.error);
    if (falha?.error) throw new Error(`Falha ao atualizar lançamentos: ${falha.error.message}`);
  }
  // Os inalterados também foram vistos agora (um update em lote por rodada, só quando há muitos, custaria caro: fica no visto_em dos novos/alterados).

  // 6) Baixados: saíram dos abertos no Consistem (pagos ou, na antecipação, abatidos por NF)
  for (const lote of lotes(plano.baixados)) {
    const { error } = await banco.from("cap_lancamentos").update({ baixado_em: hoje, valor_atualizado: 0, visto_em: agora }).in("id", lote);
    if (error) throw new Error(`Falha ao marcar baixados: ${error.message}`);
  }

  // 6b) Autorizações (Fase 2): o item cujo lançamento saiu dos abertos recebe a data; reaberto perde a marca.
  try {
    const reabertos = plano.alterados.filter((a) => a.campos.baixado_em === null).map((a) => a.id);
    for (const lote of lotes(plano.baixados)) {
      const { error } = await banco.from("cap_autorizacao_itens").update({ baixado_consistem_em: hoje }).in("lancamento_id", lote).is("baixado_consistem_em", null);
      if (error) throw new Error(error.message);
    }
    for (const lote of lotes(reabertos)) {
      const { error } = await banco.from("cap_autorizacao_itens").update({ baixado_consistem_em: null }).in("lancamento_id", lote).not("baixado_consistem_em", "is", null);
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    // Antes da migration 0122 a tabela não existe; depois dela, uma falha aqui não derruba a rodada (a próxima conserta).
    resumo.avisoAutorizacoes = `Baixas não anotadas nas autorizações: ${e instanceof Error ? e.message.slice(0, 200) : "falha"}`;
  }

  // 7) Detalhe das antecipações (data de pagamento programada, portador, código de barras, Pix): um GET por lançamento,
  // só para as que ainda não têm detalhe, com teto por rodada. Falha aqui não derruba a rodada.
  try {
    const { data: semDetalhe, error } = await banco.from("cap_lancamentos").select("id, cod_lancamento")
      .eq("empresa_id", empresa.id).eq("tipo_lancamento", "A").is("baixado_em", null).is("detalhado_em", null)
      .order("cod_lancamento").limit(LIMITE_DETALHES_POR_RODADA);
    if (error) throw new Error(error.message);
    let lidos = 0;
    let falhas = 0;
    const pendentesDetalhe = (semDetalhe ?? []) as { id: string; cod_lancamento: string }[];
    for (const lote of lotes(pendentesDetalhe, 5)) {
      await Promise.all(lote.map(async (l) => {
        try {
          const d = normalizarDetalheLancamento(await buscarObjeto(buscar, cfg, `${ROTA_DETALHE_LANCAMENTO}/${encodeURIComponent(l.cod_lancamento)}`));
          const { error: erroUpd } = await banco.from("cap_lancamentos").update({
            data_pagamento: d.dataPagamento, cod_portador: d.codPortador || null, cod_barras: d.codBarras || null, qrcode_pix: d.qrCodePix || null, detalhado_em: agora,
          }).eq("id", l.id);
          if (erroUpd) throw new Error(erroUpd.message);
          lidos++;
        } catch {
          falhas++;
        }
      }));
    }
    resumo.detalhesLidos = lidos;
    if (falhas > 0) resumo.avisoDetalhe = `${falhas} detalhe(s) de antecipação não puderam ser lidos (ficam para a próxima rodada).`;
    if (pendentesDetalhe.length >= LIMITE_DETALHES_POR_RODADA) resumo.avisoDetalhe = `${resumo.avisoDetalhe ? `${resumo.avisoDetalhe} ` : ""}Há mais antecipações sem detalhe: a próxima rodada continua.`;
  } catch (e) {
    resumo.avisoDetalhe = `Detalhe das antecipações não lido: ${e instanceof Error ? e.message.slice(0, 200) : "falha"}`;
  }

  // 8) Registro da execução
  const { error: erroLog } = await banco.from("importacoes").insert({
    modulo: MODULO,
    tipo: "lancamentos",
    arquivo: "api:consistem",
    mapeamento: {
      origem: "api", empresa: empresa.codigo_erp, segundosApi, registrosNaApi: registros.length, abertos: resumo.abertos,
      recusados: recusados.slice(0, 20), duplicadosApi: plano.duplicadosApi.slice(0, 20), ignorados: plano.ignorados, encerradosNaApi: plano.encerradosNaApi,
      fornecedoresNovos, avisoFornecedores: resumo.avisoFornecedores ?? null, detalhesLidos: resumo.detalhesLidos ?? 0, avisoDetalhe: resumo.avisoDetalhe ?? null,
      avisoAutorizacoes: resumo.avisoAutorizacoes ?? null,
    },
    linhas_novas: plano.novos.length,
    linhas_alteradas: plano.alterados.length,
    linhas_baixadas: plano.baixados.length,
    linhas_divergentes: recusados.length + plano.duplicadosApi.length,
    usuario_id: usuarioId,
  });
  if (erroLog) throw new Error(`Atualizou, mas falhou ao registrar a execução: ${erroLog.message}`);
  return resumo;
}

/** Abre (uma só) pendência de falha. Mensagens vêm da própria função e nunca contêm segredos. */
async function registrarFalha(banco: Banco, mensagem: string, agendado: boolean): Promise<void> {
  const { data: abertas } = await banco.from("pendencias").select("id").eq("modulo", MODULO).eq("titulo", TITULO_FALHA)
    .in("status", ["aberta", "em_andamento"]).limit(1);
  if (abertas && abertas.length > 0) return;
  await banco.from("pendencias").insert({
    modulo: MODULO,
    titulo: TITULO_FALHA,
    descricao: `${agendado ? "A atualização agendada" : "A atualização manual"} falhou: ${mensagem.slice(0, 300)} A lista de contas a pagar pode estar desatualizada. Tente "Atualizar do Consistem" em Financeiro > Contas a pagar; se persistir, verifique o token do Consistem (CSMEN050).`,
    prazo: hojeCuiaba(),
    criticidade: "alta",
    link: "/financeiro/contas-pagar",
  });
}

/** Atualização que deu certo encerra o aviso de falha anterior. */
async function encerrarFalhas(banco: Banco): Promise<void> {
  await banco.from("pendencias").update({ status: "cancelada" }).eq("modulo", MODULO).eq("titulo", TITULO_FALHA).in("status", ["aberta", "em_andamento"]);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  const segredoRecebido = req.headers.get("x-sincronizacao-segredo") ?? "";
  if (!autorizacao && !segredoRecebido) return responder({ erro: "Não autenticado." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = Deno.env.get("CONSISTEM_API_KEY") ?? "";
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  // Quem chama: (1) o agendamento do banco, com o segredo do Vault; (2) a service role; ou (3) um operador do Financeiro logado.
  // O gateway não confere JWT aqui (verify_jwt = false em config.toml): a conferência é toda desta função.
  let usuarioId: string | null = null;
  let agendado = false;
  if (segredoRecebido) {
    const segredoEsperado = Deno.env.get("SINCRONIZACAO_SEGREDO") ?? "";
    if (segredoEsperado.length < 32 || !iguaisSeguro(segredoRecebido, segredoEsperado)) return responder({ erro: "Não autorizado." }, 401);
    agendado = true;
  } else {
    const portador = autorizacao.replace(/^Bearer\s+/i, "");
    if (!(await ehServiceRole(url, portador, chaveServico))) {
      const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
      const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
      if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
      const { data: permitido, error: erroPermissao } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "operador" });
      if (erroPermissao || permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) pode atualizar o contas a pagar." }, 403);
      usuarioId = quem.user.id;
    }
  }

  if (token.trim().length < 50) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }

  const banco: Banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const cfgBase = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token };

  const { data: empresas, error: erroEmpresas } = await banco.from("empresas")
    .select("id, nome_curto, codigo_erp").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto");
  if (erroEmpresas) return responder({ erro: "Não foi possível ler as empresas." }, 500);
  if (!empresas || empresas.length === 0) return responder({ erro: "Nenhuma empresa ativa tem o código do Consistem (empresas.codigo_erp)." }, 400);

  try {
    switch (corpo.acao) {
      case "amostra": {
        const e = empresas[0] as Empresa;
        const cfg: ConfigConsistem = { ...cfgBase, empresa: e.codigo_erp };
        const registros = await buscarTodasPaginas(buscar, cfg, ROTA_CONTAS_PAGAR, { paginacao: 20, dataEmissaoIni: hojeCuiaba(), dataEmissaoFim: hojeCuiaba() });
        return responder({ ok: true, empresa: e.nome_curto, registros: registros.length, campos: descreverCampos(registros) });
      }
      case "medir": {
        // Só agregados: tempo, páginas e contagens/somas por tipo. Nada por fornecedor.
        const e = empresas[0] as Empresa;
        const cfg: ConfigConsistem = { ...cfgBase, empresa: e.codigo_erp };
        const { registros, lancamentos, recusados, segundosApi } = await lerLancamentosApi(cfg);
        const plano = planejarSincronizacaoPagar(lancamentos, []);
        return responder({
          ok: true, empresa: e.nome_curto, segundosApi, paginas: Math.ceil(registros.length / PAGINACAO), registrosNaApi: registros.length, recusados: recusados.length,
          abertos: Object.fromEntries(Object.entries(plano.abertosPorTipo).map(([t, v]) => [t, resumoTipo(v)])),
        });
      }
      case "sincronizar": {
        const resultados: ResumoEmpresa[] = [];
        for (const e of empresas) {
          resultados.push(await sincronizarEmpresa(banco, e as Empresa, cfgBase, corpo.simular === true, usuarioId));
        }
        if (corpo.simular !== true) await encerrarFalhas(banco);
        return responder({ ok: true, agendado, resultados });
      }
      default:
        return responder({ erro: "Ação desconhecida." }, 400);
    }
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha inesperada.";
    if (corpo.acao === "sincronizar" && corpo.simular !== true) await registrarFalha(banco, mensagem, agendado).catch(() => {});
    if (e instanceof ConsistemErro) return responder({ erro: e.message }, e.status === 401 || e.status === 403 ? 502 : 500);
    return responder({ erro: mensagem }, 500);
  }
});
