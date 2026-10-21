"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { lerCsv } from "@/lib/integracoes/importador/ler-arquivo";
import { lerDepartamentos } from "@/lib/modulos/rh/banco-horas/departamentos";
import { aplicarDepartamentos } from "../acoes";

/** Lê o cadastro de funcionários do Control iD no navegador e manda só CPF + Departamento (o resto do arquivo é sensível). */
export function ImportarDepartamentos() {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [pendente, iniciar] = useTransition();
  const ler = (f: File) => iniciar(async () => {
    const [p] = lerCsv(await f.arrayBuffer(), { delimitador: ";" });
    const r = lerDepartamentos(p.matriz);
    if (entrada.current) entrada.current.value = "";
    if (r.erro) { toast.error(r.erro); return; }
    const x = await aplicarDepartamentos(r.itens);
    if (!x.ok) toast.error(x.erro); else { toast.success(x.aviso ?? "Setores atualizados.", { duration: 12000 }); router.refresh(); }
  });
  return (
    <>
      <input ref={entrada} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Cadastro de funcionários do Control iD"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); }} />
      <Button variant="outline" disabled={pendente} onClick={() => entrada.current?.click()}>
        <Users /> {pendente ? "Aplicando…" : "Setores pelo cadastro"}
      </Button>
    </>
  );
}
