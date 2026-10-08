"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PARAMETROS_PADRAO, type ParametrosRegra } from "@/supabase/functions/_shared/parametros-regra";
import { salvarRegra } from "./acoes";

type Marco = { nome: string; descricao: string; canais: string };
type Props = {
  parametros: ParametrosRegra;
  /** Quem pode gravar (gestor do Financeiro ou acima); os demais só consultam. */
  podeEditar: boolean;
  marcos: Marco[];
  multaPct: number;
  jurosMesPct: number;
  /** Texto "Última alteração por X em dd/mm/aaaa hh:mm", se houver. */
  ultimaAlteracao: string | null;
};

const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{rotulo}</span>
      {children}
      {dica && <span className="text-[12px] text-muted-foreground">{dica}</span>}
    </label>
  );
}

/** Regra de cobrança: cada cartão explica a regra com os números em vigor e, para o gestor, deixa alterá-los. */
export function FormRegra({ parametros, podeEditar, marcos, multaPct, jurosMesPct, ultimaAlteracao }: Props) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [esteira, setEsteira] = useState(parametros.esteiraAPartirDe ?? "");
  const [regua, setRegua] = useState(parametros.reguaAPartirDe ?? "");
  const [minimo, setMinimo] = useState(reais(parametros.minimoConfirmacaoCentavos));
  const [janelaBoleto, setJanelaBoleto] = useState(String(parametros.janelaBoletoDias));
  const [janelaConfirmacao, setJanelaConfirmacao] = useState(String(parametros.janelaConfirmacaoDias));
  const [prazoContato, setPrazoContato] = useState(String(parametros.prazoContatoAntesDias));
  const [trava, setTrava] = useState(String(parametros.travaPendenciasCobranca));

  const inteiro = (t: string) => (t.trim() === "" ? NaN : Number(t));
  const minimoNumero = Number(minimo.replace(/\./g, "").replace(",", "."));

  function restaurarPadroes() {
    setMinimo(reais(PARAMETROS_PADRAO.minimoConfirmacaoCentavos));
    setJanelaBoleto(String(PARAMETROS_PADRAO.janelaBoletoDias));
    setJanelaConfirmacao(String(PARAMETROS_PADRAO.janelaConfirmacaoDias));
    setPrazoContato(String(PARAMETROS_PADRAO.prazoContatoAntesDias));
    setTrava(String(PARAMETROS_PADRAO.travaPendenciasCobranca));
    toast.info("Valores padrão carregados. Clique em “Salvar regra” para aplicar (as datas de início não mudam).");
  }

  function salvar() {
    iniciar(async () => {
      const r = await salvarRegra({
        esteiraAPartirDe: esteira.trim() === "" ? null : esteira.trim(),
        reguaAPartirDe: regua.trim() === "" ? null : regua.trim(),
        minimoConfirmacaoReais: minimoNumero,
        janelaBoletoDias: inteiro(janelaBoleto),
        janelaConfirmacaoDias: inteiro(janelaConfirmacao),
        prazoContatoAntesDias: inteiro(prazoContato),
        travaPendenciasCobranca: inteiro(trava),
      });
      if (r.ok) {
        toast.success(r.aviso);
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  const num = "w-28 tabular-nums";
  const dias = (t: string) => (t === "1" ? "1 dia" : `${t} dias`);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>1. Boleto: anexar e enviar</CardTitle>
            <CardDescription>Para títulos novos, a partir da data de início da esteira.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>A tarefa <strong>Boletos a anexar</strong> só aparece quando faltam <strong>{dias(janelaBoleto)} ou menos</strong> para o vencimento. Antes disso ainda não é hora.</p>
            <p>Com o PDF anexado, a parcela vai para <strong>A enviar</strong> até ser marcada como enviada (rascunho no Gmail ou mensagem copiada). Clientes que pagam por transferência (PIX/TED) não têm boleto: aparece <strong>Enviar dados de pagamento</strong>.</p>
            {podeEditar && (
              <div className="flex flex-wrap gap-4">
                <Campo rotulo="Janela do boleto (dias antes do vencimento)"><Input inputMode="numeric" className={num} value={janelaBoleto} onChange={(e) => setJanelaBoleto(e.target.value)} /></Campo>
                <Campo rotulo="Esteira vale para títulos novos desde" dica="Vazio desliga a entrada de títulos novos.">
                  <Input type="date" className="w-44" value={esteira} onChange={(e) => setEsteira(e.target.value)} />
                </Campo>
              </div>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>2. Confirmar pagamento</CardTitle>
            <CardDescription>Contato antes do vencimento, para clientes de maior valor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Entram as parcelas que vencem em <strong>até {dias(janelaConfirmacao)}</strong>, somadas por cliente e unidade, quando o total é de <strong>R$ {minimo}</strong> ou mais.</p>
            <p>O prazo do contato é o vencimento menos <strong>{dias(prazoContato)}</strong>. “Cliente confirmou” encerra a tarefa; “Sem resposta” abre <strong>Ligar para confirmar pagamento</strong>.</p>
            {podeEditar && (
              <div className="flex flex-wrap gap-4">
                <Campo rotulo="Valor mínimo (R$)"><Input inputMode="decimal" className="w-36 tabular-nums" value={minimo} onChange={(e) => setMinimo(e.target.value)} /></Campo>
                <Campo rotulo="Janela (dias antes)"><Input inputMode="numeric" className={num} value={janelaConfirmacao} onChange={(e) => setJanelaConfirmacao(e.target.value)} /></Campo>
                <Campo rotulo="Contatar (dias antes)" dica="0 = no dia do vencimento."><Input inputMode="numeric" className={num} value={prazoContato} onChange={(e) => setPrazoContato(e.target.value)} /></Campo>
              </div>
            )}
          </CardContent>
        </Card>

        <Card size="sm" className="lg:col-span-2">
          <CardHeader>
            <CardTitle>3. Cobrar títulos vencidos (régua)</CardTitle>
            <CardDescription>Só aparece o que ainda não foi cobrado naquele marco.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="divide-y rounded-[3px] border border-grade">
              {marcos.map((m) => (
                <li key={m.nome} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
                  <strong className="w-12 tabular-nums">{m.nome}</strong>
                  <span>{m.descricao}</span>
                  <span className="text-muted-foreground">por {m.canais}</span>
                </li>
              ))}
            </ul>
            <p>Encargos do título vencido (padrão do módulo, até os contratos terem condições próprias): multa de <strong>{multaPct}%</strong> mais juros de <strong>{jurosMesPct}% ao mês</strong>, por dia de atraso. O demonstrativo vai na cobrança do D+10. O valor definitivo é o do contrato de cada cliente.</p>
            <p>Título com <strong>promessa de pagamento</strong> pausa a régua até a data prometida. Cedido, contestado, em renegociação ou no jurídico ficam fora da régua automática.</p>
            {podeEditar && (
              <div className="flex flex-wrap gap-4">
                <Campo rotulo="Régua vale para vencimentos desde" dica="Vazio desliga a régua. Data antiga demais abre muitas tarefas de uma vez (a trava barra).">
                  <Input type="date" className="w-44" value={regua} onChange={(e) => setRegua(e.target.value)} />
                </Campo>
                <Campo rotulo="Trava de segurança (cobranças por rodada)" dica="Passou disso numa rodada, nenhuma é aberta.">
                  <Input inputMode="numeric" className={num} value={trava} onChange={(e) => setTrava(e.target.value)} />
                </Campo>
              </div>
            )}
            {!podeEditar && <p className="text-muted-foreground">Trava de segurança: se uma rodada tentar abrir mais de {trava} cobranças de uma vez, nada é aberto (algo está errado na configuração).</p>}
          </CardContent>
        </Card>

        <Card size="sm" className="lg:col-span-2">
          <CardHeader><CardTitle>4. Quando as listas se atualizam</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p>O sistema consulta o Consistem <strong>de hora em hora, de segunda a sexta, das 8h às 18h (Cuiabá)</strong>. Também dá para forçar em Recebíveis, com “Sincronizar agora” (gestor).</p>
            <p>Os itens saem da lista sozinhos quando a tarefa é feita: boleto anexado e enviado, confirmação registrada, cobrança registrada ou título baixado.</p>
          </CardContent>
        </Card>
      </div>

      {podeEditar ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={salvar} disabled={pendente}>{pendente ? "Salvando…" : "Salvar regra"}</Button>
          <Button variant="outline" onClick={restaurarPadroes} disabled={pendente}>Restaurar valores padrão</Button>
          <span className="text-[12px] text-muted-foreground">Vale a partir da próxima sincronização e da próxima abertura de tela. O sistema continua sem enviar nada ao cliente.</span>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">Para alterar estas regras, fale com um gestor do Financeiro ou o administrador.</p>
      )}
      {ultimaAlteracao && <p className="text-[12px] text-muted-foreground">Última alteração: {ultimaAlteracao}.</p>}
    </div>
  );
}
