"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseReais } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { ROTA_PARCELAMENTOS, ROTULO_SITUACAO, SITUACOES } from "@/lib/modulos/financeiro/parcelamentos/parcelamentos";
import {
  adicionarParcela, classificarManual, desvincularLancamento, devolverAsRegras, reprocessar, salvarParcelamento, salvarRegra, sincronizar,
  vincularChave, vincularLancamento, type DadosParcelamento, type Resultado,
} from "./acoes";

const SELECT = "h-9 w-full rounded-md border bg-background px-2 text-sm";
type Opcao = { codigo: string; nome: string };
type ParcelamentoOpcao = { id: string; descricao: string; empresa_id: string };

const ABAS = [
  { rota: ROTA_PARCELAMENTOS, nome: "Parcelamentos" },
  { rota: `${ROTA_PARCELAMENTOS}/parcelas`, nome: "Parcelas" },
  { rota: `${ROTA_PARCELAMENTOS}/classificacao`, nome: "Classificação" },
  { rota: `${ROTA_PARCELAMENTOS}/regras`, nome: "Regras e sincronização" },
];

export function AbasParcelamentos() {
  const atual = usePathname();
  const ativa = (r: string) => (r === ROTA_PARCELAMENTOS ? atual === r || /^\/financeiro\/parcelamentos\/[0-9a-f-]{36}$/.test(atual) : atual.startsWith(r));
  return (
    <nav aria-label="Seções" className="flex flex-wrap gap-1 border-b pb-2">
      {ABAS.map((a) => (
        <Button key={a.rota} size="sm" variant={ativa(a.rota) ? "default" : "ghost"} nativeButton={false} render={<Link href={a.rota} />}>{a.nome}</Button>
      ))}
    </nav>
  );
}

function useAcao() {
  const router = useRouter();
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const executar = (f: () => Promise<Resultado>, aoTerminar?: () => void) => {
    setErro(undefined);
    iniciar(async () => {
      const r = await f();
      if (r.ok) {
        toast.success(r.aviso);
        aoTerminar?.();
        router.refresh();
      } else setErro(r.erro);
    });
  };
  return { erro, pendente, executar };
}

/** Botão de um clique; o erro aparece ao lado. */
export function BotaoSimples({ acao, rotulo, pendenteRotulo, variante = "outline" }: { acao: "sincronizar" | "reprocessar"; rotulo: string; pendenteRotulo: string; variante?: "default" | "outline" }) {
  const { erro, pendente, executar } = useAcao();
  return (
    <div className="flex items-center gap-2">
      {erro && <p role="alert" className="max-w-md text-xs text-destructive">{erro}</p>}
      <Button size="sm" variant={variante} disabled={pendente} onClick={() => executar(acao === "sincronizar" ? sincronizar : reprocessar)}>{pendente ? pendenteRotulo : rotulo}</Button>
    </div>
  );
}

