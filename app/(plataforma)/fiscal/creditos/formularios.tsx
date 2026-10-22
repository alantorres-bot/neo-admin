// Formulários reutilizados em várias telas (componentes de servidor que montam o diálogo de cliente FormularioAcao).
import { Input } from "@/components/ui/input";
import { ACCEPT_DOCUMENTOS } from "@/lib/modulos/fiscal/creditos/arquivos";
import { ROTULO_TIPO_TAREFA } from "@/lib/modulos/fiscal/creditos/modulo";
import { comentar, criarCredito, criarTarefa, enviarDocumento, registrarDivergencia, registrarMovimento } from "./acoes";
import type { Cadastros } from "./dados";
import { SeletorTributoCategoria } from "./seletor-categoria";
import { Campo, CampoValor, FormularioAcao, SELECT, TEXTAREA } from "./ui";

const hojeIso = () => new Date().toISOString().slice(0, 10);

function OpcoesEstab({ cad, empresa }: { cad: Cadastros; empresa?: string }) {
  return (
    <>
      {cad.empresas.filter((e) => !empresa || e.id === empresa).map((e) => (
        <optgroup key={e.id} label={e.nome}>
          {cad.estabelecimentos.filter((s) => s.empresa_id === e.id && s.ativo).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </optgroup>
      ))}
    </>
  );
}

export function FormNovoCredito({ cad }: { cad: Cadastros }) {
  return (
    <FormularioAcao titulo="Novo crédito tributário" botao="Novo crédito" variante="default" acao={criarCredito} rotuloSalvar="Cadastrar" larga
      descricao="O crédito nasce PENDENTE DE VALIDAÇÃO e não fica disponível para uso até ser validado por revisor, contador ou administrador (que não pode ser quem lançou).">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Estabelecimento *" htmlFor="nc-estab">
          <select id="nc-estab" name="estabelecimento_id" required className={SELECT} defaultValue=""><option value="" disabled>Escolha…</option><OpcoesEstab cad={cad} /></select>
        </Campo>
        <SeletorTributoCategoria tributos={cad.tributos.filter((t) => t.ativo).map((t) => ({ id: t.id, rotulo: `${t.codigo} — ${t.nome}` }))}
          categorias={cad.categorias.filter((c) => c.ativo).map((c) => ({ id: c.id, nome: c.nome, tributo_id: c.tributo_id, validada: c.regra_validada }))} />
        <Campo rotulo="Origem *" htmlFor="nc-origem">
          <select id="nc-origem" name="origem" required className={SELECT} defaultValue="apuracao_mensal">
            {cad.origens.map((o) => <option key={o.codigo} value={o.codigo}>{o.nome}</option>)}</select>
        </Campo>
        <Campo rotulo="Competência de origem *" htmlFor="nc-comp"><Input id="nc-comp" name="competencia_origem" type="month" required /></Campo>
        <Campo rotulo="Valor original (R$) *" htmlFor="valor_original"><CampoValor name="valor_original" required /></Campo>
        <Campo rotulo="Lançamento inicial no razão *" htmlFor="nc-tipo" dica="Saldo inicial: valor trazido de controle anterior (exige aprovação).">
          <select id="nc-tipo" name="tipo_entrada" className={SELECT} defaultValue="credito_apurado">
            <option value="credito_apurado">Crédito apurado no período</option>
            <option value="credito_reconhecido">Crédito reconhecido (período anterior/decisão)</option>
            <option value="saldo_inicial">Saldo inicial (implantação)</option>
          </select>
        </Campo>
        <Campo rotulo="Data do lançamento inicial" htmlFor="nc-data" dica="Vazio: último dia da competência (ou hoje)."><Input id="nc-data" name="data_entrada" type="date" max={hojeIso()} /></Campo>
        <Campo rotulo="Data de reconhecimento" htmlFor="nc-rec"><Input id="nc-rec" name="data_reconhecimento" type="date" /></Campo>
        <Campo rotulo="Número do processo" htmlFor="nc-proc"><Input id="nc-proc" name="numero_processo" maxLength={80} /></Campo>
        <Campo rotulo="Documento comprobatório (identificação)" htmlFor="nc-doc" className="sm:col-span-2" dica="O arquivo em si vai em Documentos, vinculado ao crédito.">
          <Input id="nc-doc" name="documento_ref" maxLength={200} placeholder="Ex.: Livro de apuração 01/2025, DARF nº…" />
        </Campo>
        <Campo rotulo="Descrição *" htmlFor="nc-desc" className="sm:col-span-2"><Input id="nc-desc" name="descricao" required minLength={3} maxLength={500} /></Campo>
        <Campo rotulo="Responsável" htmlFor="nc-resp">
          <select id="nc-resp" name="responsavel_id" className={SELECT} defaultValue=""><option value="">Eu mesmo</option>
            {cad.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>
        </Campo>
        <Campo rotulo="Prazo de aproveitamento (se informado pelo contador)" htmlFor="nc-lim" dica="Vazio: usa o prazo da categoria, se parametrizado.">
          <Input id="nc-lim" name="data_limite_aproveitamento" type="date" />
        </Campo>
        <Campo rotulo="Observações" htmlFor="nc-obs" className="sm:col-span-2"><textarea id="nc-obs" name="observacoes" className={TEXTAREA} maxLength={2000} /></Campo>
      </div>
    </FormularioAcao>
  );
}

export type CreditoOpcao = { id: string; codigo: string; descricao: string };

export function FormMovimento({ cad, creditos, creditoId, botao = "Registrar movimentação" }: { cad: Cadastros; creditos?: CreditoOpcao[]; creditoId?: string; botao?: string }) {
  const tipos = cad.tiposMovimento.filter((t) => t.ativo && !["estorno", "saldo_inicial", "transferencia_saida", "transferencia_entrada"].includes(t.codigo));
  return (
    <FormularioAcao titulo="Registrar movimentação" botao={botao} variante="default" acao={registrarMovimento} ocultos={creditoId ? { credito_id: creditoId } : {}} rotuloSalvar="Registrar"
      descricao="Lançamento imutável: para corrigir depois, use estorno ou correção. Saídas exigem crédito validado e saldo; ajustes e baixas aguardam aprovação.">
      <div className="grid gap-3 sm:grid-cols-2">
        {!creditoId && (
          <Campo rotulo="Crédito *" htmlFor="mv-cred" className="sm:col-span-2">
            <select id="mv-cred" name="credito_id" required className={SELECT} defaultValue=""><option value="" disabled>Escolha…</option>
              {(creditos ?? []).map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.descricao.slice(0, 70)}</option>)}</select>
          </Campo>
        )}
        <Campo rotulo="Tipo *" htmlFor="mv-tipo" className="sm:col-span-2">
          <select id="mv-tipo" name="tipo" required className={SELECT} defaultValue=""><option value="" disabled>Escolha…</option>
            {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.sinal > 0 ? "(+) " : "(−) "}{t.nome}{t.exige_aprovacao ? " · exige aprovação" : ""}{t.exige_protocolo ? " · exige protocolo" : ""}</option>)}</select>
        </Campo>
        <Campo rotulo="Competência *" htmlFor="mv-comp"><Input id="mv-comp" name="competencia" type="month" required /></Campo>
        <Campo rotulo="Data *" htmlFor="mv-data"><Input id="mv-data" name="data" type="date" required max={hojeIso()} /></Campo>
        <Campo rotulo="Valor (R$) *" htmlFor="valor"><CampoValor name="valor" required /></Campo>
        <Campo rotulo="Protocolo / PER-DCOMP" htmlFor="mv-prot"><Input id="mv-prot" name="protocolo" maxLength={120} /></Campo>
        <Campo rotulo="Processo" htmlFor="mv-proc"><Input id="mv-proc" name="processo" maxLength={80} /></Campo>
        <Campo rotulo="Documento de suporte" htmlFor="mv-doc"><Input id="mv-doc" name="documento_ref" maxLength={200} /></Campo>
        <Campo rotulo="Descrição *" htmlFor="mv-desc" className="sm:col-span-2"><Input id="mv-desc" name="descricao" required minLength={3} maxLength={500} /></Campo>
      </div>
    </FormularioAcao>
  );
}

