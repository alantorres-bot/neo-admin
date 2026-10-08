// Edge Function do módulo Financeiro/Recebíveis: sincroniza as contas a receber em aberto do Consistem.
// Mesma API já em produção no gestor-akf e no NEOControl (ver _shared/consistem-receber.ts).
//
// Quem pode chamar:
//   - usuário logado com nível de gestor (ou acima) na área do Financeiro; ou
//   - agendamento diário do banco (pg_cron + pg_net, migration 0102), com o cabeçalho `x-sincronizacao-segredo`
//     igual ao segredo SINCRONIZACAO_SEGREDO (o mesmo valor fica no Vault do banco); ou
//   - service role no Authorization.
// Falha de sincronização real vira a pendência "Falha na sincronização com o Consistem" na Fila do dia.
//
// Corpo (JSON), campo `acao`:
//   sincronizar { simular?: boolean }   busca a API e grava; com simular=true só devolve o que faria
//   amostra                             devolve os NOMES e tipos dos campos da API (sem valores) para conferência
//
// Regras de segurança dos dados:
//   - A API só lista títulos EM ABERTO. Título que sumiu da lista NÃO é baixado: vira pendência
//     "Possível baixa" na Fila do dia, para um humano confirmar data e valor.
//   - Se a API devolver lista vazia mas existem títulos abertos no banco, nada é alterado (provável falha).
//   - Títulos pagos/renegociados/cancelados e de origem manual/acordo nunca são alterados por aqui.
//
// Segredos (Supabase > Edge Functions > Secrets): CONSISTEM_API_KEY (obrigatório), SINCRONIZACAO_SEGREDO
// (agendamento), CONSISTEM_BASE_URL (opcional). O código da empresa vem de empresas.codigo_erp.
//
// Deploy: npx supabase functions deploy rec-sincronizar-consistem
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  addDias,
  analisarVinculo,
  BASE_URL_PADRAO,
  buscarObjeto,
  buscarTodasPaginas,
  chaveTitulo,
  ConsistemErro,
  criticidadeBoleto,
  decidirEntrada,
  descricaoPendenciaBoleto,
  descricaoPossivelBaixa,
  documentoFormatado,
  indexarNotas,
  indexarPagos,
  limparToken,
  ligarTituloNota,
  normalizarClienteApi,
  normalizarNotaSaida,
  normalizarTituloApi,
  PAGINACAO,
  planejarSincronizacao,
  prazoBoleto,
  PREFIXO_BOLETO,
  planejarPendenciasBoleto,
  tituloPendenciaBoleto,
  type ClienteApi,
  type ConfigConsistem,
  type EvidenciaPagamento,
  type NotaEsteira,
  type NotaSaida,
  type TituloApi,
  type TituloBanco,
  type TituloEsteira,
} from "../_shared/consistem-receber.ts";
import {
  criticidadeConfirmacao,
  descricaoPendenciaConfirmacao,
  ESTAGIOS_CONFIRMAVEIS,
  pendenciasConfirmacaoObsoletas,
  planejarConfirmacoes,
  prazoConfirmacao,
  tituloPendenciaConfirmacao,
  type TituloConfirmacao,
} from "../_shared/confirmacao.ts";

import {
  criticidadeCadastro,
  descricaoPendenciaCadastro,
  descricaoPendenciaContato,
  DIAS_ESCOPO_CADASTRO,
  planejarCadastro,
  PREFIXO_CADASTRAR_CONTATO,
  PREFIXO_CONFERIR_CADASTRO,
  TRAVA_PENDENCIAS_CADASTRO,
  tituloPendenciaCadastro,
  tituloPendenciaContato,
  type ClienteParaCadastro,
} from "../_shared/clientes.ts";
import { escolherContato, temContatoUtil, type ContatoEscolha, type Finalidade } from "../_shared/contatos.ts";
import {
  criticidadeCobranca,
  descricaoPendenciaCobranca,
  ESTAGIOS_COBRAVEIS,
  ESTAGIOS_QUE_VENCEM,
  MARCOS_PADRAO,
  marcosDeLinhas,
  planejarCobrancas,
  PREFIXO_COBRANCA,
  unidadeDaPendencia,
  tituloPendenciaCobranca,
  type LinhaMarcoBanco,
  type TituloCobranca,
} from "../_shared/cobranca.ts";
import { lerParametrosRegra, TODAS_AS_CHAVES_REGRA } from "../_shared/parametros-regra.ts";

const MODULO = "financeiro.recebiveis";
const PREFIXO_BAIXA = "Possível baixa: ";
const LOTE = 200;

/** Data de hoje no fuso de Cuiabá, 'aaaa-mm-dd'. */
const hojeCuiaba = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * Antecipação parcial na AKF (migration 0113): o que RESTA com a Neo em cada título que tem parte antecipada, em centavos.
 * A confirmação e a cobrança falam do restante (a parte na AKF não é cobrada pela Neo). Título sem parte fica de fora do mapa.
 */
async function lerRestantes(banco: Banco, ids: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  for (const lote of lotes([...new Set(ids)], 100)) {
    const { data, error } = await banco.from("akf_vw_valor_restante").select("titulo_id, valor_restante").in("titulo_id", lote);
    if (error) throw new Error(`Falha ao ler as antecipações parciais: ${error.message}`);
    for (const d of data ?? []) mapa.set(d.titulo_id as string, Math.round(Number(d.valor_restante) * 100));
  }
  return mapa;
}

/**
 * Nome do contato que personaliza a saudação do WhatsApp de cada cliente: a mesma regra das telas (`_shared/contatos.ts`),
 * só quem está ativo, tem WhatsApp e, de preferência, a finalidade pedida. Cliente sem contato fica de fora (saudação genérica).
 */
async function contatosParaSaudacao(banco: Banco, clientes: string[], finalidades: Finalidade[]): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  const ids = [...new Set(clientes)];
  if (ids.length === 0) return nomes;
  const porCliente = new Map<string, ContatoEscolha[]>();
  for (const lote of lotes(ids, 100)) {
    const { data, error } = await banco.from("contatos").select("id, contraparte_id, nome, email, whatsapp, telefone, finalidades, canal_preferido, ativo").in("contraparte_id", lote).eq("ativo", true);
    if (error) throw new Error(`Falha ao ler os contatos: ${error.message}`);
    for (const c of data ?? []) porCliente.set(c.contraparte_id as string, [...(porCliente.get(c.contraparte_id as string) ?? []), c as unknown as ContatoEscolha]);
  }
  for (const [cliente, lista] of porCliente) {
    const escolhido = escolherContato(lista, finalidades, "whatsapp");
    if (escolhido) nomes.set(cliente, escolhido.nome);
  }
  return nomes;
}

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });

function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * O chamador é a service role (agendamento)? Igualdade com a chave injetada resolve o caso comum; como o projeto
 * pode ter chaves nos dois formatos (legada JWT e nova sb_secret_), a prova final é uma operação administrativa do
 * Auth, que só uma service role válida consegue fazer (um JWT forjado com role=service_role falha na assinatura).
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

type ContraparteLinha = { id: string; nome: string; documento: string | null; codigo_erp: string | null; tipos: string[] };

