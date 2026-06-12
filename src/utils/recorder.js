// Microphone recorder that produces 16 kHz mono 16-bit PCM WAV chunks — the
// format whisper.cpp prefers. While recording, it fires `onChunk(wav)` every
// few seconds so the renderer can transcribe in near-real-time. We capture
// raw float samples through a ScriptProcessorNode (deprecated but universally
// available; AudioWorklet would require a separate worklet module file).

const TARGET_SAMPLE_RATE = 16000;
const DEFAULT_CHUNK_SECONDS = 15;

export class Recorder {
  constructor() {
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.chunk = []; // float samples since last flush
    this.sourceSampleRate = 0;
    this.onChunk = null;
    this.chunkThreshold = 0;
    this.firstChunkThreshold = 0;
  }

  async start({
    onChunk,
    chunkSeconds = DEFAULT_CHUNK_SECONDS,
    firstChunkSeconds = chunkSeconds,
  } = {}) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    // Ask the browser to run the graph at 16 kHz so its (properly low-pass
    // filtered) resampler handles the downsample from the mic's native rate.
    // Falls back to the hardware rate + our manual resample if unsupported.
    try {
      this.context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    } catch {
      this.context = new AudioContext();
    }

    this.sourceSampleRate = this.context.sampleRate;
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.onChunk = onChunk || null;
    this.chunkThreshold = Math.floor(chunkSeconds * this.sourceSampleRate);
    // Flush the first chunk sooner so the first words show up quickly — the
    // single best "it's working" signal. Later chunks use the longer cadence,
    // which gives whisper more context per call.
    this.firstChunkThreshold = Math.floor(
      firstChunkSeconds * this.sourceSampleRate,
    );
    this.chunk = [];

    let pending = 0;
    let flushCount = 0;
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      this.chunk.push(new Float32Array(input));
      pending += input.length;
      const threshold =
        flushCount === 0 ? this.firstChunkThreshold : this.chunkThreshold;
      if (pending >= threshold) {
        this.flushChunk();
        pending = 0;
        flushCount++;
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  flushChunk() {
    if (!this.chunk.length || !this.onChunk) {
      this.chunk = [];
      return;
    }
    const merged = mergeFloat32(this.chunk);
    this.chunk = [];
    const resampled = resample(
      merged,
      this.sourceSampleRate,
      TARGET_SAMPLE_RATE,
    );
    if (resampled.length < TARGET_SAMPLE_RATE / 4) return; // skip <0.25s chunks (likely silence/jitter)
    const wav = encodeWav(resampled, TARGET_SAMPLE_RATE);
    this.onChunk(wav);
  }

  async stop() {
    if (!this.context) return;
    try {
      this.flushChunk();
      this.processor.disconnect();
      this.source.disconnect();
      this.stream.getTracks().forEach((track) => track.stop());
      await this.context.close();
    } catch {
      // ignore
    }
    this.context = null;
    this.source = null;
    this.processor = null;
    this.stream = null;
    this.onChunk = null;
  }
}

function mergeFloat32(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const newLength = Math.round(samples.length / ratio);
  const resampled = new Float32Array(newLength);
  for (let index = 0; index < newLength; index++) {
    const position = index * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, samples.length - 1);
    const fraction = position - lower;
    resampled[index] =
      samples[lower] * (1 - fraction) + samples[upper] * fraction;
  }
  return resampled;
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const channelCount = 1;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeString(view, offset, text) {
  for (let index = 0; index < text.length; index++) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
