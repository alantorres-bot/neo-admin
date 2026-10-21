// Importação do cadastro de funcionários do Control iD / RHiD (person_AAAAMMDDhhmmss.csv, separador ";") para o cadastro
// único do RH. O arquivo traz dados muito sensíveis (senha, PIN, endereço, RG, filiação): daqui só saem nº RHiD, CPF, nome,
// empresa, departamento, cargo e admissão, lidos no navegador. Regras (decisão de 21/10/2026):
//  - casa com o cadastro pelo nº RHiD, depois CPF, depois nome igual, depois nome parecido (só com quem está sem CPF);
//  - só completa o que está vazio; nº de fornecedor (Consistem) e matrícula da folha nunca vêm daqui;
//  - quem não casa é incluído (sem fornecedor e sem VT, para o RH completar).

export type FuncionarioControlId = {
  rhid: string; cpf: string; nome: string; empregador: string; departamento: string | null; cargo: string | null; admissao: string | null;
};

const chave = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Empresa do Control iD → empresa empregadora do cadastro (como nas planilhas do RH). */
export function empregadorDe(empresa: string): string {
  const e = chave(empresa);
  if (e.startsWith("OESTE")) return "OESTE";
  if (e.includes("SERVICOS")) return "NEO SERVIÇOS";
  return e.startsWith("NEO") ? "NEO FORMAS" : empresa.trim();
}

/** "4/7/2025 12:00:00 AM" (m/d/aaaa) ou "07/04/2025" (dd/mm/aaaa) → ISO. */
function dataIso(t: string): string | null {
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) \d/.exec(t.trim());
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t.trim());
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

export function lerCadastroControlId(matriz: readonly (readonly string[])[]): { itens: FuncionarioControlId[]; erro: string | null; ignorados: string[] } {
  const cab = (matriz[0] ?? []).map((c) => chave(c.replace(/^﻿/, "")));
  const i = (nome: string) => cab.indexOf(chave(nome));
  const col = { rhid: i("id_funcionario"), cpf: i("CPF"), nome: i("Nome"), empresa: i("Empresa"), dep: i("Departamento"), cargo: i("Cargo"), adm: i("Data de Admissão"), ativo: i("Ativo") };
  if (Object.values(col).some((x) => x < 0)) return { itens: [], erro: "Não é o cadastro de funcionários do Control iD (faltam colunas como id_funcionario, CPF, Departamento, Ativo).", ignorados: [] };
  const itens: FuncionarioControlId[] = [];
  const ignorados: string[] = [];
  for (const l of matriz.slice(1)) {
    if (l.every((c) => !c.trim()) || (l[col.ativo] ?? "").trim() !== "1") continue;   // só ativos
    const nome = (l[col.nome] ?? "").trim();
    // o Control iD tira o zero da frente do CPF (vem com 10 dígitos)
    const cpf = (l[col.cpf] ?? "").replace(/\D/g, "").padStart(11, "0");
    const rhid = (l[col.rhid] ?? "").trim();
    if (!/^\d{1,9}$/.test(rhid) || /^0+$/.test(cpf) || /\bTESTE\b/.test(chave(nome))) { ignorados.push(nome || "(sem nome)"); continue; }
    itens.push({
      rhid, cpf, nome: nome.toUpperCase(), empregador: empregadorDe(l[col.empresa] ?? ""),
      departamento: (l[col.dep] ?? "").trim() || null, cargo: (l[col.cargo] ?? "").trim() || null, admissao: dataIso(l[col.adm] ?? ""),
    });
  }
  return { itens, erro: itens.length ? null : "Nenhum funcionário ativo no arquivo.", ignorados };
}

/** Distância de edição (Levenshtein) entre dois textos curtos. */
function distancia(a: string, b: string): number {
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = atual;
  }
  return ant[b.length];
}

/** Nome parecido: mesmo primeiro nome e diferença de até 10% das letras (ex.: VAUDREUIL PIERRE × VAUDREIL PIERRI). */
export function nomeParecido(a: string, b: string): boolean {
  const x = chave(a), y = chave(b);
  return x.split(" ")[0] === y.split(" ")[0] && distancia(x, y) <= Math.max(1, Math.floor(Math.max(x.length, y.length) * 0.1));
}

export type ColaboradorParaCasar = {
  id: string; nome: string; cpf: string | null; id_rhid: string | null; cod_fornecedor: string | null; empregador: string;
  departamento: string | null; funcao: string | null; data_admissao: string | null;
};

export type Casamento = {
  item: FuncionarioControlId;
  como: "rhid" | "cpf" | "nome" | "parecido" | "novo";
  colaborador: ColaboradorParaCasar | null;
  /** campos vazios no cadastro que serão completados */
  completa: Partial<Record<"id_rhid" | "cpf" | "departamento" | "funcao" | "data_admissao", string>>;
  /** diferenças que NÃO são gravadas (o cadastro manda): para o RH conferir */
  diferencas: string[];
};

const cpfMascara = (c: string) => c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
const so = (c: string | null) => (c ?? "").replace(/\D/g, "");

export function casarComCadastro(itens: readonly FuncionarioControlId[], cadastro: readonly ColaboradorParaCasar[]): Casamento[] {
  const usados = new Set<string>();
  return itens.map((item) => {
    const livres = cadastro.filter((c) => !usados.has(c.id));
    let como: Casamento["como"] = "novo";
    let c = livres.find((x) => x.id_rhid === item.rhid);
    if (c) como = "rhid";
    if (!c && (c = livres.find((x) => so(x.cpf) === item.cpf))) como = "cpf";
    if (!c) {
      const iguais = livres.filter((x) => chave(x.nome) === chave(item.nome) && (!x.cpf || so(x.cpf) === item.cpf));
      if (iguais.length === 1) { c = iguais[0]; como = "nome"; }
    }
    if (!c) {
      const parecidos = livres.filter((x) => !x.cpf && nomeParecido(x.nome, item.nome));
      if (parecidos.length === 1) { c = parecidos[0]; como = "parecido"; }
    }
    if (!c) return { item, como: "novo", colaborador: null, completa: {}, diferencas: [] };
    usados.add(c.id);
    const completa: Casamento["completa"] = {};
    const diferencas: string[] = [];
    if (!c.id_rhid) completa.id_rhid = item.rhid; else if (c.id_rhid !== item.rhid) diferencas.push(`nº RHiD ${c.id_rhid} no cadastro × ${item.rhid} no Control iD`);
    if (!c.cpf) completa.cpf = cpfMascara(item.cpf); else if (so(c.cpf) !== item.cpf) diferencas.push(`CPF ${c.cpf} no cadastro × ${cpfMascara(item.cpf)} no Control iD`);
    if (item.departamento) { if (!c.departamento) completa.departamento = item.departamento; else if (chave(c.departamento) !== chave(item.departamento)) diferencas.push(`departamento ${c.departamento} × ${item.departamento}`); }
    if (item.cargo && !c.funcao) completa.funcao = item.cargo.toUpperCase();
    if (item.admissao && !c.data_admissao) completa.data_admissao = item.admissao;
    if (chave(c.nome) !== chave(item.nome)) diferencas.push(`nome "${c.nome}" no cadastro × "${item.nome}" no Control iD`);
    if (c.empregador !== item.empregador) diferencas.push(`empresa ${c.empregador} × ${item.empregador}`);
    return { item, como, colaborador: c, completa, diferencas };
  });
}
