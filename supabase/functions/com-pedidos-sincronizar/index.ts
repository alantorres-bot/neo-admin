// Edge Function do módulo Comercial / Pedidos (docs/modulos/comercial-pedidos.md).
// Lê a API Comercial v1.0 do Consistem (NUNCA escreve no ERP) e mantém o espelho da carteira de pedidos (migration 0701).
//
// Quem pode chamar:
//   - agendamento do banco (pg_cron + pg_net, migration 0701), com `x-sincronizacao-segredo` = SINCRONIZACAO_SEGREDO: só `sincronizar`;
//   - service role no Authorization (script `node scripts/sondar-comercial.mjs`): tudo;
//   - usuário logado: `documento` com acesso de consulta ao módulo; `sincronizar`, `amostra` e `extrato_comissoes` só o gestor
//     do Comercial (admin geral sempre pode).
//
// Corpo (JSON):
//   { "acao": "sincronizar", "simular"?: boolean }   lê a carteira e grava pedidos, itens, NFs e parcelas; abre/conclui a
//        pendência "Pedido com previsão vencida". Com simular=true só devolve o que faria (lê só a lista de pedidos).
//   { "acao": "documento", "nota_id": uuid, "tipo": "danfe" | "xml" }   DANFE (PDF) ou XML da NF, em base64, para baixar na
//        hora (o arquivo não é guardado).
//   { "acao": "amostra", "dias"?: 1..180 (padrão 90), "lista_transporte"?: "<código de uma lista de transporte>" }
//   { "acao": "extrato_comissoes", "mes": "aaaa-mm" }   para comparar com as planilhas de comissão (pedido do Alan,
//        19/10/2026): extrato de comissões do Consistem e títulos pagos no mês com o tipo de baixa (7 = Antecipação,
//        baixa com os créditos da CCCCI010). Só códigos, datas e valores: sem nomes nem dados de clientes.
//
// Cada serviço é sondado à parte: um 401/403 vira "serviço não liberado no token (CSMEN050, aba Serviço)" e os
// demais seguem.
//
// Segredos: CONSISTEM_API_KEY (o mesmo das outras integrações); CONSISTEM_BASE_URL opcional. Empresa: empresas.codigo_erp.
//
// Deploy: npx supabase functions deploy com-pedidos-sincronizar --project-ref chdszjpbtfpstjrqnmmm
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  addDias, BASE_URL_PADRAO, buscarJson, chaveNfe, buscarObjeto, buscarResumido, buscarTodasPaginas, ConsistemErro, numeroNota, PAGINACAO, type ConfigConsistem,
} from "../_shared/consistem-receber.ts";
import {
  assinaturaPedido, ehNotaSemTitulos, normalizarDetalhePedido, normalizarNotaPedido, normalizarParcela, normalizarPedidoCompleto,
  normalizarPedidoResumido, notasParaLerParcelas, pedidoFaturou, planejarPendenciasAtraso, SITUACOES_ABERTAS, TITULO_PENDENCIA_ATRASO,
  CHAVE_DIAS_ALERTA_MDFE, diasAlertaMdfe, normalizarMdfe, planejarPendenciasMdfe, TITULO_PENDENCIA_MDFE,
  type PedidoNormalizado,
  candidatosIdNota, classificarSonda, formatoCodigo, contarPor, cruzarComTitulosAbertos, descreverCampos, notasDevolvidas,
  resumirAdiantamentos, resumirBloqueios, resumirCanceladas, resumirExtratoComissoes, resumirDevolucoes, resumirNotas, resumirPedidos, resumirTitulosDaNota, resumirTitulosPagos, tamanhoBase64Kb,
  type Sonda, type TentativaTitulo,
} from "../_shared/consistem-comercial.ts";

const AREA = "comercial";
const MODULO = "comercial.pedidos";
const MAX_PEDIDOS_DETALHE = 10;
const MAX_NOTAS_TITULO = 10;
const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });

/** Data de hoje no fuso de Cuiabá, 'aaaa-mm-dd'. */
const hojeCuiaba = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const erroDe = (e: unknown) => ({
  mensagem: e instanceof Error ? e.message : "falha",
  status: e instanceof ConsistemErro ? e.status : undefined,
});

function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * O chamador é a service role? Mesma conferência do rec-sincronizar-consistem: igualdade com a chave injetada ou, para
 * chave em outro formato (legada JWT x sb_secret_), uma operação administrativa do Auth que só a service role faz.
 */
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

