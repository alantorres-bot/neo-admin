// Casa o nome do funcionário no relatório do Control iD com o cadastro único do RH (rh_colaboradores). A matrícula do
// Control iD quase sempre vem 0 ou "-", então o casamento é pelo nome: igual (sem acento, maiúsculas, espaços), ou, se não
// houver, primeiro + último nome iguais e um só candidato. Quem não casar entra "sem cadastro" (o RH vincula depois).

export const normalizarNome = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();

const pontas = (n: string) => {
  const p = normalizarNome(n).split(" ");
  return `${p[0]} ${p[p.length - 1]}`;
};

export function casarColaborador(nome: string, cadastro: readonly { id: string; nome: string }[]): string | null {
  const alvo = normalizarNome(nome);
  const iguais = cadastro.filter((c) => normalizarNome(c.nome) === alvo);
  if (iguais.length === 1) return iguais[0].id;
  if (iguais.length > 1) return null;
  const parecidos = cadastro.filter((c) => pontas(c.nome) === pontas(nome));
  return parecidos.length === 1 ? parecidos[0].id : null;
}
