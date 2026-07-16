export const EXPRESSION_PRACTICE_SUMMARY_SYSTEM_PROMPT = [
  "You generate a lightweight Chinese recap for a short English expression reuse practice.",
  "Return strict JSON only. Do not include markdown.",
  "Do not score, grade, pass, fail, or make mastery claims.",
  "For each target expression, judge whether the learner clearly attempted it or a close variant in the transcript.",
  "If attempted, first encourage the attempt, then explain briefly how to make it more natural.",
  "If not attempted, say it was not clearly used this time and give a low-friction starter sentence for next time.",
  "If the transcript is too short or empty, still return feedback and mention that there was not enough speaking content.",
  "Output schema: { sessionId, createdAt, targetExpressions, attemptedExpressions, nextSuggestion }.",
  "attemptedExpressions is an array of { target, userSentence?, feedback, betterVersion? }.",
  "nextSuggestion is { expression, reason } and should pick one expression to try next.",
].join(" ");

function asString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeTargets(input) {
  return Array.isArray(input?.targetExpressions)
    ? input.targetExpressions
        .map((item) => {
          if (typeof item === "string") {
            return item.trim();
          }
          return asString(item?.text);
        })
        .filter(Boolean)
        .slice(0, 3)
    : [];
}

function includesTarget(transcript, target) {
  const normalizedTranscript = transcript.toLowerCase();
  const normalizedTarget = target.toLowerCase().replace(/[“”"'.!?]/g, "").trim();
  if (!normalizedTarget) {
    return false;
  }
  return normalizedTranscript.includes(normalizedTarget);
}

export function buildExpressionPracticeSummaryUserPrompt(input) {
  const targetBlock = Array.isArray(input.targetExpressions)
    ? input.targetExpressions
        .slice(0, 3)
        .map((item, index) => {
          const text = typeof item === "string" ? item : item?.text;
          const meaning = typeof item === "object" && item?.meaning ? ` meaning: ${item.meaning}` : "";
          const example = typeof item === "object" && item?.example ? ` example: ${item.example}` : "";
          return `${index + 1}. ${text ?? ""}${meaning}${example}`;
        })
        .join("\n")
    : "";

  return `sessionId: ${input.sessionId ?? ""}\ndurationSeconds: ${input.durationSeconds ?? 0}\n\nTarget expressions:\n${targetBlock}\n\nTranscript:\n${input.transcript ?? ""}`;
}

export function postProcessExpressionPracticeSummary(raw, input) {
  const targets = normalizeTargets(input);
  const transcript = asString(input?.transcript);
  const createdAt = asString(raw?.createdAt, new Date().toISOString());
  const attemptedRaw = Array.isArray(raw?.attemptedExpressions) ? raw.attemptedExpressions : [];

  const attemptedExpressions = targets.map((target) => {
    const found = attemptedRaw.find((item) => asString(item?.target).toLowerCase() === target.toLowerCase());
    const detected = includesTarget(transcript, target);
    const userSentence = asString(found?.userSentence);
    const feedback = asString(
      found?.feedback,
      transcript
        ? detected
          ? `你这次有尝试用到「${target}」，先把它说出口就很好。下次可以放在更完整的语境里，会更自然。`
          : `这次还没明显用到「${target}」。下次可以先从一句很短的话开始，把它接到自己的真实经历里。`
        : `这次开口内容还不够多，暂时没法判断「${target}」的使用情况。下次可以先用它说一句自己的真实经历。`,
    );
    const betterVersion = asString(found?.betterVersion);
    return {
      target,
      ...(userSentence ? { userSentence } : {}),
      feedback,
      ...(betterVersion ? { betterVersion } : {}),
    };
  });

  const modelSuggestionExpression = asString(raw?.nextSuggestion?.expression);
  const suggestionExpression = targets.includes(modelSuggestionExpression)
    ? modelSuggestionExpression
    : targets[0] ?? "";
  const nextSuggestion = {
    expression: suggestionExpression,
    reason: asString(
      raw?.nextSuggestion?.reason,
      transcript
        ? `下次先试「${suggestionExpression}」，它很适合用来补充一个结果或后续行动。`
        : `这次内容偏短，下次可以先从「${suggestionExpression}」开口。`,
    ),
  };

  return {
    sessionId: asString(raw?.sessionId, asString(input?.sessionId, "expression-practice")),
    createdAt,
    targetExpressions: targets,
    attemptedExpressions,
    nextSuggestion,
  };
}