/** Lista que a API devolve como array puro ou como { data: [...] }. */
const listaDe = (json: unknown): Record<string, unknown>[] =>
  Array.isArray(json) ? (json as Record<string, unknown>[]) : Array.isArray((json as Record<string, unknown>)?.data) ? ((json as Record<string, unknown>).data as Record<string, unknown>[]) : [];

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

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const acao = String(corpo.acao ?? "");
  if (!["sincronizar", "documento", "amostra", "extrato_comissoes"].includes(acao)) {
    return responder({ erro: "Ação desconhecida (sincronizar | documento | amostra | extrato_comissoes)." }, 400);
  }

  // Quem chama: (1) o agendamento do banco, com o segredo do Vault (só sincronizar); (2) a service role; (3) um usuário.
  let usuarioId: string | null = null;
  let agendado = false;
  if (segredoRecebido) {
    const segredoEsperado = Deno.env.get("SINCRONIZACAO_SEGREDO") ?? "";
    if (segredoEsperado.length < 32 || !iguaisSeguro(segredoRecebido, segredoEsperado) || acao !== "sincronizar") return responder({ erro: "Não autorizado." }, 401);
    agendado = true;
  } else if (!(await ehServiceRole(url, autorizacao.replace(/^Bearer\s+/i, ""), chaveServico))) {
    const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
    const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
    if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
    const { data: permitido, error: erroPermissao } = acao === "documento"
      ? await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "consulta" })
      : await comoUsuario.rpc("tem_acesso_area", { p_area: AREA, p_minimo: "gestor" });
    if (erroPermissao || permitido !== true) {
      return responder({ erro: acao === "documento" ? "Sem acesso aos pedidos." : "Somente o gestor do Comercial pode atualizar os pedidos do Consistem." }, 403);
    }
    usuarioId = quem.user.id;
  }
  if (token.trim().length < 50) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: empresas, error: erroEmpresas } = await banco.from("empresas")
    .select("id, nome_curto, codigo_erp").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto");
  if (erroEmpresas) return responder({ erro: "Não foi possível ler as empresas." }, 500);
  if (!empresas || empresas.length === 0) return responder({ erro: "Nenhuma empresa ativa tem o código do Consistem (empresas.codigo_erp)." }, 400);
  const cfgBase = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token };

  if (acao === "sincronizar") {
    const resultados: Record<string, unknown>[] = [];
    for (const emp of empresas) {
      resultados.push(await sincronizarEmpresa(banco, emp as Empresa, { ...cfgBase, empresa: emp.codigo_erp as string }, corpo.simular === true, agendado, usuarioId));
    }
    return responder({ ok: resultados.every((r) => r.ok !== false), agendado, resultados });
  }
  if (acao === "documento") return await documentoDaNota(banco, empresas as Empresa[], cfgBase, String(corpo.nota_id ?? ""), String(corpo.tipo ?? ""));

  const e = empresas[0];
  const cfg: ConfigConsistem = { ...cfgBase, empresa: e.codigo_erp as string };
  const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);
  if (acao === "extrato_comissoes") return await extratoComissoes(String(corpo.mes ?? ""), cfg, e.nome_curto as string);

  const dias = Math.min(180, Math.max(1, Math.round(Number(corpo.dias) || 90)));
  const hoje = hojeCuiaba();
  const desde = addDias(hoje, -dias);
  const sondas: Sonda[] = [];

  /** Roda uma leitura; se falhar, registra a sonda com o erro e devolve null (as demais seguem). */
  async function sondar<T>(servico: string, ler: () => Promise<T>, contar: (r: T) => number): Promise<T | null> {
    try {
      const r = await ler();
      sondas.push(classificarSonda(servico, { registros: contar(r) }));
      return r;
    } catch (erro) {
      sondas.push(classificarSonda(servico, { erro: erroDe(erro) }));
      return null;
    }
  }
  const tamanho = (r: unknown[]) => r.length;

  // 1. Carteira de pedidos (lista leve) e bloqueados.
  const pedidos = await sondar("pedidoVendaResumido", () =>
    buscarResumido(buscar, cfg, "comercial/v10/pedidoVendaResumido", { dataDigitacaoInicio: desde, dataDigitacaoFim: hoje }), tamanho);
  const bloqueados = await sondar("pedidosVendaBloqueados", () =>
    buscarTodasPaginas(buscar, cfg, "comercial/v10/pedidosVendaBloqueados", {}), tamanho);

  // 2. Pedido completo de uma amostra (os com saldo primeiro): bloqueios, cobrança, comissão e campos.
  const amostraPedidos = [...(pedidos ?? [])]
    .sort((a, b) => Number(Number(b.vlrSaldo) > 0) - Number(Number(a.vlrSaldo) > 0))
    .slice(0, MAX_PEDIDOS_DETALHE);
  const detalhes: Record<string, unknown>[] = [];
  for (const p of amostraPedidos) {
    const d = await sondar("pedidoVenda/{id}", () => buscarObjeto(buscar, cfg, `comercial/v10/pedidoVenda/${encodeURIComponent(String(p.codPedido ?? "").trim())}`), () => 1);
    if (d) detalhes.push(d);
  }

  // 3. NFs emitidas na janela (completas e resumidas) e canceladas.
  const notas = await sondar("notaFiscalSaida (emitidas)", () =>
    buscarTodasPaginas(buscar, cfg, "comercial/v10/notaFiscalSaida", { situacao: 2, dataEmissaoInicio: desde, dataEmissaoFim: hoje, paginacao: PAGINACAO }), tamanho);
  const resumidas = await sondar("notaFiscalSaidaResumida", () =>
    buscarResumido(buscar, cfg, "comercial/v10/notaFiscalSaidaResumida", { situacao: 2, dataEmissaoInicio: desde, dataEmissaoFim: hoje }), tamanho);
  const canceladas = await sondar("notaFiscalSaida (canceladas)", () =>
    buscarTodasPaginas(buscar, cfg, "comercial/v10/notaFiscalSaida", { situacao: 3, dataEmissaoInicio: desde, dataEmissaoFim: hoje, paginacao: PAGINACAO }), tamanho);

  // 4. Títulos de cada NF (/titulo): parcelas e comissão. 1ª sondagem (19/10): o {id} é a chave de acesso (44 dígitos);
  // NF sem chave dá "Nota Fiscal de Saída não encontrada". Por isso só as NFs com chave entram na amostra.
  const notasParaTitulo = (notas ?? []).filter((n) => Number(n.valorTotal) > 0 && chaveNfe(n.chaveAcesso) !== "").slice(-MAX_NOTAS_TITULO);
  const tentativas: TentativaTitulo[][] = [];
  for (const n of notasParaTitulo) {
    const daNota: TentativaTitulo[] = [];
    for (const c of candidatosIdNota(n)) {
      try {
        const titulos = listaDe(await buscarJson(buscar, cfg, `comercial/v10/notaFiscalSaida/${encodeURIComponent(c.id)}/titulo`));
        daNota.push({ formato: c.formato, status: titulos.length > 0 ? "ok" : "vazio", titulos });
        if (titulos.length > 0) break;
      } catch (erro) {
        daNota.push({ formato: c.formato, status: "erro", erro: erroDe(erro).mensagem });
      }
    }
    tentativas.push(daNota);
  }

  // 5. NFs por pedido (notaFiscalSaidaPedido/{codPedido}), nos pedidos faturados (situação 5 ou 6). A 1ª sondagem
  // mostrou que `numeroUltimaNF` vem sempre vazio, então o filtro é pela situação.
  const pedidosFaturados = (pedidos ?? []).filter((p) => ["5", "6"].includes(String(p.situacao ?? "").trim())).slice(0, MAX_PEDIDOS_DETALHE);
  const nfsPorPedido: Record<string, unknown>[] = [];
  for (const p of pedidosFaturados) {
    const r = await sondar("notaFiscalSaidaPedido/{codPedido}", async () =>
      listaDe(await buscarJson(buscar, cfg, `comercial/v10/notaFiscalSaidaPedido/${encodeURIComponent(String(p.codPedido).trim())}`)), tamanho);
    if (r) nfsPorPedido.push({ nfs: r.length, comChave: r.filter((n) => chaveNfe(n.chaveAcesso) !== "").length });
  }

  // 6. Pós-venda: devoluções e o cruzamento de canceladas/devolvidas com títulos EM ABERTO do contas a receber.
  const devolucoes = await sondar("devolucaoNota", () =>
    buscarTodasPaginas(buscar, cfg, "comercial/v10/devolucaoNota", { dataInicio: desde, dataFim: hoje }, { campoLista: "notasDevolucao" }), tamanho);
  const titulosAbertos = await sondar("financeiro contasReceber (abertos)", () =>
    buscarTodasPaginas(buscar, cfg, "financeiro/v10/contasReceber", { tipoTitulo: 0, paginacao: PAGINACAO }), tamanho);
  // A devolução traz o CNPJ do cliente, não o código: o cliente sai da NF original, quando ela está na janela.
  const clienteDaNota = new Map((notas ?? []).map((n) => [numeroNota(n.codNumNota), String(n.codCliente ?? "").trim()]));
  const devolvidas = notasDevolvidas(devolucoes ?? []);
  const devolvidasNaJanela = devolvidas.filter((d) => clienteDaNota.has(d.nota)).map((d) => ({ nota: d.nota, cliente: clienteDaNota.get(d.nota)! }));

  // 7. Expedição: o que a Neo usa de fato (sugestão de faturamento, romaneio, lista de transporte, MDF-e).
  for (const p of amostraPedidos.slice(0, 5)) {
    await sondar("pedidoVenda/{id}/sugestaoFaturamento", () =>
      buscarTodasPaginas(buscar, cfg, `comercial/v10/pedidoVenda/${encodeURIComponent(String(p.codPedido ?? "").trim())}/sugestaoFaturamento`, {}), tamanho);
  }
  const romaneios = await sondar("romaneioTextil", () =>
    buscarTodasPaginas(buscar, cfg, "comercial/v10/romaneioTextil", { dataEmissaoInicio: desde, dataEmissaoFim: hoje }), tamanho);
  const mdfes = await sondar("mdfe", () =>
    buscarTodasPaginas(buscar, cfg, "comercial/v10/mdfe", { dataEmissaoInicio: desde, dataEmissaoFim: hoje, situacao: 99 }, { campoLista: "listaMDFe" }), tamanho);
  const codLista = String(corpo.lista_transporte ?? "").trim();
  let listaTransporte: Record<string, unknown> = { consultada: false, motivo: "informe lista_transporte para conferir uma lista" };
  if (codLista) {
    const l = await sondar("listaTransporte/{id}", () => buscarObjeto(buscar, cfg, `comercial/v10/listaTransporte/${encodeURIComponent(codLista)}`), () => 1);
    listaTransporte = l
      ? { consultada: true, campos: descreverCampos([l]), notas: Array.isArray(l.notasFiscaisListaTransp) ? l.notasFiscaisListaTransp.length : null }
      : { consultada: true, erro: true };
  }

  // 9. Comissão (2ª etapa, pedido do Alan em 19/10/2026): a base é a parcela PAGA no mês. Adiantamento do cliente fica
  // em "créditos cadastrados" (sem API de leitura); o pedido traz `vlrAntecipado`. O extrato de comissões do Consistem
  // é sondado para ver se tem dado (o Consistem não calcula a comissão hoje).
  const titulosPagos = await sondar("financeiro titulosPagos", () =>
    buscarTodasPaginas(buscar, cfg, "financeiro/v10/titulosPagos", { dataInicio: desde, dataFim: hoje }, { campoLista: "titulosPagos" }), tamanho);
  const pedidosCompletos = await sondar("pedidoVenda (lista completa)", () =>
    buscarTodasPaginas(buscar, cfg, "comercial/v10/pedidoVenda", { dataDigitacaoInicio: desde, dataDigitacaoFim: hoje, paginacao: PAGINACAO }), tamanho);
  const extrato = await sondar("comissaosobrevendas extratoComissoes", () =>
    buscarTodasPaginas(buscar, cfg, "comissaosobrevendas/v10/extratoComissoes", { dataComissoesInicial: desde, dataComissoesFinal: hoje }, { campoLista: "extratosComissaoSobreVendas" }), tamanho);

  // 8. Documentos da NF: DANFE (PDF) e XML de uma NF eletrônica recente (com chave). Só o tamanho; o arquivo não é guardado.
  const ultima = (notas ?? []).filter((n) => chaveNfe(n.chaveAcesso) !== "").at(-1) ?? (notas ?? []).at(-1);
  const documentos: Record<string, unknown> = {};
  if (ultima) {
    const params = { dataEmissao: String(ultima.dataEmissao ?? "").slice(0, 10), codNota: String(ultima.codNumNota ?? "") };
    for (const [servico, rota] of [["danfeNotaFiscal", "comercial/v10/danfeNotaFiscal"], ["notaFiscalXML", "comercial/v10/notaFiscalXML"]] as const) {
      const r = await sondar(servico, () => buscarJson(buscar, cfg, rota, { params }), (j) => (tamanhoBase64Kb((j as Record<string, unknown>)?.arquivo) ? 1 : 0));
      documentos[servico] = r ? { tamanhoKb: tamanhoBase64Kb((r as Record<string, unknown>).arquivo) } : null;
    }
  }

  const resumidasComNomeRep = (resumidas ?? []).filter((n) => String(n.nomeRepresentante ?? "").trim() !== "").length;
  return responder({
    ok: true,
    empresa: e.nome_curto,
    janela: { desde, ate: hoje, dias },
    sondas: Object.values(
      // Uma linha por serviço (o pedidoVenda/{id} e o sugestaoFaturamento são chamados várias vezes).
      sondas.reduce<Record<string, Sonda & { chamadas: number }>>((acc, s) => {
        const atual = acc[s.servico];
        acc[s.servico] = atual
          ? { ...atual, chamadas: atual.chamadas + 1, registros: (atual.registros ?? 0) + (s.registros ?? 0), status: atual.status === "ok" ? "ok" : s.status }
          : { ...s, chamadas: 1 };
        return acc;
      }, {}),
    ),
    pedidos: pedidos ? resumirPedidos(pedidos, hoje) : null,
    bloqueados: bloqueados ? { total: bloqueados.length, porSituacao: contarPor(bloqueados, "situacao") } : null,
    pedidoCompleto: { ...resumirBloqueios(detalhes), camposDisponiveis: Object.keys(descreverCampos(detalhes)).sort() },
    notas: notas ? resumirNotas(notas) : null,
    notasResumidas: resumidas ? { total: resumidas.length, comNomeRepresentante: resumidasComNomeRep, camposDisponiveis: Object.keys(descreverCampos(resumidas)).sort() } : null,
    titulosDaNota: resumirTitulosDaNota(tentativas),
    nfsPorPedido: {
      pedidosConsultados: nfsPorPedido.length,
      distribuicao: contarPor(nfsPorPedido, "nfs"),
      nfsComChave: nfsPorPedido.reduce((s, p) => s + Number(p.comChave), 0),
    },
    posVenda: {
      canceladas: canceladas
        ? { ...resumirCanceladas(canceladas), ...cruzarComTitulosAbertos(canceladas.map((n) => ({ nota: numeroNota(n.codNumNota), cliente: String(n.codCliente ?? "").trim() })), titulosAbertos ?? []) }
        : null,
      devolucoes: devolucoes
        ? { ...resumirDevolucoes(devolucoes), notasOriginais: devolvidas.length, originaisNaJanela: devolvidasNaJanela.length, ...cruzarComTitulosAbertos(devolvidasNaJanela, titulosAbertos ?? []) }
        : null,
      titulosAbertosLidos: titulosAbertos !== null,
    },
    expedicao: {
      romaneios: romaneios ? { total: romaneios.length, porSituacao: contarPor(romaneios, "situacao") } : null,
      mdfe: mdfes ? { total: mdfes.length, porSituacao: contarPor(mdfes, "situcao") } : null, // "situcao": grafia da API
      listaTransporte,
    },
    documentos,
    comissao: {
      titulosPagos: titulosPagos ? resumirTitulosPagos(titulosPagos) : null,
      adiantamentos: pedidosCompletos ? resumirAdiantamentos(pedidosCompletos) : null,
      extratoComissoes: extrato ? resumirExtratoComissoes(extrato) : null,
    },
  });
});

