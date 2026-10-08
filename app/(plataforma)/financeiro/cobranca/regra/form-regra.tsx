"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  emailCobranca, MARCOS_PADRAO, mensagemWhatsAppCobranca, validarMarcos, VARIAVEIS_TEXTO_COBRANCA,
  type CanalCobranca, type GrupoCobranca, type MarcoRegua,
} from "@/supabase/functions/_shared/cobranca";
import { PARAMETROS_PADRAO, type ParametrosRegra } from "@/supabase/functions/_shared/parametros-regra";
import { salvarRegra, type MarcoEntrada } from "./acoes";

type Props = {
  parametros: ParametrosRegra;
  marcos: MarcoRegua[];
  /** Quem pode gravar (gestor do Financeiro ou acima); os demais só consultam. */
  podeEditar: boolean;
  multaPct: number;
  jurosMesPct: number;
  /** Quantas pendências abertas há em cada marco (dias -> quantidade): são canceladas se o marco for removido. */
  abertasPorMarco: Record<number, number>;
  /** Hoje (aaaa-mm-dd) em Cuiabá, para a prévia dos textos. */
  hoje: string;
  /** Texto "Última alteração por X em dd/mm/aaaa hh:mm", se houver. */
  ultimaAlteracao: string | null;
};

type Rascunho = {
  chave: string;
  dias: string;
  email: boolean;
  whatsapp: boolean;
  descricao: string;
  textoWhatsapp: string;
  assuntoEmail: string;
  corpoEmail: string;
};

const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const doMarco = (m: MarcoRegua, i: number): Rascunho => ({
  chave: `m${i}-${m.dias}`, dias: String(m.dias), email: m.canais.includes("email"), whatsapp: m.canais.includes("whatsapp"), descricao: m.descricao,
  textoWhatsapp: m.textoWhatsapp ?? "", assuntoEmail: m.assuntoEmail ?? "", corpoEmail: m.corpoEmail ?? "",
});
const paraEntrada = (r: Rascunho): MarcoEntrada => {
  const canais: CanalCobranca[] = [...(r.email ? (["email"] as const) : []), ...(r.whatsapp ? (["whatsapp"] as const) : [])];
  return {
    dias: r.dias.trim() === "" ? NaN : Number(r.dias), canais, descricao: r.descricao.trim(),
    textoWhatsapp: r.whatsapp ? r.textoWhatsapp : null, assuntoEmail: r.email ? r.assuntoEmail : null, corpoEmail: r.email ? r.corpoEmail : null,
  };
};
const rotuloCanais = (m: Pick<MarcoRegua, "canais">) => m.canais.map((c) => (c === "email" ? "e-mail" : "WhatsApp")).join(" e ");

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{rotulo}</span>
      {children}
      {dica && <span className="text-[12px] text-muted-foreground">{dica}</span>}
    </label>
  );
}

/** Exemplo para a prévia: uma ou duas parcelas de um cliente fictício, vencidas há 12 dias. */
function exemplo(hoje: string, parcelas: 1 | 2, dias: number): GrupoCobranca {
  const base = new Date(`${hoje}T00:00:00Z`);
  const venc = (atraso: number) => new Date(base.getTime() - atraso * 86_400_000).toISOString().slice(0, 10);
  const titulos = [
    { id: "a", contraparteId: "x", nomeCliente: "Cliente Exemplo Ltda", documento: "123456", parcela: "1", vencimento: venc(Math.max(dias, 1)), valorCentavos: 12_500_00, estagio: "vencido" },
    { id: "b", contraparteId: "x", nomeCliente: "Cliente Exemplo Ltda", documento: "123457", parcela: "2", vencimento: venc(Math.max(dias, 1) + 2), valorCentavos: 8_300_00, estagio: "vencido" },
  ].slice(0, parcelas);
  return { contraparteId: "x", nomeCliente: "Cliente Exemplo Ltda", unidade: "matriz", marco: dias, titulos, totalCentavos: titulos.reduce((s, t) => s + t.valorCentavos, 0), vencimentoMaisAntigo: titulos[titulos.length - 1].vencimento };
}