function Campo({ id, rotulo, children, dica }: { id: string; rotulo: string; children: ReactNode; dica?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{rotulo}</label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

function Rodape({ erro, pendente, pronto, fechar, salvar, rotulo = "Salvar" }: { erro?: string; pendente: boolean; pronto: boolean; fechar: () => void; salvar: () => void; rotulo?: string }) {
  return (
    <>
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={fechar} disabled={pendente}>Voltar</Button>
        <Button disabled={pendente || !pronto} onClick={salvar}>{pendente ? "Salvando…" : rotulo}</Button>
      </div>
    </>
  );
}

function Janela({ titulo, descricao, aberto, fechar, largura = "sm:max-w-lg", children }: { titulo: string; descricao: string; aberto: boolean; fechar: () => void; largura?: string; children: ReactNode }) {
  if (!aberto) return null;
  return (
    <Dialog open onOpenChange={(v) => { if (!v) fechar(); }}>
      <DialogContent className={`max-h-[90vh] overflow-y-auto ${largura}`}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

const reaisParaCentavos = (s: string): number | null => (s.trim() === "" ? null : parseReais(s));
const centavosParaTexto = (c: number | null | undefined) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
const numeroOuNulo = (s: string) => (s.trim() === "" ? null : Number(s));

// ------------------------------------------------------------------ parcelamento
export type ParcelamentoInicial = Partial<Omit<DadosParcelamento, "valorOriginalCentavos">> & { valorOriginalCentavos?: number | null };

/** Criar (manual ou a partir de uma sugestão do ERP, com chaveErp) ou editar um parcelamento. Gestor. */
export function FormParcelamento({ inicial, naturezas, empresas, rotulo, titulo, variante = "default" }: {
  inicial: ParcelamentoInicial; naturezas: Opcao[]; empresas: Opcao[]; rotulo: string; titulo: string; variante?: "default" | "outline";
}) {
  const [aberto, setAberto] = useState(false);
  const [d, setD] = useState<ParcelamentoInicial>(inicial);
  const [valor, setValor] = useState(centavosParaTexto(inicial.valorOriginalCentavos));
  const { erro, pendente, executar } = useAcao();
  const mudar = (campo: keyof ParcelamentoInicial) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [campo]: e.target.value }));
  const editando = !!inicial.id;
  const id = (c: string) => `par-${c}-${inicial.id ?? inicial.chaveErp ?? "novo"}`;
  const salvar = () => executar(() => salvarParcelamento({
    ...(d as DadosParcelamento), id: inicial.id ?? null,
    valorOriginalCentavos: reaisParaCentavos(valor),
    qtdParcelas: numeroOuNulo(String(d.qtdParcelas ?? "")), diaVencimento: numeroOuNulo(String(d.diaVencimento ?? "")),
  }), () => setAberto(false));
  return (
    <>
      <Button size="sm" variant={variante} onClick={() => { setD(inicial); setValor(centavosParaTexto(inicial.valorOriginalCentavos)); setAberto(true); }}>{rotulo}</Button>
      <Janela titulo={titulo} aberto={aberto} fechar={() => setAberto(false)} largura="sm:max-w-2xl"
        descricao={inicial.chaveErp ? `As parcelas do Consistem com a chave ${inicial.chaveErp} entram neste parcelamento.` : "Obrigação parcelada. Os campos do processo são opcionais."}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id={id("empresa")} rotulo="Empresa">
            <select id={id("empresa")} className={SELECT} value={d.empresaId ?? ""} onChange={mudar("empresaId")} disabled={editando || !!inicial.chaveErp}>
              <option value="">Escolha…</option>
              {empresas.map((e) => <option key={e.codigo} value={e.codigo}>{e.nome}</option>)}
            </select>
          </Campo>
          <Campo id={id("natureza")} rotulo="Natureza">
            <select id={id("natureza")} className={SELECT} value={d.natureza ?? ""} onChange={mudar("natureza")}>
              <option value="">Escolha…</option>
              {naturezas.map((n) => <option key={n.codigo} value={n.codigo}>{n.nome}</option>)}
            </select>
          </Campo>
          <div className="sm:col-span-2">
            <Campo id={id("descricao")} rotulo="Descrição"><Input id={id("descricao")} value={d.descricao ?? ""} onChange={mudar("descricao")} maxLength={200} /></Campo>
          </div>
          <Campo id={id("credor")} rotulo="Ente / credor"><Input id={id("credor")} value={d.credor ?? ""} onChange={mudar("credor")} maxLength={120} /></Campo>
          <Campo id={id("devedor")} rotulo="Devedor" dica="Quem deve (ex.: Oeste Formas), quando não é a própria empresa.">
            <Input id={id("devedor")} value={d.devedor ?? ""} onChange={mudar("devedor")} maxLength={120} />
          </Campo>
          <Campo id={id("numero")} rotulo="Nº do parcelamento"><Input id={id("numero")} value={d.numero ?? ""} onChange={mudar("numero")} maxLength={60} /></Campo>
          <Campo id={id("processo")} rotulo="Processo administrativo"><Input id={id("processo")} value={d.processo ?? ""} onChange={mudar("processo")} maxLength={60} /></Campo>
          <Campo id={id("cda")} rotulo="CDA"><Input id={id("cda")} value={d.cda ?? ""} onChange={mudar("cda")} maxLength={60} /></Campo>
          <Campo id={id("inscricao")} rotulo="Inscrição"><Input id={id("inscricao")} value={d.inscricao ?? ""} onChange={mudar("inscricao")} maxLength={60} /></Campo>
          <div className="sm:col-span-2">
            <Campo id={id("referencia")} rotulo="Referência do débito"><Input id={id("referencia")} value={d.referenciaDebito ?? ""} onChange={mudar("referenciaDebito")} maxLength={200} /></Campo>
          </div>
          <Campo id={id("adesao")} rotulo="Data de adesão"><Input id={id("adesao")} type="date" value={d.dataAdesao ?? ""} onChange={mudar("dataAdesao")} /></Campo>
          <Campo id={id("valor")} rotulo="Valor original (R$)"><Input id={id("valor")} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></Campo>
          <Campo id={id("qtd")} rotulo="Quantidade de parcelas"><Input id={id("qtd")} inputMode="numeric" value={String(d.qtdParcelas ?? "")} onChange={mudar("qtdParcelas")} /></Campo>
          <Campo id={id("dia")} rotulo="Dia do vencimento"><Input id={id("dia")} inputMode="numeric" value={String(d.diaVencimento ?? "")} onChange={mudar("diaVencimento")} /></Campo>
          {editando && (
            <Campo id={id("situacao")} rotulo="Situação">
              <select id={id("situacao")} className={SELECT} value={d.situacao ?? "ativo"} onChange={mudar("situacao")}>
                {SITUACOES.map((s) => <option key={s} value={s}>{ROTULO_SITUACAO[s]}</option>)}
              </select>
            </Campo>
          )}
          <div className="sm:col-span-2">
            <Campo id={id("obs")} rotulo="Observações"><Textarea id={id("obs")} value={d.observacoes ?? ""} onChange={mudar("observacoes")} maxLength={2000} /></Campo>
          </div>
        </div>
        <Rodape erro={erro} pendente={pendente} pronto={!!d.empresaId && !!d.natureza && (d.descricao ?? "").trim().length >= 3} fechar={() => setAberto(false)} salvar={salvar} />
      </Janela>
    </>
  );
}

/** Parcela manual (obrigação que não está no ERP). Gestor. */
export function FormParcela({ parcelamentoId }: { parcelamentoId: string }) {
  const [aberto, setAberto] = useState(false);
  const [competencia, setCompetencia] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const { erro, pendente, executar } = useAcao();
  const comp = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(competencia.trim());
  const centavos = reaisParaCentavos(valor);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setCompetencia(""); setVencimento(""); setValor(""); setObs(""); setAberto(true); }}>Incluir parcela manual</Button>
      <Janela titulo="Parcela manual" aberto={aberto} fechar={() => setAberto(false)}
        descricao="Só para parcela que não está no Consistem. Se depois ela aparecer lá, vincule o lançamento a esta parcela (não vira duas).">
        <Campo id="par-comp" rotulo="Competência (mm/aaaa)"><Input id="par-comp" value={competencia} onChange={(e) => setCompetencia(e.target.value)} placeholder="12/2026" /></Campo>
        <Campo id="par-venc" rotulo="Vencimento"><Input id="par-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></Campo>
        <Campo id="par-valor" rotulo="Valor (R$)"><Input id="par-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></Campo>
        <Campo id="par-obs" rotulo="Observações"><Input id="par-obs" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} /></Campo>
        <Rodape erro={erro} pendente={pendente} pronto={!!comp && !!vencimento && (centavos ?? 0) > 0} fechar={() => setAberto(false)}
          salvar={() => executar(() => adicionarParcela({ parcelamentoId, competencia: comp ? `${comp[2]}-${comp[1]}` : "", vencimento, valorCentavos: centavos ?? 0, observacoes: obs }), () => setAberto(false))} />
      </Janela>
    </>
  );
}

