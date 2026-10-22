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
