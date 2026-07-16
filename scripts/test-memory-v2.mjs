import assert from "node:assert/strict";
import { postProcessMemory } from "../memory-post-process.js";
import { formatMemoryBlock } from "../src/config/session.ts";

function estimateMemoryTokens(text) {
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const nonCjkChars = text.replace(/[\u3400-\u9fff]/g, "").length;
  return Math.ceil(cjkChars * 0.6 + nonCjkChars / 4);
}

function makePreviousEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `old-${String(index + 1).padStart(2, "0")}`,
    topic: "travel plans and work updates should be trimmed",
    highlights: "used past tense more confidently with longer answers than before",
    mistakes: "confused go and went several times in short answers",
    storyNotes: `shared personal update number ${index + 1} about work and travel`,
    createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
  }));
}

function testPostProcessReturnsTwoLayerPayloadAndFifo() {
  const previousEntries = makePreviousEntries(20);
  const processed = postProcessMemory(
    {
      summary: {
        userLevel: "intermediate",
        topics: ["travel", "work", "pets", "food", "extra topic"],
        frequentMistakes: ["I go -> I went"],
        personalFacts: [
          "works as a product manager",
          "has a cat named Momo",
          "this fact has way too many words and should be trimmed down to fifteen words exactly here",
          "likes weekend hiking",
          "preparing for IELTS",
          "enjoys spicy food",
          "lives in China",
          "uses English at work",
          "overflow fact should be dropped",
        ],
        coachNotes: "She likes warm, casual follow-ups.",
      },
      entry: {
        topic: "business trip to Chengdu with many words",
        highlights: "answered with clearer details and more natural follow up sentences in this conversation",
        mistakes: "mixed up went and go when telling the story",
        storyNotes: "went on a business trip to Chengdu and ate hotpot with coworkers after meetings",
      },
    },
    {
      previousEntries,
      previousSummary: { trackedExpressions: [] },
      sessionId: "new-session",
      ownerKey: "user-1",
    },
  );

  assert.equal(processed.entries.length, 20);
  assert.equal(processed.entries[0].sessionId, "old-02");
  assert.equal(processed.entries.at(-1).sessionId, "new-session");
  assert.equal(processed.summary.topics.length, 4);
  assert.equal(processed.summary.personalFacts.length, 8);
  assert.ok(processed.summary.personalFacts.every((fact) => fact.split(/\s+/).length <= 15));
  assert.ok(processed.entries.at(-1).topic.split(/\s+/).length <= 6);
  assert.ok(processed.entries.at(-1).highlights.split(/\s+/).length <= 20);
  assert.ok(processed.entries.at(-1).mistakes.split(/\s+/).length <= 20);
  assert.ok(processed.entries.at(-1).storyNotes.split(/\s+/).length <= 20);
}

function testPromptBudgetAndRules() {
  const memory = {
    summary: {
      userLevel: "intermediate",
      topics: ["travel", "work", "pets", "IELTS"],
      frequentMistakes: ["I go -> I went", "very like -> really like"],
      trackedExpressions: [],
      personalFacts: ["works as a product manager", "has a cat named Momo"],
      coachNotes: "She opens up when the coach reacts like a friend, not a teacher.",
      updatedAt: "2026-07-16T12:00:00.000Z",
    },
    entries: makePreviousEntries(20),
  };

  const block = formatMemoryBlock(memory);
  assert.ok(block.includes("Learner memory"));
  assert.ok(block.includes("Recent conversation memories"));
  assert.ok(block.includes("Never say 'Last time you said...'"));
  assert.ok(estimateMemoryTokens(block) <= 500);
}

function testEmptyEntriesFallsBackToProfileOnly() {
  const block = formatMemoryBlock({
    summary: {
      userLevel: "beginner",
      topics: [],
      frequentMistakes: [],
      trackedExpressions: [],
      personalFacts: [],
      coachNotes: "Keep replies short.",
      updatedAt: "2026-07-16T12:00:00.000Z",
    },
    entries: [],
  });

  assert.ok(block.includes("Keep replies short."));
  assert.equal(block.includes("Recent conversation memories"), false);
}

function testOldModelShapeStillNormalizes() {
  const processed = postProcessMemory(
    {
      userLevel: "advanced",
      topics: ["career"],
      frequentMistakes: [],
      coachNotes: "Old shape still works.",
    },
    { previousSummary: { personalFacts: ["likes cats"], trackedExpressions: [] }, sessionId: "old-shape" },
  );

  assert.equal(processed.summary.userLevel, "advanced");
  assert.deepEqual(processed.summary.personalFacts, ["likes cats"]);
  assert.equal(processed.entries.at(-1).sessionId, "old-shape");
}

testPostProcessReturnsTwoLayerPayloadAndFifo();
testPromptBudgetAndRules();
testEmptyEntriesFallsBackToProfileOnly();
testOldModelShapeStillNormalizes();

console.log("memory v2 tests passed");