// ------------------------------------------------------------------ classificação e vínculo
/** Classificar à mão: é parcelamento (com a natureza) ou não é. Operador. */
export function ClassificarLancamento({ id, naturezas, rotulo = "Classificar" }: { id: string; naturezas: Opcao[]; rotulo?: string }) {
  const [aberto, setAberto] = useState(false);
  const [natureza, setNatureza] = useState("");
  const [motivo, setMotivo] = useState("");
  const { erro, pendente, executar } = useAcao();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setNatureza(""); setMotivo(""); setAberto(true); }}>{rotulo}</Button>
      <Janela titulo="Classificar lançamento" aberto={aberto} fechar={() => setAberto(false)}
        descricao="A classificação manual vale sobre as regras até alguém devolvê-la às regras.">
        <Campo id={`cl-nat-${id}`} rotulo="É parcelamento?">
          <select id={`cl-nat-${id}`} className={SELECT} value={natureza} onChange={(e) => setNatureza(e.target.value)}>
            <option value="">Escolha…</option>
            {naturezas.map((n) => <option key={n.codigo} value={n.codigo}>Sim — {n.nome}</option>)}
            <option value="-">Não é parcelamento</option>
          </select>
        </Campo>
        <Campo id={`cl-mot-${id}`} rotulo="Motivo"><Input id={`cl-mot-${id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} /></Campo>
        <Rodape erro={erro} pendente={pendente} pronto={!!natureza && motivo.trim().length >= 3} fechar={() => setAberto(false)}
          salvar={() => executar(() => classificarManual(id, natureza === "-" ? null : natureza, motivo), () => setAberto(false))} />
      </Janela>
    </>
  );
}

export function BotaoDevolver({ id }: { id: string }) {
  const { erro, pendente, executar } = useAcao();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pendente} onClick={() => executar(() => devolverAsRegras(id))}>{pendente ? "…" : "Devolver às regras"}</Button>
      {erro && <span role="alert" className="text-xs text-destructive">{erro}</span>}
    </span>
  );
}

/** Vincular um lançamento (ou todos de uma chave) a um parcelamento existente da mesma empresa. Operador. */
export function Vincular({ empresaId, lancamentoId, chave, parcelamentos, rotulo }: {
  empresaId: string; lancamentoId?: string; chave?: string; parcelamentos: ParcelamentoOpcao[]; rotulo: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [alvo, setAlvo] = useState("");
  const { erro, pendente, executar } = useAcao();
  const opcoes = parcelamentos.filter((p) => p.empresa_id === empresaId);
  const chaveId = (lancamentoId ?? chave ?? "").replace(/[^a-z0-9]/gi, "");
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setAlvo(""); setAberto(true); }} disabled={opcoes.length === 0}>{rotulo}</Button>
      <Janela titulo={rotulo} aberto={aberto} fechar={() => setAberto(false)}
        descricao={chave ? `Todos os lançamentos sem parcela da chave ${chave} entram no parcelamento escolhido.` : "Se o parcelamento já tem parcela manual nesta competência, o lançamento se junta a ela."}>
        <Campo id={`vin-${chaveId}`} rotulo="Parcelamento">
          <select id={`vin-${chaveId}`} className={SELECT} value={alvo} onChange={(e) => setAlvo(e.target.value)}>
            <option value="">Escolha…</option>
            {opcoes.map((p) => <option key={p.id} value={p.id}>{p.descricao}</option>)}
          </select>
        </Campo>
        <Rodape erro={erro} pendente={pendente} pronto={!!alvo} fechar={() => setAberto(false)} rotulo="Vincular"
          salvar={() => executar(() => (chave ? vincularChave(empresaId, chave, alvo) : vincularLancamento(lancamentoId!, alvo)), () => setAberto(false))} />
      </Janela>
    </>
  );
}

export function Desvincular({ lancamentoId }: { lancamentoId: string }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const { erro, pendente, executar } = useAcao();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => { setMotivo(""); setAberto(true); }}>Desvincular</Button>
      <Janela titulo="Desvincular lançamento" aberto={aberto} fechar={() => setAberto(false)}
        descricao="A parcela criada só para este lançamento é cancelada (fica no histórico); o lançamento volta para a classificação pendente.">
        <Campo id={`des-${lancamentoId}`} rotulo="Motivo"><Input id={`des-${lancamentoId}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} /></Campo>
        <Rodape erro={erro} pendente={pendente} pronto={motivo.trim().length >= 3} fechar={() => setAberto(false)} rotulo="Desvincular"
          salvar={() => executar(() => desvincularLancamento(lancamentoId, motivo), () => setAberto(false))} />
      </Janela>
    </>
  );
}

