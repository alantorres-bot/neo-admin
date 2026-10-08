import { cache } from "react";
import { lerPartes } from "@/lib/modulos/financeiro/akf/parcial";
import { MODULO_RECEBIVEIS, TIPO_ANEXO_BOLETO } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { ROTULO_ANDAMENTO } from "@/lib/modulos/financeiro/recebiveis/carteira";
import {
  filaDaParcela, linkWhatsApp, marcoDaDescricao, montarTextoBusca, ordenarContatos, ordenarParcelas, prazoDaParcela, removerCobrancasFeitas,
  type Andamento, type ContatoSugerido, type ItemBase, type ItemBaixa, type ItemCobrar, type ItemConfirmar, type ItemContato, type ItemParcela, type ParcelaItem, type Tarefas,
} from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { titulaNoEscopoDeCadastro } from "@/lib/modulos/financeiro/recebiveis/clientes";
import { FUSO, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { carregarRegra } from "@/lib/modulos/financeiro/recebiveis/regra";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ESTAGIOS_COBRAVEIS, mensagemWhatsAppCobranca, planejarCobrancas, unidadeDaPendencia, type TituloCobranca, type Unidade } from "@/supabase/functions/_shared/cobranca";
import {
  ESTAGIOS_CONFIRMAVEIS, mensagemWhatsAppConfirmacao, planejarConfirmacoes, prazoConfirmacao, type TituloConfirmacao,
} from "@/supabase/functions/_shared/confirmacao";
import { escolherContato, temContatoUtil, type ContatoEscolha } from "@/supabase/functions/_shared/contatos";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

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
  nota_saida_id: string | null; nota_fiscal: string | null;
};
type ContatoLinha = ContatoEscolha & { contraparte_id: string; funcao?: string | null };

/**
 * As tarefas desta requisição, calculadas UMA vez: a tela Tarefas e os contadores da Carteira (botão e aba, que carregam à parte
 * dentro de <Suspense>) usam o mesmo resultado, sem repetir as leituras.
 */
export const tarefasDaRequisicao = cache(async (): Promise<Tarefas> => carregarTarefas(await criarClienteServidor()));

/**
 * Calcula todas as filas de tarefas do contas a receber, hoje, com a sessão de quem chama (a RLS vale). Usa as mesmas regras
 * puras da sincronização (confirmação, régua, escopo do cadastro) para a tela e as pendências nunca discordarem. Nada é gravado.
 */