export function FormDocumento({ cad, empresa, alvo, alvoId, botao = "Anexar documento", tipoPadrao, substitui, estab, tributo, competencia }: {
  cad: Cadastros; empresa?: string; alvo?: string; alvoId?: string; botao?: string; tipoPadrao?: string; substitui?: { id: string; titulo: string };
  estab?: string; tributo?: string; competencia?: string;
}) {
  const ocultos: Record<string, string> = {};
  if (alvo && alvoId) Object.assign(ocultos, { alvo, alvo_id: alvoId });
  if (empresa) ocultos.empresa_id = empresa;
  if (substitui) ocultos.substitui_id = substitui.id;
  return (
    <FormularioAcao titulo={substitui ? `Nova versão de "${substitui.titulo}"` : "Anexar documento"} botao={botao} acao={enviarDocumento} ocultos={ocultos} rotuloSalvar="Enviar"
      descricao="Arquivo privado (só usuários autorizados baixam, por link temporário). Até 9 MB: PDF, XML, TXT (SPED), CSV, XLSX, XLS, DOCX, JPG, PNG. Salvar aqui não significa que algo foi transmitido a órgão público.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Arquivo *" htmlFor="dc-arq" className="sm:col-span-2"><Input id="dc-arq" name="arquivo" type="file" required accept={ACCEPT_DOCUMENTOS} /></Campo>
        {!empresa && (
          <Campo rotulo="Empresa *" htmlFor="dc-emp">
            <select id="dc-emp" name="empresa_id" required className={SELECT} defaultValue={cad.empresas[0]?.id}>{cad.empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
          </Campo>
        )}
        {!substitui && (
          <Campo rotulo="Tipo documental *" htmlFor="dc-tipo">
            <select id="dc-tipo" name="tipo" required className={SELECT} defaultValue={tipoPadrao ?? ""}><option value="" disabled>Escolha…</option>
              {cad.tiposDocumento.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}</select>
          </Campo>
        )}
        {!substitui && <Campo rotulo="Título" htmlFor="dc-tit"><Input id="dc-tit" name="titulo" maxLength={200} placeholder="Vazio: nome do arquivo" /></Campo>}
        {!substitui && (
          <>
            <Campo rotulo="Competência" htmlFor="dc-comp"><Input id="dc-comp" name="competencia" type="month" defaultValue={competencia?.slice(0, 7)} /></Campo>
            <Campo rotulo="Tributo" htmlFor="dc-trib">
              <select id="dc-trib" name="tributo_id" className={SELECT} defaultValue={tributo ?? ""}><option value="">—</option>{cad.tributos.map((t) => <option key={t.id} value={t.id}>{t.codigo}</option>)}</select>
            </Campo>
            <Campo rotulo="Estabelecimento" htmlFor="dc-est">
              <select id="dc-est" name="estabelecimento_id" className={SELECT} defaultValue={estab ?? ""}><option value="">—</option><OpcoesEstab cad={cad} empresa={empresa} /></select>
            </Campo>
          </>
        )}
        {substitui && <Campo rotulo="Motivo da substituição *" htmlFor="dc-mot" className="sm:col-span-2"><Input id="dc-mot" name="motivo_substituicao" required minLength={5} /></Campo>}
        <Campo rotulo="Observações" htmlFor="dc-obs" className="sm:col-span-2"><textarea id="dc-obs" name="observacoes" className={TEXTAREA} maxLength={2000} /></Campo>
      </div>
    </FormularioAcao>
  );
}

export function FormTarefa({ cad, empresa, alvo, alvoId, botao = "Nova tarefa", tipoPadrao = "tarefa", tituloPadrao }: {
  cad: Cadastros; empresa?: string; alvo?: string; alvoId?: string; botao?: string; tipoPadrao?: string; tituloPadrao?: string;
}) {
  const ocultos: Record<string, string> = {};
  if (alvo && alvoId) Object.assign(ocultos, { alvo, alvo_id: alvoId });
  if (empresa) ocultos.empresa_id = empresa;
  return (
    <FormularioAcao titulo="Nova tarefa" botao={botao} acao={criarTarefa} ocultos={ocultos} rotuloSalvar="Criar"
      descricao="Atribuir a outra pessoa exige revisor, contador ou administrador. A tarefa também entra na Fila do dia do responsável.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Tipo" htmlFor="tf-tipo">
          <select id="tf-tipo" name="tipo" className={SELECT} defaultValue={tipoPadrao}>{Object.entries(ROTULO_TIPO_TAREFA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Campo>
        <Campo rotulo="Documento solicitado" htmlFor="tf-doc" dica="Para solicitação de documento: só conclui quando o documento estiver vinculado.">
          <select id="tf-doc" name="tipo_documento_solicitado" className={SELECT} defaultValue=""><option value="">—</option>{cad.tiposDocumento.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}</select>
        </Campo>
        {!empresa && (
          <Campo rotulo="Empresa" htmlFor="tf-emp">
            <select id="tf-emp" name="empresa_id" className={SELECT} defaultValue={cad.empresas[0]?.id ?? ""}>{cad.empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
          </Campo>
        )}
        <Campo rotulo="Título *" htmlFor="tf-tit" className="sm:col-span-2"><Input id="tf-tit" name="titulo" required minLength={3} maxLength={200} defaultValue={tituloPadrao} /></Campo>
        <Campo rotulo="Responsável" htmlFor="tf-resp">
          <select id="tf-resp" name="responsavel_id" className={SELECT} defaultValue=""><option value="">Sem responsável (eu assumo depois)</option>{cad.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>
        </Campo>
        <Campo rotulo="Prazo" htmlFor="tf-prazo"><Input id="tf-prazo" name="prazo" type="date" /></Campo>
        <Campo rotulo="Descrição" htmlFor="tf-desc" className="sm:col-span-2"><textarea id="tf-desc" name="descricao" className={TEXTAREA} maxLength={2000} /></Campo>
      </div>
    </FormularioAcao>
  );
}

export function FormComentario({ alvo, alvoId }: { alvo: string; alvoId: string }) {
  return (
    <FormularioAcao titulo="Comentar" botao="Comentar" acao={comentar} ocultos={{ alvo, alvo_id: alvoId }} rotuloSalvar="Registrar" descricao="Comentários ficam no histórico e não podem ser apagados.">
      <textarea name="texto" required className={TEXTAREA} maxLength={4000} aria-label="Comentário" />
    </FormularioAcao>
  );
}

export function FormDivergencia({ cad, padrao = {}, botao = "Registrar divergência" }: { cad: Cadastros; padrao?: Record<string, string>; botao?: string }) {
  const { empresa_id, estabelecimento_id, tributo_id, competencia, valor_interno, valor_externo, motivo, ...ocultos } = padrao;
  return (
    <FormularioAcao titulo="Registrar divergência" botao={botao} acao={registrarDivergencia} ocultos={ocultos} rotuloSalvar="Registrar" larga
      descricao="Diferença = valor interno − valor externo (calculada se não for informada). Com responsável, vira tarefa dele.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Empresa *" htmlFor="dv-emp">
          <select id="dv-emp" name="empresa_id" required className={SELECT} defaultValue={empresa_id ?? cad.empresas[0]?.id}>{cad.empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
        </Campo>
        <Campo rotulo="Estabelecimento" htmlFor="dv-est">
          <select id="dv-est" name="estabelecimento_id" className={SELECT} defaultValue={estabelecimento_id ?? ""}><option value="">—</option><OpcoesEstab cad={cad} /></select>
        </Campo>
        <Campo rotulo="Tributo" htmlFor="dv-trib">
          <select id="dv-trib" name="tributo_id" className={SELECT} defaultValue={tributo_id ?? ""}><option value="">—</option>{cad.tributos.map((t) => <option key={t.id} value={t.id}>{t.codigo}</option>)}</select>
        </Campo>
        <Campo rotulo="Competência" htmlFor="dv-comp"><Input id="dv-comp" name="competencia" type="month" defaultValue={competencia?.slice(0, 7)} /></Campo>
        <Campo rotulo="Fonte comparada" htmlFor="dv-fonte">
          <select id="dv-fonte" name="fonte_comparada" className={SELECT} defaultValue="apuracao_oficial">
            <option value="apuracao_oficial">Apuração oficial</option><option value="declaracao">Declaração</option><option value="periodo_anterior">Período anterior</option>
            <option value="perdcomp">PER/DCOMP</option><option value="erp">ERP</option><option value="outro">Outro</option>
          </select>
        </Campo>
        <Campo rotulo="Valor interno (R$)" htmlFor="valor_interno"><CampoValor name="valor_interno" defaultValue={valor_interno} permitirZero /></Campo>
        <Campo rotulo="Valor externo (R$)" htmlFor="valor_externo"><CampoValor name="valor_externo" defaultValue={valor_externo} permitirZero /></Campo>
        <Campo rotulo="Diferença (R$)" htmlFor="valor_diferenca" dica="Vazio: interno − externo."><CampoValor name="valor_diferenca" permitirZero /></Campo>
        <Campo rotulo="Motivo *" htmlFor="dv-mot" className="sm:col-span-2"><textarea id="dv-mot" name="motivo" required minLength={5} className={TEXTAREA} defaultValue={motivo} /></Campo>
        <Campo rotulo="Providência necessária" htmlFor="dv-prov" className="sm:col-span-2"><Input id="dv-prov" name="providencia" maxLength={500} /></Campo>
        <Campo rotulo="Responsável" htmlFor="dv-resp">
          <select id="dv-resp" name="responsavel_id" className={SELECT} defaultValue=""><option value="">—</option>{cad.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>
        </Campo>
        <Campo rotulo="Prazo interno" htmlFor="dv-prazo"><Input id="dv-prazo" name="prazo_interno" type="date" /></Campo>
      </div>
    </FormularioAcao>
  );
}