async function resolverContrapartes(
  banco: Banco,
  codigos: string[],
  clientes: Map<string, ClienteApi>,
  contagem: { contrapartesNovas: number; contrapartesVinculadas: number; documentosInvalidos: number },
): Promise<Map<string, string>> {
  const existentes = await lerTudo<ContraparteLinha>((de, ate) =>
    banco.from("contrapartes").select("id, nome, documento, codigo_erp, tipos").order("id").range(de, ate));
  const porCodigo = new Map(existentes.filter((c) => c.codigo_erp).map((c) => [c.codigo_erp as string, c]));
  const porDocumento = new Map(existentes.filter((c) => c.documento).map((c) => [c.documento as string, c]));
  const resultado = new Map<string, string>();
  const paraCriar: { nome: string; documento: string | null; tipos: string[]; codigo_erp: string }[] = [];
  const documentosUsados = new Set<string>();

  for (const cod of codigos) {
    const noCodigo = porCodigo.get(cod);
    if (noCodigo) {
      resultado.set(cod, noCodigo.id);
      continue;
    }
    const cli = clientes.get(cod);
    const documento = cli?.documentoBruto ? documentoFormatado(cli.documentoBruto) : null;
    if (cli?.documentoBruto && !documento) contagem.documentosInvalidos++;

    // Cadastro já existe (criado à mão ou por outro módulo) com o mesmo CPF/CNPJ: só liga ao código do Consistem.
    const noDocumento = documento ? porDocumento.get(documento) : undefined;
    if (noDocumento && !noDocumento.codigo_erp) {
      const tipos = noDocumento.tipos.includes("cliente") || noDocumento.tipos.includes("colaborador")
        ? noDocumento.tipos
        : [...noDocumento.tipos.filter((t) => t !== "outro"), "cliente"];
      const { error } = await banco.from("contrapartes").update({ codigo_erp: cod, tipos }).eq("id", noDocumento.id);
      if (error) throw new Error(`Falha ao vincular o cliente ${cod}: ${error.message}`);
      resultado.set(cod, noDocumento.id);
      contagem.contrapartesVinculadas++;
      continue;
    }

    // Documento repetido dentro desta mesma rodada (dois códigos com o mesmo CNPJ) ou já de outro cadastro: sem documento.
    const documentoLivre = documento && !noDocumento && !documentosUsados.has(documento) ? documento : null;
    if (documentoLivre) documentosUsados.add(documentoLivre);
    paraCriar.push({ nome: cli?.nome || `Cliente ${cod} (Consistem)`, documento: documentoLivre, tipos: ["cliente"], codigo_erp: cod });
  }

  for (const lote of lotes(paraCriar)) {
    const { data, error } = await banco.from("contrapartes").insert(lote).select("id, codigo_erp");
    if (error) throw new Error(`Falha ao criar clientes: ${error.message}`);
    for (const c of data ?? []) resultado.set(c.codigo_erp as string, c.id as string);
    contagem.contrapartesNovas += lote.length;
  }
  return resultado;
}

type ResumoEmpresa = Record<string, unknown>;