function Previa({ r, hoje }: { r: Rascunho; hoje: string }) {
  const [parcelas, setParcelas] = useState<1 | 2>(2);
  const dias = Number(r.dias);
  const valido = Number.isInteger(dias) && dias >= 1;
  const entrada = paraEntrada(r);
  const marco: MarcoRegua = { dias: valido ? dias : 1, nome: `D+${valido ? dias : 1}`, canais: entrada.canais, descricao: entrada.descricao, textoWhatsapp: entrada.textoWhatsapp, assuntoEmail: entrada.assuntoEmail, corpoEmail: entrada.corpoEmail };
  const grupo = exemplo(hoje, parcelas, marco.dias);
  const whats = mensagemWhatsAppCobranca(grupo, "Maria", [marco], hoje);
  const email = emailCobranca(grupo, hoje, "Maria", [marco]);
  return (
    <details className="rounded-[3px] border border-grade p-2 text-sm">
      <summary className="cursor-pointer font-medium">Prévia com dados de exemplo</summary>
      <div className="mt-2 space-y-3">
        <div className="flex gap-2 text-[12px]">
          {([1, 2] as const).map((n) => (
            <button key={n} type="button" onClick={() => setParcelas(n)} className={`rounded-[3px] border px-2 py-0.5 ${parcelas === n ? "border-marca font-bold" : "border-grade text-muted-foreground"}`}>{n === 1 ? "1 parcela" : "2 parcelas"}</button>
          ))}
        </div>
        {whats && <div><p className="text-[12px] font-medium text-muted-foreground">WhatsApp</p><pre className="whitespace-pre-wrap rounded-[3px] border bg-muted/30 p-2 font-sans text-xs">{whats}</pre></div>}
        {email && <div><p className="text-[12px] font-medium text-muted-foreground">E-mail — assunto: {email.assunto}</p><pre className="whitespace-pre-wrap rounded-[3px] border bg-muted/30 p-2 font-sans text-xs">{email.corpo}</pre></div>}
        {!whats && !email && <p className="text-[12px] text-muted-foreground">Escolha um canal e escreva o texto para ver a prévia.</p>}
      </div>
    </details>
  );
}

