/** Smooth PCM s16le playback for streaming TTS chunks. */
const BYTES_PER_SAMPLE = 2;
/** Initial buffer before first playback — extra headroom for proxy + mobile jitter. */
const MIN_PRIME_MS = 220;
/** Keep this much audio scheduled ahead of the playhead when chunks keep arriving. */
const TARGET_AHEAD_MS = 320;
/** Schedule in small blocks so one late frame does not stall the whole pending buffer. */
const SCHEDULE_CHUNK_MS = 40;
/** A playhead gap larger than this counts as an audible underrun. */
const UNDERRUN_GAP_S = 0.02;
/** Each underrun raises the next prime by this much; clean turns walk it back down. */
const PRIME_STEP_MS = 200;
const PRIME_MAX_MS = 1500;
const PRIME_DECAY_MS = 100;
/** Short fade-in at gap boundaries turns hard clicks into soft resumes. */
const FADE_MS = 5;

export interface TtsPlayerTuning {
  /** Audio buffered before first playback each turn. */
  primeMs: number;
  /** Audio kept scheduled ahead of the playhead. */
  targetAheadMs: number;
}

export class TtsPcmPlayer {
  private pending = new Uint8Array(0);
  private nextPlayTime = 0;
  private primed = false;
  private turnActive = false;
  private turnStarted = false;
  private underrunsThisTurn = 0;
  private basePrimeMs = MIN_PRIME_MS;
  private adaptivePrimeMs = MIN_PRIME_MS;
  private onIdleHandler: (() => void) | null = null;
  private targetAheadMs = TARGET_AHEAD_MS;
  private readonly scheduleChunkBytes: number;
  private readonly fadeSamples: number;
  private readonly masterGain: GainNode;
  private readonly activeSources = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly sampleRate: number,
  ) {
    this.nextPlayTime = ctx.currentTime;
    this.scheduleChunkBytes =
      Math.max(2, Math.floor((sampleRate * BYTES_PER_SAMPLE * SCHEDULE_CHUNK_MS) / 1000)) & ~1;
    this.fadeSamples = Math.max(1, Math.floor((sampleRate * FADE_MS) / 1000));
    this.masterGain = ctx.createGain();
    this.masterGain.connect(ctx.destination);
  }

  /** Backends stream with different burstiness — takes effect from the next un-primed turn. */
  setTuning(tuning: TtsPlayerTuning): void {
    this.basePrimeMs = tuning.primeMs;
    this.adaptivePrimeMs = tuning.primeMs;
    this.targetAheadMs = tuning.targetAheadMs;
  }

  enqueue(chunk: ArrayBuffer): void {
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    const incoming = new Uint8Array(chunk);
    if (incoming.length === 0) {
      return;
    }

    const combined = new Uint8Array(this.pending.length + incoming.length);
    combined.set(this.pending);
    combined.set(incoming, this.pending.length);
    this.pending = combined;

    this.schedulePipeline();
  }

  /** True while audio is queued or still playing. */
  isActive(): boolean {
    return this.pending.length > 0 || this.activeSources.size > 0;
  }

  /** Fires once when the queue drains and all scheduled sources finish. */
  setOnIdle(handler: (() => void) | null): void {
    this.onIdleHandler = handler;
  }

  /** Stop queued/scheduled audio — use at user turn boundaries, not on bot text chunks. */
  reset(): void {
    const sources = [...this.activeSources];
    this.activeSources.clear();
    this.pending = new Uint8Array(0);
    this.nextPlayTime = this.ctx.currentTime;
    this.endTurnBookkeeping();

    if (sources.length === 0) {
      return;
    }

    // Ramp the master gain down before stopping so an interrupt doesn't click,
    // then schedule it back up for whatever plays next.
    const now = this.ctx.currentTime;
    const gain = this.masterGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + 0.012);
    gain.setValueAtTime(1, now + 0.02);
    setTimeout(() => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already stopped or never started.
        }
      }
    }, 25);
  }

  private minPrimeBytes(): number {
    return Math.floor((this.sampleRate * BYTES_PER_SAMPLE * this.adaptivePrimeMs) / 1000);
  }

  /**
   * Close out a playback turn: escalate the prime after stutters, decay it
   * back toward the configured base after clean turns.
   */
  private endTurnBookkeeping(): void {
    this.primed = false;
    this.turnStarted = false;
    if (!this.turnActive) {
      return;
    }
    this.turnActive = false;
    if (this.underrunsThisTurn > 0) {
      this.adaptivePrimeMs = Math.min(
        PRIME_MAX_MS,
        this.adaptivePrimeMs + this.underrunsThisTurn * PRIME_STEP_MS,
      );
    } else {
      this.adaptivePrimeMs = Math.max(this.basePrimeMs, this.adaptivePrimeMs - PRIME_DECAY_MS);
    }
    this.underrunsThisTurn = 0;
  }

  private schedulePipeline(): void {
    while (true) {
      const evenPending = this.pending.length & ~1;
      if (evenPending < 2) {
        return;
      }

      if (!this.primed) {
        if (evenPending < this.minPrimeBytes()) {
          return;
        }
        this.primed = true;
        this.turnActive = true;
        this.nextPlayTime = this.ctx.currentTime;
      }

      const aheadMs = (this.nextPlayTime - this.ctx.currentTime) * 1000;
      if (aheadMs >= this.targetAheadMs) {
        return;
      }

      // Flush a short tail once the playhead is close to running dry.
      const take =
        evenPending <= this.scheduleChunkBytes && aheadMs < 80
          ? evenPending
          : Math.min(evenPending, this.scheduleChunkBytes);
      this.scheduleChunk(take);
    }
  }

  private scheduleChunk(byteLength: number): void {
    const playable = this.pending.slice(0, byteLength);
    this.pending = this.pending.slice(byteLength);

    const samples = new Int16Array(
      playable.buffer,
      playable.byteOffset,
      byteLength / BYTES_PER_SAMPLE,
    );
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      floats[i] = samples[i] / 32768;
    }

    const now = this.ctx.currentTime;
    const gapSeconds = now - this.nextPlayTime;
    const discontinuity = gapSeconds > UNDERRUN_GAP_S;
    if (discontinuity && this.turnStarted) {
      // Mid-stream stall: remember it so the next turn primes with more headroom.
      this.underrunsThisTurn += 1;
    }

    // Soften the resume edge after any gap (and the very first chunk of a turn).
    if (discontinuity || !this.turnStarted) {
      const rampLength = Math.min(this.fadeSamples, floats.length);
      for (let i = 0; i < rampLength; i += 1) {
        floats[i] *= i / rampLength;
      }
    }
    this.turnStarted = true;

    const buffer = this.ctx.createBuffer(1, floats.length, this.sampleRate);
    buffer.copyToChannel(floats, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.masterGain);

    const startTime = Math.max(now, this.nextPlayTime);
    source.start(startTime);
    this.nextPlayTime = startTime + buffer.duration;

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      this.schedulePipeline();
      this.notifyIdleIfDrained();
    };
  }

  private notifyIdleIfDrained(): void {
    if (this.pending.length > 0 || this.activeSources.size > 0) {
      return;
    }
    // Natural drain ends the turn: the next utterance re-primes instead of
    // stuttering out on its first tiny chunk.
    this.endTurnBookkeeping();
    this.onIdleHandler?.();
  }
}
