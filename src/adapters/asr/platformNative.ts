export type PlatformNativeAsrSupport = "supported" | "unsupported";

export interface PlatformNativeAsrHandlers {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  /**
   * 反悔合并：上次提交后用户马上接着说，浏览器把整句重新吐了 final。
   * 收到完整合并句时回调——应当替换上一轮提交（撤销旧回复、整句重新提问），
   * 而不是把剩余尾巴当成新回合。
   */
  onAmend?: (fullText: string) => void;
  onSpeechStart?: () => void;
  onError?: (error: Error) => void;
  onEnd?: () => void;
}

export interface PlatformNativeAsrOptions {
  locale?: string;
}

/** 只有 interim（浏览器还没断句）时，静默多久后提交整轮文本。 */
const INTERIM_COMMIT_DELAY_MS = 550;
/**
 * 浏览器已给出 final 片段后，再等一小段时间才提交：
 * 用户句中停顿时浏览器常提前断句，这个窗口用来把「一次开口」合并成一个气泡。
 */
const FINAL_COMMIT_DELAY_MS = 280;
/**
 * 语义判停（本地启发式，零成本）：文本结尾看起来「话没说完」时，
 * 把提交窗口拉长到这个值，容忍学习者句中想词的停顿（通常 1~3s）。
 */
const INCOMPLETE_COMMIT_DELAY_MS = 1000;
/** 同一段识别 run 内，浏览器把已提交文本连同新内容重新吐 final 的去重窗口。 */
const PREFIX_DEDUPE_WINDOW_MS = 10_000;
const DEFAULT_PLATFORM_NATIVE_ASR_LOCALE = "en-US";

/**
 * 结尾出现这些词时，句子大概率没说完（连接词/介词/冠词/助动词/主语/填充词）。
 * 判错的代价只是多等 1~2s，判漏的代价是拆气泡——所以宁可偏向「等一等」。
 */
const INCOMPLETE_TRAILING_WORDS = new Set([
  // 连接词 / 从句引导词
  "and", "but", "or", "so", "because", "although", "though", "if", "when",
  "while", "that", "which", "who", "whose", "where", "why", "how", "what",
  // 介词
  "of", "to", "in", "on", "at", "with", "for", "from", "about", "into",
  "over", "under", "between", "during", "as", "by",
  // 冠词 / 限定词 / 所有格
  "the", "a", "an", "my", "your", "his", "her", "its", "our", "their",
  "this", "these", "those", "some", "every", "each",
  // 系动词 / 助动词 / 情态动词
  "is", "are", "was", "were", "am", "be", "been", "being",
  "do", "does", "did", "have", "has", "had",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  // 主语代词（句尾出现基本是没说完）
  "i", "he", "she", "we", "they",
  // 常见缩写（主语 + 助动词）
  "i'm", "i'll", "i've", "i'd", "you're", "you'll", "you've",
  "we're", "we'll", "we've", "they're", "they'll", "they've",
  "he's", "she's", "it's", "that's", "there's", "here's", "what's",
  "who's", "let's",
  // 口头填充词
  "um", "uh", "umm", "uhh", "er", "erm", "hmm",
  // 程度副词（后面必然还有内容）
  "very", "really",
]);

/** 很短但本身是完整回答的词，不触发「延长等待」。 */
const COMPLETE_SHORT_UTTERANCES = new Set([
  "yes", "no", "okay", "ok", "yeah", "yep", "nope", "sure", "right",
  "exactly", "definitely", "maybe", "thanks", "hello", "hi", "bye",
  "goodbye", "morning", "fine", "good", "great", "nice", "nothing", "sorry",
]);

