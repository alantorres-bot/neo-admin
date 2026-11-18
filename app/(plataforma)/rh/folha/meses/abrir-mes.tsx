"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { competenciaDoDecimo, pagamentoDe, ROTA_FOLHA, ROTULO_TIPO_FOLHA, TIPOS_FOLHA, type TipoFolha } from "@/lib/modulos/rh/folha/modulo";
import { abrirMes } from "../mes/acoes";

const data = (iso: string) => iso.split("-").reverse().join("/");

/** Abre a folha de um mês, ou a do 13º (1ª/2ª parcela) do ano, com todos os colaboradores ativos (valores zerados, para lançar). */
export function AbrirMesFolha({ sugestao }: { sugestao: string | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [mes, setMes] = useState(sugestao ?? "");
  const [tipo, setTipo] = useState<TipoFolha>("mensal");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const valido = tipo === "mensal" ? /^\d{4}-\d{2}$/.test(mes) : /^\d{4}$/.test(ano);
  const competencia = !valido ? "" : tipo === "mensal" ? `${mes}-01` : competenciaDoDecimo(Number(ano), tipo);

  const confirmar = () => iniciar(async () => {
    const r = await abrirMes(competencia.slice(0, 7), tipo);
    if (!r.ok) { setErro(r.erro); return; }
    toast.success(`Folha aberta com os colaboradores ativos.${r.aviso ? ` ${r.aviso}` : ""}`);
    setAberto(false);
    router.push(`${ROTA_FOLHA}/mes/${r.id}`);
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); setErro(undefined); }}>
      <DialogTrigger render={<Button />}><CalendarPlus /> Abrir mês</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abrir uma folha</DialogTitle>
          <DialogDescription>Entram todos os colaboradores ativos do cadastro, com os dados de hoje e os valores zerados.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="tipoFolha">Folha</Label>
          <select id="tipoFolha" value={tipo} onChange={(e) => setTipo(e.target.value as TipoFolha)} className="h-8 rounded-[3px] border border-input bg-white px-2 text-sm">
            {TIPOS_FOLHA.map((t) => <option key={t} value={t}>{t === "mensal" ? "Mensal (salários)" : ROTULO_TIPO_FOLHA[t]}</option>)}
          </select>
        </div>
        {tipo === "mensal" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="mesFolha">Mês da folha</Label>
            <Input id="mesFolha" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="anoFolha">Ano</Label>
            <Input id="anoFolha" inputMode="numeric" maxLength={4} value={ano} onChange={(e) => setAno(e.target.value)} />
          </div>
        )}
        {valido && (
          <p className="text-sm text-muted-foreground">
            Pagamento até {data(pagamentoDe(competencia, tipo))} ({tipo === "mensal" ? "5º dia útil do mês seguinte" : `último dia útil até ${tipo === "decimo_1" ? "30/11" : "20/12"}`}; feriados não contados).
          </p>
        )}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end"><Button onClick={confirmar} disabled={pendente || !valido}>{pendente ? "Abrindo…" : "Abrir"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
