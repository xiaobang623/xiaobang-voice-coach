import { expect, seedRegisteredUser, setupAppMocks, test } from "../support/test";

test("模块 8/11/11.1/15：成长页展示统计、历史复盘、掌握度和 CEFR 等级", async ({ page }) => {
  await seedRegisteredUser(page);
  await setupAppMocks(page);
  await page.goto("/");
  await expect(page.getByText("准备好开口了吗")).toBeVisible();

  await page.getByRole("button", { name: "我的" }).click();
  await expect(page.getByText("雅菲")).toBeVisible();
  await expect(page.getByText("我的进度")).toBeVisible();
  await expect(page.getByText("B2").first()).toBeVisible();
  await expect(page.getByText("练习次数").first()).toBeVisible();
  await expect(page.getByText("未掌握").first()).toBeVisible();
  await expect(page.getByText("已掌握").first()).toBeVisible();

  await page.getByRole("button", { name: /查看全部表达/ }).click();
  await expect(page.getByText("表达掌握度")).toBeVisible();
  await expect(page.getByText("I really like coffee")).toBeVisible();
  await page.getByRole("button", { name: /复习中/ }).click();
  await expect(page.getByText("I ended up...")).toBeVisible();
  await page.getByRole("button", { name: /已掌握/ }).click();
  await expect(page.getByText("Today has been pretty busy.")).toBeVisible();

  await page.getByRole("button", { name: /返回/ }).click();
  await page.getByRole("button", { name: /完整记录/ }).click();
  await expect(page.getByText("完整等级体系")).toBeVisible();
  await expect(page.getByText("A1")).toBeVisible();
  await expect(page.getByText("C2")).toBeVisible();
  await expect(page.getByText("最近点评")).toBeVisible();
  await page.getByRole("button", { name: /今天过得怎么样/ }).first().click();
  await expect(page.getByText("这次复盘")).toBeVisible();
});
