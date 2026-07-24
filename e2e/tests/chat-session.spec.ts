import { expect, gotoApp, startMockedTypingConversation, test } from "../support/test";

test("模块 2/3/4：语音链路 mock 后聊天气泡、字幕开关、设置面板正常工作", async ({ page }) => {
  await gotoApp(page);
  await startMockedTypingConversation(page);

  await page.getByRole("button", { name: "练习设置" }).click();
  await expect(page.getByRole("button", { name: "语速 正常" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "语速 慢" })).toBeDisabled();

  await page.getByTitle("关掉字幕，纯听力练习").click();
  await expect(page.getByTitle("打开字幕")).toBeVisible();
});
