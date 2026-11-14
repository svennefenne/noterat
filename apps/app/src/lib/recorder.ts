/**
 * Recording a voice memo with the microphone (MediaRecorder): Opus at speech quality, about a quarter of
 * a megabyte a minute. Needs a "secure context": the Android app, or the website over https (on plain
 * http, as a server reached at its home address, browsers don't let a page use the microphone).
 */

export type RecordProblem = "unsupported" | "insecure" | "denied" | "failed";

export function recordProblem(): RecordProblem | null {
  if (!window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return "unsupported";
  return null;
}

const TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

export interface Recorded {
  blob: Blob;
  /** seconds */
  duration: number;
}

export class Recording {
  private readonly chunks: Blob[] = [];
  private readonly started = performance.now();
  private readonly analyser: AnalyserNode;
  private readonly samples: Uint8Array<ArrayBuffer>;

  private constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
    private readonly audio: AudioContext,
  ) {
    recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.analyser = audio.createAnalyser();
    this.analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(this.analyser);
    // (made after waiting for the microphone, it may start paused: only the meter needs it running)
    void audio.resume().catch(() => {});
    this.samples = new Uint8Array(this.analyser.fftSize);
    // (in pieces of a few seconds, gathered here, rather than one big one at the end)
    recorder.start(5000);
  }

  /** Start: asks for the microphone the first time. Throws a RecordProblem. */
  static async start(): Promise<Recording> {
    const problem = recordProblem();
    if (problem) throw problem;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      throw (err as DOMException)?.name === "NotAllowedError" ? "denied" : "failed";
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    try {
      return new Recording(stream, new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 }), new AudioContext());
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      throw "failed" satisfies RecordProblem;
    }
  }

  /** Seconds since it started. */
  get elapsed() {
    return (performance.now() - this.started) / 1000;
  }

  /** How loud it is right now, 0–1 (for a meter). */
  level(): number {
    this.analyser.getByteTimeDomainData(this.samples);
    let peak = 0;
    for (const s of this.samples) peak = Math.max(peak, Math.abs(s - 128));
    return Math.min(1, peak / 100);
  }

  stop(): Promise<Recorded> {
    const duration = this.elapsed;
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        this.release();
        resolve({ blob: new Blob(this.chunks, { type: this.recorder.mimeType || "audio/webm" }), duration });
      };
      this.recorder.stop();
    });
  }

  cancel() {
    this.recorder.onstop = () => this.release();
    if (this.recorder.state !== "inactive") this.recorder.stop();
    else this.release();
  }

  private release() {
    this.stream.getTracks().forEach((t) => t.stop());
    void this.audio.close().catch(() => {});
  }
}
