# 新表达复练挑战 · 设计说明

日期：2026-07-16  
状态：设计稿，待实现  
范围：小榜 Voice Coach 报告页后的新表达复练闭环

## 1. 背景与目标

当前复盘报告已经能产出 `growth.newExpressions`，但用户看完表达后没有一个低摩擦的“马上开口复用”入口。这个功能要把报告里的新表达转成 2 分钟短会话，让用户在自然聊天里尝试使用这些表达。

核心目标：

- 让报告不只停留在“看懂”，而是进入“复用”。
- 第一版保持轻量，不打分、不强判定完成，避免像考试。
- 复练结果独立沉淀为一个小结，方便用户知道自己尝试了什么、下次还可以怎么说。

## 2. 第一版用户流程

1. 用户完成普通口语练习并进入复盘报告。
2. 报告页在「新表达」区域展示 3-5 个表达。
3. 用户点击按钮：`复练这些表达`。
4. 系统从本次报告的 `newExpressions` 中选择 2-3 个作为目标表达。
5. 进入一个新的短会话模式：`expression_practice`。
6. 开场准备页明确展示目标表达，让用户知道这次要尝试复用什么。
7. 用户和小榜自然聊约 2 分钟。
8. 用户结束后进入独立的「复练小结」。

## 3. 功能范围

### 3.1 本版要做

- 报告页「新表达」区增加 `复练这些表达` 入口。
- 新增表达复练会话模式，复用现有语音会话能力。
- 会话开始前明确展示 2-3 个目标表达。
- Coach system prompt 中加入表达复练引导策略。
- 结束后生成独立复练小结。
- 复练小结展示：
  - 本次目标表达
  - 用户尝试用到的表达
  - 可以说得更自然的一版
  - 下次建议继续练哪个表达

### 3.2 本版不做

- 不做表达掌握度更新。
- 不做首页每日表达挑战。
- 不做成长页历史表达池。
- 不做严格完成判定或打分。
- 不强制用户必须说出目标表达。

## 4. 交互设计

### 4.1 报告页入口

在 `newExpressions` 模块底部增加一个主按钮：

- 按钮文案：`复练这些表达`
- 可用条件：本次报告有至少 1 个 `newExpressions`。
- 如果表达多于 3 个，第一版优先取前 3 个。
- 如果只有 1-2 个，就全部使用。

### 4.2 复练准备页

复练会话沿用当前半屏开口准备页，但文案调整为表达挑战：

- 标题：`试着用上这些表达`
- 副标题：`不用刻意背，聊到合适的时候用出来就行。`
- 目标表达以卡片展示：
  - 表达文本
  - 中文解释或例句，取决于现有报告字段

准备页仍遵循现有规则：

- 后台可先连接语音。
- 用户点击 `我准备好了` 前不收音。
- 准备页不写入消息流，也不进入报告 transcript。

### 4.3 会话中体验

会话顶部保留轻量目标提示，避免用户忘记目标表达：

- 展示 2-3 个目标表达 chip。
- 不需要实时判定完成。
- 不弹出强提醒。

Coach 行为要求：

- 像朋友聊天，不像老师考试。
- 不说“请使用第一个表达”。
- 用自然追问制造表达使用机会。
- 如果用户没有使用目标表达，也继续自然聊天。
- 如果用户尝试使用但不自然，不在会话中长篇纠错，留到复练小结。

示例引导方式：

- 目标表达：`I ended up...`
- Coach 可以问：`So what did you end up doing?`

## 5. 数据与状态设计

新增一个轻量会话上下文，不改数据库结构：

```ts
interface ExpressionPracticeContext {
  sourceReportId?: string;
  targetExpressions: Array<{
    text: string;
    meaning?: string;
    example?: string;
  }>;
}
```

会话模式可用枚举或字符串标识：

```ts
type PracticeMode = "normal" | "expression_practice";
```

第一版复练小结可以先不持久化到 Supabase；如果后续要做成长页表达池，再把小结落库。

## 6. 复练小结生成

复练结束后调用现有报告生成链路的轻量变体，输入包括：

- targetExpressions
- 本次复练 transcript
- sessionId
- durationSeconds

输出结构建议：

```ts
interface ExpressionPracticeSummary {
  sessionId: string;
  createdAt: string;
  targetExpressions: string[];
  attemptedExpressions: Array<{
    target: string;
    userSentence?: string;
    feedback: string;
    betterVersion?: string;
  }>;
  nextSuggestion: {
    expression: string;
    reason: string;
  };
}
```

判定原则：

- 不输出分数。
- 不输出“通过/失败”。
- 如果没有识别到明确复用，也给轻反馈：`这次你还没明显用到它，下次可以从这句开始...`
- 优先鼓励用户尝试，再给一条更自然的版本。

## 7. 组件与代码边界

建议改动位置：

- `src/components/ReportView.tsx`
  - 增加复练按钮和回调。
- `src/App.tsx`
  - 保存当前复练上下文。
  - 从报告页切换到复练会话。
  - 区分普通报告与复练小结。
- `src/components/VoiceSession.tsx`
  - 支持表达复练模式的准备页文案和目标表达展示。
- `src/config/session.ts`
  - 增加表达复练 system prompt 拼接逻辑。
- 新增或扩展 API：
  - 可新增 `api/generate-expression-practice-summary.js`。
  - 也可以在现有 `generate-report` 基础上拆 shared post-process，但第一版推荐独立轻量接口，避免污染普通报告。

## 8. 错误与空状态

- 如果报告没有 `newExpressions`：不显示按钮。
- 如果表达数据不完整：只展示表达文本，不阻塞复练。
- 如果复练小结生成失败：展示普通错误卡片，并允许用户回到报告页。
- 如果用户复练时间太短：小结仍生成，但提示内容不足，建议下次多说几句。

## 9. 验收标准

- 有 `newExpressions` 的报告页能看到 `复练这些表达`。
- 点击后进入表达复练会话，准备页展示 1-3 个目标表达。
- 点击 `我准备好了` 前不会收音。
- Coach 不机械要求用户逐条造句，而是自然引导。
- 结束后出现独立复练小结，不覆盖原报告。
- 普通口语练习、普通报告生成不受影响。
- `npm run build` 通过。

## 10. 后续扩展

后续可以在第一版稳定后继续做：

- 把复练小结写入 Supabase。
- 在成长页展示待复练表达池。
- 根据历史复用情况推荐每日表达挑战。
- 接入表达掌握度状态：new / practiced / reused / mastered。
