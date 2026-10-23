"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseReais } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import {
  aprovarVencimento, confirmarAdiantamento, confirmarConsignacao, consultarTitulos, descartar, devolverProposta, escolherTitulo,
  informarDados, lerGmailAgora, marcarProtestado, mesclar, previaProtestado, proporVencimento, registrarNf, retomar, type CandidatoTela, type Resultado,
} from "./acoes";

const SELECT = "h-9 rounded-md border bg-background px-2 text-sm";

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

export function BotaoLerGmail() {
  const { erro, pendente, executar } = useAcao();
  return (
    <div className="flex items-center gap-2">
      {erro && <p role="alert" className="max-w-md text-xs text-destructive">{erro}</p>}
      <Button size="sm" variant="outline" disabled={pendente} onClick={() => executar(lerGmailAgora)}>{pendente ? "Lendo…" : "Ler o Gmail agora"}</Button>
    </div>
  );
}

/** Botão de um clique (sem texto). */
export function BotaoAcao({ id, acao, rotulo, variante = "default" }: { id: string; acao: "propor" | "retomar"; rotulo: string; variante?: "default" | "outline" }) {
  const { erro, pendente, executar } = useAcao();
  return (
    <div className="space-y-1">
      <Button variant={variante} disabled={pendente} onClick={() => executar(() => (acao === "propor" ? proporVencimento(id) : retomar(id)))}>{pendente ? "Enviando…" : rotulo}</Button>
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    </div>
  );
}

type AcaoTexto = "devolver" | "descartar" | "adiantamento" | "nf" | "consignacao";
const ACOES_TEXTO: Record<AcaoTexto, { f: (id: string, t: string) => Promise<Resultado>; campo: string; obrigatorio: boolean; confirmacao?: string }> = {
  devolver: { f: devolverProposta, campo: "Motivo da devolução", obrigatorio: true },
  descartar: { f: descartar, campo: "Motivo do descarte", obrigatorio: true },
  adiantamento: { f: confirmarAdiantamento, campo: "Código do lançamento no Consistem (opcional)", obrigatorio: false,
    confirmacao: "Confirmo que lancei o adiantamento à mão na tela do Consistem, com o valor exato das custas." },
  nf: { f: registrarNf, campo: "Número da NF de serviço do cartório", obrigatorio: true },
  consignacao: { f: confirmarConsignacao, campo: "Referência da consignação no Consistem (opcional)", obrigatorio: false,
    confirmacao: "Confirmo que consignei (abati) o adiantamento no Consistem." },
};

/** Ação com diálogo: um campo de texto e, quando a etapa exige, uma confirmação explícita da pessoa. */
export function AcaoComTexto({ id, acao, rotulo, titulo, descricao, variante = "default" }: { id: string; acao: AcaoTexto; rotulo: string; titulo: string; descricao: string; variante?: "default" | "outline" | "destructive" }) {
  const cfg = ACOES_TEXTO[acao];
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const { erro, pendente, executar } = useAcao();
  const pronto = (!cfg.obrigatorio || texto.trim().length > 0) && (!cfg.confirmacao || confirmado);
  return (
    <>
      <Button variant={variante} onClick={() => { setTexto(""); setConfirmado(false); setAberto(true); }}>{rotulo}</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{titulo}</DialogTitle>
              <DialogDescription>{descricao}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor={`int-${acao}-${id}`} className="text-sm font-medium">{cfg.campo}</label>
                <Input id={`int-${acao}-${id}`} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={acao === "devolver" || acao === "descartar" ? 300 : 50} />
              </div>
              {cfg.confirmacao && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={confirmado} onCheckedChange={(v) => setConfirmado(v === true)} />
                  <span>{cfg.confirmacao}</span>
                </label>
              )}
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button disabled={pendente || !pronto} onClick={() => executar(() => cfg.f(id, texto), () => setAberto(false))}>{pendente ? "Salvando…" : "Confirmar"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

type DadosForm = {
  empresaId: string | null; credorDocumento: string | null; credorNome: string | null; numeroTitulo: string | null; valorTitulo: number | null;
  vencimentoTitulo: string | null; dataLimite: string | null; valorCustas: number | null;
};
const reais = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));

