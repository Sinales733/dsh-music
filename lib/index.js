// dsh-music host half. Runs the Windows bridge (bridge.ps1) and the lyrics engine, and serves the browser half
// through one Remote service, "dshMusic":
//   watch(signal)            stream of events: { t: 'state', ... }, { t: 'lyrics', lyrics }, { t: 'beat', s }
//   command(action, signal)  'ai-busy' | 'ai-idle' | 'approval-on' | 'approval-off' | 'typing <0..1>' | 'swell'
//                            | 'launch' | 'set <json>' | 'play' | 'pause' | 'toggle' | 'next' | 'prev'
//                            | 'mode order|list|one|shuffle' | 'seek <ms>'
// The Gateway finds the service in SRC mode: a visible `typertRemote` binding plus the method markers set on the
// prototype below (the same record the @Remote decorator writes), so no generated Typert files are needed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLyrics, setRelay } from './lyrics.js';
import { createNcmClock } from './ncm.js';
import { DATA_DIR, SongArchive, songKey } from './songs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const name = 'dsh-whale-music';

const DEFAULTS = { micApps: 'Typeless' };
// What the user can change on the plugin's page; kept in %LOCALAPPDATA%\dsh-music\settings.json.
const LYRICS_RETRY = [15000, 60000, 180000, 600000];   // when a lyrics source could not be reached
const SETTINGS = { musicCoding: false, backdrop: 0.32, duck: 0.5, fadeIn: 8, beat: true, translation: true, lyrics: true, offsets: {}, moodModel: 'haiku', player: null };
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
// Music Coding is set aside for now (2026-11-16): its switch is gone from the page and it stays off whatever was saved.
// Set to true (here and MUSIC_CODING in src/client/music.js) to bring it back.
const MUSIC_CODING = false;

// Player process for per-app volume, from the SMTC app id.
// a player's media id (its program, or a Store app's id) to the process that plays its sound (for its volume)
const PROCS = [[/spotify/i, 'Spotify'], [/cloudmusic|netease/i, 'cloudmusic'], [/qqmusic/i, 'QQMusic'], [/applemusic|apple\.music/i, 'AppleMusic'], [/kugou/i, 'KuGou'], [/foobar/i, 'foobar2000'],
  [/sodamusic|汽水音乐/i, 'SodaMusic'], [/tidal/i, 'TIDAL'], [/deezer/i, 'Deezer'], [/amazon.?music/i, 'Amazon Music'], [/th-ch\.youtube-music|youtube.?music/i, 'YouTube Music'],
  [/cider/i, 'Cider'], [/musicbee/i, 'MusicBee'], [/aimp/i, 'AIMP'], [/itunes/i, 'iTunes'], [/qobuz/i, 'Qobuz'], [/zunemusic|media\.player/i, 'Microsoft.Media.Player']];
