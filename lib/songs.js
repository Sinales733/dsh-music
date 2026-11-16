// Song archive for Music Coding: how each song feels, A quiet / B medium / C lively (D unknown).
// Measured first from the bridge's beat reports while the song is audible; a song that has no measurement when a
// decision needs it is asked once of a small model (Haiku by default) through DSH's LLM service. Kept in
// %LOCALAPPDATA%\dsh-music\songs.json.
import fs from 'node:fs';
import path from 'node:path';
import { MOOD_SYSTEM, moodPrompt, parseMood, excerptOf } from './mood.js';

export const DATA_DIR = path.join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? '.', 'dsh-music');
const FILE = path.join(DATA_DIR, 'songs.json');
const MEASURE_MS = 25000;                 // audible time needed before a measurement counts

export const songKey = (m) => (m?.title ? `${m.title}\u0000${m.artist ?? ''}` : null);

/** From beat statistics: beats per second of bass hits, the average bass response, the tempo. */
export function moodFromMeasure({ rate, activity, bpm }) {
  if (rate < 0.5 || activity < 0.03) return 'A';
  if ((rate >= 1.3 && activity >= 0.07) || (bpm >= 120 && rate >= 1.15)) return 'C';
  return 'B';
}

export class SongArchive {
  constructor({ llm, log, model = 'haiku' } = {}) {
    this.llmOf = typeof llm === 'function' ? llm : () => llm;   // the service may arrive after the plugin
    this.log = log;
    this.model = model;
    this.asking = new Map();
    try { this.songs = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { this.songs = {}; }
  }

  save() {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(this.songs)); } catch (e) { this.log?.warn('songs: %s', e); }
  }

  get(m) { return this.songs[songKey(m)] ?? null; }

  // Called with the bridge's 2-second tempo reports while the song is audible.
  measure(m, report, audibleMs) {
    const key = songKey(m);
    if (!key || audibleMs < MEASURE_MS || !report.rate) return;
    const old = this.songs[key];
    if (old?.by === 'measure' && old.n >= 3) return;
    const n = (old?.by === 'measure' ? old.n : 0) + 1;
    const avg = (a, b) => (old?.by === 'measure' ? (a * (n - 1) + b) / n : b);
    const bpm = avg(old?.bpm ?? 0, report.bpm), rate = avg(old?.rate ?? 0, report.rate), activity = avg(old?.activity ?? 0, report.activity);
    this.songs[key] = { mood: moodFromMeasure({ bpm, rate, activity }), bpm, rate, activity, n, by: 'measure', at: Date.now() };
    this.save();
  }

  /** The song's mood, asking the model once when nothing is known yet. Resolves 'D' when it cannot tell. */
  async moodOf(m, lyrics) {
    const known = this.get(m);
    if (known) return known.mood;
    const key = songKey(m);
    if (!key || !this.llmOf()) return 'D';
    if (!this.asking.has(key)) this.asking.set(key, this.ask(m, lyrics).finally(() => this.asking.delete(key)));
    return this.asking.get(key);
  }

  async findModel() {
    if (this.route !== undefined) return this.route;
    this.route = null;
    try {
      const rx = new RegExp(this.model, 'i');
      const llm = this.llmOf();
      for (const p of llm.listProviders()) {
        const models = await llm.listModels(p.id).catch(() => []);
        const hit = models.filter((x) => rx.test(x.id) || rx.test(x.name)).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
        if (hit) { this.route = { provider: p.id, model: hit.id }; break; }
      }
    } catch (e) { this.log?.warn('songs: model lookup failed: %s', e); }
    this.log?.info('songs: mood model %s', this.route ? `${this.route.provider}/${this.route.model}` : 'none');
    return this.route;
  }

  async ask(m, lyrics) {
    const route = await this.findModel();
    if (!route) return 'D';
    const prompt = moodPrompt({ title: m.title, artist: m.artist, album: m.album, instrumental: lyrics?.instrumental, excerpt: excerptOf(lyrics) });
    let text = '';
    try {
      const signal = AbortSignal.timeout(20000);
      for await (const c of this.llmOf().stream({ ...route, system: MOOD_SYSTEM, maxTokens: 8, temperature: 0, signal,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] })) {
        if (c.type === 'text-delta') text += c.text;
      }
    } catch (e) { this.log?.warn('songs: asking %s failed: %s', route.model, e?.message ?? e); return 'D'; }
    const mood = parseMood(text);
    this.log?.info('songs: %s - %s -> %s (%s)', m.title, m.artist, mood, route.model);
    if (mood !== 'D') { this.songs[songKey(m)] = { mood, by: 'model', model: route.model, at: Date.now() }; this.save(); }
    return mood;
  }
}
