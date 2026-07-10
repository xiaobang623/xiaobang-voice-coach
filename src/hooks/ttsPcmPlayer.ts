/** Smooth PCM s16le playback for streaming TTS chunks. */
const BYTES_PER_SAMPLE = 2;
/** Initial buffer before first playback — extra headroom for proxy + mobile jitter. */
const MIN_PRIME_MS = 220;
/** Keep this much audio scheduled ahead of the playhead when chunks keep arriving. */
const TARGET_AHEAD_MS = 320;
/** Schedule in small blocks so one late frame does not stall the whole pending buffer. */
const SCHEDULE_CHUNK_MS = 40;

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
  private onIdleHandler: (() => void) | null = null;
  private minPrimeBytes: number;
  private targetAheadMs = TARGET_AHEAD_MS;
  private readonly scheduleChunkBytes: number;
  private readonly activeSources = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly sampleRate: number,
  ) {
    this.nextPlayTime = ctx.currentTime;
    this.minPrimeBytes = Math.floor((sampleRate * BYTES_PER_SAMPLE * MIN_PRIME_MS) / 1000);
    this.scheduleChunkBytes =
      Math.max(2, Math.floor((sampleRate * BYTES_PER_SAMPLE * SCHEDULE_CHUNK_MS) / 1000)) & ~1;
  }

  /** Backends stream with different burstiness — takes effect from the next un-primed turn. */
  setTuning(tuning: TtsPlayerTuning): void {
    this.minPrimeBytes = Math.floor((this.sampleRate * BYTES_PER_SAMPLE * tuning.primeMs) / 1000);
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
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Already stopped or never started.
      }
    }
    this.activeSources.clear();
    this.pending = new Uint8Array(0);
    this.primed = false;
    this.nextPlayTime = this.ctx.currentTime;
  }

  private schedulePipeline(): void {
    while (true) {
      const evenPending = this.pending.length & ~1;
      if (evenPending < 2) {
        return;
      }

      if (!this.primed) {
        if (evenPending < this.minPrimeBytes) {
          return;
        }
        this.primed = true;
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

    const buffer = this.ctx.createBuffer(1, floats.length, this.sampleRate);
    buffer.copyToChannel(floats, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    // Small underrun: chain immediately. Large gap: jump playhead to avoid compounding delay.
    if (this.nextPlayTime < now - 0.15) {
      this.nextPlayTime = now;
    }

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
    if (this.pending.length > 0 || this.activeSources.size > 0 || !this.onIdleHandler) {
      return;
    }
    this.onIdleHandler();
  }
}