/** 纯本地启发式：这段话看起来说完了吗？ */
function looksIncomplete(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-z']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const lastWord = words[words.length - 1];
  if (words.length < 3) {
    // 一两个词：要么是完整短回答，要么大概率是起头
    return !COMPLETE_SHORT_UTTERANCES.has(lastWord);
  }
  return INCOMPLETE_TRAILING_WORDS.has(lastWord);
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error?: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const candidate = window as WindowWithSpeechRecognition;
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function getPlatformNativeAsrSupport(): PlatformNativeAsrSupport {
  return getSpeechRecognitionConstructor() ? "supported" : "unsupported";
}

/**
 * Web implementation of the product-level "平台原生 ASR".
 *
 * In future native apps this interface can be backed by Apple Speech / Android
 * SpeechRecognizer while keeping the rest of the voice session unchanged.
 */
export class BrowserPlatformNativeAsr {
  private recognition: SpeechRecognitionLike | null = null;
  private shouldRun = false;
  private pausedForPlayback = false;
  private starting = false;
  private interimCommitTimer: number | null = null;
  /** 本轮说话中浏览器已判定 final 的片段累积（合并成一个气泡的关键）。 */
  private pendingFinalText = "";
  private latestCombinedText = "";
  private lastSubmittedText = "";
  private lastSubmittedAt = 0;
  /** 浏览器识别 run 序号（onend 自增）：前缀去重只在同一 run 内生效。 */
  private runId = 0;
  private lastSubmittedRunId = -1;

  constructor(
    private readonly handlers: PlatformNativeAsrHandlers,
    private readonly options: PlatformNativeAsrOptions = {},
  ) {}

  start(): boolean {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      return false;
    }

    this.stop();
    this.shouldRun = true;
    this.pausedForPlayback = false;
    this.pendingFinalText = "";
    this.latestCombinedText = "";
    this.lastSubmittedText = "";
    this.lastSubmittedAt = 0;
    this.runId = 0;
    this.lastSubmittedRunId = -1;

    const recognition = new Recognition();
    recognition.lang = this.options.locale?.trim() || DEFAULT_PLATFORM_NATIVE_ASR_LOCALE;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onspeechstart = () => {
      if (this.pausedForPlayback) {
        return;
      }
      this.handlers.onSpeechStart?.();
    };

    recognition.onresult = (event) => {
      if (this.pausedForPlayback) {
        return;
      }

      let interimText = "";
      let finalText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      // 本轮内的 final 片段先累积，不立刻提交——避免一次开口被拆成多个气泡。
      const normalizedFinal = normalizeTranscript(finalText);
      if (normalizedFinal) {
        this.pendingFinalText = normalizeTranscript(
          `${this.pendingFinalText} ${normalizedFinal}`,
        );
      }

      const combined = normalizeTranscript(`${this.pendingFinalText} ${interimText}`);
      if (combined) {
        this.latestCombinedText = combined;
        this.handlers.onPartial(combined);
        // 有 final 说明浏览器已检测到断句，用更短的窗口提交；否则等 interim 稳定。
        // 语义判停：结尾像「话没说完」（连接词/介词/助动词等收尾）时拉长窗口，
        // 容忍学习者句中想词的停顿，避免一次开口被拆成两个气泡。
        const baseDelay = normalizedFinal ? FINAL_COMMIT_DELAY_MS : INTERIM_COMMIT_DELAY_MS;
        const delay = looksIncomplete(combined)
          ? Math.max(baseDelay, INCOMPLETE_COMMIT_DELAY_MS)
          : baseDelay;
        this.scheduleCommit(delay);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech") {
        return;
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.shouldRun = false;
      }
      const detail = event.message || event.error || "unknown";
      this.handlers.onError?.(new Error(`平台原生 ASR 出错：${detail}`));
    };

    recognition.onend = () => {
      this.starting = false;
      this.runId += 1;
      this.handlers.onEnd?.();
      if (this.shouldRun && !this.pausedForPlayback) {
        window.setTimeout(() => this.safeStart(), 180);
      }
    };

    this.recognition = recognition;
    this.safeStart();
    return true;
  }

  stop(): void {
    this.shouldRun = false;
    this.pausedForPlayback = false;
    this.starting = false;
    this.clearInterimCommitTimer();
    this.pendingFinalText = "";
    this.latestCombinedText = "";
    this.lastSubmittedText = "";
    this.lastSubmittedAt = 0;
    this.runId = 0;
    this.lastSubmittedRunId = -1;
    if (!this.recognition) {
      return;
    }
    try {
      this.recognition.onend = null;
      this.recognition.abort();
    } catch {
      // Ignore browser-specific invalid state errors.
    } finally {
      this.recognition = null;
    }
  }

  pauseForPlayback(): void {
    if (!this.recognition || !this.shouldRun || this.pausedForPlayback) {
      return;
    }
    this.pausedForPlayback = true;
    this.starting = false;
    this.clearInterimCommitTimer();
    this.pendingFinalText = "";
    this.latestCombinedText = "";
    try {
      this.recognition.stop();
    } catch {
      // Ignore invalid state errors; resume will recreate/restart if needed.
    }
  }

  resumeAfterPlayback(): void {
    if (!this.recognition || !this.shouldRun || !this.pausedForPlayback) {
      return;
    }
    this.pausedForPlayback = false;
    this.pendingFinalText = "";
    this.latestCombinedText = "";
    // Give the browser/audio output a short tail window so the recognizer
    // doesn't pick up the Coach's last syllables as the user's next turn.
    window.setTimeout(() => this.safeStart(), 450);
    window.setTimeout(() => this.safeStart(), 760);
  }

  private safeStart(): void {
    if (!this.recognition || !this.shouldRun || this.pausedForPlayback || this.starting) {
      return;
    }
    try {
      this.starting = true;
      this.recognition.start();
    } catch {
      this.starting = false;
      // Chrome throws when start() is called too soon after an end event.
      window.setTimeout(() => this.safeStart(), 240);
    }
  }

  private scheduleCommit(delayMs: number): void {
    this.clearInterimCommitTimer();
    this.interimCommitTimer = window.setTimeout(() => {
      this.interimCommitTimer = null;
      this.submitFinal(this.latestCombinedText);
    }, delayMs);
  }

  private clearInterimCommitTimer(): void {
    if (this.interimCommitTimer !== null) {
      window.clearTimeout(this.interimCommitTimer);
      this.interimCommitTimer = null;
    }
  }

  private submitFinal(text: string): void {
    let content = normalizeTranscript(text);
    if (!content) {
      return;
    }
    const normalizedLast = this.lastSubmittedText.toLowerCase();
    const sinceLastSubmit = Date.now() - this.lastSubmittedAt;

    // 同一段识别 run 内，浏览器常把已提交的内容连同后续新内容整体再吐一遍 final
    //（尤其是提交发生在 interim 阶段时）。不看 3s 时间窗，直接剥掉重复前缀，
    // 只提交新增部分——修复「第二个气泡复读第一个气泡」的 bug。
    if (
      this.runId === this.lastSubmittedRunId &&
      normalizedLast.length > 0 &&
      sinceLastSubmit < PREFIX_DEDUPE_WINDOW_MS
    ) {
      const lowered = content.toLowerCase();
      if (lowered === normalizedLast) {
        return;
      }
      if (lowered.startsWith(`${normalizedLast} `)) {
        if (this.handlers.onAmend) {
          // 反悔合并：整句作为一个回合重发，替换上一次提交——
          // 气泡恢复成完整长句，避免「说了长句被收敛成短尾巴」。
          this.lastSubmittedText = content;
          this.lastSubmittedAt = Date.now();
          this.lastSubmittedRunId = this.runId;
          this.pendingFinalText = "";
          this.latestCombinedText = "";
          this.handlers.onAmend(content);
          return;
        }
        // 没有 onAmend 时退回旧行为：只提交新增尾巴
        content = normalizeTranscript(content.slice(normalizedLast.length));
        if (!content) {
          return;
        }
      }
    }

    const normalizedContent = content.toLowerCase();
    const isImmediateDuplicate = sinceLastSubmit < 3_000;
    if (
      isImmediateDuplicate &&
      (normalizedContent === normalizedLast ||
        (normalizedLast.length > 0 && normalizedContent.includes(normalizedLast)))
    ) {
      return;
    }
    this.lastSubmittedText = content;
    this.lastSubmittedAt = Date.now();
    this.lastSubmittedRunId = this.runId;
    this.pendingFinalText = "";
    this.latestCombinedText = "";
    this.handlers.onFinal(content);
  }
}