/** Dados da intimação: vêm do portal do 4º Ofício e da CENPROT; a pessoa confere e corrige o que precisar. */
export function FormDados({ id, inicial, empresas, editavel }: { id: string; inicial: DadosForm; empresas: { id: string; nome_curto: string }[]; editavel: boolean }) {
  const [d, setD] = useState({
    empresaId: inicial.empresaId ?? (empresas.length === 1 ? empresas[0].id : ""), credorDocumento: inicial.credorDocumento ?? "",
    credorNome: inicial.credorNome ?? "", numeroTitulo: inicial.numeroTitulo ?? "", valorTitulo: reais(inicial.valorTitulo),
    vencimentoTitulo: inicial.vencimentoTitulo ?? "", dataLimite: inicial.dataLimite ?? "", valorCustas: reais(inicial.valorCustas),
  });
  const { erro, pendente, executar } = useAcao();
  const campo = (k: keyof typeof d) => ({ id: `int-${k}`, value: d[k], disabled: !editavel || pendente, onChange: (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value }) });

  function salvar() {
    const valor = d.valorTitulo.trim() ? parseReais(d.valorTitulo) : null;
    const custas = d.valorCustas.trim() ? parseReais(d.valorCustas) : null;
    if (d.valorTitulo.trim() && !valor) return executar(async () => ({ ok: false, erro: "Valor do título inválido (ex.: 12.367,00)." }));
    if (d.valorCustas.trim() && !custas) return executar(async () => ({ ok: false, erro: "Valor das custas inválido (ex.: 45,90)." }));
    executar(() => informarDados({
      id, empresaId: d.empresaId, credorDocumento: d.credorDocumento, credorNome: d.credorNome, numeroTitulo: d.numeroTitulo,
      valorTituloCentavos: valor, vencimentoTitulo: d.vencimentoTitulo || null, dataLimite: d.dataLimite || null, valorCustasCentavos: custas,
    }));
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <label htmlFor="int-empresaId" className="text-sm font-medium">Empresa devedora</label>
        <select className={SELECT} {...campo("empresaId")}>
          <option value="">Escolha…</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome_curto}</option>)}
        </select>
      </div>
      <div className="grid gap-1.5"><label htmlFor="int-credorDocumento" className="text-sm font-medium">CNPJ/CPF do credor</label><Input {...campo("credorDocumento")} maxLength={18} /></div>
      <div className="grid gap-1.5"><label htmlFor="int-credorNome" className="text-sm font-medium">Credor</label><Input {...campo("credorNome")} maxLength={200} /></div>
      <div className="grid gap-1.5"><label htmlFor="int-numeroTitulo" className="text-sm font-medium">Número do título</label><Input {...campo("numeroTitulo")} maxLength={50} /></div>
      <div className="grid gap-1.5"><label htmlFor="int-valorTitulo" className="text-sm font-medium">Valor do título (R$)</label><Input {...campo("valorTitulo")} inputMode="decimal" /></div>
      <div className="grid gap-1.5"><label htmlFor="int-vencimentoTitulo" className="text-sm font-medium">Vencimento do título</label><Input type="date" {...campo("vencimentoTitulo")} /></div>
      <div className="grid gap-1.5"><label htmlFor="int-dataLimite" className="text-sm font-medium">Data limite para pagamento (da intimação)</label><Input type="date" {...campo("dataLimite")} /></div>
      <div className="grid gap-1.5"><label htmlFor="int-valorCustas" className="text-sm font-medium">Custas do cartório (R$; do portal = total − saldo)</label><Input {...campo("valorCustas")} inputMode="decimal" /></div>
      {editavel && (
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button disabled={pendente} onClick={salvar}>{pendente ? "Salvando…" : "Salvar dados"}</Button>
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        </div>
      )}
    </div>
  );
}

