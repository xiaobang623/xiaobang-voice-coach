/** Smooth PCM s16le playback for streaming TTS chunks from Doubao. */
const BYTES_PER_SAMPLE = 2;
/** Buffer ~120ms before first playback to absorb network jitter between frames. */
const MIN_PRIME_MS = 120;

export class TtsPcmPlayer {
  private pending = new Uint8Array(0);
  private nextPlayTime = 0;
  private primed = false;
  private readonly minPrimeBytes: number;

  constructor(
    private readonly ctx: AudioContext,
    private readonly sampleRate: number,
  ) {
    this.nextPlayTime = ctx.currentTime;
    this.minPrimeBytes = Math.floor((sampleRate * BYTES_PER_SAMPLE * MIN_PRIME_MS) / 1000);
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

    if (!this.primed && this.pending.length < this.minPrimeBytes) {
      return;
    }
    this.primed = true;

    this.flushPlayable();
  }

  /** Call when a new bot spoken response begins so stale audio does not overlap. */
  reset(): void {
    this.pending = new Uint8Array(0);
    this.primed = false;
    this.nextPlayTime = this.ctx.currentTime;
  }

  private flushPlayable(): void {
    const evenLen = this.pending.length & ~1;
    if (evenLen === 0) {
      return;
    }

    const playable = this.pending.slice(0, evenLen);
    this.pending = this.pending.slice(evenLen);

    const samples = new Int16Array(
      playable.buffer,
      playable.byteOffset,
      evenLen / BYTES_PER_SAMPLE,
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
    // Catch up if scheduling fell behind (e.g. chunk arrived late).
    if (this.nextPlayTime < now - 0.08) {
      this.nextPlayTime = now;
    }

    const startTime = Math.max(now, this.nextPlayTime);
    source.start(startTime);
    this.nextPlayTime = startTime + buffer.duration;
  }
}
