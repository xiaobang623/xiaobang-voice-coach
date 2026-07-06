/** Typing test is on in production unless explicitly disabled. */
export function isTypingTestAvailable(): boolean {
  return import.meta.env.VITE_ENABLE_TYPING_TEST !== "false";
}