/** Consulta (só leitura) os títulos do credor no Consistem e escolhe um. */
export function ConsultaTitulos({ id }: { id: string }) {
  const [candidatos, setCandidatos] = useState<CandidatoTela[] | null>(null);
  const [sugerido, setSugerido] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroConsulta, setErroConsulta] = useState<string>();
  const [consultando, iniciar] = useTransition();
  const { erro, pendente, executar } = useAcao();

  function consultar() {
    setErroConsulta(undefined);
    iniciar(async () => {
      const r = await consultarTitulos(id);
      if (!r.ok) { setErroConsulta(r.erro); return; }
      setCandidatos(r.candidatos);
      setSugerido(r.sugerido);
      setAviso(r.aviso);
    });
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={consultando} onClick={consultar}>{consultando ? "Consultando o Consistem…" : "Procurar o título no Consistem"}</Button>
      {erroConsulta && <p role="alert" className="text-sm text-destructive">{erroConsulta}</p>}
      {aviso && <p className="text-sm text-amber-700">{aviso}</p>}
      {candidatos && candidatos.length === 0 && !aviso && <p className="text-sm text-muted-foreground">Nenhum título em aberto do credor com esse número ou valor.</p>}
      {candidatos && candidatos.length > 0 && (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lançamento</TableHead><TableHead>Documento</TableHead><TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Saldo</TableHead><TableHead>Confere</TableHead><TableHead>Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidatos.map((c) => (
                <TableRow key={c.codLancamento}>
                  <TableCell>{c.codLancamento}{c.codLancamento === sugerido ? " (sugerido)" : ""}</TableCell>
                  <TableCell>{c.numDocumento}</TableCell>
                  <TableCell>{formatarData(c.vencimento)}</TableCell>
                  <TableCell className="text-right">{formatarMoeda(c.valorCentavos)}</TableCell>
                  <TableCell className="text-right">{formatarMoeda(c.saldoCentavos)}</TableCell>
                  <TableCell>{[c.numeroConfere && "número", c.valorConfere && "valor"].filter(Boolean).join(" e ") || "—"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant={c.codLancamento === sugerido ? "default" : "outline"} disabled={pendente}
                      onClick={() => executar(() => escolherTitulo({ id, titulo: { codLancamento: c.codLancamento, numDocumento: c.numDocumento, vencimento: c.vencimento, valorCentavos: c.valorCentavos, saldoCentavos: c.saldoCentavos } }))}>
                      É este
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    </div>
  );
}

/** Aprovação do gestor: mostra exatamente o que será enviado (só a data) antes de alterar no Consistem. */
export function AprovarVencimento({ id, codLancamento, vencimentoAtual, novaData, valorCentavos }: { id: string; codLancamento: string; vencimentoAtual: string | null; novaData: string; valorCentavos: number | null }) {
  const [aberto, setAberto] = useState(false);
  const { erro, pendente, executar } = useAcao();
  return (
    <>
      <Button onClick={() => setAberto(true)}>Aprovar e alterar no Consistem</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v && !pendente) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Alterar o vencimento no Consistem</DialogTitle>
              <DialogDescription>
                Título {codLancamento}: vencimento {formatarData(vencimentoAtual) || "atual"} → <strong>{formatarData(novaData)}</strong>.
                Só a data muda{valorCentavos === null ? "" : `; o valor (${formatarMoeda(valorCentavos)}) continua o mesmo`}. O Neo Admin lê o título de novo e confere.
              </DialogDescription>
            </DialogHeader>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
              <Button disabled={pendente} onClick={() => executar(() => aprovarVencimento(id), () => setAberto(false))}>{pendente ? "Alterando…" : "Aprovar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Título protestado: lê a prévia no Consistem (complemento atual → "PROTESTADO - VENC ORIG …") e o gestor aprova. */
export function MarcarProtestado({ id }: { id: string }) {
  const [previa, setPrevia] = useState<{ codLancamento: string; complementoAtual: string; complementoNovo: string } | null>(null);
  const [erroPrevia, setErroPrevia] = useState<string>();
  const [lendo, iniciar] = useTransition();
  const { erro, pendente, executar } = useAcao();

  function abrir() {
    setErroPrevia(undefined);
    iniciar(async () => {
      const r = await previaProtestado(id);
      if (r.ok) setPrevia(r);
      else setErroPrevia(r.erro);
    });
  }

  return (
    <div className="space-y-1">
      <Button variant="destructive" disabled={lendo} onClick={abrir}>{lendo ? "Lendo o título no Consistem…" : "Marcar como PROTESTADO no Consistem"}</Button>
      {erroPrevia && <p role="alert" className="text-sm text-destructive">{erroPrevia}</p>}
      {previa && (
        <Dialog open onOpenChange={(v) => { if (!v && !pendente) setPrevia(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Marcar o título {previa.codLancamento} como protestado</DialogTitle>
              <DialogDescription>Só o complemento muda; vencimento e valor continuam os mesmos. O Neo Admin lê o título de novo e confere.</DialogDescription>
            </DialogHeader>
            <dl className="grid gap-1 text-sm">
              <dt className="font-medium">Complemento atual</dt><dd className="break-words">{previa.complementoAtual || "(vazio)"}</dd>
              <dt className="font-medium">Complemento novo</dt><dd className="font-semibold">{previa.complementoNovo}</dd>
            </dl>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPrevia(null)} disabled={pendente}>Voltar</Button>
              <Button disabled={pendente} onClick={() => executar(() => marcarProtestado(id, previa.complementoNovo), () => setPrevia(null))}>{pendente ? "Alterando…" : "Aprovar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Junta a intimação do 4º Ofício (só localizador) a um apontamento da CENPROT do mesmo protesto. */
export function JuntarAoApontamento({ id, opcoes }: { id: string; opcoes: { id: string; protocolo: string | null; credor_nome: string | null; numero_titulo: string | null }[] }) {
  const [destino, setDestino] = useState("");
  const { erro, pendente, executar } = useAcao();
  if (opcoes.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Apontamento da CENPROT" className={SELECT} value={destino} onChange={(e) => setDestino(e.target.value)} disabled={pendente}>
        <option value="">Juntar a um apontamento da CENPROT…</option>
        {opcoes.map((o) => <option key={o.id} value={o.id}>{`Protocolo ${o.protocolo ?? "?"} · ${o.credor_nome ?? ""} · ${o.numero_titulo ?? ""}`}</option>)}
      </select>
      <Button variant="outline" disabled={!destino || pendente} onClick={() => executar(() => mesclar(id, destino))}>Juntar</Button>
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    </div>
  );
}
