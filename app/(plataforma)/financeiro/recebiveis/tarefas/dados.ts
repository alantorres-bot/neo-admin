import { lerPartes } from "@/lib/modulos/financeiro/akf/parcial";
import { MODULO_RECEBIVEIS, TIPO_ANEXO_BOLETO } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { ROTULO_ANDAMENTO } from "@/lib/modulos/financeiro/recebiveis/carteira";
import {
  filaDaParcela, marcoDaDescricao, montarTextoBusca, ordenarContatos, ordenarParcelas, prazoDaParcela, removerCobrancasFeitas,
  type Andamento, type ContatoSugerido, type ItemBase, type ItemBaixa, type ItemCobrar, type ItemConfirmar, type ItemContato, type ItemParcela, type ParcelaItem, type Tarefas,
} from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { titulaNoEscopoDeCadastro } from "@/lib/modulos/financeiro/recebiveis/clientes";
import { FUSO, hojeEmCuiaba } from "@/lib/nucleo/fila";
import type { criarClienteServidor } from "@/lib/supabase/servidor";
import { ESTAGIOS_COBRAVEIS, planejarCobrancas, unidadeDaPendencia, type TituloCobranca, type Unidade } from "@/supabase/functions/_shared/cobranca";
import {
  ESTAGIOS_CONFIRMAVEIS, MINIMO_PADRAO_CENTAVOS, planejarConfirmacoes, prazoConfirmacao, type TituloConfirmacao,
} from "@/supabase/functions/_shared/confirmacao";
import { escolherContato, temContatoUtil, type ContatoEscolha } from "@/supabase/functions/_shared/contatos";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

const CONFIG_INICIO_REGUA = "financeiro.recebiveis.regua_a_partir_de";
const CONFIG_MINIMO_CONFIRMACAO = "financeiro.recebiveis.confirmacao_valor_minimo";
const ENCERRADOS = ["pago", "renegociado", "cancelado"];
const TIPOS_COBRANCA_FEITA = ["cobranca", "promessa", "contestacao"];
const centavos = (v: number | string) => Math.round(Number(v) * 100);
const em = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" }).format(new Date(iso));
const lotes = <T,>(lista: readonly T[], tamanho = 100): T[][] => Array.from({ length: Math.ceil(lista.length / tamanho) }, (_, i) => lista.slice(i * tamanho, (i + 1) * tamanho));
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

type LinhaTitulo = {
  id: string; contraparte_id: string; documento: string; parcela: string; vencimento: string; valor: number | string; estagio: string; dias_atraso: number;
  faixa: string; cedido: boolean; contestado: boolean; unidade: string; forma_pagamento: string; regua_pausada_ate: string | null;
  consistem_pago_em: string | null; consistem_valor_pago: number | string | null;
};
type ContatoLinha = ContatoEscolha & { contraparte_id: string; funcao?: string | null };

/**
 * Calcula todas as filas de tarefas do contas a receber, hoje, com a sessão de quem chama (a RLS vale). Usa as mesmas regras
 * puras da sincronização (confirmação, régua, escopo do cadastro) para a tela e as pendências nunca discordarem. Nada é gravado.
 */
