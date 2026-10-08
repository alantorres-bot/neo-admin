import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { formatarData } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { JUROS_MES_PADRAO_PCT, MARCOS_COBRANCA, MULTA_PADRAO_PCT, TRAVA_PENDENCIAS_COBRANCA, type CanalCobranca } from "@/supabase/functions/_shared/cobranca";
import { DIAS_CONTATO_ANTES, DIAS_JANELA_CONFIRMACAO, MINIMO_PADRAO_CENTAVOS } from "@/supabase/functions/_shared/confirmacao";
import { DIAS_JANELA_ANEXAR_BOLETO } from "@/supabase/functions/_shared/consistem-receber";
import { MODULO_COBRANCA } from "../fila";

export const metadata: Metadata = { title: "Regra de cobrança — Cobrança" };

const ROTULO_CANAL: Record<CanalCobranca, string> = { email: "e-mail", whatsapp: "WhatsApp" };
const CHAVES = {
  esteira: "financeiro.recebiveis.esteira_a_partir_de",
  regua: "financeiro.recebiveis.regua_a_partir_de",
  minimo: "financeiro.recebiveis.confirmacao_valor_minimo",
} as const;

const dataOuNada = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatarData(v) : "não definida");

/** Só consulta: mostra as regras em vigor. Quem executa é a sincronização (de hora em hora); nada aqui altera o comportamento. */
export default async function PaginaRegraCobranca() {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_COBRANCA);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();

  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("configuracoes").select("chave, valor").in("chave", Object.values(CHAVES));
  const config = new Map((data ?? []).map((c) => [c.chave as string, c.valor as unknown]));
  const minimoReais = Number(config.get(CHAVES.minimo));
  const minimo = Number.isFinite(minimoReais) && minimoReais > 0 ? Math.round(minimoReais * 100) : MINIMO_PADRAO_CENTAVOS;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Regra de cobrança</h2>
        <p className="text-sm text-muted-foreground">
          Como o sistema decide o que entra em cada etapa. Esta tela só mostra as regras em vigor; para alterá-las, fale com o administrador. O sistema nunca envia nada ao cliente: ele prepara a tarefa e a mensagem, e quem envia é a pessoa.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>1. Boleto: anexar e enviar</CardTitle>
            <CardDescription>Para títulos novos, a partir de {dataOuNada(config.get(CHAVES.esteira))}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p>A tarefa <strong>Boletos a anexar</strong> só aparece quando faltam <strong>{DIAS_JANELA_ANEXAR_BOLETO} dias ou menos</strong> para o vencimento. Antes disso ainda não é hora.</p>
            <p>Com o PDF anexado, a parcela vai para <strong>A enviar</strong> até ser marcada como enviada (rascunho no Gmail ou mensagem copiada).</p>
            <p>Clientes que pagam por transferência (PIX/TED) não têm boleto: aparece <strong>Enviar dados de pagamento</strong>.</p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>2. Confirmar pagamento</CardTitle>
            <CardDescription>Contato antes do vencimento, para clientes de maior valor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p>Entram as parcelas que vencem em <strong>até {DIAS_JANELA_CONFIRMACAO} dias</strong>, somadas por cliente e unidade, quando o total é de <strong>{formatarMoeda(minimo)}</strong> ou mais.</p>
            <p>O prazo do contato é o vencimento menos <strong>{DIAS_CONTATO_ANTES} dias</strong>.</p>
            <p>“Cliente confirmou” encerra a tarefa. “Sem resposta” abre <strong>Ligar para confirmar pagamento</strong>.</p>
          </CardContent>
        </Card>

        <Card size="sm" className="lg:col-span-2">
          <CardHeader>
            <CardTitle>3. Cobrar títulos vencidos (régua)</CardTitle>
            <CardDescription>Vale para vencimentos a partir de {dataOuNada(config.get(CHAVES.regua))}. Só aparece o que ainda não foi cobrado naquele marco.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="divide-y rounded-[3px] border border-grade">
              {MARCOS_COBRANCA.map((m) => (
                <li key={m.dias} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
                  <strong className="w-12 tabular-nums">{m.nome}</strong>
                  <span>{m.descricao}</span>
                  <span className="text-muted-foreground">por {m.canais.map((c) => ROTULO_CANAL[c]).join(" e ")}</span>
                </li>
              ))}
            </ul>
            <p>Encargos do título vencido (padrão do módulo, até os contratos terem condições próprias): multa de <strong>{MULTA_PADRAO_PCT}%</strong> mais juros de <strong>{JUROS_MES_PADRAO_PCT}% ao mês</strong>, por dia de atraso. O demonstrativo vai na cobrança do D+10.</p>
            <p>Título com <strong>promessa de pagamento</strong> pausa a régua até a data prometida. Cedido, contestado, em renegociação ou no jurídico ficam fora da régua automática.</p>
            <p className="text-muted-foreground">Trava de segurança: se uma rodada tentar abrir mais de {TRAVA_PENDENCIAS_COBRANCA} cobranças de uma vez, nada é aberto (algo está errado na configuração).</p>
          </CardContent>
        </Card>

        <Card size="sm" className="lg:col-span-2">
          <CardHeader>
            <CardTitle>4. Quando as listas se atualizam</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p>O sistema consulta o Consistem <strong>de hora em hora, de segunda a sexta, das 8h às 18h (Cuiabá)</strong>. Também dá para forçar em Recebíveis, com “Sincronizar agora” (gestor).</p>
            <p>Os itens saem da lista sozinhos quando a tarefa é feita: boleto anexado e enviado, confirmação registrada, cobrança registrada ou título baixado.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