const MAX_TITULOS_TIPO_BAIXA = 300;

/** Extrato de comissões do Consistem e títulos pagos de um mês, com valores, para comparar com as planilhas. */
async function extratoComissoes(mes: string, cfg: ConfigConsistem, empresa: string): Promise<Response> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return responder({ erro: "Informe o mês como aaaa-mm." }, 400);
  const [ano, m] = mes.split("-").map(Number);
  const inicio = `${mes}-01`;
  const fim = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10); // dia 0 do mês seguinte = último dia do mês
  const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);
  try {
    const extrato = await buscarTodasPaginas(buscar, cfg, "comissaosobrevendas/v10/extratoComissoes",
      { dataComissoesInicial: inicio, dataComissoesFinal: fim }, { campoLista: "extratosComissaoSobreVendas" });
    const pagos = await buscarTodasPaginas(buscar, cfg, "financeiro/v10/titulosPagos", { dataInicio: inicio, dataFim: fim }, { campoLista: "titulosPagos" });

    // Tipo de baixa de cada título pago (titulosPagos não traz): contasReceber/{codTitulo}.
    const tipoBaixa = new Map<string, Record<string, unknown>>();
    for (const t of pagos.slice(0, MAX_TITULOS_TIPO_BAIXA)) {
      const cod = String(t.codTitulo ?? "").trim();
      if (!cod || tipoBaixa.has(cod)) continue;
      try {
        const r = await buscarObjeto(buscar, cfg, `financeiro/v10/contasReceber/${encodeURIComponent(cod)}`);
        tipoBaixa.set(cod, {
          tipoBaixa: r.tipoBaixa ?? null, codRepresentante: r.codRepresentante ?? null, percComissao: r.percComissao ?? null,
          valorComissaoFaturamento: r.valorComissaoFaturamento ?? null, valorComissaoLiquidacao: r.valorComissaoLiquidacao ?? null,
        });
      } catch (erro) {
        tipoBaixa.set(cod, { erro: erroDe(erro).mensagem.slice(0, 80) });
      }
    }

    const extratos = extrato.flatMap((r) => (Array.isArray(r.extratosComissaoSobreVendas) ? (r.extratosComissaoSobreVendas as Record<string, unknown>[]) : [r]));
    return responder({
      ok: true, empresa, periodo: { inicio, fim },
      extratos: extratos.map((x) => ({
        codRepresentante: x.codRepresentante, valoresReferencia: x.valoresReferencia, valoresResumoNota: x.valoresResumoNota,
        lancamentos: listaDe({ data: x.lancamentos }).map((l) => ({
          seq: l.seqLancamento, data: l.dataLancamento, descricao: l.descricaoLancamento, tipo: l.tipoLancamento, valor: l.valorLancamento,
          titulos: listaDe({ data: l.titulosRefLancamento }).map((t) => ({
            codTitulo: t.codTitulo, valorTitulo: t.valorTitulo, valorComissao: t.valorComissao, nota: t.notaFiscalOrigem,
          })),
        })),
      })),
      titulosPagos: pagos.map((t) => ({
        codTitulo: t.codTitulo, vlrTitulo: t.vlrTitulo, vlrPago: t.vlrPago, dataVencimento: t.dataVencimento,
        dataPagamento: t.dataPagamento, notaFiscal: t.notaFiscal, ...(tipoBaixa.get(String(t.codTitulo ?? "").trim()) ?? { tipoBaixa: "não consultado" }),
      })),
    });
  } catch (erro) {
    return responder({ erro: erroDe(erro).mensagem }, 502);
  }
}