/** Regra de cobrança: cada cartão explica a regra com os números em vigor e, para o gestor, deixa alterá-los (parâmetros e marcos). */
export function FormRegra({ parametros, marcos, podeEditar, multaPct, jurosMesPct, abertasPorMarco, hoje, ultimaAlteracao }: Props) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [esteira, setEsteira] = useState(parametros.esteiraAPartirDe ?? "");
  const [regua, setRegua] = useState(parametros.reguaAPartirDe ?? "");
  const [minimo, setMinimo] = useState(reais(parametros.minimoConfirmacaoCentavos));
  const [janelaBoleto, setJanelaBoleto] = useState(String(parametros.janelaBoletoDias));
  const [janelaConfirmacao, setJanelaConfirmacao] = useState(String(parametros.janelaConfirmacaoDias));
  const [prazoContato, setPrazoContato] = useState(String(parametros.prazoContatoAntesDias));
  const [trava, setTrava] = useState(String(parametros.travaPendenciasCobranca));
  const [lista, setLista] = useState<Rascunho[]>(() => marcos.map(doMarco));
  const [confirmando, setConfirmando] = useState(false);

  const inteiro = (t: string) => (t.trim() === "" ? NaN : Number(t));
  const minimoNumero = Number(minimo.replace(/\./g, "").replace(",", "."));
  const dias = (t: string) => (t === "1" ? "1 dia" : `${t} dias`);
  const num = "w-28 tabular-nums";

  // Marcos que existiam e saíram da lista (ou mudaram de dias): as pendências abertas deles são canceladas ao salvar.
  const diasNovos = useMemo(() => new Set(lista.map((r) => Number(r.dias))), [lista]);
  const removidos = marcos.filter((m) => !diasNovos.has(m.dias));
  const aCancelar = removidos.reduce((soma, m) => soma + (abertasPorMarco[m.dias] ?? 0), 0);

  function atualizar(chave: string, mudanca: Partial<Rascunho>) {
    setConfirmando(false);
    setLista((atual) => atual.map((r) => (r.chave === chave ? { ...r, ...mudanca } : r)));
  }
  function adicionar() {
    setConfirmando(false);
    const modelo = MARCOS_PADRAO[1];
    const maior = Math.max(0, ...lista.map((r) => Number(r.dias) || 0));
    setLista((atual) => [...atual, { chave: `novo-${Date.now()}`, dias: String(maior + 5), email: false, whatsapp: true, descricao: "Novo marco de cobrança", textoWhatsapp: modelo.textoWhatsapp ?? "", assuntoEmail: "", corpoEmail: "" }]);
  }
  function remover(chave: string) {
    setConfirmando(false);
    setLista((atual) => atual.filter((r) => r.chave !== chave));
  }
  function restaurarPadroes() {
    setConfirmando(false);
    setMinimo(reais(PARAMETROS_PADRAO.minimoConfirmacaoCentavos));
    setJanelaBoleto(String(PARAMETROS_PADRAO.janelaBoletoDias));
    setJanelaConfirmacao(String(PARAMETROS_PADRAO.janelaConfirmacaoDias));
    setPrazoContato(String(PARAMETROS_PADRAO.prazoContatoAntesDias));
    setTrava(String(PARAMETROS_PADRAO.travaPendenciasCobranca));
    setLista(MARCOS_PADRAO.map(doMarco));
    toast.info("Valores e marcos padrão carregados. Clique em “Salvar regra” para aplicar (as datas de início não mudam).");
  }

  function gravar() {
    iniciar(async () => {
      const r = await salvarRegra({
        esteiraAPartirDe: esteira.trim() === "" ? null : esteira.trim(),
        reguaAPartirDe: regua.trim() === "" ? null : regua.trim(),
        minimoConfirmacaoReais: minimoNumero,
        janelaBoletoDias: inteiro(janelaBoleto),
        janelaConfirmacaoDias: inteiro(janelaConfirmacao),
        prazoContatoAntesDias: inteiro(prazoContato),
        travaPendenciasCobranca: inteiro(trava),
      }, lista.map(paraEntrada));
      setConfirmando(false);
      if (r.ok) {
        toast.success(r.aviso);
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  function salvar() {
    const erro = validarMarcos(lista.map(paraEntrada));
    if (erro) {
      toast.error(erro);
      return;
    }
    if (aCancelar > 0 && !confirmando) {
      setConfirmando(true);
      return;
    }
    gravar();
  }

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
            <CardDescription>Cada marco é um número de dias de atraso. Só aparece o que ainda não foi cobrado naquele marco.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {podeEditar ? (
              <div className="space-y-3">
                {lista.length === 0 && <p className="rounded-[3px] border border-dashed p-3 text-muted-foreground">Nenhum marco: a régua não vai abrir cobranças. Adicione um marco para ligá-la.</p>}
                {lista.map((r) => (
                  <div key={r.chave} className="space-y-3 rounded-[3px] border border-grade p-3">
                    <div className="flex flex-wrap items-end gap-4">
                      <Campo rotulo="Dias de atraso" dica={Number(r.dias) > 0 ? `Nome do marco: D+${Number(r.dias)}` : undefined}>
                        <Input inputMode="numeric" className={num} value={r.dias} onChange={(e) => atualizar(r.chave, { dias: e.target.value })} />
                      </Campo>
                      <fieldset className="grid gap-1">
                        <legend className="text-sm font-medium">Canais</legend>
                        <div className="flex gap-4 py-1.5">
                          <label className="flex items-center gap-1.5"><input type="checkbox" className="size-4" checked={r.whatsapp} onChange={(e) => atualizar(r.chave, { whatsapp: e.target.checked })} /> WhatsApp</label>
                          <label className="flex items-center gap-1.5"><input type="checkbox" className="size-4" checked={r.email} onChange={(e) => atualizar(r.chave, { email: e.target.checked })} /> E-mail</label>
                        </div>
                      </fieldset>
                      <div className="min-w-64 flex-1">
                        <Campo rotulo="O que este marco faz"><Input value={r.descricao} onChange={(e) => atualizar(r.chave, { descricao: e.target.value })} maxLength={120} /></Campo>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => remover(r.chave)}>Remover marco</Button>
                    </div>
                    {r.whatsapp && (
                      <Campo rotulo="Texto do WhatsApp"><Textarea rows={8} value={r.textoWhatsapp} onChange={(e) => atualizar(r.chave, { textoWhatsapp: e.target.value })} /></Campo>
                    )}
                    {r.email && (
                      <>
                        <Campo rotulo="Assunto do e-mail"><Input value={r.assuntoEmail} onChange={(e) => atualizar(r.chave, { assuntoEmail: e.target.value })} maxLength={200} /></Campo>
                        <Campo rotulo="Texto do e-mail" dica="Termine com “Atenciosamente,”: a assinatura não vai no texto."><Textarea rows={10} value={r.corpoEmail} onChange={(e) => atualizar(r.chave, { corpoEmail: e.target.value })} /></Campo>
                      </>
                    )}
                    <Previa r={r} hoje={hoje} />
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={adicionar} disabled={lista.length >= 6}>Adicionar marco</Button>
                  {lista.length >= 6 && <span className="text-[12px] text-muted-foreground">No máximo 6 marcos.</span>}
                </div>
                <details className="rounded-[3px] border border-grade p-2 text-[12px]">
                  <summary className="cursor-pointer font-medium">Variáveis que podem ser usadas nos textos</summary>
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {Object.entries(VARIAVEIS_TEXTO_COBRANCA).map(([nome, descricao]) => (
                      <li key={nome}><code className="rounded bg-muted px-1">{`{${nome}}`}</code> {descricao}</li>
                    ))}
                    <li className="sm:col-span-2"><code className="rounded bg-muted px-1">{"{pl:se for uma parcela|se forem várias}"}</code> escolhe o trecho conforme o número de parcelas.</li>
                  </ul>
                </details>
              </div>
            ) : (
              <ul className="space-y-2">
                {marcos.length === 0 && <li className="text-muted-foreground">Nenhum marco: a régua não abre cobranças.</li>}
                {marcos.map((m) => (
                  <li key={m.dias} className="rounded-[3px] border border-grade px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <strong className="w-12 tabular-nums">{m.nome}</strong>
                      <span>{m.descricao}</span>
                      <span className="text-muted-foreground">por {rotuloCanais(m)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p>Encargos do título vencido (padrão do módulo, até os contratos terem condições próprias): multa de <strong>{multaPct}%</strong> mais juros de <strong>{jurosMesPct}% ao mês</strong>, por dia de atraso. O valor definitivo é o do contrato de cada cliente.</p>
            <p>Título com <strong>promessa de pagamento</strong> pausa a régua até a data prometida. Cedido, contestado, em renegociação ou no jurídico ficam fora da régua automática.</p>
            {podeEditar ? (
              <div className="flex flex-wrap gap-4">
                <Campo rotulo="Régua vale para vencimentos desde" dica="Vazio desliga a régua. Data antiga demais abre muitas tarefas de uma vez (a trava barra).">
                  <Input type="date" className="w-44" value={regua} onChange={(e) => setRegua(e.target.value)} />
                </Campo>
                <Campo rotulo="Trava de segurança (cobranças por rodada)" dica="Passou disso numa rodada, nenhuma é aberta.">
                  <Input inputMode="numeric" className={num} value={trava} onChange={(e) => setTrava(e.target.value)} />
                </Campo>
              </div>
            ) : (
              <p className="text-muted-foreground">Trava de segurança: se uma rodada tentar abrir mais de {trava} cobranças de uma vez, nada é aberto (algo está errado na configuração).</p>
            )}
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
        <div className="space-y-3">
          {confirmando && aCancelar > 0 && (
            <div role="alert" className="rounded-[3px] border border-marca bg-marca-clara p-3 text-sm">
              Salvar vai <strong>cancelar {aCancelar} {aCancelar === 1 ? "pendência aberta" : "pendências abertas"}</strong> de {removidos.filter((m) => (abertasPorMarco[m.dias] ?? 0) > 0).map((m) => m.nome).join(", ")}, porque
              {removidos.length === 1 ? " esse marco saiu" : " esses marcos saíram"} da régua (ou mudou o número de dias). O histórico fica. Clique de novo em “Confirmar e salvar” para seguir.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={salvar} disabled={pendente}>{pendente ? "Salvando…" : confirmando ? "Confirmar e salvar" : "Salvar regra"}</Button>
            <Button variant="outline" onClick={restaurarPadroes} disabled={pendente}>Restaurar valores padrão</Button>
            <span className="text-[12px] text-muted-foreground">Vale a partir da próxima sincronização e da próxima abertura de tela. O sistema continua sem enviar nada ao cliente.</span>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">Para alterar estas regras, fale com um gestor do Financeiro ou o administrador.</p>
      )}
      {ultimaAlteracao && <p className="text-[12px] text-muted-foreground">Última alteração: {ultimaAlteracao}.</p>}
    </div>
  );
}
