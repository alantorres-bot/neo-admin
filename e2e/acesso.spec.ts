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

  test("oferece entrar com o Google por um link (não por formulário)", async ({ page }) => {
    await page.goto("/login?proximo=%2Fconfiguracoes%2Fempresas");
    const link = page.getByRole("link", { name: "Entrar com Google" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/auth/google?proximo=%2Fconfiguracoes%2Fempresas");
  });

  test("mostra o motivo quando o e-mail não tem cadastro", async ({ page }) => {
    await page.goto("/login?erro=sem_cadastro");
    // getByText, não getByRole("alert"): o Next injeta um anunciador de rota que também tem role="alert".
    await expect(page.getByText("ainda não tem acesso")).toBeVisible();
  });

  test("a volta do Google é pública: sem código, volta ao login com aviso", async ({ page }) => {
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/login\?erro=google$/);
    await expect(page.getByText("Não foi possível entrar com o Google")).toBeVisible();
  });

  test("não aceita enviar vazio", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/login/);
    const invalido = await page.getByLabel("E-mail").evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(invalido).toBe(true);
  });
});