// ---------------------------------------------------------------- sincronização da carteira (Fase 1)

// deno-lint-ignore no-explicit-any
type Banco = SupabaseClient<any, "public", any>;
type Empresa = { id: string; nome_curto: string; codigo_erp: string };

/** Janela de digitação lida do pedidoVendaResumido. Pedido aberto mais antigo que isso é relido um a um (pedidoVenda/{id}). */
const JANELA_DIGITACAO_DIAS = 730;
// Limites por rodada (a Edge Function tem tempo máximo); o que sobrar fica para a próxima rodada de 30 minutos.
const MAX_RELER_FORA_JANELA = 40;
const MAX_DETALHES = 60;
const MAX_NOTAS_PARCELAS = 60;
/** MDF-e emitidos nesta janela são relidos a cada rodada (situação muda até o encerramento). */
const JANELA_MDFE_DIAS = 180;
const LOTE = 200;
const TITULO_FALHA = "Falha na sincronização dos pedidos";

function lotes<T>(itens: T[], tamanho = LOTE): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho));
  return saida;
}

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

/** Executa uma gravação e transforma o erro do banco em exceção. */
async function gravar(operacao: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await operacao;
  if (error) throw new Error(error.message);
}

type PedidoBanco = {
  id: string; cod_pedido: string; assinatura: string | null; detalhado_em: string | null; situacao: string;
  nome_cliente: string | null; nome_representante: string | null; desc_tipo_nf: string | null; desc_cond_venda: string | null; data_ultimo_fat: string | null;
};

