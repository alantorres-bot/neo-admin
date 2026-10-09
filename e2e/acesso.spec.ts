import { expect, test } from "@playwright/test";

test.describe("proteção de rotas (sem login)", () => {
  for (const rota of ["/", "/inicio", "/configuracoes/usuarios", "/financeiro/recebiveis", "/financeiro/recebiveis/fila", "/financeiro/cobranca", "/conta"]) {
    test(`${rota} leva ao login`, async ({ page }) => {
      await page.goto(rota);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    });
  }

  test("o login lembra para onde o usuário queria ir", async ({ page }) => {
    await page.goto("/configuracoes/empresas");
    await expect(page).toHaveURL(/\/login\?proximo=%2Fconfiguracoes%2Fempresas/);
  });
});

test.describe("tela de login", () => {
  test("está em português e pede e-mail e senha", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Senha")).toBeVisible();
  });

  test("não aceita enviar vazio", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/login/);
    const invalido = await page.getByLabel("E-mail").evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(invalido).toBe(true);
  });
});