const procOf = (app) => (app ? PROCS.find(([rx]) => rx.test(app))?.[1] ?? /([^\\/!]+?)(\.exe)?$/i.exec(app)?.[1] ?? null : null);
// play modes as shuffle + repeat (Windows' media controls keep the two apart)
const MODES = { order: { shuffle: false, repeat: 'None' }, list: { shuffle: false, repeat: 'List' }, one: { shuffle: false, repeat: 'Track' }, shuffle: { shuffle: true, repeat: 'List' } };
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const livePos = (m) => (m.at > 946684800000 ? m.pos + (m.status === 'Playing' ? Date.now() - m.at : 0) : Infinity);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The same song title, give or take width, case, spacing and punctuation, or one inside the other (NetEase may add a
// translation or "(feat. …)" on one side). An unknown name (an older log) counts as the same.
const plainTitle = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
function sameTitle(name, title) {
  if (name == null) return true;
  const a = plainTitle(name), b = plainTitle(title);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

class Core {
  constructor(config, log, llm) {
    this.config = { ...DEFAULTS, ...config };
    this.log = log;
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { }
    this.settings = { ...SETTINGS, ...saved, offsets: { ...saved.offsets } };
    if (!MUSIC_CODING) this.settings.musicCoding = false;
    this.songs = new SongArchive({ llm, log, model: this.settings.moodModel });
    this.state = { media: null, cover: null, lyricsStatus: 'idle', mic: false, aiIdle: false, waiting: false, level: 1, mood: null, settings: this.settings };
    this.typing = 0;            // Music Coding: how far typing has brought the music back while the AI waits (0..1)
    this.skips = 0;
    this.audibleMs = 0;
    this.beatOn = false;
    this.pendingPlay = 0;
    this.lyrics = null;
    this.lyricsKey = null;
    this.lyricsReq = 0;         // numbers each look for lyrics: only the newest one's answer is used
    this.cache = new Map();
    this.subs = new Set();
    this.bridge = null;
    this.buf = '';
    this.http = new Map();
    this.httpId = 0;
    setRelay((url, o) => this.relay(url, o));
    this.start();
  }

  // A web request done by the bridge process (see lyrics.js: why a second process can get through).
  relay(url, { method, headers, body, timeout }) {
    if (!this.bridge) return Promise.reject(new Error('bridge not running'));
    const id = String(++this.httpId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.http.delete(id); reject(new Error('relay timeout')); }, timeout + 4000);
      this.http.set(id, (m) => {
        clearTimeout(timer);
        if (m.error) return reject(new Error(`relay: ${m.error}`));
        if (m.status >= 400) return reject(new Error(`HTTP ${m.status}`));
        try { resolve(JSON.parse(m.body)); } catch (e) { reject(e); }
      });
      this.send({ c: 'http', id, url, method, headers, body });
    });
  }

  start() {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'bridge.ps1'), '-MicApps', this.config.micApps];
    const p = spawn('powershell.exe', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.bridge = p;
    this.bridgeAt = Date.now();
    this.buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => {
      this.buf += d;
      for (let i; (i = this.buf.indexOf('\n')) >= 0;) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (line) { try { this.onBridge(JSON.parse(line)); } catch (e) { this.log?.warn('bridge line: %s', e); } }
      }
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => this.log?.warn('bridge: %s', String(d).trim()));
    p.on('error', (e) => this.log?.warn('bridge failed to start: %s', e));
    // a write that lands as the bridge exits fails later, as an event; unhandled it would take the Host down
    p.stdin.on('error', (e) => this.log?.warn('bridge input: %s', e.message));
    p.on('exit', (code) => {
      if (this.bridge !== p) return;
      this.bridge = null;
      this.log?.info('bridge exited %s', code);
      for (const [id, done] of this.http) done({ id, error: 'bridge exited' });   // relayed requests waiting on it
      this.http.clear();
      if (this.disposed) return;
      // Without the bridge nothing works (volume, lyrics relay, beats): start it again, backing off if it keeps dying
      this.bridgeDelay = Date.now() - this.bridgeAt > 60000 ? 1000 : Math.min((this.bridgeDelay ?? 500) * 2, 30000);
      this.log?.warn('restarting the bridge in %ds', this.bridgeDelay / 1000);
      this.bridgeRestart = setTimeout(() => {
        if (this.disposed) return;
        this.start();
        this.beatOn = false; this.updateBeat();          // the new one listens for beats only when told to
        this.state.level = 1; this.applyLevel(400);      // and holds no volume down until told to
      }, this.bridgeDelay);
      this.bridgeRestart.unref?.();
    });
  }

  send(o) { try { this.bridge?.stdin.write(JSON.stringify(o) + '\n'); } catch { /* bridge gone */ } }

  dispose() {
    this.log?.info('disposing');
    this.disposed = true;
    clearTimeout(this.bridgeRestart);
    setRelay(null);
    clearTimeout(this.ncmWait);
    clearTimeout(this.lyricsRetry);
    clearTimeout(this.changeWait);
    this.ncm?.dispose();
    this.send({ c: 'quit' });              // the bridge puts every volume it changed back before exiting
    setTimeout(() => this.bridge?.kill(), 1500).unref?.();
    for (const s of this.subs) s.end();
    this.subs.clear();
  }

  emit(ev) { for (const s of this.subs) s.push(ev); }
  pushState() { this.emit({ t: 'state', ...this.state }); }

  onBridge(m) {
    if (m.t === 'media') this.setMedia(m.app ? m : null);
    else if (m.t === 'cover') this.setCover(m.path);
    else if (m.t === 'mic') { this.state.mic = m.on; this.applyLevel(m.on ? 250 : 900); this.pushState(); }
    else if (m.t === 'beat') this.emit({ t: 'beat', s: m.s });
    else if (m.t === 'tempo') this.onTempo(m);
    else if (m.t === 'http') { const done = this.http.get(m.id); this.http.delete(m.id); done?.(m); }
    else if (m.t === 'launched') { if (!m.ok) { this.pendingPlay = 0; this.log?.warn('could not start the player: %s', m.m); } }
    else if (m.t === 'error') this.log?.warn('bridge: %s', m.m);
    else if (m.t === 'log') this.log?.info('bridge: %s', m.m);
  }

  setCover(file) {
    fs.readFile(file, (err, buf) => {
      if (err) return;
      this.state.cover = `data:${buf[0] === 0x89 ? 'image/png' : 'image/jpeg'};base64,${buf.toString('base64')}`;
      this.pushState();
    });
  }

  // NetEase reports no timeline; its position comes from its log (ncm.js), which also names the exact song. Windows
  // announces a new song about half a second before the log does, so the log only counts once the song it names is
  // the one Windows names: until then it still describes the previous song (its id, length and position).
  withNcm(m) {
    this.ncm ??= createNcmClock(() => { if (this.rawMedia && /cloudmusic/i.test(this.rawMedia.app)) this.setMedia(this.rawMedia); });
    const c = this.ncm.now();
    if (!c || !sameTitle(c.name, m.title)) return m;
    return { ...m, ncmId: c.id, dur: m.dur || c.dur, pos: c.pos, at: c.playing ? c.at : Date.now() };
  }

  setMedia(raw) {
    const prevRaw = this.rawMedia;
    this.rawMedia = raw;
    let m = raw && /cloudmusic/i.test(raw.app) ? this.withNcm(raw) : raw;
    // a new song reported with the last one's timeline (QQ Music, for a second after a change): it starts now
    if (m && prevRaw && raw.at > 946684800000 && songKey(raw) !== songKey(prevRaw) && raw.at === prevRaw.at && raw.pos === prevRaw.pos && m.at === raw.at) {
      m = { ...m, pos: 0, at: Date.now() };
    }
    // No timeline at all, not even a time it was updated (KuGou, when the bridge does not know its build and cannot
    // read its place): no place in the song is known, the song is shown by its name (noPos).
    if (m && !(m.dur > 0) && !(m.at > 946684800000)) m = { ...m, noPos: true };
    const prevProc = procOf(this.state.media?.app), proc = procOf(m?.app);
    const prevKey = songKey(this.state.media);
    this.state.media = m && { app: m.app, proc, title: m.title, artist: m.artist, album: m.album, status: m.status, pos: m.pos, at: m.at, dur: m.dur, ncmId: m.ncmId,
      next: m.next !== false, prev: m.prev !== false, seek: m.seek === true, shuffle: m.shuffle ?? null, repeat: m.repeat ?? null, ...(m.noPos ? { noPos: true } : {}) };
    if (!m) this.state.cover = null;
    if (m?.exe && this.settings.player?.exe !== m.exe) this.set({ player: { app: m.app, exe: m.exe } });
    if (m && this.pendingPlay > Date.now() && m.status !== 'Playing') { this.pendingPlay = 0; this.send({ c: 'play' }); }
    if (prevProc !== proc) {                   // another player: give the old one its volume back, duck the new one
      if (prevProc) this.send({ c: 'restore', ms: 300 });
      this.state.level = 1;
      this.applyLevel(400);
    }
    const key = songKey(m);
    if (key !== prevKey) {
      this.titleAt = Date.now();
      this.changing = 0; clearTimeout(this.changeWait);
      if (m) this.log?.info('song: %s - %s (%s, %s)', m.title, m.artist ?? '', proc, m.dur > 0 ? `${Math.round(m.dur / 1000)} s` : 'no length');
      this.onNewSong(m, prevKey && prevProc === proc);
    }
    // lyrics belong to a song and, on NetEase, to its exact id: one arriving late loads them again, by id
    const lyricsKey = key && `${key}\u0000${m.ncmId ?? ''}`;
    if (lyricsKey !== this.lyricsKey) {
      clearTimeout(this.durWait);
      this.lyricsKey = lyricsKey;
      this.lyricsSong = key;
      this.lyrics = null;
      this.emit({ t: 'lyrics', lyrics: null });
      clearTimeout(this.ncmWait);
      if (!key) this.state.lyricsStatus = 'idle';
      else if (/cloudmusic/i.test(m.app) && !m.ncmId) {
        // NetEase's log names the song a moment after Windows does; search by title only if it never does
        this.state.lyricsStatus = 'searching';
        this.ncmWait = setTimeout(() => { if (this.lyricsKey === lyricsKey) this.loadLyrics(lyricsKey, m); }, 2500);
        this.ncmWait.unref?.();
      } else this.loadLyrics(lyricsKey, m);
    } else if (key && m.dur > 0 && this.lyricsDur > 0 && Math.abs(m.dur - this.lyricsDur) > 2000 && Date.now() - this.titleAt > 4000 && livePos(m) < 15000) {
      // The length changed long after the name came, the song back at its start: the next song (or an ad) has started
      // and the player has not named it yet (Spotify names it only once its artwork is in; the bridge reads Spotify's
      // window for the name meanwhile, which an ad does not show). The lyrics would be the last song's from its top:
      // they go until the name comes, or for 20 s at most (the same song after all: looked up again for its length).
      this.unnamed(lyricsKey, m);
    } else if (key && m.dur > 0 && Math.abs(m.dur - (this.lyricsDur || 0)) > 2000 && !this.changing) {
      // the player told the song's length only after its name (Spotify, after an ad, still reports the ad's for a
      // moment): look again with the right one, which can pick another cut of the song (a live recording). Not at
      // once: on a skip, Spotify can tell the next song's length a moment before its name (the name would not change
      // within 1.5 s here).
      clearTimeout(this.durWait);
      this.durWait = setTimeout(() => {
        const cur = this.state.media;
        if (this.lyricsKey === lyricsKey && cur?.dur > 0 && Math.abs(cur.dur - (this.lyricsDur || 0)) > 2000) this.loadLyrics(lyricsKey, { ...m, dur: cur.dur });
      }, 1500);
      this.durWait.unref?.();
    }
    if (this.changing && this.state.media) this.state.media.changing = true;
    this.updateBeat();
    this.pushState();
  }

  unnamed(lyricsKey, m) {
    if (this.changing) return;
    this.changing = Date.now();
    this.log?.info('a new song started, not named yet (%s s): the last one\'s lyrics go', Math.round(m.dur / 1000));
    clearTimeout(this.durWait);
    this.lyrics = null;
    this.emit({ t: 'lyrics', lyrics: null });
    clearTimeout(this.changeWait);
    this.changeWait = setTimeout(() => {
      if (!this.changing || this.lyricsKey !== lyricsKey) return;
      this.changing = 0;
      const cur = this.state.media;
      if (cur) { delete cur.changing; this.loadLyrics(lyricsKey, { ...m, dur: cur.dur }); }
      this.pushState();
    }, 20000);
    this.changeWait.unref?.();
  }

  // A song started. Music Coding: fade it in over a few seconds, and while the music is silent, skip a song that
  // does not suit the moment.
  onNewSong(m, sameDevice) {
    this.audibleMs = 0;
    this.state.mood = this.songs.get(m)?.mood ?? null;
    if (!m || !this.settings.musicCoding) return;
    const proc = procOf(m.app);
    if (sameDevice && proc && this.state.level > 0) {
      this.send({ c: 'duck', p: proc, f: 0, ms: 1 });
      this.send({ c: 'duck', p: proc, f: this.state.level, ms: this.settings.fadeIn * 1000 });
    }
    if (this.state.aiIdle && this.state.level === 0) void this.maybeSkip('waiting');
  }

  // While you think or type the music should be calm (skip lively songs); while the AI works, not sleepy.
  async maybeSkip(moment) {
    const m = this.state.media;
    if (!this.settings.musicCoding || !m || this.skips >= 5) return;
    const key = songKey(m);
    const mood = await this.songs.moodOf(m, this.lyricsSong === key ? this.lyrics : null);
    if (songKey(this.state.media) !== key) return;
    this.state.mood = mood;
    this.pushState();
    if (mood === (moment === 'working' ? 'A' : 'C')) {
      this.skips++;
      this.log?.info('skipping %s - %s (%s while %s)', m.title, m.artist, mood, moment);
      this.send({ c: 'next' });
    } else this.skips = 0;
  }

  onTempo(report) {
    const m = this.state.media;
    if (!m || m.status !== 'Playing' || this.state.level < 0.3) return;
    this.audibleMs += 2000;
    this.songs.measure(m, report, this.audibleMs);
    const mood = this.songs.get(m)?.mood ?? null;
    if (mood !== this.state.mood) { this.state.mood = mood; this.pushState(); }
  }

  updateBeat() {
    const on = !!(this.settings.beat && this.state.media?.status === 'Playing');
    if (on !== this.beatOn) { this.beatOn = on; this.send({ c: 'beat', on }); }
  }

  async loadLyrics(key, m, attempt = 0) {
    // A second look for the same song (its length told again, corrected) can answer before the first: the first one's
    // answer, for the wrong length, must not then replace it.
    const req = ++this.lyricsReq;
    this.lyricsDur = m.dur || 0;
    const ck = `${key}\u0000${Math.round((m.dur || 0) / 2000)}`;   // lyrics found for a song of about this length
    let ly = this.cache.get(ck), retrying = false;
    const t0 = Date.now();
    if (ly === undefined) {
      this.state.lyricsStatus = 'searching';
      let unreached = false;
      // better lyrics for the same song, a moment later (moved to LRCLIB's timing when LRCLIB was slow)
      const onUpdate = (better) => {
        if (this.cache.get(ck) === ly) this.cache.set(ck, better);
        if (this.lyricsKey !== key || this.lyrics !== ly) return;
        this.log?.info('lyrics for %s: moved %s ms to LRCLIB\'s timing (it answered late)', m.title, better.shift);
        this.lyrics = better;
        this.emit({ t: 'lyrics', lyrics: better });
      };
      try { ly = await findLyrics({ app: m.app, title: m.title, artist: m.artist, album: m.album, dur: m.dur, ncmId: m.ncmId }, { log: (s) => this.log?.warn(s), onUpdate: (b) => onUpdate(b) }); }
      catch (e) { this.log?.warn('lyrics: %s', e?.message ?? e); ly = null; unreached = true; }
      if (!unreached) {
        this.cache.set(ck, ly);
        if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
      } else if (attempt < LYRICS_RETRY.length && this.lyricsReq === req) {
        // a source could not be reached (the network was down): not "no lyrics"; look again in a while
        clearTimeout(this.lyricsRetry);
        this.lyricsRetry = setTimeout(() => { if (this.lyricsKey === key) this.loadLyrics(key, m, attempt + 1); }, LYRICS_RETRY[attempt]);
        this.lyricsRetry.unref?.();
        retrying = true;
      }
    }
    if (this.lyricsKey !== key || this.lyricsReq !== req) return;
    const [title, artist, id] = key.split('\u0000');
    const notes = [ly?.shift ? `moved ${ly.shift > 0 ? '+' : ''}${ly.shift} ms to LRCLIB's timing` : '', ly?.clip ? `QQ preview ${ly.clip[0]}-${ly.clip[1]} ms` : '', m.dur ? `${Math.round(m.dur / 1000)} s` : 'no length',
      `in ${Date.now() - t0} ms`, retrying ? 'trying again later' : ''].filter(Boolean).join(', ');
    this.log?.info('lyrics for %s - %s%s: %s', title, artist, id ? ` (NetEase ${id})` : '', ly?.nameOnly ? `name only: a live cut, no lyrics timed for it (${notes})` : ly ? `${ly.src} ${ly.synced} ${ly.lines.length} lines (${notes})` : `none (${notes})`);
    this.lyrics = ly;
    this.state.lyricsStatus = ly ? 'found' : retrying ? 'searching' : 'none';
    this.emit({ t: 'lyrics', lyrics: ly });
    this.pushState();
  }

  // Normal mode: the song plays on, and steps back only while the AI waits for your approval.
  // Music Coding: silent once the AI is done; your typing brings it back (faster typing, more of it), speaking
  // presses it low, pasted dictation and sending a message bring it back in full.
  targetLevel() {
    const s = this.settings;
    if (this.state.waiting) return s.duck;
    if (!s.musicCoding) return 1;
    if (this.state.mic) return 0.15;
    if (this.state.aiIdle) return Math.round(this.typing * 20) / 20;
    return 1;
  }

  applyLevel(ms = 600) {
    const proc = procOf(this.state.media?.app);
    const level = this.targetLevel();
    if (level === this.state.level) return;
    this.state.level = level;
    if (!proc) return;
    this.send(level === 1 ? { c: 'restore', ms } : { c: 'duck', p: proc, f: level, ms });
  }

  set(patch) {
    if (!MUSIC_CODING) patch = { ...patch, musicCoding: false };
    const before = this.settings;
    this.settings = { ...before, ...patch, offsets: { ...before.offsets, ...patch.offsets } };
    this.state.settings = this.settings;
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2)); } catch (e) { this.log?.warn('settings: %s', e); }
    if (patch.moodModel) { this.songs.model = patch.moodModel; this.songs.route = undefined; }
    if ('musicCoding' in patch && !patch.musicCoding) this.typing = 0;
    this.applyLevel(800);
    this.updateBeat();
  }

  // Nothing playing: start the player last seen (Spotify when none was), then press play once it reports in.
  launch() {
    if (this.state.media) { this.send({ c: 'play' }); return; }
    this.pendingPlay = Date.now() + 25000;
    this.send({ c: 'launch', path: this.settings.player?.exe || 'spotify:' });
  }

  command(action) {
    this.log?.info('command %s', action.length > 80 ? `${action.slice(0, 80)}…` : action);
    const mc = this.settings.musicCoding;
    if (action.startsWith('set ')) {
      try { this.set(JSON.parse(action.slice(4))); } catch (e) { this.log?.warn('settings: %s', e); return false; }
    } else if (action.startsWith('seek ')) {
      const ms = Number(action.slice(5));
      if (!Number.isFinite(ms) || !this.state.media?.seek) return false;
      this.send({ c: 'seek', ms: Math.max(0, Math.round(ms)) });
    } else if (action.startsWith('mode ')) {
      // the page's play modes, as the player's shuffle and repeat (only what this player takes: Spotify both, NetEase none)
      const want = MODES[action.slice(5)], m = this.state.media;
      if (!want || !m) return false;
      this.send({ c: 'mode', ...(m.shuffle !== null ? { shuffle: want.shuffle } : {}), ...(m.repeat !== null ? { repeat: want.repeat } : {}) });
    } else if (action.startsWith('typing ')) {
      if (!mc || !this.state.aiIdle) return true;
      this.typing = clamp01(action.slice(7));
      this.applyLevel(400);
    } else switch (action) {
      case 'ai-busy':
        this.state.aiIdle = false; this.typing = 0; this.skips = 0;
        if (mc) { void Promise.race([this.maybeSkip('working'), sleep(2000)]).then(() => { this.applyLevel(1500); this.pushState(); }); return true; }
        this.applyLevel(800);
        break;
      case 'ai-idle': this.state.aiIdle = true; this.typing = 0; this.applyLevel(mc ? 3000 : 1200); break;
      case 'swell': if (mc && this.state.aiIdle) { this.typing = 1; this.applyLevel(2500); } break;
      case 'approval-on': this.state.waiting = true; this.applyLevel(800); break;
      case 'approval-off': this.state.waiting = false; this.applyLevel(800); break;
      case 'launch': this.launch(); break;
      case 'play': case 'pause': case 'toggle': case 'next': case 'prev': this.send({ c: action }); break;
      default: return false;
    }
    this.pushState();
    return true;
  }

  // One subscriber per watch() call: replays the current state and lyrics, then live events.
  subscribe(signal) {
    const queue = [], waiters = [];
    let done = false;
    const sub = {
      push: (ev) => { if (done) return; const w = waiters.shift(); w ? w({ value: ev, done: false }) : queue.push(ev); },
      end: () => { done = true; for (const w of waiters.splice(0)) w({ value: undefined, done: true }); },
    };
    this.subs.add(sub);
    this.log?.info('watch opened (%d open)', this.subs.size);
    sub.push({ t: 'state', ...this.state });
    sub.push({ t: 'lyrics', lyrics: this.lyrics });
    const stop = () => {
      if (!this.subs.delete(sub)) return;
      sub.end();
      this.log?.info('watch closed (%d open)', this.subs.size);
      // no page left to see the approval card (a reload, the plugin turned off): stop holding the music down; a page
      // that opens again and still shows one says so on connecting
      if (!this.subs.size && this.state.waiting) { this.state.waiting = false; this.applyLevel(800); }
    };
    signal?.addEventListener('abort', stop, { once: true });
    return {
      [Symbol.asyncIterator]() { return this; },
      next: () => (queue.length ? Promise.resolve({ value: queue.shift(), done: false })
        : done ? Promise.resolve({ value: undefined, done: true }) : new Promise((r) => waiters.push(r))),
      return: () => { stop(); return Promise.resolve({ value: undefined, done: true }); },
    };
  }
}

