// Departamento de cada pessoa a partir do cadastro de funcionários do Control iD (person_AAAAMMDDhhmmss.csv, separador ";").
// Esse arquivo traz dados muito sensíveis (senha, PIN, endereço, RG, filiação): daqui só saem CPF e Departamento, lidos no
// navegador. O departamento vira o setor da pessoa no banco de horas quando há setor do RH > Ponto com o mesmo nome.

export const chaveSetor = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export function lerDepartamentos(matriz: readonly (readonly string[])[]): { itens: { cpf: string; departamento: string }[]; erro: string | null } {
  const cab = (matriz[0] ?? []).map((c) => chaveSetor(c.replace(/^﻿/, "")));
  const iCpf = cab.indexOf("CPF");
  const iDep = cab.indexOf("DEPARTAMENTO");
  if (iCpf < 0 || iDep < 0) return { itens: [], erro: "Não é o cadastro de funcionários do Control iD: faltam as colunas CPF e Departamento." };
  const itens = matriz.slice(1)
    .map((l) => ({ cpf: (l[iCpf] ?? "").replace(/\D/g, ""), departamento: (l[iDep] ?? "").trim() }))
    .filter((x) => x.cpf.length === 11 && x.departamento);
  return { itens, erro: itens.length ? null : "Nenhuma pessoa com CPF e departamento no arquivo." };
}

/** Casa departamento com setor pelo nome (sem acento e caixa). Devolve os casados e os departamentos sem setor. */
export function setoresPorDepartamento(itens: readonly { cpf: string; departamento: string }[], setores: readonly { id: string; nome: string }[]) {
  const porNome = new Map(setores.map((s) => [chaveSetor(s.nome), s.id]));
  const casados = itens.flatMap((x) => (porNome.has(chaveSetor(x.departamento)) ? [{ cpf: x.cpf, setor: porNome.get(chaveSetor(x.departamento))! }] : []));
  const semSetor = [...new Set(itens.filter((x) => !porNome.has(chaveSetor(x.departamento))).map((x) => x.departamento))].sort();
  return { casados, semSetor };
}