async function sincronizarEmpresa(
  banco: Banco,
  empresa: { id: string; nome_curto: string; codigo_erp: string },
  cfgBase: Omit<ConfigConsistem, "empresa">,
  simular: boolean,
  usuarioId: string | null,
): Promise<ResumoEmpresa> {
  const cfg: ConfigConsistem = { ...cfgBase, empresa: empresa.codigo_erp };
  const buscar = (url: string, init: { headers: Record<string, string> }) => fetch(url, init);
  const hoje = hojeCuiaba();

  // 1) API: títulos em aberto
  const registros = await buscarTodasPaginas(buscar, cfg, "financeiro/v10/contasReceber", { tipoTitulo: 0, paginacao: PAGINACAO });
  const titulosApi: TituloApi[] = [];
  const recusados: { documento: string; motivo: string }[] = [];
  for (const r of registros) {
    const n = normalizarTituloApi(r);
    if (n.ok) titulosApi.push(n.titulo);
    else recusados.push({ documento: n.documento, motivo: n.motivo });
  }

  // 2) Banco
  type LinhaTitulo = {
    id: string; contraparte_id: string; documento: string; parcela: string; emissao: string | null;
    vencimento: string; valor: number | string; estagio: string; origem: string;
    nota_fiscal: string | null; chave_nfe: string | null; cod_portador: string | null; tipo_cobranca: string | null; nota_saida_id: string | null;
    consistem_pago_em: string | null;
  };
  const linhas = await lerTudo<LinhaTitulo>((de, ate) =>
    banco.from("rec_titulos")
      .select("id, contraparte_id, documento, parcela, emissao, vencimento, valor, estagio, origem, nota_fiscal, chave_nfe, cod_portador, tipo_cobranca, nota_saida_id, consistem_pago_em")
      .eq("empresa_id", empresa.id).order("id").range(de, ate));
  const titulosBanco: TituloBanco[] = linhas.map((l) => ({
    id: l.id, documento: l.documento, parcela: l.parcela, emissao: l.emissao, vencimento: l.vencimento,
    valorCentavos: Math.round(Number(l.valor) * 100), estagio: l.estagio, origem: l.origem,
    notaFiscal: l.nota_fiscal, chaveNfe: l.chave_nfe, codPortador: l.cod_portador, tipoCobranca: l.tipo_cobranca,
  }));
  const contraparteDoTitulo = new Map(linhas.map((l) => [l.id, l.contraparte_id]));
  const linhaPorChave = new Map(linhas.map((l) => [chaveTitulo(l.documento, l.parcela), l]));

  // Trava de segurança: lista vazia da API com títulos abertos no banco = provável falha, não "todos pagaram".
  const abertosDoConsistem = titulosBanco.filter((t) => t.origem === "importacao" && !["pago", "renegociado", "cancelado"].includes(t.estagio)).length;
  if (titulosApi.length === 0 && abertosDoConsistem > 0) {
    throw new Error(`A API devolveu nenhum título válido, mas há ${abertosDoConsistem} abertos no banco. Nada foi alterado.`);
  }

  const plano = planejarSincronizacao(titulosApi, titulosBanco);

  // 2b) NFs de saída: de qual nota veio cada título e quais pedidos ela atende. Janela: os últimos 7 dias e, se houver
  // título ainda sem nota ligada (novo, ou anterior à migration 0103) emitido nos últimos 60 dias, desde a emissão dele.
  const presentes = new Set(plano.presentes);
  const novosPorChave = new Set(plano.novos.map((t) => chaveTitulo(t.documento, t.parcela)));
  const precisaLigar = titulosApi.filter((t) => {
    if (!t.nota && !t.chaveNfe) return false;
    const chave = chaveTitulo(t.documento, t.parcela);
    if (novosPorChave.has(chave)) return true;
    const l = linhaPorChave.get(chave);
    return l !== undefined && presentes.has(l.id) && l.nota_saida_id === null;
  });
  const limiteJanela = addDias(hoje, -60);
  let desde = addDias(hoje, -7);
  for (const t of precisaLigar) if (t.emissao && t.emissao >= limiteJanela && t.emissao < desde) desde = t.emissao;

  let registrosNotas: Record<string, unknown>[];
  try {
    registrosNotas = await buscarTodasPaginas(buscar, cfg, "comercial/v10/notaFiscalSaida", {
      situacao: 2, dataEmissaoInicio: desde, dataEmissaoFim: hoje, paginacao: PAGINACAO,
    });
  } catch (e) {
    // Sem as NFs o título entraria na esteira sem pedido e sem agrupar parcelas, e na rodada seguinte não seria mais "novo".
    throw new Error(`Falha ao consultar as NFs de saída (nada foi gravado): ${e instanceof Error ? e.message : "erro"}`);
  }
  const notas: NotaSaida[] = [];
  const notasVistas = new Set<string>();
  for (const r of registrosNotas) {
    const n = normalizarNotaSaida(r);
    if (!n) continue;
    const k = `${n.nota}\u0000${n.serie}`;
    if (notasVistas.has(k)) continue;
    notasVistas.add(k);
    notas.push(n);
  }
  const indiceNotas = indexarNotas(notas);
  const notaDoTitulo = new Map<string, number>(); // chave do título -> índice da NF
  const naoLigados = { ambigua: 0, nao_encontrada: 0 };
  for (const t of precisaLigar) {
    const v = ligarTituloNota(t, indiceNotas);
    if (v.ok) notaDoTitulo.set(chaveTitulo(t.documento, t.parcela), v.indice);
    else if (v.motivo === "ambigua") naoLigados.ambigua++;
    else if (v.motivo === "nao_encontrada") naoLigados.nao_encontrada++;
  }

  // Entrada na esteira: só títulos novos a partir da data de início, e nunca em carga em lote.
  // Parâmetros da regra (Cobrança > Regra de cobrança): lidos uma vez por rodada; valor ausente ou inválido cai no padrão.
  const { data: linhasRegra } = await banco.from("configuracoes").select("chave, valor").in("chave", [...TODAS_AS_CHAVES_REGRA]);
  const regra = lerParametrosRegra(linhasRegra);
  const decisao = decidirEntrada(plano.novos.length, hoje, regra.esteiraAPartirDe);

  const resumo: ResumoEmpresa = {
    empresa: empresa.nome_curto,
    titulosNaApi: registros.length,
    novos: plano.novos.length,
    alterados: plano.alterados.length,
    enriquecidos: plano.enriquecidos.length,
    inalterados: plano.inalterados,
    possiveisBaixas: plano.possiveisBaixas.length,
    divergentes: plano.divergentes.length,
    recusados: recusados.length,
    duplicadosNaApi: plano.duplicadosApi.length,
    exemplosRecusados: recusados.slice(0, 5),
    // Conferência de leitura dos valores (só agregados, sem dados de cliente).
    valorTotalApi: titulosApi.reduce((s, t) => s + t.valorCentavos, 0) / 100,
    maiorValorApi: titulosApi.reduce((m, t) => Math.max(m, t.valorCentavos), 0) / 100,
    vencidosNaApi: titulosApi.filter((t) => t.vencimento < hoje).length,
    clientesDistintos: new Set(titulosApi.map((t) => t.codCliente)).size,
    notasConsultadas: notas.length,
    janelaNotasDesde: desde,
    titulosLigadosANota: notaDoTitulo.size,
    titulosSemNotaLigada: naoLigados,
    entrada: decisao.abrir ? "novos entram em aguardando_boleto" : `não abre pendência (${decisao.motivo})`,
    esteiraAPartirDe: regra.esteiraAPartirDe,
    simulacao: simular,
  };
  if (simular) return resumo;

  // 3) Clientes: só os que têm título novo.
  const codigosNovos = [...new Set(plano.novos.map((t) => t.codCliente))];
  const contagem = { contrapartesNovas: 0, contrapartesVinculadas: 0, documentosInvalidos: 0 };
  let idPorCodigo = new Map<string, string>();
  if (codigosNovos.length > 0) {
    const regsClientes = await buscarTodasPaginas(buscar, cfg, "cadastrosgerais/v10/cliente", { situacao: 1, paginacao: PAGINACAO });
    const clientes = new Map<string, ClienteApi>();
    for (const r of regsClientes) {
      const c = normalizarClienteApi(r);
      if (c) clientes.set(c.codCliente, c);
    }
    idPorCodigo = await resolverContrapartes(banco, codigosNovos, clientes, contagem);
  }
  Object.assign(resumo, contagem);

  // 3b) NFs ligadas a algum título (só elas são guardadas): upsert pela chave empresa + número + série.
  const indicesUsados = [...new Set(notaDoTitulo.values())];
  const idPorNota = new Map<string, string>(); // `${nota}\0${serie}` -> id
  for (const lote of lotes(indicesUsados)) {
    const rows = lote.map((i) => {
      const n = notas[i];
      return {
        empresa_id: empresa.id, nota: n.nota, serie: n.serie, chave_acesso: n.chave || null, cod_cliente: n.codCliente || null,
        valor_total: n.valorCentavos === null ? null : n.valorCentavos / 100, data_emissao: n.emissao, pedidos: n.pedidos,
        visto_em: new Date().toISOString(),
      };
    });
    const { data, error } = await banco.from("rec_notas_saida").upsert(rows, { onConflict: "empresa_id,nota,serie" }).select("id, nota, serie");
    if (error) throw new Error(`Falha ao gravar as NFs de saída: ${error.message}`);
    for (const d of data ?? []) idPorNota.set(`${d.nota}\u0000${d.serie}`, d.id as string);
  }
  const idDaNotaDoTitulo = (chave: string): string | null => {
    const i = notaDoTitulo.get(chave);
    if (i === undefined) return null;
    return idPorNota.get(`${notas[i].nota}\u0000${notas[i].serie}`) ?? null;
  };

  // 4) Títulos novos (upsert ignorando duplicata: se rodar duas vezes ao mesmo tempo, não duplica).
  const agora = new Date().toISOString();
  for (const lote of lotes(plano.novos)) {
    const rows = lote.map((t) => ({
      empresa_id: empresa.id,
      contraparte_id: idPorCodigo.get(t.codCliente) as string,
      documento: t.documento,
      parcela: t.parcela,
      emissao: t.emissao,
      vencimento: t.vencimento,
      valor: t.valorCentavos / 100,
      origem: "importacao",
      nota_fiscal: t.nota || null,
      chave_nfe: t.chaveNfe || null,
      cod_portador: t.codPortador || null,
      tipo_cobranca: t.tipoCobranca || null,
      nota_saida_id: idDaNotaDoTitulo(chaveTitulo(t.documento, t.parcela)),
      estagio: decisao.abrir ? "aguardando_boleto" : "importado",
      entrou_esteira_em: decisao.abrir ? agora : null,
    }));
    const { error } = await banco.from("rec_titulos").upsert(rows, { onConflict: "empresa_id,documento,parcela", ignoreDuplicates: true });
    if (error) throw new Error(`Falha ao gravar títulos novos: ${error.message}`);
  }

  // 5) Títulos existentes: data/valor que mudaram no Consistem + dados de nota e cobrança que faltavam + vínculo com a NF.
  const atualizacoes = new Map<string, Record<string, unknown>>();
  for (const a of plano.alterados) atualizacoes.set(a.id, { ...a.campos });
  for (const e of plano.enriquecidos) atualizacoes.set(e.id, { ...(atualizacoes.get(e.id) ?? {}), ...e.campos });
  let titulosLigados = 0;
  for (const t of titulosApi) {
    const chave = chaveTitulo(t.documento, t.parcela);
    const l = linhaPorChave.get(chave);
    if (!l || !presentes.has(l.id) || l.nota_saida_id !== null) continue;
    const idNota = idDaNotaDoTitulo(chave);
    if (idNota) {
      atualizacoes.set(l.id, { ...(atualizacoes.get(l.id) ?? {}), nota_saida_id: idNota });
      titulosLigados++;
    }
  }
  for (const lote of lotes([...atualizacoes.entries()], 10)) {
    const resultados = await Promise.all(lote.map(([id, campos]) => banco.from("rec_titulos").update(campos).eq("id", id)));
    const falha = resultados.find((r) => r.error);
    if (falha?.error) throw new Error(`Falha ao atualizar títulos: ${falha.error.message}`);
  }
  resumo.titulosLigadosAgora = titulosLigados;

  // 5b) Pendência "Anexar boleto" para todo título aguardando boleto que ainda não tem uma aberta. Calculada do banco
  // (não só dos novos desta rodada): se uma rodada falhar no meio, a seguinte conserta.
  type LinhaAguardando = {
    id: string; contraparte_id: string; documento: string; parcela: string; vencimento: string; valor: number | string;
    nota_saida_id: string | null; contrapartes: { codigo_erp: string | null; nome: string } | { codigo_erp: string | null; nome: string }[] | null;
  };
  const aguardando = await lerTudo<LinhaAguardando>((de, ate) =>
    banco.from("rec_titulos")
      .select("id, contraparte_id, documento, parcela, vencimento, valor, nota_saida_id, contrapartes(codigo_erp, nome)")
      .eq("empresa_id", empresa.id).eq("estagio", "aguardando_boleto").eq("forma_pagamento", "boleto").order("id").range(de, ate));
  const titulosEsteira: TituloEsteira[] = aguardando.map((l) => {
    const c = Array.isArray(l.contrapartes) ? l.contrapartes[0] : l.contrapartes;
    return {
      id: l.id, documento: l.documento, parcela: l.parcela, vencimento: l.vencimento, valorCentavos: Math.round(Number(l.valor) * 100),
      notaSaidaId: l.nota_saida_id, contraparteId: l.contraparte_id, codCliente: c?.codigo_erp ?? "", nomeCliente: c?.nome ?? "",
    };
  });
  const idsNotasEsteira = [...new Set(titulosEsteira.map((t) => t.notaSaidaId).filter((x): x is string => x !== null))];
  const notasEsteira: NotaEsteira[] = [];
  for (const lote of lotes(idsNotasEsteira)) {
    const { data, error } = await banco.from("rec_notas_saida").select("id, nota, pedidos").in("id", lote);
    if (error) throw new Error(`Falha ao ler as NFs da esteira: ${error.message}`);
    for (const n of data ?? []) notasEsteira.push({ id: n.id as string, nota: n.nota as string, pedidos: (n.pedidos as string[]) ?? [] });
  }
  const abertasBoletoLinhas = await lerTudo<{ id: string; referencia_id: string; titulo: string; descricao: string | null }>((de, ate) =>
    banco.from("pendencias").select("id, referencia_id, titulo, descricao").eq("modulo", MODULO).like("titulo", `${PREFIXO_BOLETO}%`)
      .in("status", ["aberta", "em_andamento"]).order("id").range(de, ate));
  const abertasBoleto = new Set(abertasBoletoLinhas.map((p) => p.referencia_id));
  // Só entra na lista de tarefas quem vence dentro da janela do boleto (30 dias, editável); as abertas que ficaram fora da janela são canceladas.
  const planoBoleto = planejarPendenciasBoleto(titulosEsteira, notasEsteira, hoje, abertasBoleto, regra.janelaBoletoDias);
  const foraDaJanela = new Set(planoBoleto.fora);
  const boletoObsoletas = abertasBoletoLinhas.filter((p) => foraDaJanela.has(p.referencia_id)).map((p) => p.id);
  for (const lote of lotes(boletoObsoletas)) {
    const { error } = await banco.from("pendencias").update({ status: "cancelada" }).in("id", lote);
    if (error) throw new Error(`Falha ao encerrar pendências de boleto fora da janela: ${error.message}`);
  }
  resumo.pendenciasBoletoCanceladas = boletoObsoletas.length;
  // O texto da pendência acompanha o que ainda falta (parcela que saiu do grupo ou entrou na janela); prazo e responsável não mudam.
  const porReferencia = new Map<string, { id: string; titulo: string; descricao: string | null }>();
  for (const p of abertasBoletoLinhas) if (!porReferencia.has(p.referencia_id)) porReferencia.set(p.referencia_id, p);
  let boletoAtualizadas = 0;
  for (const g of planoBoleto.atualizar) {
    const atual = porReferencia.get(g.referenciaId);
    const titulo = tituloPendenciaBoleto(g);
    const descricao = descricaoPendenciaBoleto(g);
    if (!atual || (atual.titulo === titulo && atual.descricao === descricao)) continue;
    const { error } = await banco.from("pendencias").update({ titulo, descricao }).eq("id", atual.id);
    if (error) throw new Error(`Falha ao atualizar o texto da pendência de boleto: ${error.message}`);
    boletoAtualizadas++;
  }
  resumo.pendenciasBoletoAtualizadas = boletoAtualizadas;
  const pendenciasBoleto = planoBoleto.novas.map((g) => ({
    modulo: MODULO,
    empresa_id: empresa.id,
    contraparte_id: g.contraparteId,
    titulo: tituloPendenciaBoleto(g),
    descricao: descricaoPendenciaBoleto(g),
    prazo: prazoBoleto(g.vencimentoMaisProximo, hoje),
    criticidade: criticidadeBoleto(g.vencimentoMaisProximo, hoje),
    referencia_tabela: g.referenciaTabela,
    referencia_id: g.referenciaId,
    link: `/financeiro/recebiveis/${g.titulos[0].id}`, // ficha da NF: boleto, mensagem e registro do envio
  }));
  for (const lote of lotes(pendenciasBoleto)) {
    const { error } = await banco.from("pendencias").insert(lote);
    if (error) throw new Error(`Falha ao criar pendências de boleto: ${error.message}`);
  }
  resumo.pendenciasBoleto = pendenciasBoleto.length;

  // 5c) Confirmação de pagamento: clientes acima do corte, com parcelas vencendo nos próximos 7 dias, ganham UMA pendência
  // "Confirmar pagamento" (por cliente e vencimento mais próximo; nunca repete, nem depois de concluída).
  const minimoCentavos = regra.minimoConfirmacaoCentavos;
  type LinhaConfirmacao = {
    id: string; contraparte_id: string; documento: string; parcela: string; vencimento: string; valor: number | string; estagio: string;
    cedido: boolean; contestado: boolean; unidade: string; contrapartes: { nome: string } | { nome: string }[] | null;
  };
  const candidatas = await lerTudo<LinhaConfirmacao>((de, ate) =>
    banco.from("rec_titulos")
      .select("id, contraparte_id, documento, parcela, vencimento, valor, estagio, cedido, contestado, unidade, contrapartes(nome)")
      .eq("empresa_id", empresa.id).in("estagio", [...ESTAGIOS_CONFIRMAVEIS])
      .gte("vencimento", hoje).lte("vencimento", addDias(hoje, regra.janelaConfirmacaoDias)).order("id").range(de, ate));
  const restanteConfirmacao = await lerRestantes(banco, candidatas.map((l) => l.id));
  const gruposConfirmacao = planejarConfirmacoes(
    candidatas.map((l): TituloConfirmacao => ({
      id: l.id, contraparteId: l.contraparte_id, nomeCliente: (Array.isArray(l.contrapartes) ? l.contrapartes[0] : l.contrapartes)?.nome ?? "",
      documento: l.documento, parcela: l.parcela, vencimento: l.vencimento, valorCentavos: restanteConfirmacao.get(l.id) ?? Math.round(Number(l.valor) * 100),
      estagio: l.estagio, cedido: l.cedido, contestado: l.contestado, unidade: l.unidade === "contagem" ? "contagem" : "matriz",
    })),
    hoje,
    minimoCentavos,
    regra.janelaConfirmacaoDias,
  );
  let pendenciasConfirmacao = 0;
  if (gruposConfirmacao.length > 0) {
    const titulosCalculados = gruposConfirmacao.map(tituloPendenciaConfirmacao);
    const { data: jaCriadas } = await banco.from("pendencias").select("titulo").eq("modulo", MODULO).eq("referencia_tabela", "contrapartes").in("titulo", titulosCalculados);
    const existentes = new Set((jaCriadas ?? []).map((p) => p.titulo as string));
    const novas = gruposConfirmacao.filter((g) => !existentes.has(tituloPendenciaConfirmacao(g)));
    if (novas.length > 0) {
      // Contato conhecido (finalidade confirmação ou cobrança) personaliza a saudação da mensagem.
      const contatoDoCliente = await contatosParaSaudacao(banco, novas.map((g) => g.contraparteId), ["confirmacao", "cobranca"]);
      const linhasNovas = novas.map((g) => ({
        modulo: MODULO,
        empresa_id: empresa.id,
        contraparte_id: g.contraparteId,
        titulo: tituloPendenciaConfirmacao(g),
        descricao: descricaoPendenciaConfirmacao(g, contatoDoCliente.get(g.contraparteId) ?? ""),
        prazo: prazoConfirmacao(g.vencimentoMaisProximo, hoje, regra.prazoContatoAntesDias),
        criticidade: criticidadeConfirmacao(g.vencimentoMaisProximo, hoje),
        referencia_tabela: "contrapartes",
        referencia_id: g.contraparteId,
        link: `/financeiro/recebiveis/confirmar/${g.contraparteId}${g.unidade === "contagem" ? "?unidade=contagem" : ""}`,
      }));
      for (const lote of lotes(linhasNovas)) {
        const { error } = await banco.from("pendencias").insert(lote);
        if (error) throw new Error(`Falha ao criar pendências de confirmação: ${error.message}`);
      }
      pendenciasConfirmacao = linhasNovas.length;
    }
  }
  resumo.pendenciasConfirmacao = pendenciasConfirmacao;

  // Confirmação e ligação abertas que perderam o sentido (parcela paga, vencida, confirmada ou abaixo do corte) são canceladas.
  const abertasConfirmacao = await lerTudo<{ id: string; referencia_id: string; titulo: string }>((de, ate) =>
    banco.from("pendencias").select("id, referencia_id, titulo").eq("modulo", MODULO).eq("referencia_tabela", "contrapartes")
      .or("titulo.like.Confirmar pagamento:%,titulo.like.Ligar para confirmar pagamento:%").in("status", ["aberta", "em_andamento"]).order("id").range(de, ate));
  const confirmacaoObsoleta = pendenciasConfirmacaoObsoletas(abertasConfirmacao, gruposConfirmacao);
  for (const lote of lotes(confirmacaoObsoleta)) {
    const { error } = await banco.from("pendencias").update({ status: "cancelada" }).in("id", lote);
    if (error) throw new Error(`Falha ao encerrar pendências de confirmação obsoletas: ${error.message}`);
  }
  resumo.pendenciasConfirmacaoCanceladas = confirmacaoObsoleta.length;
  resumo.clientesNaJanelaDeConfirmacao = gruposConfirmacao.length;

  // 6) Possíveis baixas: o título saiu da lista de abertos. Procura na lista de PAGOS do Consistem (lida inteira em ~1 s) e
  // guarda o que o ERP informa (data, valor, tipo de baixa) como EVIDÊNCIA. Nunca baixa sozinho.
  const linhaPorId = new Map(linhas.map((l) => [l.id, l]));
  const precisamEvidencia = plano.possiveisBaixas.filter((t) => !linhaPorId.get(t.id)?.consistem_pago_em);
  const evidenciaDoTitulo = new Map<string, EvidenciaPagamento | null>();
  let evidenciasNovas = 0;
  if (precisamEvidencia.length > 0) {
    try {
      const pagos = indexarPagos(await buscarTodasPaginas(buscar, cfg, "financeiro/v10/contasReceber", { tipoTitulo: 1, paginacao: PAGINACAO }));
      for (const t of precisamEvidencia) evidenciaDoTitulo.set(t.id, pagos.get(t.documento) ?? null);
      const agoraIso = new Date().toISOString();
      for (const lote of lotes(precisamEvidencia, 10)) {
        const resultados = await Promise.all(lote.map((t) => {
          const ev = evidenciaDoTitulo.get(t.id);
          return banco.from("rec_titulos").update(ev
            ? { consistem_pago_em: ev.pagoEm, consistem_valor_pago: ev.valorCentavos / 100, consistem_tipo_baixa: ev.tipoBaixa || null, consistem_verificado_em: agoraIso }
            : { consistem_verificado_em: agoraIso }).eq("id", t.id);
        }));
        const falha = resultados.find((r) => r.error);
        if (falha?.error) throw new Error(`Falha ao gravar a evidência de pagamento: ${falha.error.message}`);
      }
      evidenciasNovas = [...evidenciaDoTitulo.values()].filter((e) => e !== null).length;
    } catch (e) {
      // A evidência é um auxílio: se a lista de pagos falhar, a sincronização segue (a pessoa confere sem ela).
      resumo.avisoEvidencia = e instanceof Error ? e.message.slice(0, 160) : "falha ao ler os títulos pagos";
    }
  }
  resumo.evidenciasEncontradas = evidenciasNovas;

  const jaPendentes = new Set(
    (await lerTudo<{ referencia_id: string }>((de, ate) =>
      banco.from("pendencias").select("referencia_id").eq("modulo", MODULO).eq("referencia_tabela", "rec_titulos")
        .like("titulo", `${PREFIXO_BAIXA}%`).in("status", ["aberta", "em_andamento"]).order("id").range(de, ate)))
      .map((p) => p.referencia_id),
  );
  const evidenciaPara = (t: TituloBanco): EvidenciaPagamento | null => {
    const nova = evidenciaDoTitulo.get(t.id);
    if (nova) return nova;
    const l = linhaPorId.get(t.id);
    return l?.consistem_pago_em ? { pagoEm: l.consistem_pago_em, valorCentavos: t.valorCentavos, tipoBaixa: "" } : null;
  };
  const pendenciasNovas = plano.possiveisBaixas.filter((t) => !jaPendentes.has(t.id)).map((t) => ({
    modulo: MODULO,
    empresa_id: empresa.id,
    contraparte_id: contraparteDoTitulo.get(t.id) ?? null,
    titulo: `${PREFIXO_BAIXA}${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`,
    descricao: descricaoPossivelBaixa(evidenciaPara(t), t.valorCentavos),
    prazo: hoje,
    criticidade: "normal",
    referencia_tabela: "rec_titulos",
    referencia_id: t.id,
    link: "/financeiro/recebiveis/baixas",
  }));
  for (const lote of lotes(pendenciasNovas)) {
    const { error } = await banco.from("pendencias").insert(lote);
    if (error) throw new Error(`Falha ao criar pendências de baixa: ${error.message}`);
  }
  resumo.pendenciasCriadas = pendenciasNovas.length;

  // Pendências "Possível baixa" que já existiam passam a mostrar a evidência e a apontar para a tela de baixas.
  const jaExistiam = precisamEvidencia.filter((t) => jaPendentes.has(t.id));
  for (const lote of lotes(jaExistiam, 10)) {
    const resultados = await Promise.all(lote.map((t) => banco.from("pendencias")
      .update({ descricao: descricaoPossivelBaixa(evidenciaPara(t), t.valorCentavos), link: "/financeiro/recebiveis/baixas" })
      .eq("modulo", MODULO).eq("referencia_tabela", "rec_titulos").eq("referencia_id", t.id).like("titulo", `${PREFIXO_BAIXA}%`).in("status", ["aberta", "em_andamento"])));
    const falha = resultados.find((r) => r.error);
    if (falha?.error) throw new Error(`Falha ao atualizar pendências de baixa: ${falha.error.message}`);
  }

  // 7) Voltou para a lista em aberto: a pendência de "possível baixa" antiga perde o sentido.
  let canceladas = 0;
  for (const lote of lotes(plano.presentes)) {
    const { data, error } = await banco.from("pendencias").update({ status: "cancelada" })
      .eq("modulo", MODULO).eq("referencia_tabela", "rec_titulos").like("titulo", `${PREFIXO_BAIXA}%`)
      .in("status", ["aberta", "em_andamento"]).in("referencia_id", lote).select("id");
    if (error) throw new Error(`Falha ao encerrar pendências de baixa: ${error.message}`);
    canceladas += data?.length ?? 0;
  }
  resumo.pendenciasCanceladas = canceladas;

  // 7b) Régua de cobrança (D+1, D+5, D+10): só vencimentos a partir da data de corte; nunca envia, só abre a pendência
  // "Cobrar D+n" com o texto pronto. Antes, o que passou do vencimento sem pagamento vira `vencido`.
  const corteRegua = regra.reguaAPartirDe;
  const { data: novosVencidos, error: erroVencidos } = await banco.from("rec_titulos").update({ estagio: "vencido" })
    .eq("empresa_id", empresa.id).in("estagio", [...ESTAGIOS_QUE_VENCEM]).lt("vencimento", hoje).select("id");
  if (erroVencidos) throw new Error(`Falha ao marcar títulos vencidos: ${erroVencidos.message}`);
  resumo.passaramParaVencido = novosVencidos?.length ?? 0;

  if (corteRegua === null) {
    resumo.regua = "desligada (sem data de corte)";
  } else try {
    type LinhaCobranca = {
      id: string; contraparte_id: string; documento: string; parcela: string; vencimento: string; valor: number | string; estagio: string;
      cedido: boolean; contestado: boolean; regua_pausada_ate: string | null; unidade: string;
      contrapartes: { nome: string } | { nome: string }[] | null;
      rec_contratos: { multa_pct: number | string; juros_mes_pct: number | string } | { multa_pct: number | string; juros_mes_pct: number | string }[] | null;
    };
    // Marcos da régua (dias, canais e textos editáveis na tela). Falha de leitura = padrão (D+1, D+5, D+10); lista vazia = régua sem marcos.
    const { data: linhasMarcos, error: erroMarcos } = await banco.from("rec_regua_marcos")
      .select("dia_relativo, canais, descricao, texto_whatsapp, assunto_email, corpo_email, rec_reguas!inner(nome, ativa)")
      .eq("acao", "cobranca").eq("ativo", true).eq("rec_reguas.nome", "Padrao").eq("rec_reguas.ativa", true);
    const marcos = erroMarcos || !linhasMarcos ? [...MARCOS_PADRAO] : marcosDeLinhas(linhasMarcos as unknown as LinhaMarcoBanco[]);
    resumo.marcosDaRegua = marcos.map((m) => m.nome).join(", ") || "nenhum";
    const candidatasCobranca = await lerTudo<LinhaCobranca>((de, ate) =>
      banco.from("rec_titulos")
        .select("id, contraparte_id, documento, parcela, vencimento, valor, estagio, cedido, contestado, regua_pausada_ate, unidade, contrapartes(nome), rec_contratos(multa_pct, juros_mes_pct)")
        .eq("empresa_id", empresa.id).in("estagio", [...ESTAGIOS_COBRAVEIS]).gte("vencimento", corteRegua).lt("vencimento", hoje).order("id").range(de, ate));
    // Quem saiu da lista de abertos do Consistem provavelmente pagou: não se cobra (a pessoa confere em "Baixas a conferir").
    const naoCobrar = new Set<string>([...plano.possiveisBaixas.map((t) => t.id), ...jaPendentes]);
    const restanteCobranca = await lerRestantes(banco, candidatasCobranca.map((l) => l.id));
    const gruposCobranca = planejarCobrancas(
      candidatasCobranca.map((l): TituloCobranca => {
        const contrato = Array.isArray(l.rec_contratos) ? l.rec_contratos[0] : l.rec_contratos;
        return {
          id: l.id, contraparteId: l.contraparte_id, nomeCliente: (Array.isArray(l.contrapartes) ? l.contrapartes[0] : l.contrapartes)?.nome ?? "",
          documento: l.documento, parcela: l.parcela, vencimento: l.vencimento, valorCentavos: restanteCobranca.get(l.id) ?? Math.round(Number(l.valor) * 100), estagio: l.estagio,
          cedido: l.cedido, contestado: l.contestado, reguaPausadaAte: l.regua_pausada_ate, unidade: l.unidade === "contagem" ? "contagem" : "matriz",
          multaPct: contrato ? Number(contrato.multa_pct) : undefined, jurosMesPct: contrato ? Number(contrato.juros_mes_pct) : undefined,
        };
      }),
      hoje, corteRegua, naoCobrar, marcos,
    );

    // Pendências já criadas (abertas ou concluídas) não se repetem; as canceladas podem voltar a abrir.
    const titulosCalculados = gruposCobranca.map(tituloPendenciaCobranca);
    const existentes = new Set<string>();
    for (const lote of lotes(titulosCalculados, 100)) {
      const { data: jaCriadas } = await banco.from("pendencias").select("titulo").eq("modulo", MODULO).eq("referencia_tabela", "contrapartes")
        .in("status", ["aberta", "em_andamento", "concluida"]).in("titulo", lote);
      for (const p of jaCriadas ?? []) existentes.add(p.titulo as string);
    }
    const novasCobrancas = gruposCobranca.filter((g) => !existentes.has(tituloPendenciaCobranca(g)));
    resumo.clientesNaRegua = new Set(gruposCobranca.map((g) => `${g.contraparteId}|${g.unidade}`)).size;
    if (novasCobrancas.length > regra.travaPendenciasCobranca) {
      // Passou da trava: provável erro de configuração (data de corte antiga). Ninguém é cobrado.
      resumo.regua = `trava: ${novasCobrancas.length} pendências de uma vez (limite ${regra.travaPendenciasCobranca}); confira a data de corte`;
      resumo.pendenciasCobranca = 0;
    } else {
      const contatoDoCliente = await contatosParaSaudacao(banco, novasCobrancas.map((g) => g.contraparteId), ["cobranca", "confirmacao"]);
      const linhasCobranca = novasCobrancas.map((g) => ({
        modulo: MODULO,
        empresa_id: empresa.id,
        contraparte_id: g.contraparteId,
        titulo: tituloPendenciaCobranca(g),
        descricao: descricaoPendenciaCobranca(g, hoje, contatoDoCliente.get(g.contraparteId) ?? "", marcos),
        prazo: hoje,
        criticidade: criticidadeCobranca(g.marco, marcos),
        referencia_tabela: "contrapartes",
        referencia_id: g.contraparteId,
        link: `/financeiro/recebiveis/cobrar/${g.contraparteId}`,
      }));
      for (const lote of lotes(linhasCobranca)) {
        const { error } = await banco.from("pendencias").insert(lote);
        if (error) throw new Error(`Falha ao criar pendências de cobrança: ${error.message}`);
      }
      resumo.pendenciasCobranca = linhasCobranca.length;
    }

    // Cliente que não tem mais nada a cobrar (pagou, contestou, prometeu): as pendências "Cobrar" abertas perdem o sentido.
    const clientesNaRegua = new Set(gruposCobranca.map((g) => `${g.contraparteId}|${g.unidade}`));
    const abertasCobranca = await lerTudo<{ id: string; referencia_id: string; titulo: string }>((de, ate) =>
      banco.from("pendencias").select("id, referencia_id, titulo").eq("modulo", MODULO).eq("referencia_tabela", "contrapartes")
        .like("titulo", `${PREFIXO_COBRANCA} D+%`).in("status", ["aberta", "em_andamento"]).order("id").range(de, ate));
    // Também perde o sentido a pendência de um marco que saiu da régua (a tela já cancela ao salvar; isto cobre o que sobrar).
    const diasDosMarcos = new Set(marcos.map((m) => m.dias));
    const marcoDaPendencia = (titulo: string) => Number(/^Cobrar D\+(\d+):/.exec(titulo)?.[1] ?? NaN);
    const semMotivo = abertasCobranca
      .filter((p) => !clientesNaRegua.has(`${p.referencia_id}|${unidadeDaPendencia(p.titulo)}`) || !diasDosMarcos.has(marcoDaPendencia(p.titulo)))
      .map((p) => p.id);
    for (const lote of lotes(semMotivo)) {
      const { error } = await banco.from("pendencias").update({ status: "cancelada" }).in("id", lote);
      if (error) throw new Error(`Falha ao encerrar pendências de cobrança: ${error.message}`);
    }
    resumo.pendenciasCobrancaCanceladas = semMotivo.length;
  } catch (e) {
    // A régua é um auxílio: se falhar, a sincronização dos títulos e das baixas (já gravada) segue e o aviso fica no resumo.
    resumo.avisoRegua = e instanceof Error ? e.message.slice(0, 200) : "falha na régua de cobrança";
  }

  // 7c) Cadastro de contatos: clientes da MATRIZ com título em aberto a vencer ou vencido há menos de 60 dias (escopo combinado
  // com o usuário; os antigos e a Filial Contagem ficam para depois). Sem contato útil: "Cadastrar contato: <Cliente>". Sem
  // CPF/CNPJ: "Conferir cadastro: <Cliente>". As pendências se concluem quando o contato/documento é salvo (ações das telas)
  // e esta rotina cancela as que sobrarem (cliente passou a ter contato, ou saiu do escopo).
  try {
    const limiteVencimento = addDias(hoje, -(DIAS_ESCOPO_CADASTRO - 1)); // atraso < 60 dias
    type LinhaCadastro = {
      contraparte_id: string; documento: string; parcela: string; vencimento: string; valor: number | string;
      contrapartes: { nome: string; documento: string | null } | { nome: string; documento: string | null }[] | null;
    };
    const titulosCadastro = await lerTudo<LinhaCadastro>((de, ate) =>
      banco.from("rec_titulos").select("id, contraparte_id, documento, parcela, vencimento, valor, contrapartes(nome, documento)")
        .eq("empresa_id", empresa.id).eq("unidade", "matriz").not("estagio", "in", "(pago,renegociado,cancelado)")
        .gte("vencimento", limiteVencimento).order("id").range(de, ate));
    const clientesCadastro = new Map<string, ClienteParaCadastro>();
    for (const t of titulosCadastro) {
      const cp = Array.isArray(t.contrapartes) ? t.contrapartes[0] : t.contrapartes;
      const c = clientesCadastro.get(t.contraparte_id) ?? { id: t.contraparte_id, nome: cp?.nome ?? "", documento: cp?.documento ?? null, titulos: [], temContato: false };
      c.titulos.push({ documento: t.documento, parcela: t.parcela, vencimento: t.vencimento, valorCentavos: Math.round(Number(t.valor) * 100) });
      clientesCadastro.set(t.contraparte_id, c);
    }
    const contatosPorCliente = new Map<string, ContatoEscolha[]>();
    for (const lote of lotes([...clientesCadastro.keys()], 100)) {
      const { data, error } = await banco.from("contatos").select("id, contraparte_id, nome, email, whatsapp, telefone, finalidades, ativo").in("contraparte_id", lote).eq("ativo", true);
      if (error) throw new Error(`Falha ao ler os contatos: ${error.message}`);
      for (const c of data ?? []) contatosPorCliente.set(c.contraparte_id as string, [...(contatosPorCliente.get(c.contraparte_id as string) ?? []), c as unknown as ContatoEscolha]);
    }
    for (const c of clientesCadastro.values()) c.temContato = temContatoUtil(contatosPorCliente.get(c.id) ?? []);
    const plano = planejarCadastro([...clientesCadastro.values()]);

    // Pendências que já existem (abertas ou concluídas não se repetem); as abertas de quem já não precisa são canceladas.
    const existentes = await lerTudo<{ id: string; referencia_id: string; titulo: string; status: string }>((de, ate) =>
      banco.from("pendencias").select("id, referencia_id, titulo, status").eq("modulo", MODULO).eq("referencia_tabela", "contrapartes")
        .or(`titulo.like.${PREFIXO_CADASTRAR_CONTATO}:%,titulo.like.${PREFIXO_CONFERIR_CADASTRO}:%`).in("status", ["aberta", "em_andamento", "concluida"]).order("id").range(de, ate));
    const ja = (prefixo: string) => new Set(existentes.filter((p) => p.titulo.startsWith(`${prefixo}:`)).map((p) => p.referencia_id));
    const jaContato = ja(PREFIXO_CADASTRAR_CONTATO);
    const jaCadastro = ja(PREFIXO_CONFERIR_CADASTRO);
    const novasContato = plano.semContato.filter((c) => !jaContato.has(c.id));
    const novasCadastro = plano.semDocumento.filter((c) => !jaCadastro.has(c.id));

    if (novasContato.length + novasCadastro.length > TRAVA_PENDENCIAS_CADASTRO) {
      resumo.cadastroContatos = `trava: ${novasContato.length + novasCadastro.length} pendências de uma vez (limite ${TRAVA_PENDENCIAS_CADASTRO})`;
    } else {
      const linhas = [
        ...novasContato.map((c) => ({ c, titulo: tituloPendenciaContato(c.nome), descricao: descricaoPendenciaContato(c) })),
        ...novasCadastro.map((c) => ({ c, titulo: tituloPendenciaCadastro(c.nome), descricao: descricaoPendenciaCadastro(c) })),
      ].map(({ c, titulo, descricao }) => ({
        modulo: MODULO, empresa_id: empresa.id, contraparte_id: c.id, titulo, descricao, prazo: hoje, criticidade: criticidadeCadastro(c, hoje),
        referencia_tabela: "contrapartes", referencia_id: c.id, link: `/financeiro/recebiveis/clientes/${c.id}`,
      }));
      for (const lote of lotes(linhas)) {
        const { error } = await banco.from("pendencias").insert(lote);
        if (error) throw new Error(`Falha ao criar pendências de cadastro: ${error.message}`);
      }
      resumo.pendenciasCadastroContato = novasContato.length;
      resumo.pendenciasConferirCadastro = novasCadastro.length;
    }

    const precisamContato = new Set(plano.semContato.map((c) => c.id));
    const precisamCadastro = new Set(plano.semDocumento.map((c) => c.id));
    const obsoletas = existentes.filter((p) => p.status !== "concluida" && (
      (p.titulo.startsWith(`${PREFIXO_CADASTRAR_CONTATO}:`) && !precisamContato.has(p.referencia_id))
      || (p.titulo.startsWith(`${PREFIXO_CONFERIR_CADASTRO}:`) && !precisamCadastro.has(p.referencia_id))
    )).map((p) => p.id);
    for (const lote of lotes(obsoletas)) {
      const { error } = await banco.from("pendencias").update({ status: "cancelada" }).in("id", lote);
      if (error) throw new Error(`Falha ao encerrar pendências de cadastro: ${error.message}`);
    }
    resumo.pendenciasCadastroCanceladas = obsoletas.length;
  } catch (e) {
    // O aviso de cadastro é um auxílio: se falhar, a sincronização dos títulos e das baixas (já gravada) segue.
    resumo.avisoCadastro = e instanceof Error ? e.message.slice(0, 200) : "falha no cadastro de contatos";
  }

  // 8) Registro da execução.
  const { error: erroLog } = await banco.from("importacoes").insert({
    modulo: MODULO,
    tipo: "titulos_abertos",
    arquivo: "api:consistem",
    mapeamento: {
      origem: "api", empresa: empresa.codigo_erp, recusados: recusados.slice(0, 20), duplicadosApi: plano.duplicadosApi.slice(0, 20),
      notasConsultadas: notas.length, titulosLigadosANota: notaDoTitulo.size, entrada: resumo.entrada, pendenciasBoleto: pendenciasBoleto.length,
      passaramParaVencido: resumo.passaramParaVencido ?? 0, pendenciasCobranca: resumo.pendenciasCobranca ?? 0, regua: resumo.regua ?? "ligada", avisoRegua: resumo.avisoRegua ?? null, cadastroContatos: resumo.cadastroContatos ?? null, pendenciasCadastroContato: resumo.pendenciasCadastroContato ?? 0, pendenciasConferirCadastro: resumo.pendenciasConferirCadastro ?? 0, avisoCadastro: resumo.avisoCadastro ?? null,
    },
    linhas_novas: plano.novos.length,
    linhas_alteradas: plano.alterados.length,
    linhas_baixadas: plano.possiveisBaixas.length, // aqui = "possíveis baixas" (nenhuma é dada automaticamente)
    linhas_divergentes: plano.divergentes.length + recusados.length + plano.duplicadosApi.length,
    usuario_id: usuarioId,
  });
  if (erroLog) throw new Error(`Sincronizou, mas falhou ao registrar a execução: ${erroLog.message}`);
  return resumo;
}

