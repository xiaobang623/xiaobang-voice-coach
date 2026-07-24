import { expect, gotoApp, test } from "../support/test";

test("模块 1/1.1：话题卡进入半屏准备页，准备后可安全返回首页", async ({ page }) => {
  await gotoApp(page);

  await expect(page.getByText("选择场景")).toBeVisible();
  await expect(page.getByRole("button", { name: /开始对话/ })).toBeVisible();

  await page.getByRole("button", { name: "今天过得怎么样" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("开口准备")).toBeVisible();
  await expect(page.getByText("先准备一句，再开口")).toBeVisible();
  await expect(page.getByText("不会写入聊天记录，点按钮后才开始收音。"))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "我准备好了" })).toBeEnabled({ timeout: 10_000 });

  await page.getByRole("button", { name: "我准备好了" }).click();
  await expect(page.getByText(/麦克风开着|小榜在听/)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /返回/ }).click();
  await expect(page.getByText("准备好开口了吗")).toBeVisible();
  await expect(page.getByText("选择场景")).toBeVisible();
});
