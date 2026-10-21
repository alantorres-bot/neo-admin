// Textos de "O que fazer aqui" do Banco de horas, em linguagem simples para quem opera. Serão a base do POP (a gerar quando o
// módulo estiver concluído, com a skill pop-neoformas:gerar-pop).

export const REGRA_EM_UMA_FRASE = [
  "Horas a mais (crédito): a pessoa tem até o dia 25 do 6º mês depois do mês em que fez as horas para FOLGAR. O que sobrar, a EMPRESA PAGA na folha daquele mês.",
  "Horas a menos (débito): mesmo prazo para REPOR trabalhando a mais. O que sobrar é DESCONTADO na folha daquele mês.",
  "O mais antigo é acertado primeiro: hora a mais abate a hora a menos mais antiga, e vice-versa.",
  "Exemplo: 3h a mais em 10/05 → folgar até 25/11 → senão a empresa paga na folha de novembro.",
];

export const AJUDA: Record<"saldos" | "fechamentos" | "importacoes" | "parametros", { titulo: string; passos: string[] }> = {
  saldos: {
    titulo: "Saldos: quem tem horas para folgar ou repor",
    passos: [
      "Confira os cartões amarelos no topo: são os setores com horas vencendo nos próximos 30 dias.",
      "Clique em \"E-mail ao líder\" em cada cartão. O e-mail abre no seu Gmail; confira e envie.",
      "Pessoa sem setor? Escolha o setor na coluna Setor (só uma vez).",
      "Para entregar ao funcionário, abra o nome dele e clique em \"Extrato\" (imprime com linha de assinatura).",
    ],
  },
  fechamentos: {
    titulo: "Fechamento do mês: quem a empresa paga e quem é descontado",
    passos: [
      "Todo mês, depois do dia 25: em Importações, importe o CSV do Control iD até o dia 25 (Neo e Oeste).",
      "Aqui, clique em \"Emitir fechamento\" do mês. O sistema lista quem a empresa paga e quem é descontado.",
      "Peça ao gestor do RH para conferir e clicar em \"Aprovar\".",
      "Imprima o relatório (botão \"Relatório\") e envie ao escritório contábil junto com o ponto; depois clique em \"Enviado ao escritório\".",
      "Quando o escritório lançar na folha, clique em \"Lançado na folha\". Só aí as horas saem do saldo.",
    ],
  },
  importacoes: {
    titulo: "Importações: trazer o banco de horas do Control iD",
    passos: [
      "No Control iD, exporte o relatório de banco de horas em CSV, de todas as pessoas, do período (Neo e Oeste).",
      "Clique em \"Importar CSV\", escolha os arquivos (pode ser mais de um) e confira a prévia: não pode haver aviso de período sem arquivo.",
      "Clique em \"Gravar\". Importar de novo o mesmo período só corrige; não duplica.",
      "Entrou gente nova? Clique em \"Setores pelo cadastro\" e escolha o cadastro de funcionários do Control iD (person_….csv).",
    ],
  },
  parametros: {
    titulo: "Parâmetros (só o gestor)",
    passos: [
      "Validade: 6 meses (acordo individual de banco de horas). Só mude se o acordo mudar.",
      "Aviso: quantos dias antes do vencimento o RH e o líder são avisados.",
      "Alerta de negativo: a partir de quantas horas devendo a pessoa aparece em alerta.",
    ],
  },
};
