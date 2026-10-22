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

async function abrirPorBusca(page: Page, titulo: string) {
  await page.goto(`/gestao?visao=minhas&busca=${encodeURIComponent(titulo)}`);
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