// ------------------------------------------------------------------ regras
export type RegraInicial = {
  id: string | null; nome: string; empresaId: string; tipos: ("P" | "C")[]; fornecedores: string; grupo: string; conta: string; complementoContem: string;
  natureza: string; excecao: boolean; prioridade: string; ativa: boolean; observacoes: string;
};

export function FormRegra({ inicial, naturezas, empresas, rotulo, variante = "outline" }: { inicial: RegraInicial; naturezas: Opcao[]; empresas: Opcao[]; rotulo: string; variante?: "default" | "outline" | "ghost" }) {
  const [aberto, setAberto] = useState(false);
  const [r, setR] = useState(inicial);
  const { erro, pendente, executar } = useAcao();
  const mudar = (campo: keyof RegraInicial) => (e: { target: { value: string } }) => setR((x) => ({ ...x, [campo]: e.target.value }));
  const id = (c: string) => `regra-${c}-${inicial.id ?? "nova"}`;
  const alternarTipo = (t: "P" | "C", marcado: boolean) => setR((x) => ({ ...x, tipos: marcado ? [...new Set([...x.tipos, t])] : x.tipos.filter((y) => y !== t) }));
  const salvar = () => executar(() => salvarRegra({
    id: r.id, nome: r.nome, empresaId: r.empresaId, tipos: r.tipos,
    fornecedores: r.fornecedores.split(/[\s,;]+/).filter(Boolean),
    grupo: numeroOuNulo(r.grupo), conta: numeroOuNulo(r.conta), complementoContem: r.complementoContem,
    natureza: r.natureza, excecao: r.excecao, prioridade: Number(r.prioridade || 100), ativa: r.ativa, observacoes: r.observacoes,
  }), () => setAberto(false));
  return (
    <>
      <Button size="sm" variant={variante} onClick={() => { setR(inicial); setAberto(true); }}>{rotulo}</Button>
      <Janela titulo={inicial.id ? "Editar regra" : "Nova regra"} aberto={aberto} fechar={() => setAberto(false)} largura="sm:max-w-2xl"
        descricao="A regra casa quando TODOS os critérios preenchidos batem (vazio = não importa). Conta de fluxo é o par grupo/conta do Consistem. Salvar reclassifica os lançamentos que não foram classificados à mão.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Campo id={id("nome")} rotulo="Nome"><Input id={id("nome")} value={r.nome} onChange={mudar("nome")} maxLength={120} /></Campo></div>
          <Campo id={id("empresa")} rotulo="Empresa">
            <select id={id("empresa")} className={SELECT} value={r.empresaId} onChange={mudar("empresaId")}>
              <option value="">Todas</option>
              {empresas.map((e) => <option key={e.codigo} value={e.codigo}>{e.nome}</option>)}
            </select>
          </Campo>
          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">Tipo de lançamento</legend>
            <div className="flex gap-4 text-sm">
              {(["P", "C"] as const).map((t) => (
                <label key={t} className="flex items-center gap-2"><Checkbox checked={r.tipos.includes(t)} onCheckedChange={(v) => alternarTipo(t, v === true)} />{t === "P" ? "P (projeção)" : "C (guia lançada)"}</label>
              ))}
            </div>
          </fieldset>
          <Campo id={id("forn")} rotulo="Fornecedores (códigos)" dica="Ex.: 986, 475. O 917 é o código do fornecedor Parcelamentos ALUTEC.">
            <Input id={id("forn")} value={r.fornecedores} onChange={mudar("fornecedores")} />
          </Campo>
          <div className="grid grid-cols-2 gap-2">
            <Campo id={id("grupo")} rotulo="Grupo de fluxo"><Input id={id("grupo")} inputMode="numeric" value={r.grupo} onChange={mudar("grupo")} placeholder="20" /></Campo>
            <Campo id={id("conta")} rotulo="Conta de fluxo"><Input id={id("conta")} inputMode="numeric" value={r.conta} onChange={mudar("conta")} placeholder="17" /></Campo>
          </div>
          <Campo id={id("hist")} rotulo="Histórico contém"><Input id={id("hist")} value={r.complementoContem} onChange={mudar("complementoContem")} maxLength={80} /></Campo>
          <Campo id={id("prio")} rotulo="Prioridade" dica="Menor vence. Empate entre naturezas diferentes = pendente.">
            <Input id={id("prio")} inputMode="numeric" value={r.prioridade} onChange={mudar("prioridade")} />
          </Campo>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox checked={r.excecao} onCheckedChange={(v) => setR((x) => ({ ...x, excecao: v === true }))} />
            Exceção: o que casar com esta regra NÃO é parcelamento (vence as outras)
          </label>
          {!r.excecao && (
            <Campo id={id("nat")} rotulo="Natureza">
              <select id={id("nat")} className={SELECT} value={r.natureza} onChange={mudar("natureza")}>
                <option value="">Escolha…</option>
                {naturezas.map((n) => <option key={n.codigo} value={n.codigo}>{n.nome}</option>)}
              </select>
            </Campo>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={r.ativa} onCheckedChange={(v) => setR((x) => ({ ...x, ativa: v === true }))} />Ativa
          </label>
          <div className="sm:col-span-2"><Campo id={id("obs")} rotulo="Observações"><Input id={id("obs")} value={r.observacoes} onChange={mudar("observacoes")} maxLength={500} /></Campo></div>
        </div>
        <Rodape erro={erro} pendente={pendente} pronto={r.nome.trim().length >= 3} fechar={() => setAberto(false)} salvar={salvar} />
      </Janela>
    </>
  );
}