export async function carregarTarefas(supabase: Cliente): Promise<Tarefas> {
  const hoje = hojeEmCuiaba();

  // 1) Todos os títulos em aberto (PostgREST devolve até 1000 por vez).
  const abertos: LinhaTitulo[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("rec_vw_titulos")
      .select("id, contraparte_id, documento, parcela, vencimento, valor, estagio, dias_atraso, faixa, cedido, contestado, unidade, forma_pagamento, regua_pausada_ate, consistem_pago_em, consistem_valor_pago")
      .neq("faixa", "encerrado").order("id").range(de, de + 999);
    if (error) throw new Error(`Falha ao ler a carteira: ${error.message}`);
    abertos.push(...((data ?? []) as unknown as LinhaTitulo[]));
    if (!data || data.length < 1000) break;
  }
  const emAberto = abertos.filter((t) => !ENCERRADOS.includes(t.estagio));

  // 2) Configurações e pendências que mudam a classificação.
  const [{ data: cfgRegua }, { data: cfgMinimo }, { data: baixasPend }, { data: ligarPend }] = await Promise.all([
    supabase.from("configuracoes").select("valor").eq("chave", CONFIG_INICIO_REGUA).maybeSingle(),
    supabase.from("configuracoes").select("valor").eq("chave", CONFIG_MINIMO_CONFIRMACAO).maybeSingle(),
    supabase.from("pendencias").select("referencia_id").eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "rec_titulos").like("titulo", "Possível baixa:%").in("status", ["aberta", "em_andamento"]).limit(1000),
    supabase.from("pendencias").select("referencia_id, titulo").eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "contrapartes").like("titulo", "Ligar para confirmar pagamento:%").in("status", ["aberta", "em_andamento"]).limit(1000),
  ]);
  const corte = typeof cfgRegua?.valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cfgRegua.valor) ? cfgRegua.valor : null;
  const minimoReais = typeof cfgMinimo?.valor === "number" ? cfgMinimo.valor : Number(cfgMinimo?.valor);
  const minimoCentavos = Number.isFinite(minimoReais) && minimoReais > 0 ? Math.round(minimoReais * 100) : MINIMO_PADRAO_CENTAVOS;
  const idsPossivelBaixa = new Set((baixasPend ?? []).map((p) => p.referencia_id as string));
  const ligar = new Set((ligarPend ?? []).map((p) => `${p.referencia_id as string}|${unidadeDaPendencia(p.titulo as string)}`));

  // 3) Parcelas aguardando boleto: quais já têm o PDF anexado.
  const aguardando = emAberto.filter((t) => t.estagio === "aguardando_boleto");
  const comBoleto = new Set<string>();
  for (const lote of lotes(aguardando.map((t) => t.id))) {
    const { data, error } = await supabase.from("anexos").select("referencia_id").eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "rec_titulos").eq("tipo", TIPO_ANEXO_BOLETO).in("referencia_id", lote);
    if (error) throw new Error(`Falha ao ler os boletos anexados: ${error.message}`);
    for (const a of data ?? []) comBoleto.add(a.referencia_id as string);
  }

  // 4) Confirmação: parcelas que vencem nos próximos 7 dias (com o restante das antecipações parciais) e cobrança: régua.
  const candidatasConfirmacao = emAberto.filter((t) => (ESTAGIOS_CONFIRMAVEIS as readonly string[]).includes(t.estagio) && t.vencimento >= hoje);
  const candidatasCobranca = corte
    ? emAberto.filter((t) => (ESTAGIOS_COBRAVEIS as readonly string[]).includes(t.estagio) && t.vencimento >= corte && t.vencimento < hoje)
    : [];
  const partes = await lerPartes(supabase, [...candidatasConfirmacao.filter((t) => diasEntre(t.vencimento, hoje) <= 7), ...candidatasCobranca].map((t) => t.id));
  const valorRestante = (t: LinhaTitulo) => partes.get(t.id)?.restanteCentavos ?? centavos(t.valor);
  const nomesClientes = new Map<string, { nome: string; codigo: string | null }>();

  const unidadeDe = (t: Pick<LinhaTitulo, "unidade">): Unidade => (t.unidade === "contagem" ? "contagem" : "matriz");
  const gruposConfirmacao = planejarConfirmacoes(
    candidatasConfirmacao.map((t): TituloConfirmacao => ({
      id: t.id, contraparteId: t.contraparte_id, nomeCliente: "", documento: t.documento, parcela: t.parcela, vencimento: t.vencimento,
      valorCentavos: valorRestante(t), estagio: t.estagio, cedido: t.cedido, contestado: t.contestado, unidade: unidadeDe(t),
    })),
    hoje, minimoCentavos,
  );
  const gruposCobranca = corte
    ? planejarCobrancas(
      candidatasCobranca.map((t): TituloCobranca => ({
        id: t.id, contraparteId: t.contraparte_id, nomeCliente: "", documento: t.documento, parcela: t.parcela, vencimento: t.vencimento,
        valorCentavos: valorRestante(t), estagio: t.estagio, cedido: t.cedido, contestado: t.contestado, unidade: unidadeDe(t), reguaPausadaAte: t.regua_pausada_ate,
      })),
      hoje, corte, idsPossivelBaixa,
    )
    : [];

  // 5) Cadastro de contatos: clientes da Matriz no escopo (a vencer ou vencido há menos de 60 dias).
  const noEscopo = emAberto.filter((t) => titulaNoEscopoDeCadastro({ unidade: t.unidade, faixa: t.faixa, dias_atraso: t.dias_atraso }));

  // 6) Clientes (nome e código) e contatos de todos os que aparecem em alguma fila.
  const idsClientes = new Set<string>([
    ...aguardando.map((t) => t.contraparte_id), ...gruposConfirmacao.map((g) => g.contraparteId), ...gruposCobranca.map((g) => g.contraparteId),
    ...emAberto.filter((t) => idsPossivelBaixa.has(t.id)).map((t) => t.contraparte_id), ...noEscopo.map((t) => t.contraparte_id),
  ]);
  const contatosPorCliente = new Map<string, ContatoLinha[]>();
  for (const lote of lotes([...idsClientes])) {
    const [{ data: clientes }, { data: contatos }] = await Promise.all([
      supabase.from("contrapartes").select("id, nome, codigo_erp").in("id", lote),
      supabase.from("contatos").select("id, contraparte_id, nome, funcao, email, whatsapp, telefone, finalidades, canal_preferido, ativo").in("contraparte_id", lote).eq("ativo", true),
    ]);
    for (const c of clientes ?? []) nomesClientes.set(c.id as string, { nome: c.nome as string, codigo: (c.codigo_erp as string | null) ?? null });
    for (const c of (contatos ?? []) as unknown as ContatoLinha[]) contatosPorCliente.set(c.contraparte_id, [...(contatosPorCliente.get(c.contraparte_id) ?? []), c]);
  }
  const base = (clienteId: string, unidade: Unidade, documentos: string[]): ItemBase => {
    const c = nomesClientes.get(clienteId);
    return { clienteId, cliente: c?.nome ?? "(cliente sem nome)", codigo: c?.codigo ?? null, unidade, textoBusca: montarTextoBusca(c?.nome ?? "", c?.codigo ?? null, documentos) };
  };
  const sugerido = (c: ContatoLinha | null): ContatoSugerido => (c ? { id: c.id, nome: c.nome, email: c.email ?? null, whatsapp: c.whatsapp ?? null } : null);
  const contatoBoleto = (id: string) => {
    const lista = contatosPorCliente.get(id) ?? [];
    return sugerido(escolherContato(lista, "boleto", "email") ?? escolherContato(lista, "boleto", "whatsapp"));
  };
  const contatoMensagem = (id: string) => {
    const lista = contatosPorCliente.get(id) ?? [];
    return sugerido(escolherContato(lista, ["confirmacao", "cobranca"], "whatsapp") ?? escolherContato(lista, ["confirmacao", "cobranca"], "telefone"));
  };

  // 7) Último registro do histórico de cada parcela das filas ("o que já foi feito") e as cobranças já registradas por marco.
  const idsHistorico = [...new Set([
    ...aguardando.map((t) => t.id), ...gruposConfirmacao.flatMap((g) => g.titulos.map((t) => t.id)), ...gruposCobranca.flatMap((g) => g.titulos.map((t) => t.id)),
  ])];
  const ultimo = new Map<string, Andamento>();
  const cobrancasFeitas = new Set<string>(); // "parcelaId|marco"
  for (const lote of lotes(idsHistorico)) {
    const { data, error } = await supabase.from("interacoes").select("referencia_id, tipo, descricao, criado_em")
      .eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "rec_titulos").in("referencia_id", lote).in("tipo", Object.keys(ROTULO_ANDAMENTO))
      .order("criado_em", { ascending: false }).limit(1000);
    if (error) throw new Error(`Falha ao ler o histórico dos títulos: ${error.message}`);
    for (const i of data ?? []) {
      const id = i.referencia_id as string;
      if (!ultimo.has(id)) ultimo.set(id, { texto: ROTULO_ANDAMENTO[i.tipo as string], quando: em(i.criado_em as string) });
      const marco = marcoDaDescricao(i.descricao as string | null);
      if (TIPOS_COBRANCA_FEITA.includes(i.tipo as string) && marco !== null) cobrancasFeitas.add(`${id}|${marco}`);
    }
  }

  // ---- monta as filas ----
  const itemParcela = (t: LinhaTitulo): ItemParcela => ({
    ...base(t.contraparte_id, unidadeDe(t), [t.documento]),
    id: t.id, documento: t.documento, parcela: t.parcela, vencimento: t.vencimento, valorCentavos: valorRestante(t), estagio: t.estagio,
    prazo: prazoDaParcela(t.vencimento, hoje), contato: contatoBoleto(t.contraparte_id), andamento: ultimo.get(t.id) ?? null, diasAtraso: Math.max(t.dias_atraso, 0),
  });
  const filas = { anexar: [] as ItemParcela[], enviar: [] as ItemParcela[], dados: [] as ItemParcela[] };
  for (const t of aguardando) {
    const fila = filaDaParcela({ estagio: t.estagio, forma: t.forma_pagamento, temBoleto: comBoleto.has(t.id) });
    if (fila) filas[fila].push(itemParcela(t));
  }

  const parcelaDe = (t: { id: string; documento: string; parcela: string; vencimento: string; valorCentavos: number }): ParcelaItem => ({
    id: t.id, documento: t.documento, parcela: t.parcela, vencimento: t.vencimento, valorCentavos: t.valorCentavos,
  });
  const confirmar: ItemConfirmar[] = gruposConfirmacao.map((g) => ({
    ...base(g.contraparteId, g.unidade, g.titulos.map((t) => t.documento)),
    parcelas: g.titulos.map(parcelaDe), totalCentavos: g.totalCentavos, vencimentoMaisProximo: g.vencimentoMaisProximo,
    prazo: prazoConfirmacao(g.vencimentoMaisProximo, hoje), ligar: ligar.has(`${g.contraparteId}|${g.unidade}`), contato: contatoMensagem(g.contraparteId),
    andamento: g.titulos.map((t) => ultimo.get(t.id)).find((a) => a) ?? null,
  }));

  const cobrar: ItemCobrar[] = removerCobrancasFeitas(gruposCobranca, (id, marco) => cobrancasFeitas.has(`${id}|${marco}`)).map((g) => ({
    ...base(g.contraparteId, g.unidade, g.titulos.map((t) => t.documento)),
    marco: g.marco, parcelas: g.titulos.map(parcelaDe), totalCentavos: g.totalCentavos, vencimentoMaisAntigo: g.vencimentoMaisAntigo,
    diasAtraso: diasEntre(hoje, g.vencimentoMaisAntigo), contato: contatoMensagem(g.contraparteId),
    andamento: g.titulos.map((t) => ultimo.get(t.id)).find((a) => a) ?? null,
  }));

  const baixa: ItemBaixa[] = ordenarParcelas(
    emAberto.filter((t) => idsPossivelBaixa.has(t.id)).map((t): ItemBaixa => ({
      ...base(t.contraparte_id, unidadeDe(t), [t.documento]),
      id: t.id, documento: t.documento, parcela: t.parcela, vencimento: t.vencimento, valorCentavos: centavos(t.valor), diasAtraso: Math.max(t.dias_atraso, 0),
      pagoEm: t.consistem_pago_em, valorPagoCentavos: t.consistem_valor_pago !== null ? centavos(t.consistem_valor_pago) : null,
    })),
  );

  const porCliente = new Map<string, LinhaTitulo[]>();
  for (const t of noEscopo) porCliente.set(t.contraparte_id, [...(porCliente.get(t.contraparte_id) ?? []), t]);
  const contato: ItemContato[] = ordenarContatos(
    [...porCliente.entries()].filter(([id]) => !temContatoUtil(contatosPorCliente.get(id) ?? [])).map(([id, ts]): ItemContato => ({
      ...base(id, "matriz", ts.map((t) => t.documento)),
      titulos: ts.length, totalCentavos: ts.reduce((s, t) => s + centavos(t.valor), 0), menorVencimento: ts.map((t) => t.vencimento).sort()[0],
      maiorAtraso: Math.max(0, ...ts.map((t) => t.dias_atraso)),
    })),
  );

  return {
    hoje,
    anexar: ordenarParcelas(filas.anexar), enviar: ordenarParcelas(filas.enviar), dados: ordenarParcelas(filas.dados),
    confirmar: confirmar.sort((a, b) => a.vencimentoMaisProximo.localeCompare(b.vencimentoMaisProximo) || b.totalCentavos - a.totalCentavos),
    cobrar: cobrar.sort((a, b) => b.marco - a.marco || a.vencimentoMaisAntigo.localeCompare(b.vencimentoMaisAntigo) || a.cliente.localeCompare(b.cliente, "pt-BR")),
    baixa, contato,
  };
}
