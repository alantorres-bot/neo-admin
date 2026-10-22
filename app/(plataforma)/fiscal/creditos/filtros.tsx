// Barra de filtros comum (GET): ano, competência, empresa, estabelecimento, tributo e situações.
import { MESES, } from "@/lib/modulos/fiscal/creditos/formatos";
import { ROTULO_STATUS_OBRIGACAO, ROTULO_VALIDACAO } from "@/lib/modulos/fiscal/creditos/modulo";
import type { Cadastros, Filtros } from "./dados";
import { FiltrosAuto, SELECT } from "./ui";

type CampoFiltro = "ano" | "mes" | "empresa" | "estab" | "tributo" | "validacao" | "status" | "busca";

export function BarraFiltros({ cad, f, campos, anos, status }: {
  cad: Cadastros; f: Filtros; campos: CampoFiltro[]; anos?: number[]; status?: Record<string, string>;
}) {
  const listaAnos = anos ?? Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 4 + i);
  const estabs = cad.estabelecimentos.filter((e) => !f.empresa || e.empresa_id === f.empresa);
  const sel = (nome: string, rotulo: string, valor: string | number | null, opcoes: [string, string][], todos = "Todos") => (
    <label className="grid gap-0.5 text-xs">
      <span className="text-muted-foreground">{rotulo}</span>
      <select name={nome} defaultValue={valor === null ? "" : String(valor)} className={`${SELECT} min-w-32`}>
        {todos && <option value="">{todos}</option>}
        {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
    </label>
  );
  return (
    <FiltrosAuto>
      {campos.includes("ano") && sel("ano", "Ano", f.ano, listaAnos.map((a) => [String(a), String(a)]), "")}
      {campos.includes("mes") && sel("mes", "Competência", f.mes, MESES.map((m, i) => [String(i + 1), `${String(i + 1).padStart(2, "0")} - ${m}`]), "Ano inteiro")}
      {campos.includes("empresa") && sel("empresa", "Empresa", f.empresa, cad.empresas.map((e) => [e.id, e.nome]), "Todas")}
      {campos.includes("estab") && sel("estab", "Estabelecimento", f.estab, estabs.map((e) => [e.id, e.nome]))}
      {campos.includes("tributo") && sel("tributo", "Tributo", f.tributo, cad.tributos.map((t) => [t.id, t.codigo]))}
      {campos.includes("validacao") && sel("validacao", "Situação do crédito", f.validacao, Object.entries(ROTULO_VALIDACAO), "Todas")}
      {campos.includes("status") && sel("status", "Situação da obrigação", f.status, Object.entries(status ?? ROTULO_STATUS_OBRIGACAO), "Todas")}
      {campos.includes("busca") && (
        <label className="grid gap-0.5 text-xs">
          <span className="text-muted-foreground">Busca</span>
          <input name="busca" defaultValue={f.busca} placeholder="Código, descrição, processo…" className={`${SELECT} min-w-52`} />
        </label>
      )}
    </FiltrosAuto>
  );
}
