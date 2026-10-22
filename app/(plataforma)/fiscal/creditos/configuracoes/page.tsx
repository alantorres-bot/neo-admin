import type { Metadata } from "next";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cnpj } from "@/lib/modulos/fiscal/creditos/formatos";
import { DESCRICAO_PAPEL, pode, ROTA_CREDITOS, ROTULO_CLASSE, ROTULO_FORMA, ROTULO_NATUREZA, ROTULO_PAPEL, type Papel } from "@/lib/modulos/fiscal/creditos/modulo";
import { ROTULO_NIVEL } from "@/lib/nucleo/permissoes";
import type { NivelAcesso } from "@/lib/nucleo/tipos";
import {
  definirAplicavel, definirMembro, salvarCategoria, salvarEstabelecimento, salvarTipoMovimento, salvarTipoObrigacao, salvarTributo,
} from "../acoes";
import { Secao, Selo } from "../componentes";
import { contexto, lerCadastros, nomes, type Cadastros, type Categoria, type TipoObrigacao } from "../dados";
import { BotaoAcao, Campo, FormularioAcao, SELECT, TEXTAREA } from "../ui";

export const metadata: Metadata = { title: "Configurações" };

const ABAS = [
  ["estabelecimentos", "Estabelecimentos"], ["tributos", "Tributos"], ["categorias", "Categorias e parâmetros"], ["tipos", "Tipos de movimentação"],
  ["obrigacoes", "Tipos de obrigação"], ["perfil", "Perfil tributário"], ["usuarios", "Usuários e papéis"],
] as const;

export default async function PaginaConfiguracoes({ searchParams }: PageProps<"/fiscal/creditos/configuracoes">) {
  const { supabase, papel, sessao } = await contexto();
  const sp = await searchParams;
  const aba = (ABAS.find(([k]) => k === sp.aba)?.[0] ?? "estabelecimentos") as (typeof ABAS)[number][0];
  const cad = await lerCadastros();
  const admin = pode(papel, "parametrizar");
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1.5 text-sm">
        {ABAS.map(([k, r]) => <Link key={k} href={`${ROTA_CREDITOS}/configuracoes?aba=${k}`} className={`rounded-[3px] border px-2 py-0.5 ${aba === k ? "border-marca bg-marca-clara font-bold" : "hover:bg-muted"}`}>{r}</Link>)}
      </nav>
      {!admin && <p className="rounded-[3px] border bg-cabecalho px-3 py-2 text-sm">Somente consulta: os parâmetros fiscais só são alterados pelo administrador do módulo.</p>}
      {aba === "estabelecimentos" && <Estabelecimentos cad={cad} admin={admin} empresas={(await supabase.from("empresas").select("id, nome_curto, razao_social, cnpj").eq("ativa", true).order("nome_curto")).data ?? []} />}
      {aba === "tributos" && <Tributos cad={cad} admin={admin} />}
      {aba === "categorias" && <Categorias cad={cad} admin={admin} />}
      {aba === "tipos" && <TiposMovimento cad={cad} admin={admin} />}
      {aba === "obrigacoes" && <TiposObrigacao cad={cad} admin={admin} />}
      {aba === "perfil" && <Perfil cad={cad} admin={admin} aplicaveis={(await supabase.from("fis_obrigacoes_aplicaveis").select("tipo_id, estabelecimento_id, ativo, responsavel_id, contador_responsavel")).data ?? []} />}
      {aba === "usuarios" && <Usuarios cad={cad} admin={admin} usuarioId={sessao.userId} supabase={supabase} />}
    </div>
  );
}

