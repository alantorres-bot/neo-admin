import { Input } from "@/components/ui/input";
import { gerarObrigacoes, salvarObrigacao } from "../acoes";
import type { Cadastros } from "../dados";
import { Campo, FormularioAcao, SELECT, TEXTAREA } from "../ui";

export function FormObrigacao({ cad, o }: { cad: Cadastros; o?: { id: string; vencimento: string | null; vencimento_confirmado: boolean; vencimento_fonte: string | null; responsavel_id: string | null; contador_responsavel: string | null; observacoes: string | null } }) {
  return (
    <FormularioAcao titulo={o ? "Editar obrigação" : "Nova obrigação"} botao={o ? "Editar" : "Nova obrigação"} variante={o ? "outline" : "default"} acao={salvarObrigacao} ocultos={o ? { id: o.id } : {}} larga
      descricao="O sistema não presume prazos: sem regra validada, o vencimento fica 'a confirmar'. Confirmar o vencimento exige revisor/contador e a fonte.">
      <div className="grid gap-3 sm:grid-cols-2">
        {!o && (
          <>
            <Campo rotulo="Obrigação *" htmlFor="ob-tipo">
              <select id="ob-tipo" name="tipo_id" required className={SELECT} defaultValue=""><option value="" disabled>Escolha…</option>{cad.tiposObrigacao.filter((t) => t.ativo).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select>
            </Campo>
            <Campo rotulo="Estabelecimento *" htmlFor="ob-est">
              <select id="ob-est" name="estabelecimento_id" required className={SELECT} defaultValue=""><option value="" disabled>Escolha…</option>{cad.estabelecimentos.filter((e) => e.ativo).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
            </Campo>
            <Campo rotulo="Competência *" htmlFor="ob-comp"><Input id="ob-comp" name="competencia" type="month" required /></Campo>
            <Campo rotulo="Tributo relacionado" htmlFor="ob-trib">
              <select id="ob-trib" name="tributo_id" className={SELECT} defaultValue=""><option value="">—</option>{cad.tributos.map((t) => <option key={t.id} value={t.id}>{t.codigo}</option>)}</select>
            </Campo>
          </>
        )}
        <Campo rotulo="Vencimento" htmlFor="ob-venc" dica="Vazio: usa a regra cadastrada no tipo (se houver)."><Input id="ob-venc" name="vencimento" type="date" defaultValue={o?.vencimento ?? ""} /></Campo>
        <Campo rotulo="Fonte do vencimento" htmlFor="ob-fonte"><Input id="ob-fonte" name="vencimento_fonte" defaultValue={o?.vencimento_fonte ?? ""} placeholder="Ex.: agenda do escritório contábil" /></Campo>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="vencimento_confirmado" defaultChecked={o?.vencimento_confirmado} /> Vencimento confirmado (revisor/contador)</label>
        <Campo rotulo="Responsável interno" htmlFor="ob-resp">
          <select id="ob-resp" name="responsavel_id" className={SELECT} defaultValue={o?.responsavel_id ?? ""}><option value="">—</option>{cad.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>
        </Campo>
        <Campo rotulo="Contador / escritório" htmlFor="ob-cont"><Input id="ob-cont" name="contador_responsavel" defaultValue={o?.contador_responsavel ?? ""} /></Campo>
        <Campo rotulo="Observações" htmlFor="ob-obs" className="sm:col-span-2"><textarea id="ob-obs" name="observacoes" className={TEXTAREA} defaultValue={o?.observacoes ?? ""} /></Campo>
      </div>
    </FormularioAcao>
  );
}

export function FormGerar({ cad }: { cad: Cadastros }) {
  return (
    <FormularioAcao titulo="Gerar obrigações do mês" botao="Gerar pelo perfil tributário" acao={gerarObrigacoes} rotuloSalvar="Gerar"
      descricao="Cria as obrigações mensais marcadas como aplicáveis a cada estabelecimento (Configurações > Perfil tributário). Não cria duplicadas.">
      <Campo rotulo="Competência *" htmlFor="ger-comp"><Input id="ger-comp" name="competencia" type="month" required /></Campo>
      <Campo rotulo="Empresa" htmlFor="ger-emp">
        <select id="ger-emp" name="empresa_id" className={SELECT} defaultValue=""><option value="">Todas do meu escopo</option>{cad.empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
      </Campo>
    </FormularioAcao>
  );
}