class MusicService {
  constructor(core) {
    this.core = core;
    this.typertRemote = Object.freeze({ service: this, serviceKey: 'dshMusic', namespace: 'dshMusic' });
  }
  watch(signal) { return this.core.subscribe(signal); }
  async command(action, signal) { return this.core.command(action); }
}
// What @Remote / @Remote({ mode: 'stream' }) would record (dsh-typert-protocol's descriptor, version 1).
Object.defineProperty(MusicService.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      Object.freeze({ method: 'watch', mode: 'stream', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'command', invocation: Object.freeze({ kind: 'direct' }) }),
    ]),
  }),
});

// A short plain-text log in %TEMP%\dsh-music\host.log (restarted with each load), for when something does not show up.
function fileLogger(base) {
  const file = path.join(os.tmpdir(), 'dsh-music', 'host.log');
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); } catch { }
  const line = (level) => (fmt, ...args) => {
    let i = 0;
    const msg = String(fmt).replace(/%[sdo]/g, () => String(args[i++]));
    try { fs.appendFileSync(file, `${new Date().toISOString().slice(11, 23)} ${level} ${msg}\n`); } catch { }
    base?.[level]?.(fmt, ...args);
  };
  return { info: line('info'), warn: line('warn') };
}

export function apply(ctx, config = {}) {
  if (process.platform !== 'win32') return;               // the bridge is Windows-only; stay out of the way elsewhere
  const log = fileLogger(typeof ctx.logger === 'function' ? ctx.logger('dsh-whale-music') : undefined);
  log.info('loaded');
  // DSH's model service, used only by Music Coding to ask a song's mood. Attached in a child of its own once it
  // exists, never as a dependency of the plugin itself (a declared inject held the whole Desktop start-up back).
  let llm;
  const core = new Core(config ?? {}, log, () => llm);
  try {
    ctx.inject?.(['llm'], (child) => { llm = child.llm; log.info('model service ready'); child.effect(() => () => { llm = undefined; }); });
  } catch (e) { log.warn('model service: %s', e?.message ?? e); }
  ctx.reflect.provide('dshMusic', new MusicService(core));
  ctx.effect(() => () => core.dispose());
}