function Estabelecimentos({ cad, admin, empresas }: { cad: Cadastros; admin: boolean; empresas: { id: string; nome_curto: string; razao_social: string; cnpj: string | null }[] }) {
  const n = nomes(cad);
  const form = (e?: Cadastros["estabelecimentos"][number]) => (
    <FormularioAcao titulo={e ? `Editar ${e.nome}` : "Novo estabelecimento"} botao={e ? "Editar" : "Novo estabelecimento"} tamanho={e ? "xs" : "sm"} variante={e ? "outline" : "default"}
      acao={salvarEstabelecimento} ocultos={e ? { id: e.id, empresa_id: e.empresa_id, cnpj: e.cnpj } : {}}
      descricao="As empresas do grupo vêm de Configurações gerais (núcleo). A matriz recebe os tributos apurados de forma centralizada (confirmar com o contador).">
      <div className="grid gap-3 sm:grid-cols-2">
        {!e && <Campo rotulo="Empresa *" htmlFor="es-emp"><select id="es-emp" name="empresa_id" required className={SELECT}>{empresas.map((x) => <option key={x.id} value={x.id}>{x.nome_curto}</option>)}</select></Campo>}
        {!e && <Campo rotulo="CNPJ *" htmlFor="es-cnpj"><Input id="es-cnpj" name="cnpj" required inputMode="numeric" placeholder="00.000.000/0000-00" /></Campo>}
        <Campo rotulo="Nome *" htmlFor="es-nome"><Input id="es-nome" name="nome" required defaultValue={e?.nome} /></Campo>
        <Campo rotulo="UF" htmlFor="es-uf"><Input id="es-uf" name="uf" maxLength={2} defaultValue={e?.uf ?? ""} /></Campo>
        <Campo rotulo="Inscrição estadual" htmlFor="es-ie"><Input id="es-ie" name="inscricao_estadual" /></Campo>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="matriz" defaultChecked={e?.matriz} /> Matriz</label>
        {e && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inativo" defaultChecked={!e.ativo} /> Inativo</label>}
      </div>
    </FormularioAcao>
  );
  return (
    <Secao titulo="Estabelecimentos" acoes={admin ? form() : undefined}>
      <Table>
        <TableHeader><TableRow><TableHead>Empresa</TableHead><TableHead>Estabelecimento</TableHead><TableHead>CNPJ</TableHead><TableHead>UF</TableHead><TableHead>Tipo</TableHead><TableHead>Situação</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {cad.estabelecimentos.map((e) => (
            <TableRow key={e.id}>
              <TableCell>{n.empresa.get(e.empresa_id)}</TableCell><TableCell>{e.nome}{e.ficticio && <Selo className="ml-1">fictício</Selo>}</TableCell><TableCell>{cnpj(e.cnpj)}</TableCell>
              <TableCell>{e.uf}</TableCell><TableCell>{e.matriz ? "Matriz" : "Filial"}</TableCell><TableCell>{e.ativo ? "Ativo" : "Inativo"}</TableCell><TableCell>{admin && form(e)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Secao>
  );
}

function Tributos({ cad, admin }: { cad: Cadastros; admin: boolean }) {
  const form = (t?: Cadastros["tributos"][number]) => (
    <FormularioAcao titulo={t ? `Editar ${t.codigo}` : "Novo tributo"} botao={t ? "Editar" : "Novo tributo"} tamanho={t ? "xs" : "sm"} variante={t ? "outline" : "default"} acao={salvarTributo} ocultos={t ? { id: t.id, codigo: t.codigo } : {}}>
      <div className="grid gap-3 sm:grid-cols-2">
        {!t && <Campo rotulo="Código *" htmlFor="tb-cod"><Input id="tb-cod" name="codigo" required pattern="[A-Za-z0-9_]{2,20}" /></Campo>}
        <Campo rotulo="Nome *" htmlFor="tb-nome"><Input id="tb-nome" name="nome" required defaultValue={t?.nome} /></Campo>
        <Campo rotulo="Esfera" htmlFor="tb-esf"><select id="tb-esf" name="esfera" className={SELECT} defaultValue={t?.esfera ?? "federal"}><option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option></select></Campo>
        <Campo rotulo="Observação" htmlFor="tb-obs" className="sm:col-span-2"><Input id="tb-obs" name="observacao" defaultValue={t?.observacao ?? ""} /></Campo>
        {t && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inativo" defaultChecked={!t.ativo} /> Inativo</label>}
      </div>
    </FormularioAcao>
  );
  return (
    <Secao titulo="Tributos" acoes={admin ? form() : undefined}>
      <Table>
        <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Nome</TableHead><TableHead>Esfera</TableHead><TableHead>Situação</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>{cad.tributos.map((t) => <TableRow key={t.id}><TableCell>{t.codigo}</TableCell><TableCell>{t.nome}</TableCell><TableCell>{t.esfera}</TableCell><TableCell>{t.ativo ? "Ativo" : "Inativo"}</TableCell><TableCell>{admin && form(t)}</TableCell></TableRow>)}</TableBody>
      </Table>
    </Secao>
  );
}

function Categorias({ cad, admin }: { cad: Cadastros; admin: boolean }) {
  const n = nomes(cad);
  const form = (c?: Categoria) => (
    <FormularioAcao titulo={c ? `Parâmetros: ${c.nome}` : "Nova categoria"} botao={c ? "Editar" : "Nova categoria"} tamanho={c ? "xs" : "sm"} variante={c ? "outline" : "default"} acao={salvarCategoria}
      ocultos={c ? { id: c.id, codigo: c.codigo } : {}} larga
      descricao="Estes parâmetros decidem o que o sistema permite (formas de utilização, documentos exigidos, prazo). Não há valor 'legal' presumido: preencha com o contador e marque como validado. Alterar sem marcar volta para 'não validado'.">
      <div className="grid gap-3 sm:grid-cols-2">
        {!c && <Campo rotulo="Código *" htmlFor="ct-cod"><Input id="ct-cod" name="codigo" required pattern="[A-Za-z0-9_]{2,40}" /></Campo>}
        <Campo rotulo="Nome *" htmlFor="ct-nome"><Input id="ct-nome" name="nome" required defaultValue={c?.nome} /></Campo>
        <Campo rotulo="Tributo" htmlFor="ct-trib"><select id="ct-trib" name="tributo_id" className={SELECT} defaultValue={c?.tributo_id ?? ""}><option value="">Qualquer</option>{cad.tributos.map((t) => <option key={t.id} value={t.id}>{t.codigo}</option>)}</select></Campo>
        <Campo rotulo="Natureza" htmlFor="ct-nat"><select id="ct-nat" name="natureza" className={SELECT} defaultValue={c?.natureza ?? "outro"}>{Object.entries(ROTULO_NATUREZA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
        <fieldset className="grid gap-1 text-sm sm:col-span-2"><legend className="text-[13px] font-medium">Formas de utilização permitidas</legend>
          {Object.entries(ROTULO_FORMA).map(([k, v]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" name="formas" value={k} defaultChecked={c?.formas_utilizacao.includes(k)} /> {v}</label>)}
        </fieldset>
        <fieldset className="grid gap-1 text-sm sm:col-span-2"><legend className="text-[13px] font-medium">Documentos exigidos para validar</legend>
          <div className="grid gap-1 sm:grid-cols-2">{cad.tiposDocumento.map((t) => <label key={t.codigo} className="flex items-center gap-2"><input type="checkbox" name="documentos" value={t.codigo} defaultChecked={c?.documentos_exigidos.includes(t.codigo)} /> {t.nome}</label>)}</div>
        </fieldset>
        <Campo rotulo="Prazo de aproveitamento (meses)" htmlFor="ct-prazo" dica="Vazio = não parametrizado (o sistema não presume prazo)."><Input id="ct-prazo" name="prazo" type="number" min={1} max={600} defaultValue={c?.prazo_aproveitamento_meses ?? ""} /></Campo>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="exige_processo" defaultChecked={c?.exige_processo} /> Exige número do processo</label>
        <Campo rotulo="Fundamento / observação do contador" htmlFor="ct-obs" className="sm:col-span-2"><textarea id="ct-obs" name="observacao_legal" className={TEXTAREA} defaultValue={c?.observacao_legal ?? ""} /></Campo>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="regra_validada" defaultChecked={c?.regra_validada} /> Parâmetros validados pelo contador responsável</label>
        {c && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inativo" defaultChecked={!c.ativo} /> Inativa</label>}
      </div>
    </FormularioAcao>
  );
  return (
    <Secao titulo="Categorias de crédito e parâmetros de aproveitamento" descricao="Valores iniciais são exemplos NÃO validados. Nenhum crédito é tratado como utilizável só por existir: precisa ser validado e a forma precisa estar permitida aqui." acoes={admin ? form() : undefined}>
      <Table>
        <TableHeader><TableRow><TableHead>Categoria</TableHead><TableHead>Tributo</TableHead><TableHead>Natureza</TableHead><TableHead>Formas permitidas</TableHead><TableHead>Documentos exigidos</TableHead><TableHead>Prazo</TableHead><TableHead>Parâmetros</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {cad.categorias.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.nome}<span className="block text-[10px] text-muted-foreground">{c.codigo}</span></TableCell>
              <TableCell>{c.tributo_id ? n.tributo.get(c.tributo_id) : "Qualquer"}</TableCell>
              <TableCell>{ROTULO_NATUREZA[c.natureza]}</TableCell>
              <TableCell>{c.formas_utilizacao.map((f) => ROTULO_FORMA[f]).join(", ") || "—"}</TableCell>
              <TableCell>{c.documentos_exigidos.map((d) => n.tipoDoc.get(d) ?? d).join(", ") || "—"}{c.exige_processo ? " · processo" : ""}</TableCell>
              <TableCell>{c.prazo_aproveitamento_meses ? `${c.prazo_aproveitamento_meses} meses` : "não parametrizado"}</TableCell>
              <TableCell>{c.regra_validada ? <Selo tom="bom">validados</Selo> : <Selo tom="atencao">não validados</Selo>}</TableCell>
              <TableCell>{admin && form(c)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Secao>
  );
}

function TiposMovimento({ cad, admin }: { cad: Cadastros; admin: boolean }) {
  const form = (t?: Cadastros["tiposMovimento"][number]) => (
    <FormularioAcao titulo={t ? `Tipo: ${t.nome}` : "Novo tipo de movimentação"} botao={t ? "Editar" : "Novo tipo"} tamanho={t ? "xs" : "sm"} variante={t ? "outline" : "default"} acao={salvarTipoMovimento}
      ocultos={t ? { codigo: t.codigo, classe: t.classe, sinal: String(t.sinal), forma: t.forma ?? "" } : {}}
      descricao="A classe define a coluna da apuração e o sinal, se entra ou sai. Tipos do sistema não mudam de classe/sinal.">
      <div className="grid gap-3 sm:grid-cols-2">
        {!t && <Campo rotulo="Código *" htmlFor="tm-cod"><Input id="tm-cod" name="codigo" required pattern="[a-z0-9_]{2,40}" /></Campo>}
        <Campo rotulo="Nome *" htmlFor="tm-nome"><Input id="tm-nome" name="nome" required defaultValue={t?.nome} /></Campo>
        {!t && (
          <>
            <Campo rotulo="Classe" htmlFor="tm-cl"><select id="tm-cl" name="classe" className={SELECT}>{Object.entries(ROTULO_CLASSE).filter(([k]) => !["estorno", "saldo_inicial"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
            <Campo rotulo="Sinal" htmlFor="tm-sn"><select id="tm-sn" name="sinal" className={SELECT}><option value="1">Entrada (+)</option><option value="-1">Saída (−)</option></select></Campo>
            <Campo rotulo="Forma exigida na categoria" htmlFor="tm-fm"><select id="tm-fm" name="forma" className={SELECT}><option value="">Nenhuma</option>{Object.entries(ROTULO_FORMA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
          </>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="exige_aprovacao" defaultChecked={t ? t.exige_aprovacao : true} /> Exige aprovação</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="exige_protocolo" defaultChecked={t?.exige_protocolo} /> Exige protocolo</label>
        {t && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inativo" defaultChecked={!t.ativo} /> Inativo</label>}
      </div>
    </FormularioAcao>
  );
  return (
    <Secao titulo="Tipos de movimentação" acoes={admin ? form() : undefined}>
      <Table>
        <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Classe</TableHead><TableHead>Sinal</TableHead><TableHead>Forma</TableHead><TableHead>Aprovação</TableHead><TableHead>Protocolo</TableHead><TableHead>Origem</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {cad.tiposMovimento.map((t) => (
            <TableRow key={t.codigo}>
              <TableCell>{t.nome}</TableCell><TableCell>{ROTULO_CLASSE[t.classe]}</TableCell><TableCell>{t.sinal > 0 ? "+" : t.sinal < 0 ? "−" : "inverte"}</TableCell>
              <TableCell>{t.forma ? ROTULO_FORMA[t.forma] : "—"}</TableCell><TableCell>{t.exige_aprovacao ? "sim" : "não"}</TableCell><TableCell>{t.exige_protocolo ? "sim" : "não"}</TableCell>
              <TableCell>{t.sistema ? "sistema" : "configurado"}</TableCell><TableCell>{admin && t.codigo !== "estorno" && form(t)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Secao>
  );
}

function TiposObrigacao({ cad, admin }: { cad: Cadastros; admin: boolean }) {
  const form = (t?: TipoObrigacao) => (
    <FormularioAcao titulo={t ? `Obrigação: ${t.nome}` : "Novo tipo de obrigação"} botao={t ? "Editar" : "Novo tipo"} tamanho={t ? "xs" : "sm"} variante={t ? "outline" : "default"} acao={salvarTipoObrigacao}
      ocultos={t ? { id: t.id, codigo: t.codigo } : {}} larga
      descricao="Regra de vencimento: dia do mês, N meses após a competência. Só informe com fonte confiável; sem regra validada as obrigações ficam 'vencimento a confirmar'.">
      <div className="grid gap-3 sm:grid-cols-2">
        {!t && <Campo rotulo="Código *" htmlFor="to-cod"><Input id="to-cod" name="codigo" required pattern="[A-Za-z0-9_]{2,30}" /></Campo>}
        <Campo rotulo="Nome *" htmlFor="to-nome"><Input id="to-nome" name="nome" required defaultValue={t?.nome} /></Campo>
        <Campo rotulo="Tributo" htmlFor="to-trib"><select id="to-trib" name="tributo_id" className={SELECT} defaultValue={t?.tributo_id ?? ""}><option value="">—</option>{cad.tributos.map((x) => <option key={x.id} value={x.id}>{x.codigo}</option>)}</select></Campo>
        <Campo rotulo="Esfera" htmlFor="to-esf"><select id="to-esf" name="esfera" className={SELECT} defaultValue={t?.esfera ?? "federal"}><option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option></select></Campo>
        <Campo rotulo="Periodicidade" htmlFor="to-per"><select id="to-per" name="periodicidade" className={SELECT} defaultValue={t?.periodicidade ?? "mensal"}><option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="anual">Anual</option><option value="eventual">Eventual</option></select></Campo>
        <Campo rotulo="Dia do vencimento" htmlFor="to-dia"><Input id="to-dia" name="dia_vencimento" type="number" min={1} max={31} defaultValue={t?.dia_vencimento ?? ""} /></Campo>
        <Campo rotulo="Meses após a competência" htmlFor="to-mes"><Input id="to-mes" name="meses_apos" type="number" min={0} max={24} defaultValue={t?.meses_apos ?? 1} /></Campo>
        <Campo rotulo="Fonte da regra" htmlFor="to-fonte" className="sm:col-span-2"><Input id="to-fonte" name="fonte_regra" defaultValue={t?.fonte_regra ?? ""} placeholder="Norma/agenda informada pelo contador" /></Campo>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="regra_vencimento_validada" defaultChecked={t?.regra_vencimento_validada} /> Regra validada pelo contador</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="exige_recibo" defaultChecked={t ? t.exige_recibo : true} /> Exige recibo para “transmitida”</label>
        <fieldset className="grid gap-1 text-sm sm:col-span-2"><legend className="text-[13px] font-medium">Documentos exigidos na transmissão</legend>
          <div className="grid gap-1 sm:grid-cols-2">{cad.tiposDocumento.map((d) => <label key={d.codigo} className="flex items-center gap-2"><input type="checkbox" name="documentos" value={d.codigo} defaultChecked={(t?.documentos_exigidos ?? ["recibo_transmissao"]).includes(d.codigo)} /> {d.nome}</label>)}</div>
        </fieldset>
        <Campo rotulo="Descrição" htmlFor="to-desc" className="sm:col-span-2"><textarea id="to-desc" name="descricao" className={TEXTAREA} defaultValue={t?.descricao ?? ""} /></Campo>
        {t && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inativo" defaultChecked={!t.ativo} /> Inativo</label>}
      </div>
    </FormularioAcao>
  );
  return (
    <Secao titulo="Tipos de obrigação acessória" descricao="Lista de exemplo: não presume que se aplicam à empresa. Defina a aplicabilidade em 'Perfil tributário'." acoes={admin ? form() : undefined}>
      <Table>
        <TableHeader><TableRow><TableHead>Obrigação</TableHead><TableHead>Esfera</TableHead><TableHead>Periodicidade</TableHead><TableHead>Regra de vencimento</TableHead><TableHead>Recibo</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {cad.tiposObrigacao.map((t) => (
            <TableRow key={t.id}>
              <TableCell>{t.nome}</TableCell><TableCell>{t.esfera}</TableCell><TableCell>{t.periodicidade}</TableCell>
              <TableCell>{t.dia_vencimento ? `dia ${t.dia_vencimento}, ${t.meses_apos} mês(es) após` : "não cadastrada"} {t.regra_vencimento_validada ? <Selo tom="bom">validada</Selo> : <Selo tom="atencao">a confirmar</Selo>}</TableCell>
              <TableCell>{t.exige_recibo ? "exige" : "não exige"}</TableCell><TableCell>{admin && form(t)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Secao>
  );
}

function Perfil({ cad, admin, aplicaveis }: { cad: Cadastros; admin: boolean; aplicaveis: { tipo_id: string; estabelecimento_id: string; ativo: boolean; responsavel_id: string | null; contador_responsavel: string | null }[] }) {
  const n = nomes(cad);
  const mapa = new Map(aplicaveis.map((a) => [`${a.tipo_id}|${a.estabelecimento_id}`, a]));
  const ativos = cad.estabelecimentos.filter((e) => e.ativo);
  return (
    <Secao titulo="Perfil tributário: obrigações aplicáveis por estabelecimento" descricao="Marque o que se aplica (definição do contador). Só as mensais marcadas são geradas automaticamente.">
      <Table interativa={false}>
        <TableHeader><TableRow><TableHead>Obrigação</TableHead>{ativos.map((e) => <TableHead key={e.id}>{e.nome}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {cad.tiposObrigacao.filter((t) => t.ativo).map((t) => (
            <TableRow key={t.id}>
              <TableCell>{t.nome}</TableCell>
              {ativos.map((e) => {
                const a = mapa.get(`${t.id}|${e.id}`);
                return (
                  <TableCell key={e.id}>
                    {a?.ativo ? <Selo tom="bom">aplica</Selo> : <span className="text-xs text-muted-foreground">não</span>}
                    {a?.ativo && a.responsavel_id && <span className="block text-[10px]">{n.usuario.get(a.responsavel_id)}</span>}
                    {admin && (a?.ativo
                      ? <BotaoAcao rotulo="Remover" tamanho="xs" variante="ghost" acao={definirAplicavel} campos={{ tipo_id: t.id, estabelecimento_id: e.id, ativo: "nao" }} confirmar="Deixar de gerar?" />
                      : (
                        <FormularioAcao titulo={`${t.nome} em ${e.nome}`} botao="Aplicar" tamanho="xs" acao={definirAplicavel} ocultos={{ tipo_id: t.id, estabelecimento_id: e.id, ativo: "sim" }} rotuloSalvar="Aplicar">
                          <Campo rotulo="Responsável interno" htmlFor={`pf-r-${t.id}-${e.id}`}><select id={`pf-r-${t.id}-${e.id}`} name="responsavel_id" className={SELECT} defaultValue=""><option value="">—</option>{cad.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></Campo>
                          <Campo rotulo="Contador / escritório" htmlFor={`pf-c-${t.id}-${e.id}`}><Input id={`pf-c-${t.id}-${e.id}`} name="contador_responsavel" /></Campo>
                        </FormularioAcao>
                      ))}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Secao>
  );
}

async function Usuarios({ cad, admin, usuarioId, supabase }: { cad: Cadastros; admin: boolean; usuarioId: string; supabase: Awaited<ReturnType<typeof contexto>>["supabase"] }) {
  const [{ data: membros }, { data: niveis }] = await Promise.all([
    supabase.from("fis_membros").select("perfil_id, papel, empresas"),
    supabase.from("permissoes").select("perfil_id, nivel").eq("area", "fiscal"),
  ]);
  const membro = new Map((membros ?? []).map((m) => [m.perfil_id, m]));
  const nivel = new Map((niveis ?? []).map((p) => [p.perfil_id, p.nivel as NivelAcesso]));
  const n = nomes(cad);
  return (
    <Secao titulo="Usuários e papéis no Fiscal Control" descricao="O acesso à área Fiscal é dado em Configurações > Usuários (núcleo): consulta → Leitor, operador → Analista, gestor → Revisor (ou Contador), administrador → Administrador. Aqui o administrador escolhe o papel dentro do permitido e pode restringir empresas.">
      <ul className="mb-3 grid gap-1 text-sm md:grid-cols-2">
        {(Object.keys(ROTULO_PAPEL) as Papel[]).map((p) => <li key={p}><strong>{ROTULO_PAPEL[p]}:</strong> {DESCRICAO_PAPEL[p]}</li>)}
      </ul>
      <Table>
        <TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead>Nível na área Fiscal</TableHead><TableHead>Papel escolhido</TableHead><TableHead>Empresas</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {cad.usuarios.filter((u) => nivel.has(u.id) || membro.has(u.id)).map((u) => {
            const m = membro.get(u.id);
            return (
              <TableRow key={u.id}>
                <TableCell>{u.nome}{u.id === usuarioId ? " (você)" : ""}</TableCell>
                <TableCell>{ROTULO_NIVEL[nivel.get(u.id) ?? "sem_acesso"]}</TableCell>
                <TableCell>{m ? ROTULO_PAPEL[m.papel as Papel] : "derivado do nível"}</TableCell>
                <TableCell>{m?.empresas?.length ? (m.empresas as string[]).map((e) => n.empresa.get(e) ?? "?").join(", ") : "todas"}</TableCell>
                <TableCell>
                  {admin && (
                    <FormularioAcao titulo={`Papel de ${u.nome}`} botao="Definir" tamanho="xs" acao={definirMembro} ocultos={{ perfil_id: u.id }} rotuloSalvar="Salvar"
                      descricao="Se o papel exigir nível maior que o da área, vale o papel derivado do nível.">
                      <Campo rotulo="Papel" htmlFor={`pp-${u.id}`}>
                        <select id={`pp-${u.id}`} name="papel" className={SELECT} defaultValue={m?.papel ?? ""}><option value="">Derivado do nível</option>{Object.entries(ROTULO_PAPEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      </Campo>
                      <fieldset className="grid gap-1 text-sm"><legend className="text-[13px] font-medium">Empresas permitidas (nenhuma marcada = todas)</legend>
                        {cad.empresas.map((e) => <label key={e.id} className="flex items-center gap-2"><input type="checkbox" name="empresas" value={e.id} defaultChecked={(m?.empresas as string[] | null)?.includes(e.id)} /> {e.nome}</label>)}
                      </fieldset>
                    </FormularioAcao>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Secao>
  );
}
