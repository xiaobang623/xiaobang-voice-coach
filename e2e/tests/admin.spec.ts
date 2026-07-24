import { expect, setupAdminApiMocks, test } from "../support/test";

test("模块 17：/admin 登录后能看到成本与运营看板", async ({ page }) => {
  await setupAdminApiMocks(page);
  await page.goto("/admin/login");

  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByText("小榜 · 管理后台")).toBeVisible();
  await page.getByLabel("用户名").fill("e2e-admin");
  await page.getByLabel("密码").fill("password123");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByText("今日数据")).toBeVisible();
  await expect(page.getByText("注册用户")).toBeVisible();
  await expect(page.getByText("成本").first()).toBeVisible();
  await expect(page.getByText("进入对话页 → 点「我准备好了」")).toBeVisible();
  await expect(page.getByRole("cell", { name: "雅菲" }).first()).toBeVisible();
  await expect(page.getByText("User: Today was busy")).toBeVisible();
});
