import { expect, gotoApp, test } from "../support/test";

test("模块 9：游客态权限边界——可练习但不展示登录后的小榜记忆入口", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "我的" }).click();

  await expect(page.getByText("游客")).toBeVisible();
  await expect(page.getByText("登录后，这里会记录你的练习次数")).toBeVisible();
  await expect(page.getByText("小榜记忆")).not.toBeVisible();
  await expect(page.getByText("小榜记得的关于你")).not.toBeVisible();

  await page.getByRole("button", { name: "登录 / 注册" }).first().click();
  await expect(page.getByText("不登录也能去「练习」随便聊")).toBeVisible();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "注册" })).toBeVisible();
});

test("模块 9：注册/登录表单能切换并进入注册用户状态", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "登录 / 注册" }).first().click();

  await page.getByRole("tab", { name: "注册" }).click();
  await page.getByPlaceholder("昵称（例如：小明）").fill("雅菲");
  await page.getByPlaceholder("邮箱").fill("yafei@example.com");
  await page.getByPlaceholder("设置密码（至少 6 位）").fill("password123");
  await page.getByRole("button", { name: "注册" }).click();

  await expect(page.getByText("雅菲").first()).toBeVisible();
  await expect(page.getByText("个人资料")).toBeVisible();
});