export async function carregarTarefas(supabase: Cliente): Promise<Tarefas> {
  const hoje = hojeEmCuiaba();

  // Cada ida ao banco custa a latência da rede (~200 ms com o banco no Canadá), então as leituras que não dependem uma da outra
  // saem juntas, em 3 ondas: (1) títulos, configurações e pendências; (2) boletos, antecipações e clientes já conhecidos;
  // (3) clientes dos grupos formados e histórico.

  // Onda 1: todos os títulos em aberto (PostgREST devolve até 1000 por vez) + configurações e pendências que mudam a classificação.
  const lerAbertos = async () => {
    const todos: LinhaTitulo[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase.from("rec_vw_titulos")
        .select("id, contraparte_id, documento, parcela, vencimento, valor, estagio, dias_atraso, faixa, cedido, contestado, unidade, forma_pagamento, regua_pausada_ate, consistem_pago_em, consistem_valor_pago, nota_saida_id, nota_fiscal")
        .neq("faixa", "encerrado").order("id").range(de, de + 999);
      if (error) throw new Error(`Falha ao ler a carteira: ${error.message}`);
      todos.push(...((data ?? []) as unknown as LinhaTitulo[]));
      if (!data || data.length < 1000) break;
    }
    return todos;
  };
  const [abertos, { parametros: regra }, { data: baixasPend }, { data: ligarPend }] = await Promise.all([
    lerAbertos(),
    carregarRegra(supabase),
    supabase.from("pendencias").select("referencia_id").eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "rec_titulos").like("titulo", "Possível baixa:%").in("status", ["aberta", "em_andamento"]).limit(1000),
    supabase.from("pendencias").select("referencia_id, titulo").eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "contrapartes").like("titulo", "Ligar para confirmar pagamento:%").in("status", ["aberta", "em_andamento"]).limit(1000),
  ]);
  const emAberto = abertos.filter((t) => !ENCERRADOS.includes(t.estagio));
  const corte = regra.reguaAPartirDe;
  const minimoCentavos = regra.minimoConfirmacaoCentavos;
  const idsPossivelBaixa = new Set((baixasPend ?? []).map((p) => p.referencia_id as string));
  const ligar = new Set((ligarPend ?? []).map((p) => `${p.referencia_id as string}|${unidadeDaPendencia(p.titulo as string)}`));

  const aguardando = emAberto.filter((t) => t.estagio === "aguardando_boleto");
  // Confirmação: parcelas que vencem nos próximos 7 dias; cobrança: régua. Cadastro de contatos: Matriz, a vencer ou vencido há < 60 dias.
  const candidatasConfirmacao = emAberto.filter((t) => (ESTAGIOS_CONFIRMAVEIS as readonly string[]).includes(t.estagio) && t.vencimento >= hoje);
  const candidatasCobranca = corte
    ? emAberto.filter((t) => (ESTAGIOS_COBRAVEIS as readonly string[]).includes(t.estagio) && t.vencimento >= corte && t.vencimento < hoje)
    : [];
  const noEscopo = emAberto.filter((t) => titulaNoEscopoDeCadastro({ unidade: t.unidade, faixa: t.faixa, dias_atraso: t.dias_atraso }));

  // Clientes (nome e código) e contatos: cada cliente é lido uma única vez, em lotes que correm juntos.
  const nomesClientes = new Map<string, { nome: string; codigo: string | null }>();
  const contatosPorCliente = new Map<string, ContatoLinha[]>();
  const clientesLidos = new Set<string>();
  const carregarClientes = async (ids: Iterable<string>) => {
    const faltam = [...new Set(ids)].filter((id) => !clientesLidos.has(id));
    for (const id of faltam) clientesLidos.add(id);
    await Promise.all(lotes(faltam).map(async (lote) => {
      const [{ data: clientes }, { data: contatos }] = await Promise.all([
        supabase.from("contrapartes").select("id, nome, codigo_erp").in("id", lote),
        supabase.from("contatos").select("id, contraparte_id, nome, funcao, email, whatsapp, telefone, finalidades, canal_preferido, ativo").in("contraparte_id", lote).eq("ativo", true),
      ]);
      for (const c of clientes ?? []) nomesClientes.set(c.id as string, { nome: c.nome as string, codigo: (c.codigo_erp as string | null) ?? null });
      for (const c of (contatos ?? []) as unknown as ContatoLinha[]) contatosPorCliente.set(c.contraparte_id, [...(contatosPorCliente.get(c.contraparte_id) ?? []), c]);
    }));
  };

  // Onda 2: boletos anexados, antecipações parciais (restante) e os clientes que já se sabe que aparecem.
  const comBoleto = new Set<string>();
  const lerBoletos = Promise.all(lotes(aguardando.map((t) => t.id)).map(async (lote) => {
    const { data, error } = await supabase.from("anexos").select("referencia_id").eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "rec_titulos").eq("tipo", TIPO_ANEXO_BOLETO).in("referencia_id", lote);
    if (error) throw new Error(`Falha ao ler os boletos anexados: ${error.message}`);
    for (const a of data ?? []) comBoleto.add(a.referencia_id as string);
  }));
  const [partes] = await Promise.all([
    lerPartes(supabase, [...candidatasConfirmacao.filter((t) => diasEntre(t.vencimento, hoje) <= regra.janelaConfirmacaoDias), ...candidatasCobranca].map((t) => t.id)),
    lerBoletos,
    carregarClientes([...aguardando, ...emAberto.filter((t) => idsPossivelBaixa.has(t.id)), ...noEscopo].map((t) => t.contraparte_id)),
  ]);
  const valorRestante = (t: LinhaTitulo) => partes.get(t.id)?.restanteCentavos ?? centavos(t.valor);

  const unidadeDe = (t: Pick<LinhaTitulo, "unidade">): Unidade => (t.unidade === "contagem" ? "contagem" : "matriz");
  const gruposConfirmacao = planejarConfirmacoes(
    candidatasConfirmacao.map((t): TituloConfirmacao => ({
      id: t.id, contraparteId: t.contraparte_id, nomeCliente: "", documento: t.documento, parcela: t.parcela, vencimento: t.vencimento,
      valorCentavos: valorRestante(t), estagio: t.estagio, cedido: t.cedido, contestado: t.contestado, unidade: unidadeDe(t),
    })),
    hoje, minimoCentavos, regra.janelaConfirmacaoDias,
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

  // Onda 3: clientes dos grupos formados + último registro do histórico de cada parcela das filas ("o que já foi feito") e as
  // cobranças já registradas por marco.
  const idsHistorico = [...new Set([
    ...aguardando.map((t) => t.id), ...gruposConfirmacao.flatMap((g) => g.titulos.map((t) => t.id)), ...gruposCobranca.flatMap((g) => g.titulos.map((t) => t.id)),
  ])];
  const ultimo = new Map<string, Andamento>();
  const cobrancasFeitas = new Set<string>(); // "parcelaId|marco"
  await Promise.all([
    carregarClientes([...gruposConfirmacao, ...gruposCobranca].map((g) => g.contraparteId)),
    ...lotes(idsHistorico).map(async (lote) => {
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
    }),
  ]);

  const base = (clienteId: string, unidade: Unidade, documentos: string[]): ItemBase => {
    const c = nomesClientes.get(clienteId);
    return { clienteId, cliente: c?.nome ?? "(cliente sem nome)", codigo: c?.codigo ?? null, unidade, textoBusca: montarTextoBusca(c?.nome ?? "", c?.codigo ?? null, documentos) };
  };
  const sugerido = (c: ContatoLinha | null): ContatoSugerido => (c ? { id: c.id, nome: c.nome, email: c.email ?? null, whatsapp: c.whatsapp ?? null } : null);
  const contatoBoleto = (id: string) => {
    const lista = contatosPorCliente.get(id) ?? [];
    return sugerido(escolherContato(lista, "boleto", "email") ?? escolherContato(lista, "boleto", "whatsapp"));
  };
  const contatoWhatsapp = (id: string) => escolherContato(contatosPorCliente.get(id) ?? [], ["confirmacao", "cobranca"], "whatsapp");
  const contatoMensagem = (id: string) => {
    const lista = contatosPorCliente.get(id) ?? [];
    return sugerido(escolherContato(lista, ["confirmacao", "cobranca"], "whatsapp") ?? escolherContato(lista, ["confirmacao", "cobranca"], "telefone"));
  };

  // ---- monta as filas ----
  const itemParcela = (t: LinhaTitulo): ItemParcela => ({
    ...base(t.contraparte_id, unidadeDe(t), [t.documento]),
    id: t.id, documento: t.documento, parcela: t.parcela, vencimento: t.vencimento, valorCentavos: valorRestante(t), estagio: t.estagio,
    prazo: prazoDaParcela(t.vencimento, hoje), contato: contatoBoleto(t.contraparte_id), andamento: ultimo.get(t.id) ?? null, diasAtraso: Math.max(t.dias_atraso, 0),
    notaSaidaId: t.nota_saida_id, nota: t.nota_fiscal,
  });
  const filas = { anexar: [] as ItemParcela[], enviar: [] as ItemParcela[], dados: [] as ItemParcela[] };
  for (const t of aguardando) {
    const fila = filaDaParcela({ estagio: t.estagio, forma: t.forma_pagamento, temBoleto: comBoleto.has(t.id), vencimento: t.vencimento, hoje, janelaBoletoDias: regra.janelaBoletoDias });
    if (fila) filas[fila].push(itemParcela(t));
  }

  const parcelaDe = (t: { id: string; documento: string; parcela: string; vencimento: string; valorCentavos: number }): ParcelaItem => ({
    id: t.id, documento: t.documento, parcela: t.parcela, vencimento: t.vencimento, valorCentavos: t.valorCentavos,
  });
  const confirmar: ItemConfirmar[] = gruposConfirmacao.map((g) => {
    const zap = contatoWhatsapp(g.contraparteId);
    const mensagem = mensagemWhatsAppConfirmacao(g, zap?.nome ?? "");
    return {
      ...base(g.contraparteId, g.unidade, g.titulos.map((t) => t.documento)),
      parcelas: g.titulos.map(parcelaDe), totalCentavos: g.totalCentavos, vencimentoMaisProximo: g.vencimentoMaisProximo,
      prazo: prazoConfirmacao(g.vencimentoMaisProximo, hoje, regra.prazoContatoAntesDias), ligar: ligar.has(`${g.contraparteId}|${g.unidade}`), contato: contatoMensagem(g.contraparteId),
      andamento: g.titulos.map((t) => ultimo.get(t.id)).find((a) => a) ?? null,
      mensagem, linkWhatsApp: linkWhatsApp(zap?.whatsapp, mensagem),
    };
  });

  const cobrar: ItemCobrar[] = removerCobrancasFeitas(gruposCobranca, (id, marco) => cobrancasFeitas.has(`${id}|${marco}`)).map((g) => {
    const zap = contatoWhatsapp(g.contraparteId);
    // D+10 é por e-mail: sem mensagem de WhatsApp.
    const mensagem = mensagemWhatsAppCobranca(g, zap?.nome ?? "");
    return {
      ...base(g.contraparteId, g.unidade, g.titulos.map((t) => t.documento)),
      marco: g.marco, parcelas: g.titulos.map(parcelaDe), totalCentavos: g.totalCentavos, vencimentoMaisAntigo: g.vencimentoMaisAntigo,
      diasAtraso: diasEntre(hoje, g.vencimentoMaisAntigo), contato: contatoMensagem(g.contraparteId),
      andamento: g.titulos.map((t) => ultimo.get(t.id)).find((a) => a) ?? null,
      mensagem, linkWhatsApp: mensagem ? linkWhatsApp(zap?.whatsapp, mensagem) : null,
    };
  });

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