async function sincronizarEmpresa(
  banco: Banco, emp: Empresa, cfg: ConfigConsistem, simular: boolean, agendado: boolean, usuarioId: string | null,
): Promise<Record<string, unknown>> {
  const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);
  const hoje = hojeCuiaba();
  const resumo: Record<string, unknown> = { empresa: emp.nome_curto, ok: true };
  let registroId: string | null = null;
  if (!simular) {
    const { data } = await banco.from("com_sincronizacoes").insert({ empresa_id: emp.id, agendada: agendado, usuario_id: usuarioId }).select("id").single();
    registroId = (data?.id as string | undefined) ?? null;
  }

  try {
    // 1. Carteira: pedidos digitados na janela (com nomes) + os abertos mais antigos já gravados, relidos um a um.
    const brutos = await buscarResumido(buscar, cfg, "comercial/v10/pedidoVendaResumido", {
      dataDigitacaoInicio: addDias(hoje, -JANELA_DIGITACAO_DIAS), dataDigitacaoFim: hoje,
    });
    const daApi = new Map<string, PedidoNormalizado>();
    for (const b of brutos) {
      const p = normalizarPedidoResumido(b);
      if (p) daApi.set(p.cod_pedido, p);
    }
    const existentes = await lerTudo<PedidoBanco>((de, ate) => banco.from("com_pedidos")
      .select("id, cod_pedido, assinatura, detalhado_em, situacao, nome_cliente, nome_representante, desc_tipo_nf, desc_cond_venda, data_ultimo_fat")
      .eq("empresa_id", emp.id).order("cod_pedido").range(de, ate));
    if (daApi.size === 0 && existentes.length > 0) {
      throw new Error("A API devolveu nenhum pedido, mas há pedidos gravados: nada foi alterado (provável falha do Consistem).");
    }
    let relidos = 0;
    for (const e of existentes.filter((x) => !daApi.has(x.cod_pedido) && SITUACOES_ABERTAS.includes(x.situacao)).slice(0, MAX_RELER_FORA_JANELA)) {
      try {
        const c = normalizarPedidoCompleto(await buscarObjeto(buscar, cfg, `comercial/v10/pedidoVenda/${encodeURIComponent(e.cod_pedido)}`));
        if (c) {
          daApi.set(c.cod_pedido, {
            ...c, nome_cliente: e.nome_cliente, nome_representante: e.nome_representante, desc_tipo_nf: e.desc_tipo_nf,
            desc_cond_venda: e.desc_cond_venda, data_ultimo_fat: e.data_ultimo_fat,
          });
          relidos++;
        }
      } catch {
        /* fica como estava; tenta de novo na próxima rodada */
      }
    }
    const porCodigo = new Map(existentes.map((e) => [e.cod_pedido, e]));
    const paraDetalhar = [...daApi.values()].filter((p) => {
      const e = porCodigo.get(p.cod_pedido);
      return !e || !e.detalhado_em || e.assinatura !== assinaturaPedido(p);
    });
    Object.assign(resumo, {
      pedidosNaApi: brutos.length, relidosForaDaJanela: relidos, novos: [...daApi.keys()].filter((c) => !porCodigo.has(c)).length,
      paraDetalhar: paraDetalhar.length,
    });
    if (simular) return { ...resumo, simulado: true };

    // 2. Grava a carteira (cliente ligado à contraparte do núcleo pelo código do Consistem).
    const codClientes = [...new Set([...daApi.values()].map((p) => p.cod_cliente).filter((c): c is string => !!c))];
    const contraparte = new Map<string, string>();
    for (const lote of lotes(codClientes, 100)) {
      const { data, error } = await banco.from("contrapartes").select("id, codigo_erp").in("codigo_erp", lote);
      if (error) throw new Error(`Falha ao ler as contrapartes: ${error.message}`);
      for (const c of data ?? []) if (!contraparte.has(c.codigo_erp as string)) contraparte.set(c.codigo_erp as string, c.id as string);
    }
    const agora = new Date().toISOString();
    const linhas = [...daApi.values()].map((p) => ({
      empresa_id: emp.id, ...p, contraparte_id: p.cod_cliente ? contraparte.get(p.cod_cliente) ?? null : null, visto_em: agora,
    }));
    for (const lote of lotes(linhas)) await gravar(banco.from("com_pedidos").upsert(lote, { onConflict: "empresa_id,cod_pedido" }));
    const ids = new Map((await lerTudo<{ id: string; cod_pedido: string }>((de, ate) => banco.from("com_pedidos")
      .select("id, cod_pedido").eq("empresa_id", emp.id).order("cod_pedido").range(de, ate))).map((x) => [x.cod_pedido, x.id]));

    // 3. Detalhe (itens) e NFs dos pedidos novos ou que mudaram; os com saldo a faturar primeiro.
    const fila = paraDetalhar
      .sort((a, b) => Number(b.valor_saldo > 0) - Number(a.valor_saldo > 0) || (b.data_digitacao ?? "").localeCompare(a.data_digitacao ?? ""))
      .slice(0, MAX_DETALHES);
    let detalhados = 0, notasGravadas = 0, errosDetalhe = 0;
    for (const p of fila) {
      const id = ids.get(p.cod_pedido);
      if (!id) continue;
      const cod = encodeURIComponent(p.cod_pedido);
      try {
        const d = normalizarDetalhePedido(await buscarObjeto(buscar, cfg, `comercial/v10/pedidoVenda/${cod}`));
        await gravar(banco.from("com_pedido_itens").delete().eq("pedido_id", id));
        if (d.itens.length > 0) await gravar(banco.from("com_pedido_itens").insert(d.itens.map((i) => ({ pedido_id: id, ...i }))));
        const atual: Record<string, unknown> = { valor_antecipado: d.valor_antecipado, cod_portador: d.cod_portador, observacao: d.observacao, detalhado_em: agora };
        if (pedidoFaturou(p)) {
          let brutasNotas: Record<string, unknown>[] = [];
          try {
            brutasNotas = listaDe(await buscarJson(buscar, cfg, `comercial/v10/notaFiscalSaidaPedido/${cod}`));
          } catch (erro) {
            // 400 = o Consistem não achou NF do pedido (não é falha da rodada); o resto sobe.
            if (!(erro instanceof ConsistemErro && erro.status === 400)) throw erro;
          }
          const notas = brutasNotas.map(normalizarNotaPedido).filter((n): n is NonNullable<typeof n> => n !== null);
          if (notas.length > 0) {
            await gravar(banco.from("com_notas").upsert(notas.map((n) => ({ pedido_id: id, ...n, visto_em: agora })), { onConflict: "pedido_id,nota,serie" }));
            notasGravadas += notas.length;
          }
          atual.notas_lidas_em = agora;
        }
        atual.assinatura = assinaturaPedido(p); // só depois de tudo lido: se falhar no meio, relê na próxima rodada
        await gravar(banco.from("com_pedidos").update(atual).eq("id", id));
        detalhados++;
      } catch {
        errosDetalhe++;
      }
    }

    // 4. Parcelas das NFs (pela chave de acesso): as nunca lidas e as que ainda têm parcela em aberto.
    type NotaBanco = { id: string; chave_acesso: string | null; situacao: string | null; sem_titulos: boolean; parcelas_lidas_em: string | null; com_nota_parcelas: { data_pagamento: string | null }[] };
    const notasBanco = await lerTudo<NotaBanco>((de, ate) => banco.from("com_notas")
      .select("id, chave_acesso, situacao, sem_titulos, parcelas_lidas_em, com_nota_parcelas(data_pagamento), com_pedidos!inner(empresa_id)")
      .eq("com_pedidos.empresa_id", emp.id).order("id").range(de, ate));
    let notasLidas = 0, notasSemTitulos = 0, errosParcelas = 0;
    const paraLer = notasParaLerParcelas(
      notasBanco.map((n) => ({ ...n, parcelas_abertas: (n.com_nota_parcelas ?? []).filter((x) => !x.data_pagamento).length })),
      MAX_NOTAS_PARCELAS,
    );
    for (const n of paraLer) {
      try {
        const parcelas = listaDe(await buscarJson(buscar, cfg, `comercial/v10/notaFiscalSaida/${encodeURIComponent(n.chave_acesso!)}/titulo`))
          .map(normalizarParcela).filter((x): x is NonNullable<typeof x> => x !== null);
        if (parcelas.length > 0) {
          await gravar(banco.from("com_nota_parcelas").upsert(parcelas.map((x) => ({ nota_id: n.id, ...x, visto_em: agora })), { onConflict: "nota_id,cod_titulo" }));
        }
        await gravar(banco.from("com_notas").update({ parcelas_lidas_em: agora }).eq("id", n.id));
        notasLidas++;
      } catch (erro) {
        if (erro instanceof Error && ehNotaSemTitulos(erro.message)) {
          await gravar(banco.from("com_notas").update({ sem_titulos: true, parcelas_lidas_em: agora }).eq("id", n.id));
          notasSemTitulos++;
        } else {
          errosParcelas++;
        }
      }
    }

    // 5. Pendência "Pedido com previsão vencida" na Fila do dia.
    const pedidosPend = await lerTudo<{ id: string; cod_pedido: string; situacao: string; valor_saldo: number; data_prev_fat: string | null; nome_cliente: string | null; contraparte_id: string | null }>(
      (de, ate) => banco.from("com_pedidos").select("id, cod_pedido, situacao, valor_saldo, data_prev_fat, nome_cliente, contraparte_id")
        .eq("empresa_id", emp.id).order("cod_pedido").range(de, ate),
    );
    const abertas = await lerTudo<{ id: string; referencia_id: string | null; descricao: string | null }>((de, ate) => banco.from("pendencias")
      .select("id, referencia_id, descricao").eq("modulo", MODULO).eq("empresa_id", emp.id).eq("referencia_tabela", "com_pedidos")
      .eq("titulo", TITULO_PENDENCIA_ATRASO).in("status", ["aberta", "em_andamento"]).order("id").range(de, ate));
    const plano = planejarPendenciasAtraso(pedidosPend.map((p) => ({ ...p, valor_saldo: Number(p.valor_saldo) })), abertas, hoje);
    for (const lote of lotes(plano.abrir)) {
      await gravar(banco.from("pendencias").insert(lote.map((x) => ({ ...x, modulo: MODULO, empresa_id: emp.id, criticidade: "normal" }))));
    }
    for (const a of plano.atualizar) await gravar(banco.from("pendencias").update({ descricao: a.descricao }).eq("id", a.id));
    for (const lote of lotes(plano.concluir)) {
      await gravar(banco.from("pendencias").update({ status: "concluida", concluido_em: agora }).in("id", lote));
    }

    // 6. MDF-e (Fase 2): espelho dos manifestos e pendência "MDF-e não encerrado" (só com o prazo configurado).
    let mdfesLidos = 0, pendenciasMdfeAbertas = 0, pendenciasMdfeConcluidas = 0;
    try {
      const brutosMdfe = await buscarTodasPaginas(buscar, cfg, "comercial/v10/mdfe",
        { dataEmissaoInicio: addDias(hoje, -JANELA_MDFE_DIAS), dataEmissaoFim: hoje, situacao: 99 }, { campoLista: "listaMDFe" });
      const mdfes = brutosMdfe.map(normalizarMdfe).filter((m): m is NonNullable<typeof m> => m !== null);
      for (const lote of lotes(mdfes)) {
        await gravar(banco.from("com_mdfes").upsert(lote.map((m) => ({ empresa_id: emp.id, ...m, visto_em: agora })), { onConflict: "empresa_id,numero" }));
      }
      mdfesLidos = mdfes.length;
      // Formato cru da data de emissão (sem valor), para conferir quando algum MDF-e ficar sem data.
      const semData = brutosMdfe.find((m, i) => mdfes[i] && !mdfes[i].data_emissao) ?? null;
      if (semData) resumo.formatoDataMdfeSemData = `${typeof semData.dataEmissao}:${formatoCodigo(semData.dataEmissao)}`;
      const { data: cfgAlerta } = await banco.from("configuracoes").select("valor").eq("chave", CHAVE_DIAS_ALERTA_MDFE).maybeSingle();
      const gravados = await lerTudo<{ id: string; numero: string; situacao: string | null; data_emissao: string | null; uf_final: string | null; placas: string | null }>(
        (de, ate) => banco.from("com_mdfes").select("id, numero, situacao, data_emissao, uf_final, placas").eq("empresa_id", emp.id).order("numero").range(de, ate),
      );
      const abertasMdfe = await lerTudo<{ id: string; referencia_id: string | null }>((de, ate) => banco.from("pendencias")
        .select("id, referencia_id").eq("modulo", MODULO).eq("empresa_id", emp.id).eq("referencia_tabela", "com_mdfes")
        .eq("titulo", TITULO_PENDENCIA_MDFE).in("status", ["aberta", "em_andamento"]).order("id").range(de, ate));
      const planoMdfe = planejarPendenciasMdfe(gravados, abertasMdfe, hoje, diasAlertaMdfe(cfgAlerta?.valor));
      for (const lote of lotes(planoMdfe.abrir)) {
        await gravar(banco.from("pendencias").insert(lote.map((x) => ({ ...x, modulo: MODULO, empresa_id: emp.id, criticidade: "alta" }))));
      }
      for (const lote of lotes(planoMdfe.concluir)) {
        await gravar(banco.from("pendencias").update({ status: "concluida", concluido_em: agora }).in("id", lote));
      }
      pendenciasMdfeAbertas = planoMdfe.abrir.length;
      pendenciasMdfeConcluidas = planoMdfe.concluir.length;
    } catch (erro) {
      // MDF-e é complementar: a falha não derruba a carteira (fica registrada no resumo).
      resumo.erroMdfe = erro instanceof Error ? erro.message.slice(0, 200) : "falha";
    }

    Object.assign(resumo, {
      mdfesLidos, pendenciasMdfeAbertas, pendenciasMdfeConcluidas,
      detalhados, notasGravadas, errosDetalhe, notasLidas, notasSemTitulos, errosParcelas,
      pendenciasAbertas: plano.abrir.length, pendenciasConcluidas: plano.concluir.length,
      restamParaDetalhar: Math.max(0, paraDetalhar.length - fila.length),
    });
    await gravar(banco.from("pendencias").update({ status: "cancelada" }).eq("modulo", MODULO).eq("titulo", TITULO_FALHA).in("status", ["aberta", "em_andamento"]));
    if (registroId) await banco.from("com_sincronizacoes").update({ concluida_em: new Date().toISOString(), resumo }).eq("id", registroId);
    return resumo;
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha inesperada.";
    if (!simular) {
      if (registroId) await banco.from("com_sincronizacoes").update({ concluida_em: new Date().toISOString(), resumo, erro: mensagem }).eq("id", registroId);
      const { data: jaAberta } = await banco.from("pendencias").select("id").eq("modulo", MODULO).eq("titulo", TITULO_FALHA).in("status", ["aberta", "em_andamento"]).limit(1);
      if (!jaAberta || jaAberta.length === 0) {
        await banco.from("pendencias").insert({
          modulo: MODULO, empresa_id: emp.id, titulo: TITULO_FALHA, criticidade: "alta", prazo: hoje, link: "/comercial/pedidos",
          descricao: `${agendado ? "Rodada agendada" : "Atualização manual"}: ${mensagem.slice(0, 300)}`,
        });
      }
    }
    return { ...resumo, ok: false, erro: mensagem };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DANFE (PDF) ou XML de uma NF do espelho, direto do Consistem, em base64 (não é guardado). */
async function documentoDaNota(
  banco: Banco, empresas: Empresa[], cfgBase: { baseUrl: string; token: string }, notaId: string, tipo: string,
): Promise<Response> {
  if (!UUID.test(notaId) || (tipo !== "danfe" && tipo !== "xml")) return responder({ erro: "Pedido de documento inválido." }, 400);
  const { data: nota, error } = await banco.from("com_notas").select("nota, data_emissao, com_pedidos!inner(empresa_id)").eq("id", notaId).maybeSingle();
  if (error || !nota) return responder({ erro: "NF não encontrada." }, 404);
  const empresaId = (nota.com_pedidos as unknown as { empresa_id: string }).empresa_id;
  const emp = empresas.find((x) => x.id === empresaId);
  if (!emp || !nota.data_emissao) return responder({ erro: "NF sem empresa ou sem data de emissão." }, 400);
  const rota = tipo === "danfe" ? "comercial/v10/danfeNotaFiscal" : "comercial/v10/notaFiscalXML";
  try {
    const json = await buscarJson((u, init) => fetch(u, init), { ...cfgBase, empresa: emp.codigo_erp }, rota, {
      params: { dataEmissao: String(nota.data_emissao), codNota: String(nota.nota) },
    });
    const arquivo = String((json as Record<string, unknown>)?.arquivo ?? "").replace(/\s/g, "");
    if (!arquivo) return responder({ erro: "O Consistem não devolveu o arquivo." }, 404);
    return responder({
      ok: true, arquivo, nome: `NF-${nota.nota}.${tipo === "danfe" ? "pdf" : "xml"}`,
      tipo: tipo === "danfe" ? "application/pdf" : "application/xml",
    });
  } catch (erro) {
    const m = erroDe(erro).mensagem;
    return responder({ erro: /n[ãa]o encontrad/i.test(m) ? "O Consistem não tem esse arquivo para a NF (NF sem chave ou não transmitida)." : m }, 502);
  }
}
