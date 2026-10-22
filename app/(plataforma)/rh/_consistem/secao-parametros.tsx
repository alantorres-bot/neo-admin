import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerEmpresas } from "../vale_transporte/dados";
import { lerEmpregadores, lerParametrosRh } from "./dados";
import { FormParametrosLancamento } from "./formulario";

/** Seção "Títulos no Consistem" dos Parâmetros da folha e do VT (os mesmos parâmetros nas duas abas). */
export async function SecaoParametrosConsistem() {
  const sessao = await exigirSessao();
  const ehGestor = temAcesso(sessao.acesso, "rh", "gestor");
  const supabase = await criarClienteServidor();
  const [p, empregadores, empresas] = await Promise.all([lerParametrosRh(supabase), lerEmpregadores(supabase), lerEmpresas(supabase)]);
  return (
    <section className="max-w-5xl space-y-4">
      <div>
        <h2 className="text-base font-bold">Títulos no Consistem (folha e vale-transporte)</h2>
        <p className="text-sm text-muted-foreground">
          Um título por funcionário e tipo de pagamento no mês aprovado: fornecedor = Nº, vencimento no dia do pagamento, complemento “&lt;TIPO&gt; - MM/AAAA”
          (ex.: “SALÁRIO - 10/2026”). Os mesmos parâmetros valem nas abas da folha e do VT. {ehGestor ? "" : "Só o gestor do RH altera."}
        </p>
      </div>
      <FormParametrosLancamento parametros={p.parametros} vtLigado={p.vtLigado} folhaLigado={p.folhaLigado} empregadores={empregadores} empresas={empresas} editavel={ehGestor} />
    </section>
  );
}
