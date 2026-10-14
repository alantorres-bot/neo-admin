import type { Metadata } from "next";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerEmpresas, lerParametros } from "../dados";
import { FormParametros } from "./form-parametros";

export const metadata: Metadata = { title: "Vale-transporte — parâmetros" };

export default async function PaginaParametros() {
  const sessao = await exigirSessao();
  const ehGestor = temAcesso(sessao.acesso, "rh", "gestor");
  const supabase = await criarClienteServidor();
  const [parametros, empresas] = await Promise.all([lerParametros(supabase), lerEmpresas(supabase)]);
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-base font-bold">Título no Consistem</h2>
        <p className="text-sm text-muted-foreground">
          Um título por colaborador no mês aprovado: fornecedor = Nº, valor do mês, vencimento no dia do pagamento, documento “VT” + mês/ano, complemento
          “VALE TRANSPORTE &lt;MÊS&gt;/&lt;ANO&gt; - &lt;forma&gt;”. Os códigos abaixo valem para todos. {ehGestor ? "" : "Só o gestor do RH altera."}
        </p>
      </div>
      <FormParametros inicial={parametros.bruto} ligado={parametros.ligado} empresas={empresas} editavel={ehGestor} />
    </div>
  );
}
