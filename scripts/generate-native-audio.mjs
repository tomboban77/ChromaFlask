import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const RATE = 24_000;
const OUT = join(process.cwd(), 'public', 'audio', 'native');

function midi(n) {
  return 440 * 2 ** ((n - 69) / 12);
}

function wave(kind, phase) {
  if (kind === 'square') return Math.sin(phase) >= 0 ? 1 : -1;
  if (kind === 'triangle') return (2 / Math.PI) * Math.asin(Math.sin(phase));
  return Math.sin(phase);
}

function render(seconds, events) {
  const samples = new Float32Array(Math.ceil(seconds * RATE));
  for (const event of events) {
    const start = Math.floor((event.at ?? 0) * RATE);
    const length = Math.max(1, Math.floor(event.dur * RATE));
    let phase = 0;
    for (let i = 0; i < length && start + i < samples.length; i++) {
      const p = i / length;
      const attack = Math.min(1, i / Math.max(1, RATE * (event.attack ?? 0.008)));
      const release = Math.min(1, (length - i) / Math.max(1, RATE * (event.release ?? 0.08)));
      const envelope = attack * release;
      const from = event.freq;
      const to = event.to ?? from;
      const frequency = from * (to / from) ** p;
      phase += (Math.PI * 2 * frequency) / RATE;
      samples[start + i] += wave(event.kind ?? 'sine', phase) * (event.gain ?? 0.18) * envelope;
    }
  }
  return wav(samples);
}

function wav(samples) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const scale = peak > 0.92 ? 0.92 / peak : 1;
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * scale)) * 32767), 44 + i * 2);
  }
  return buffer;
}

const sounds = {
  select: [0.13, [{ freq: 620, to: 880, dur: 0.11, gain: 0.32 }]],
  deselect: [0.13, [{ freq: 720, to: 480, dur: 0.11, gain: 0.28 }]],
  swap: [0.11, [{ freq: 520, to: 700, dur: 0.09, gain: 0.3, kind: 'triangle' }]],
  pour: [0.48, [
    { freq: 310, to: 190, dur: 0.42, gain: 0.15 },
    { freq: 1100, to: 480, dur: 0.12, gain: 0.08, at: 0.06 },
    { freq: 920, to: 420, dur: 0.12, gain: 0.08, at: 0.19 },
  ]],
  land: [0.18, [{ freq: 240, to: 160, dur: 0.16, gain: 0.18 }]],
  invalid: [0.24, [
    { freq: 200, dur: 0.1, gain: 0.11, kind: 'square' },
    { freq: 170, dur: 0.12, gain: 0.09, kind: 'square', at: 0.09 },
  ]],
  tubeComplete: [0.52, [0, 0.07, 0.14].map((at, i) => ({ freq: [784, 988, 1175][i], dur: 0.34, gain: 0.2, at }))],
  star: [0.5, [
    { freq: 1046, dur: 0.46, gain: 0.25 },
    { freq: 2093, dur: 0.3, gain: 0.08 },
  ]],
  win: [0.95, [523, 659, 784, 1046, 1318].map((freq, i) => ({ freq, dur: 0.5, gain: 0.18, kind: 'triangle', at: i * 0.08 }))],
  coin: [0.25, [
    { freq: 988, dur: 0.08, gain: 0.18, kind: 'square' },
    { freq: 1319, dur: 0.16, gain: 0.17, kind: 'square', at: 0.07 },
  ]],
  button: [0.1, [{ freq: 440, to: 620, dur: 0.08, gain: 0.25, kind: 'triangle' }]],
  powerup: [0.35, [{ freq: 400, to: 1200, dur: 0.32, gain: 0.25, kind: 'triangle' }]],
  stuck: [0.55, [
    { freq: 400, to: 300, dur: 0.22, gain: 0.23, kind: 'triangle' },
    { freq: 300, to: 190, dur: 0.34, gain: 0.21, kind: 'triangle', at: 0.18 },
  ]],
  unlock: [0.52, [
    { freq: 660, to: 990, dur: 0.24, gain: 0.24 },
    { freq: 990, to: 1320, dur: 0.32, gain: 0.2, at: 0.15 },
  ]],
  cork: [0.3, [
    { freq: 560, to: 240, dur: 0.13, gain: 0.28 },
    { freq: 1500, dur: 0.04, gain: 0.12, kind: 'triangle' },
    { freq: 392, dur: 0.24, gain: 0.1, at: 0.04 },
  ]],
  whoosh: [0.38, [{ freq: 220, to: 980, dur: 0.34, gain: 0.2, attack: 0.03 }]],
  fanfare: [1.65, [
    ...[523, 659, 784, 1046, 1318, 1568].map((freq, i) => ({ freq, dur: 0.42, gain: 0.16, kind: 'triangle', at: i * 0.07 })),
    ...[1046, 1318, 1568, 2093].map((freq, i) => ({ freq, dur: 1.2, gain: 0.09 - i * 0.01, at: 0.43, attack: 0.04 })),
  ]],
};

const chordProgression = [
  [57, 60, 64],
  [60, 65, 69],
  [60, 64, 67],
  [59, 62, 67],
];
const musicEvents = [];
for (let bar = 0; bar < chordProgression.length; bar++) {
  const at = bar * 2.88;
  const chord = chordProgression[bar];
  for (const note of chord) {
    musicEvents.push({
      freq: midi(note),
      dur: 2.82,
      gain: note < 60 ? 0.04 : 0.065,
      at,
      attack: 0.45,
      release: 0.5,
    });
  }
  for (const [step, noteIndex] of [[1, 0], [3, 1], [4, 2], [6, 1]]) {
    musicEvents.push({
      freq: midi(chord[noteIndex] + 12),
      dur: 0.7,
      gain: 0.075,
      at: at + step * 0.36,
      attack: 0.01,
      release: 0.45,
    });
  }
}

await mkdir(OUT, { recursive: true });
for (const [name, [seconds, events]] of Object.entries(sounds)) {
  await writeFile(join(OUT, `${name}.wav`), render(seconds, events));
}
await writeFile(join(OUT, 'music.wav'), render(11.52, musicEvents));

console.log(`Generated ${Object.keys(sounds).length + 1} native audio assets in ${OUT}`);
