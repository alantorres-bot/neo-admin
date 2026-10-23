// Central de Gestão pela interface (ver playwright.central.config.ts). Usa os usuários e as pendências [DEMO] de
// scripts/local-sem-docker/central-demo.sh. Fase 2: só leitura (indicadores, intervenção, equipe, fila, detalhe, permissões).
import { expect, test, type Page } from "@playwright/test";

const SENHA = process.env.CENTRAL_E2E_SENHA ?? "Teste-local-123";

async function entrar(page: Page, quem: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${quem}@neoformas.com.br`);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

const fila = (page: Page) => page.locator("#fila table");

test.describe("gestor (todas as áreas)", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, "gestor.teste");
  });

  test("abre pelo menu, mostra indicadores e o que exige intervenção com o motivo", async ({ page }) => {
    await page.goto("/inicio");
    await page.getByRole("link", { name: "Central", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Central de Gestão" })).toBeVisible();
    await expect(page.getByText("Gestão: todas as áreas")).toBeVisible();
    for (const rotulo of ["Em aberto", "Atrasadas", "Vencem hoje", "Exigem intervenção", "Aguardando gestor", "Bloqueadas", "Precisam distribuir"]) {
      await expect(page.getByRole("link", { name: new RegExp(rotulo) }).first()).toBeVisible();
    }
    const bloco = page.locator("li", { hasText: "[DEMO] Anexar boleto: NF 1234" }).first();
    await expect(bloco.getByText(/Bloqueada há \d+ dias \(limite de 2 dias\): Aguardando o extrato do banco/)).toBeVisible();
    await expect(bloco.getByText("Resolver o bloqueio com o responsável")).toBeVisible();
    const decisao = page.locator("li", { hasText: "[DEMO] Confirmar pagamento: Cliente Exemplo A" }).first();
    await expect(decisao.getByText(/Aguarda decisão do gestor desde .*Autorizar desconto de 5%/)).toBeVisible();
    await expect(page.getByText("Acompanhamento da equipe", { exact: true })).toBeVisible();
  });

  test("clicar num indicador mostra as pendências que o compõem", async ({ page }) => {
    await page.goto("/gestao");
    await page.getByRole("link", { name: /Atrasadas/ }).first().click();
    await expect(page).toHaveURL(/recorte=atrasadas/);
    await expect(page.getByText("Mostrando: Atrasadas")).toBeVisible();
    await expect(fila(page).getByText("[DEMO] Anexar boleto: NF 1234")).toBeVisible();
    await expect(fila(page).getByText("[DEMO] Fechar folha do mês")).toHaveCount(0);
  });

  test("filtra por área e abre o detalhe com os motivos", async ({ page }) => {
    await page.goto("/gestao");
    await page.getByLabel("Área").selectOption("rh");
    await page.getByRole("button", { name: "Filtrar", exact: true }).click();
    await expect(page).toHaveURL(/area=rh/);
    await expect(fila(page).getByText("[DEMO] Fechar folha do mês")).toBeVisible();
    await expect(fila(page).getByText("[DEMO] Anexar boleto")).toHaveCount(0);

    await page.goto("/gestao?busca=Anexar%20boleto");
    await fila(page).getByRole("link", { name: /\[DEMO\] Anexar boleto/ }).click();
    await expect(page.getByText("Por que está em destaque", { exact: true })).toBeVisible();
    await expect(page.getByText(/Atrasada há \d+ dias \(limite de 5 dias\)/)).toBeVisible();
    await expect(page.locator("a", { hasText: "Abrir no módulo" })).toHaveAttribute("href", "/financeiro/recebiveis");
  });
});

test.describe("operador do Fiscal", () => {
  test("vê só o que é dele e não abre pendência do Financeiro pelo endereço", async ({ page }) => {
    await entrar(page, "gestor.teste");
    await page.goto("/gestao?busca=Anexar%20boleto");
    const href = await fila(page).getByRole("link", { name: /\[DEMO\] Anexar boleto/ }).getAttribute("href");

    await entrar(page, "operador.fiscal.teste");
    await page.goto("/gestao");
    await expect(page.getByText("Minhas pendências e as sem responsável")).toBeVisible();
    await expect(page.getByRole("link", { name: "Gestão", exact: true })).toHaveCount(0);
    await expect(fila(page).getByText("[DEMO] Fiscal: conferir arquivo enviado pelo contador")).toBeVisible();
    await expect(page.getByText("[DEMO] Anexar boleto")).toHaveCount(0);
    await expect(page.getByText("[DEMO] Levantar contratos")).toHaveCount(0);

    const resposta = await page.goto(href!);
    expect(resposta?.status()).toBe(404);
  });
});

// --- Fase 3: criação, distribuição e andamento -------------------------------------------------------------------------

const sufixo = Date.now().toString().slice(-6);
const dialogo = (page: Page) => page.getByRole("dialog");

async function abrirPorBusca(page: Page, titulo: string, visao: "minhas" | "gestao" = "minhas") {
  await page.goto(`/gestao?visao=${visao}&busca=${encodeURIComponent(titulo)}`);
  await page.goto((await fila(page).getByRole("link", { name: titulo }).getAttribute("href"))!);
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
}

test.describe("tarefas (Fase 3)", () => {
  test("gestor cria e atribui; responsável de outra área inicia, bloqueia, comenta, desbloqueia e conclui", async ({ page }) => {
    const titulo = `[DEMO] Levantar contratos ${sufixo}`;
    await entrar(page, "gestor.teste");
    await page.goto("/gestao");
    await page.getByRole("button", { name: "Nova tarefa" }).click();
    await dialogo(page).getByLabel("Título").fill(titulo);
    await dialogo(page).getByLabel("Módulo").selectOption("administrativo.gestao");
    await dialogo(page).getByLabel("Responsável").selectOption({ label: "Operador Fiscal Teste" });
    await dialogo(page).getByLabel("Prioridade").selectOption("alta");
    await dialogo(page).getByLabel("Observações (opcional)").fill("Começar pelos de locação");
    await dialogo(page).getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByText("Tarefa criada.")).toBeVisible();

    await entrar(page, "operador.fiscal.teste");
    await abrirPorBusca(page, titulo);
    await page.getByRole("button", { name: "Iniciar" }).click();
    await expect(page.getByText("Pendência em andamento.")).toBeVisible();

    await page.getByRole("button", { name: "Bloquear" }).click();
    await dialogo(page).getByLabel("Motivo do bloqueio").fill("Aguardando cópia do jurídico");
    await dialogo(page).getByRole("button", { name: "Bloquear" }).click();
    await expect(page.getByText("Bloqueio registrado.")).toBeVisible();
    await expect(page.getByText("Em andamento · bloqueada").first()).toBeVisible();

    await page.getByRole("button", { name: "Comentar" }).click();
    await dialogo(page).getByLabel("Comentário").fill("Pedi a cópia por e-mail");
    await dialogo(page).getByRole("button", { name: "Comentar" }).click();
    await expect(page.getByText("Comentário registrado.")).toBeVisible();

    await page.getByRole("button", { name: "Desbloquear" }).click();
    await dialogo(page).getByRole("button", { name: "Desbloquear" }).click();
    await expect(page.getByText("Pendência desbloqueada.")).toBeVisible();

    await page.getByRole("button", { name: "Concluir" }).click();
    await dialogo(page).getByLabel("Observação da conclusão (opcional)").fill("Planilha enviada ao Alan");
    await dialogo(page).getByRole("button", { name: "Concluir" }).click();
    await expect(page.getByText("Pendência concluída.")).toBeVisible();

    const historico = page.locator("ol");
    for (const texto of ["Criou a tarefa", "Observação: Começar pelos de locação", "Situação: Aberta → Em andamento",
      "Bloqueou: Aguardando cópia do jurídico", "Comentou: Pedi a cópia por e-mail", "Desbloqueou",
      "Situação: Em andamento → Concluída", "Comentou: Planilha enviada ao Alan"]) {
      await expect(historico.getByText(texto, { exact: true })).toBeVisible();
    }
    // O responsável não reabre (só o gestor).
    await expect(page.getByRole("button", { name: "Reabrir" })).toHaveCount(0);
  });

  test("pedido de decisão: o responsável pede, aparece em 'Aguardando gestor' e o gestor responde", async ({ page }) => {
    const titulo = `[DEMO] Desconto para cliente ${sufixo}`;
    await entrar(page, "gestor.teste");
    await page.goto("/gestao");
    await page.getByRole("button", { name: "Nova tarefa" }).click();
    await dialogo(page).getByLabel("Título").fill(titulo);
    await dialogo(page).getByLabel("Módulo").selectOption("financeiro.recebiveis");
    await dialogo(page).getByLabel("Responsável").selectOption({ label: "Operador Financeiro Teste" });
    await dialogo(page).getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByText("Tarefa criada.")).toBeVisible();

    await entrar(page, "operador.financeiro.teste");
    await abrirPorBusca(page, titulo);
    await page.getByRole("button", { name: "Pedir decisão do gestor" }).click();
    await dialogo(page).getByLabel("O que precisa ser decidido?").fill("Posso conceder 5% de desconto?");
    await dialogo(page).getByRole("button", { name: "Pedir decisão do gestor" }).click();
    await expect(page.getByText("Pedido enviado ao gestor.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Responder decisão" })).toHaveCount(0);

    await entrar(page, "gestor.teste");
    await page.goto(`/gestao?recorte=aguarda_gestor&busca=${encodeURIComponent(titulo)}`);
    await page.goto((await fila(page).getByRole("link", { name: titulo }).getAttribute("href"))!);
    await expect(page.getByText(/Aguarda decisão do gestor desde .*Posso conceder 5% de desconto\?/).first()).toBeVisible();
    await page.getByRole("button", { name: "Responder decisão" }).click();
    await dialogo(page).getByLabel("Sua decisão").fill("Pode, até 5%.");
    await dialogo(page).getByRole("button", { name: "Responder decisão" }).click();
    await expect(page.getByText("Decisão registrada.")).toBeVisible();
    await expect(page.locator("ol").getByText("Respondeu ao pedido de decisão: Pode, até 5%.", { exact: true })).toBeVisible();
  });

  test("operador só cria tarefa para si ou sem responsável", async ({ page }) => {
    await entrar(page, "operador.fiscal.teste");
    await page.goto("/gestao");
    await page.getByRole("button", { name: "Nova tarefa" }).click();
    const opcoes = await dialogo(page).getByLabel("Responsável").locator("option").allTextContents();
    expect(opcoes).toEqual(["Sem responsável", "Operador Fiscal Teste (eu)"]);
    const modulos = await dialogo(page).getByLabel("Módulo").locator("option").allTextContents();
    expect(modulos.every((m) => m.startsWith("Fiscal"))).toBe(true);
  });
});

// --- Fase 3B: atividades e acessos -------------------------------------------------------------------------------------

test.describe.serial("atividades da equipe (Fase 3B)", () => {
  test("cada um vê só as próprias atividades; gestor de área sem a marca também", async ({ page }) => {
    await entrar(page, "operador.fiscal.teste");
    await page.goto("/gestao/atividades");
    await expect(page.getByRole("heading", { name: "Minhas atividades" })).toBeVisible();
    await expect(page.getByLabel("Pessoa")).toHaveCount(0);
    await expect(page.getByText("Linha do tempo de Operador Fiscal Teste")).toBeVisible();
    await expect(page.locator("table").getByText(/Concluiu "\[DEMO\] Levantar contratos/).first()).toBeVisible();
    await expect(page.locator("table").getByText("Operador Financeiro Teste")).toHaveCount(0);

    await entrar(page, "gestor.teste");
    await page.goto("/gestao/atividades");
    await expect(page.getByRole("heading", { name: "Minhas atividades" })).toBeVisible();
  });

  test("o admin marca 'Acompanha a equipe' e o gestor passa a ver o resumo de todos", async ({ page }) => {
    await entrar(page, "admin.teste");
    await page.goto("/configuracoes/usuarios");
    const linha = page.getByRole("row", { name: /Gestor Geral Teste/ });
    await linha.getByRole("button", { name: "Permissões" }).click();
    const caixa = page.getByRole("dialog").getByLabel(/Acompanha a equipe/);
    if (!(await caixa.isChecked())) await caixa.check();
    await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Permissões salvas.")).toBeVisible();

    await entrar(page, "gestor.teste");
    await page.goto("/gestao/atividades");
    await expect(page.getByRole("heading", { name: "Atividades da equipe" })).toBeVisible();
    const resumo = page.locator("table").first();
    await expect(resumo.getByRole("link", { name: "Operador Fiscal Teste" })).toBeVisible();
    await page.goto((await resumo.getByRole("link", { name: "Operador Fiscal Teste" }).getAttribute("href"))!);
    await expect(page.getByText("Linha do tempo de Operador Fiscal Teste")).toBeVisible();

    // Desfaz a marca (o teste pode rodar de novo no mesmo banco).
    await entrar(page, "admin.teste");
    await page.goto("/configuracoes/usuarios");
    await page.getByRole("row", { name: /Gestor Geral Teste/ }).getByRole("button", { name: "Permissões" }).click();
    await page.getByRole("dialog").getByLabel(/Acompanha a equipe/).uncheck();
    await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Permissões salvas.")).toBeVisible();
  });

  test("registro de acessos: desligado por padrão; o admin liga e a navegação passa a aparecer", async ({ page }) => {
    await entrar(page, "admin.teste");
    await page.goto("/gestao/atividades");
    await expect(page.getByText(/O registro de acessos .* está desligado/)).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Ligar registro de acessos" }).click();
    await expect(page.getByText("Registro de acessos ligado.")).toBeVisible();

    await entrar(page, "operador.fiscal.teste");
    await page.goto("/fiscal/creditos");
    await page.goto("/gestao/atividades");
    await expect(page.locator("table").getByText("/fiscal/creditos", { exact: true }).first()).toBeVisible();

    await entrar(page, "admin.teste");
    await page.goto("/gestao/atividades");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Desligar registro de acessos" }).click();
    await expect(page.getByText("Registro de acessos desligado.")).toBeVisible();
  });

  test("exporta a planilha com os mesmos filtros", async ({ page }) => {
    await entrar(page, "gestor.teste");
    const r = await page.request.get("/gestao/atividades/exportar");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("spreadsheetml");
    expect((await r.body()).length).toBeGreaterThan(1000);
  });
});

// --- Fase 4: criticidade e priorização ---------------------------------------------------------------------------------

test.describe.serial("criticidade (Fase 4)", () => {
  test("todos veem as regras; só o admin aprova os limites", async ({ page }) => {
    await entrar(page, "operador.fiscal.teste");
    await page.goto("/gestao/regras");
    await expect(page.getByRole("heading", { name: "Como a Central classifica" })).toBeVisible();
    await expect(page.getByText(/Atrasada há mais de \d+ dias, ou atrasada com prioridade crítica/)).toBeVisible();
    await expect(page.getByRole("button", { name: /limites/ })).toHaveCount(0);

    await entrar(page, "admin.teste");
    await page.goto("/gestao/regras");
    await page.getByRole("button", { name: /limites/ }).click();
    await page.getByRole("dialog").getByLabel("Atraso relevante (dias)").fill("5");
    await page.getByRole("dialog").getByRole("button", { name: "Salvar e aprovar" }).click();
    await expect(page.getByText("Limites salvos e aprovados.")).toBeVisible();
    await expect(page.getByText(/Aprovados por Admin Teste em/)).toBeVisible();
  });

  test("gestor registra impacto com fundamento e a pendência passa a exigir intervenção, com o motivo", async ({ page }) => {
    const titulo = `[DEMO] Guia de ICMS ${sufixo}`;
    await entrar(page, "gestor.teste");
    await page.goto("/gestao");
    await page.getByRole("button", { name: "Nova tarefa" }).click();
    await dialogo(page).getByLabel("Título").fill(titulo);
    await dialogo(page).getByLabel("Módulo").selectOption("fiscal.creditos");
    await dialogo(page).getByLabel("Responsável").selectOption({ label: "Operador Fiscal Teste" });
    const amanha = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Cuiaba" });
    await dialogo(page).getByLabel("Prazo").fill(amanha);
    await dialogo(page).getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByText("Tarefa criada.")).toBeVisible();

    await abrirPorBusca(page, titulo, "gestao");
    await page.getByRole("button", { name: "Alterar dados" }).click();
    await dialogo(page).getByLabel("Impacto", { exact: true }).selectOption("fiscal");
    await dialogo(page).getByLabel("Fundamento do impacto").fill("Multa e juros se a guia não for paga no vencimento");
    await dialogo(page).getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Dados alterados.")).toBeVisible();
    await expect(page.getByText("Impacto fiscal registrado: Multa e juros se a guia não for paga no vencimento")).toBeVisible();
    await expect(page.getByText("Intervir").first()).toBeVisible();

    await page.goto("/gestao");
    await expect(page.getByText("Áreas e módulos que precisam de atenção")).toBeVisible();
    await expect(page.locator("table").getByRole("link", { name: "Créditos tributários" }).first()).toBeVisible();
  });
});

// --- Fase 5: sugestões de melhoria -------------------------------------------------------------------------------------

test.describe.serial("sugestões de melhoria (Fase 5)", () => {
  const titulo = `[DEMO] Importar o extrato OFX ${sufixo}`;

  test("dentro do módulo, 'Sugerir melhoria' já vem com área e módulo; a sugestão aparece como minha", async ({ page }) => {
    await entrar(page, "operador.financeiro.teste");
    await page.goto("/financeiro/recebiveis");
    await page.getByRole("button", { name: "Sugerir melhoria" }).click();
    await expect(dialogo(page).getByLabel("Área")).toHaveValue("financeiro");
    await expect(dialogo(page).getByLabel("Módulo (opcional)")).toHaveValue("financeiro.recebiveis");
    await dialogo(page).getByLabel("Título").fill(titulo);
    await dialogo(page).getByLabel("Melhoria sugerida").fill("Ler o OFX do banco em vez de digitar o extrato");
    await dialogo(page).getByLabel("Problema observado (opcional)").fill("Digitação manual com erros");
    await dialogo(page).getByRole("button", { name: "Enviar sugestão" }).click();
    await expect(page.getByText(/Sugestão enviada/)).toBeVisible();

    await page.goto("/gestao/sugestoes");
    const linha = page.getByRole("row", { name: new RegExp(titulo.replace(/[[\]]/g, "\\$&")) });
    await expect(linha.getByText("(minha)")).toBeVisible();
    await expect(linha.getByText("Nova", { exact: true })).toBeVisible();
  });

  test("outra pessoa vê título e situação, sem abrir o conteúdo", async ({ page }) => {
    await entrar(page, "operador.fiscal.teste");
    await page.goto("/gestao/sugestoes");
    const linha = page.getByRole("row", { name: new RegExp(titulo.replace(/[[\]]/g, "\\$&")) });
    await expect(linha).toBeVisible();
    await expect(linha.getByRole("link")).toHaveCount(0);
  });

  test("o avaliador aprova com justificativa e cria a tarefa de implementação", async ({ page }) => {
    await entrar(page, "admin.teste");
    await page.goto("/gestao/sugestoes");
    const href = await page.getByRole("row", { name: new RegExp(titulo.replace(/[[\]]/g, "\\$&")) }).getByRole("link").getAttribute("href");
    await page.goto(href!);
    await expect(page.getByText("Digitação manual com erros")).toBeVisible();
    await page.getByRole("button", { name: "Avaliar / mudar situação" }).click();
    await dialogo(page).getByLabel("Nova situação").selectOption("aprovada");
    await dialogo(page).getByLabel("Prioridade").selectOption("alta");
    await dialogo(page).getByLabel("Justificativa da decisão").fill("Economiza tempo da conciliação");
    await dialogo(page).getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Sugestão atualizada.")).toBeVisible();
    await expect(page.locator("ol").getByText("Situação: Nova → Aprovada. Justificativa: Economiza tempo da conciliação")).toBeVisible();

    await page.getByRole("button", { name: "Criar tarefa de implementação" }).click();
    await dialogo(page).getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByText("Tarefa criada.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Implementar sugestão nº \d+/ })).toBeVisible();

    await entrar(page, "operador.fiscal.teste");
    await page.goto("/gestao/sugestoes?situacao=aprovada");
    await expect(page.getByRole("row", { name: new RegExp(titulo.replace(/[[\]]/g, "\\$&")) }).getByText("Economiza tempo da conciliação")).toBeVisible();
  });
});

// --- Fase 6: integração com os módulos ---------------------------------------------------------------------------------

test.describe("integração com os módulos (Fase 6)", () => {
  test("cobranças do Recebíveis aparecem no módulo Cobrança da Central", async ({ page }) => {
    await entrar(page, "gestor.teste");
    await page.goto("/gestao?visao=gestao&modulo=financeiro.cobranca");
    await expect(fila(page).getByText("Cobrar D+5: [DEMO] Cliente Exemplo C")).toBeVisible();
    await expect(fila(page).getByText("Cobrança", { exact: true }).first()).toBeVisible();
    await expect(fila(page).getByText(/Anexar boleto/)).toHaveCount(0);
  });

  test("obrigação fiscal a vencer chega à Central do responsável, com o vencimento como prazo e o link do módulo", async ({ page }) => {
    await entrar(page, "operador.fiscal.teste");
    await page.goto("/gestao?visao=minhas&busca=Entregar");
    const link = fila(page).getByRole("link", { name: /Entregar \[DEMO\] DCTF/ });
    await expect(link).toBeVisible();
    await page.goto((await link.getAttribute("href"))!);
    await expect(page.getByText(/Vence em 4 dias/).first()).toBeVisible();
    await expect(page.locator("a", { hasText: "Abrir no módulo" })).toHaveAttribute("href", /^\/fiscal\/creditos\/obrigacoes\//);
  });
});

// --- Fase 7: avisos (Slack) e ClickUp — nada é enviado de verdade -------------------------------------------------------

test.describe.serial("avisos e ClickUp (Fase 7)", () => {
  test("só o admin abre os avisos; tudo começa desligado; ligar um evento põe o aviso na fila sem enviar", async ({ page }) => {
    await entrar(page, "gestor.teste");
    await page.goto("/gestao/notificacoes");
    await expect(page).toHaveURL(/\/inicio/);   // não é admin: volta ao início

    await entrar(page, "admin.teste");
    await page.goto("/gestao/notificacoes");
    await expect(page.getByText(/Envio\s+desligado/)).toBeVisible();
    await page.getByRole("button", { name: "Configurar" }).click();
    const d = dialogo(page);
    await expect(d.getByLabel(/Envio ligado/)).not.toBeChecked();
    await d.getByLabel(/^Atribuição/).check();
    await d.getByLabel("Canal da gestão (ID do Slack)").fill("C0123ABCD");
    await d.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Configuração salva.")).toBeVisible();
    await expect(page.getByText(/eventos ligados: Atribuição/)).toBeVisible();

    const titulo = `[DEMO] Aviso de atribuição ${sufixo}`;
    await entrar(page, "gestor.teste");
    await page.goto("/gestao");
    await page.getByRole("button", { name: "Nova tarefa" }).click();
    await dialogo(page).getByLabel("Título").fill(titulo);
    await dialogo(page).getByLabel("Módulo").selectOption("financeiro.recebiveis");
    await dialogo(page).getByLabel("Responsável").selectOption({ label: "Operador Financeiro Teste" });
    await dialogo(page).getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByText("Tarefa criada.")).toBeVisible();

    await entrar(page, "admin.teste");
    await page.goto("/gestao/notificacoes");
    const linha = page.getByRole("row", { name: new RegExp(titulo.replace(/[[\]]/g, "\\$&")) });
    await expect(linha.getByText("Na fila")).toBeVisible();
    await expect(linha.getByText("Operador Financeiro Teste")).toBeVisible();

    // sem a função publicada (ambiente local), o botão informa e não quebra a tela
    await page.getByRole("button", { name: "Gerar lembretes e enviar agora" }).click();
    await expect(page.getByText(/não respondeu|desligado|nao_configurado|SLACK_BOT_TOKEN/).first()).toBeVisible();

    // desliga de novo (o teste pode rodar outra vez no mesmo banco)
    await page.getByRole("button", { name: "Configurar" }).click();
    await dialogo(page).getByLabel(/^Atribuição/).uncheck();
    await dialogo(page).getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Configuração salva.")).toBeVisible();
  });

  test("gestor marca uma pendência para o ClickUp; o admin cadastra o usuário do Slack da pessoa", async ({ page }) => {
    await entrar(page, "gestor.teste");
    await abrirPorBusca(page, `[DEMO] Aviso de atribuição ${sufixo}`, "gestao");
    await page.getByRole("button", { name: "Enviar ao ClickUp" }).click();
    await expect(page.getByText("Será enviada ao ClickUp no próximo envio.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Não enviar ao ClickUp" })).toBeVisible();

    await entrar(page, "admin.teste");
    await page.goto("/configuracoes/usuarios");
    await page.getByRole("row", { name: /Operador Financeiro Teste/ }).getByRole("button", { name: "Permissões" }).click();
    await page.getByRole("dialog").getByLabel(/Usuário do Slack/).fill("u0123abcd");
    await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Permissões salvas.")).toBeVisible();
  });
});