const TITULO_FALHA = "Falha na sincronização com o Consistem";

/** Abre (uma só) pendência de falha. Mensagens vêm da própria função e nunca contêm segredos. */
async function registrarFalha(banco: Banco, mensagem: string, agendado: boolean): Promise<void> {
  const { data: abertas } = await banco.from("pendencias").select("id").eq("modulo", MODULO).eq("titulo", TITULO_FALHA)
    .in("status", ["aberta", "em_andamento"]).limit(1);
  if (abertas && abertas.length > 0) return;
  await banco.from("pendencias").insert({
    modulo: MODULO,
    titulo: TITULO_FALHA,
    descricao: `${agendado ? "A sincronização agendada" : "A sincronização manual"} falhou: ${mensagem.slice(0, 300)} Os dados da carteira podem estar desatualizados. Tente "Sincronizar agora" em Financeiro > Recebíveis; se persistir, verifique o token do Consistem (CSMEN050).`,
    prazo: hojeCuiaba(),
    criticidade: "alta",
    link: "/financeiro/recebiveis",
  });
}

/** Sincronização que deu certo encerra o aviso de falha anterior. */
async function encerrarFalhas(banco: Banco): Promise<void> {
  await banco.from("pendencias").update({ status: "cancelada" }).eq("modulo", MODULO).eq("titulo", TITULO_FALHA).in("status", ["aberta", "em_andamento"]);
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

  // Quem chama: (1) o agendamento do banco (pg_cron), com o segredo próprio guardado no Vault; (2) a service role;
  // ou (3) um gestor do Financeiro logado. O gateway não confere JWT aqui (verify_jwt = false em config.toml): a
  // conferência é toda desta função.
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
      const { data: permitido, error: erroPermissao } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "gestor" });
      if (erroPermissao || permitido !== true) return responder({ erro: "Somente o gestor do Financeiro pode sincronizar com o Consistem." }, 403);
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
        const e = empresas[0];
        const cfg: ConfigConsistem = { ...cfgBase, empresa: e.codigo_erp as string };
        const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);
        const titulos = await buscarTodasPaginas(buscar, cfg, "financeiro/v10/contasReceber", { tipoTitulo: 0, paginacao: 20 });
        return responder({ ok: true, empresa: e.nome_curto, titulos: titulos.length, campos: descreverCampos(titulos) });
      }
      case "amostra_notas": {
        // Etapa 0 (só leitura): mede quanto a ligação NF de saída <-> título funciona com dados reais.
        // Devolve apenas contagens, formatos e nomes de campos: nada de clientes, valores ou documentos.
        const e = empresas[0];
        const cfg: ConfigConsistem = { ...cfgBase, empresa: e.codigo_erp as string };
        const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);
        const dias = Math.min(120, Math.max(1, Math.round(Number(corpo.dias) || 30)));
        const hoje = hojeCuiaba();
        const desde = addDias(hoje, -dias);

        const notas = await buscarTodasPaginas(buscar, cfg, "comercial/v10/notaFiscalSaida", {
          situacao: 2, dataEmissaoInicio: desde, dataEmissaoFim: hoje, paginacao: PAGINACAO,
        });
        const titulos = await buscarTodasPaginas(buscar, cfg, "financeiro/v10/contasReceber", { tipoTitulo: 0, paginacao: PAGINACAO });
        const relatorio = analisarVinculo(notas, titulos, hoje, dias);

        // Quais tipos de nota geram duplicata (título)? Só os nomes dos campos e a contagem.
        let tiposNota: Record<string, unknown> = { erro: "não consultado" };
        try {
          const tipos = await buscarTodasPaginas(buscar, cfg, "cadastrosgerais/v10/tipoNota", { paginacao: PAGINACAO });
          tiposNota = {
            total: tipos.length,
            campos: descreverCampos(tipos),
            comDuplicata: tipos.filter((t) => t.possuiDuplicata === true || t.possuiDuplicata === "S" || t.possuiDuplicata === 1 || t.possuiDuplicata === "1").length,
          };
        } catch (erro) {
          tiposNota = { erro: erro instanceof Error ? erro.message : "falha" };
        }

        // O pedido de uma NF recente: só nomes e tipos dos campos.
        let pedido: Record<string, unknown> = { erro: "nenhuma NF com pedido na janela" };
        const comPedido = notas.find((n) => n.codPedido !== null && n.codPedido !== undefined && String(n.codPedido).trim() !== "");
        if (comPedido) {
          try {
            const p = await buscarObjeto(buscar, cfg, `comercial/v10/pedidoVenda/${encodeURIComponent(String(comPedido.codPedido).trim())}`);
            pedido = { campos: descreverCampos([p]), itens: Array.isArray(p.itensPedido) ? p.itensPedido.length : null };
          } catch (erro) {
            pedido = { erro: erro instanceof Error ? erro.message : "falha" };
          }
        }
        // Os itens da NF trazem o pedido? Só nomes e tipos dos campos do primeiro item.
        const primeiraComItens = notas.find((n) => Array.isArray(n.itensNotaFiscalSaida) && (n.itensNotaFiscalSaida as unknown[]).length > 0);
        const camposItemNota = primeiraComItens ? descreverCampos([(primeiraComItens.itensNotaFiscalSaida as Record<string, unknown>[])[0]]) : {};
        // NFs SEM pedido no cabeçalho: os itens trazem o pedido (codItemPedido / itemPedidoAgrupado)? Só contagens.
        const itensDe = (n: Record<string, unknown>) => (Array.isArray(n.itensNotaFiscalSaida) ? (n.itensNotaFiscalSaida as Record<string, unknown>[]) : []);
        const semPedidoNoCabecalho = notas.filter((n) => String(n.codPedido ?? "").trim() === "");
        const primeiroAgrupado = semPedidoNoCabecalho.flatMap(itensDe).map((i) => (Array.isArray(i.itemPedidoAgrupado) ? (i.itemPedidoAgrupado as Record<string, unknown>[])[0] : undefined)).find(Boolean);
        const pedidoNosItens = {
          nfsSemPedidoNoCabecalho: semPedidoNoCabecalho.length,
          comCodItemPedido: semPedidoNoCabecalho.filter((n) => itensDe(n).some((i) => String(i.codItemPedido ?? "").trim() !== "")).length,
          comItemPedidoAgrupado: semPedidoNoCabecalho.filter((n) => itensDe(n).some((i) => Array.isArray(i.itemPedidoAgrupado) && i.itemPedidoAgrupado.length > 0)).length,
          // O codPedido dentro do agrupado vem preenchido de verdade (não vazio)?
          comCodPedidoPreenchido: semPedidoNoCabecalho.filter((n) => itensDe(n).some((i) => Array.isArray(i.itemPedidoAgrupado) && (i.itemPedidoAgrupado as Record<string, unknown>[]).some((a) => String(a?.codPedido ?? "").trim() !== ""))).length,
          comItemPedidoPreenchido: semPedidoNoCabecalho.filter((n) => itensDe(n).some((i) => Array.isArray(i.itemPedidoAgrupado) && (i.itemPedidoAgrupado as Record<string, unknown>[]).some((a) => String(a?.itemPedido ?? "").trim() !== ""))).length,
          comNumeroPedidoCompra: semPedidoNoCabecalho.filter((n) => itensDe(n).some((i) => String(i.numeroPedidoCompra ?? "").trim() !== "")).length,
          camposDoAgrupado: primeiroAgrupado ? descreverCampos([primeiroAgrupado]) : {},
        };
        // Sem a lista enorme de campos da NF no retorno (já conhecida): só nomes que citam pedido.
        const camposNotaComPedido = relatorio.notas.camposDisponiveis.filter((c) => /pedid/i.test(c));
        relatorio.notas.camposDisponiveis = camposNotaComPedido;
        return responder({ ok: true, empresa: e.nome_curto, dias, ...relatorio, camposItemNota: undefined, pedidoNosItens, tiposNota: { ...tiposNota, campos: undefined }, pedido: { itens: (pedido as { itens?: unknown }).itens ?? null, erro: (pedido as { erro?: unknown }).erro } });
      }
      case "sincronizar": {
        const resultados: ResumoEmpresa[] = [];
        for (const e of empresas) {
          resultados.push(await sincronizarEmpresa(banco, e as { id: string; nome_curto: string; codigo_erp: string }, cfgBase, corpo.simular === true, usuarioId));
        }
        if (corpo.simular !== true) await encerrarFalhas(banco);
        return responder({ ok: true, agendado, resultados });
      }
      default:
        return responder({ erro: "Ação desconhecida." }, 400);
    }
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha inesperada.";
    // Sincronização real que falhou (agendada ou manual): deixa um aviso na Fila do dia, para não passar batido.
    if (corpo.acao === "sincronizar" && corpo.simular !== true) await registrarFalha(banco, mensagem, agendado).catch(() => {});
    if (e instanceof ConsistemErro) return responder({ erro: e.message }, e.status === 401 || e.status === 403 ? 502 : 500);
    return responder({ erro: mensagem }, 500);
  }
});
