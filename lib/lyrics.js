// dsh-music lyrics engine: find, fetch and parse time-synced lyrics for the track that is playing.
// Adapted from lx-music-desktop (Apache-2.0, lyswhut): NetEase eapi requests, QQ Music signing and QRC decoding;
// and from Lyricify Lyrics Helper (Apache-2.0, WXRIW): the track-matching scores. See NOTICE.
//
// Result: { src, id, match, synced: 'word'|'line'|'none', instrumental, lines: [{ t, d, text, w?, tr? }] }
//   t / d: start and length in ms;  w: word timings [[t, d, text], ...];  tr: translation of the line.
import crypto from 'node:crypto';
import https from 'node:https';
import zlib from 'node:zlib';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Three ways out, because a user's network may block any one of them for this process:
//   direct  node:https with its own agent (never sees dsh-http-proxy's global fetch dispatcher)
//   relay   another process does the request (the host passes one in via setRelay: the PowerShell bridge),
//           for per-app proxy rules such as Clash TUN routing the whole DSH process abroad
//   fetch   global fetch, i.e. through the user's configured proxy inside DSH
// Domestic services try direct first, overseas ones fetch first; whichever works is remembered per host.
let relay = null;
export const setRelay = (fn) => { relay = fn; };
const viaRelay = (url, o) => (relay ? relay(url, o) : Promise.reject(new Error('no relay')));
const working = new Map();
const directAgent = new https.Agent({ keepAlive: true });
function direct(url, { method, headers, body, timeout }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, agent: directAgent, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
async function viaFetch(url, { method, headers, body, timeout }) {
  const r = await fetch(url, { method, body, headers, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function http(url, { method = 'GET', headers = {}, body, form, timeout = 8000, directFirst = false } = {}) {
  if (form) { body = new URLSearchParams(form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
  const o = { method, body, timeout, headers: { 'user-agent': UA, ...headers } };
  const host = new URL(url).host;
  const order = directFirst ? [direct, viaRelay, viaFetch] : [viaFetch, direct, viaRelay];
  const known = working.get(host);
  const routes = known ? [known, ...order.filter((r) => r !== known)] : order;
  let first;
  for (const route of routes) {
    try {
      const out = await route(url, o);
      working.set(host, route);
      return out;
    } catch (e) {
      if (/^HTTP /.test(e?.message)) throw e;           // the server answered: another route will not help
      first ??= e;
    }
  }
  throw first;
}

// ------------------------------------------------------------------------------------------------- parsing
const ms = (m, s, f = '0') => (+m * 60 + +s) * 1000 + Math.round(+(f + '00').slice(0, 3));
const CREDIT = /^\s*(作词|作詞|作曲|编曲|編曲|词|詞|曲|制作人|製作人|制作|製作|监制|監製|出品|发行|發行|混音|母带|母帶|录音|錄音|和声|和聲|合声|合聲|演唱|主唱|伴唱|人声|吉他|贝斯|貝斯|鼓|键盘|鍵盤|弦乐|弦樂|配器|配唱|统筹|統籌|策划|策劃|原唱|lyricist|lyrics?|composer|composed|written|music|arranger|arranged|producer|produced|mixing|mixed|mastering|mastered|recording|vocals?|backing vocals?|guitars?|bass|drums|keyboards?|strings|programming)[一-鿿]{0,4}(\s*by)?\s*[:：]/i;
const CLAIM = /著作权|版权所有|未经.{0,10}许可|不得翻唱|享有本翻译/;
const INSTRUMENTAL = /纯音乐|请您?欣赏|^instrumental$/i;

/** LRC: [mm:ss.xx]... text, several tags per line allowed; [offset:+/-ms] honoured. */
export function parseLrc(text) {
  const out = [];
  let offset = 0;
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(raw);
    if (off) { offset = +off[1]; continue; }
    const tags = [];
    const body = raw.replace(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g, (_, m, s, f) => (tags.push(ms(m, s, f)), ''));
    for (const t of tags) out.push({ t: Math.max(0, t - offset), text: body.trim() });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** NetEase YRC: [start,dur](ws,wd,0)word(ws,wd,0)word  — timing before each word; JSON lines are credits. */
export function parseYrc(text) {
  const out = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const m = /^\[(\d+),(\d+)\](.*)$/.exec(raw.trim());
    if (!m) continue;
    const w = [];
    const marks = [...m[3].matchAll(/\((\d+),(\d+),-?\d+\)/g)];
    marks.forEach((k, i) => {
      const s = m[3].slice(k.index + k[0].length, marks[i + 1]?.index ?? m[3].length);
      if (s) w.push([+k[1], +k[2], s]);
    });
    out.push({ t: +m[1], d: +m[2], text: w.map((x) => x[2]).join(''), w });
  }
  return out;
}

/** QQ QRC: [start,dur]word(ws,wd)word(ws,wd)  — timing after each word. */
export function parseQrc(text) {
  const out = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const m = /^\[(\d+),(\d+)\](.*)$/.exec(raw.trim());
    if (!m) continue;
    const w = [...m[2 + 1].matchAll(/(.*?)\((\d+),(\d+)\)/g)].filter((k) => k[1]).map((k) => [+k[2], +k[3], k[1]]);
    out.push({ t: +m[1], d: +m[2], text: w.map((x) => x[2]).join(''), w });
  }
  return out;
}

/** Drop credits, claims and a leading "title - artist" line, fill in line lengths, attach a translation, flag instrumentals. */
function finish(lines, trText, synced, track) {
  const title = track?.title ? normName(track.title) : null;
  lines = lines.filter((l, i) => {
    if (!l.text || CREDIT.test(l.text) || CLAIM.test(l.text)) return false;
    if (i > 2 || !title) return true;
    const s = normName(l.text);
    return !(s.includes(title) && (/ [-–—] /.test(s) || track.artists.some((a) => s.includes(a.toLowerCase()))));
  });
  const instrumental = lines.length === 0 || (lines.length === 1 && INSTRUMENTAL.test(lines[0].text.trim()));
  if (instrumental) return { synced: 'none', instrumental: true, lines: [] };
  lines.forEach((l, i) => { if (!l.d) l.d = Math.min((lines[i + 1]?.t ?? l.t + 5000) - l.t, 10000); });
  const tr = parseLrc(trText).filter((l) => l.text && l.text !== '//' && !CLAIM.test(l.text));
  let j = 0;
  for (const l of tr) {           // each translation goes to the nearest line that starts within 1.5 s of it
    while (j + 1 < lines.length && Math.abs(lines[j + 1].t - l.t) <= Math.abs(lines[j].t - l.t)) j++;
    if (Math.abs(lines[j].t - l.t) <= 1500 && !lines[j].tr) lines[j].tr = l.text;
  }
  return { synced, instrumental: false, lines };
}

// ------------------------------------------------------------------------------------------------- QQ QRC decoding
// QQ's lyrics are 3DES (a DES variant: S2[23]=15, S4[53]=10) + zlib. Ported from lx-music-desktop, unrolled
// permutations folded back into loops.
const SBOX = ['e4d12fb83a6c59070f74e2d1a6cb953841e8d62bfc973a50fc8249175b3ea06d', 'f18e6b34972dc05a3d47f28fc01a69b50e7ba4d158c6932fd8a13f42b67c05e9', 'a09e63f51dc7b428d709346a285ecbf1d6498f30b12c5ae71ad069874fe3b52c', '7de3069a1285bc4fd8b56f03472c1ae9a690cb7df13e52843f06aad8945bc72e', '2c417ab6853fd0e9eb2c47d150fa3986421bad78f9c5630eb8c71e2d6f09a453', 'c1af92680d34e75baf427c9561de0b389ef528c3704a1db6432c95fabe17608d', '4b2ef08d3c975a61d0b7491ae35c2f8614bdc37eaf6805926bd814a7950fe23c', 'd2846fb1a93e50c71fd8a374c56b0e927b419ce206adf35821e74a8dfc90356b'].map((s) => [...s].map((c) => parseInt(c, 16)));
const PC_C = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
const PC_D = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
const PC2 = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];
const PERM = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24];
const SHIFT = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const QRC_KEY = Buffer.from('!@#)(*$%123ZXC!@!@#)(NHL');
const bit = (a, b, c) => ((a[(b >> 5) * 4 + 3 - ((b & 31) >> 3)] >>> (7 - (b & 7))) & 1) << c;   // byte array, LE words
const bitR = (a, b, c) => ((a >>> (31 - b)) & 1) << c;
const bitL = (a, b, c) => ((a << b) & 0x80000000) >>> c;
const sboxBit = (a) => (a & 32) | ((a & 31) >> 1) | ((a & 1) << 4);

function keySchedule(key, decrypt) {
  const ks = Array.from({ length: 16 }, () => new Uint8Array(6));
  let c = 0, d = 0;
  for (let i = 0; i < 28; i++) { c |= bit(key, PC_C[i], 31 - i); d |= bit(key, PC_D[i], 31 - i); }
  for (let i = 0; i < 16; i++) {
    const s = SHIFT[i];
    c = ((c << s) | (c >>> (28 - s))) & 0xfffffff0;
    d = ((d << s) | (d >>> (28 - s))) & 0xfffffff0;
    const k = ks[decrypt ? 15 - i : i];
    for (let j = 0; j < 24; j++) k[j >> 3] |= bitR(c, PC2[j], 7 - (j & 7));
    for (let j = 24; j < 48; j++) k[j >> 3] |= bitR(d, PC2[j] - 27, 7 - (j & 7));
  }
  return ks;
}

function feistel(st, k) {
  let t1 = 0, t2 = 0;
  for (let i = 0; i < 24; i++) {                      // E expansion, source bit (4*(i/6) + i%6 - 1) mod 32
    t1 |= bitL(st, (4 * ((i / 6) | 0) + (i % 6) + 31) % 32, i);
    t2 |= bitL(st, (4 * (((i + 24) / 6) | 0) + ((i + 24) % 6) + 31) % 32, i);
  }
  const x = [t1 >>> 24, t1 >>> 16, t1 >>> 8, t2 >>> 24, t2 >>> 16, t2 >>> 8].map((v, i) => (v & 255) ^ k[i]);
  const s = (SBOX[0][sboxBit(x[0] >> 2)] << 28) | (SBOX[1][sboxBit(((x[0] & 3) << 4) | (x[1] >> 4))] << 24)
    | (SBOX[2][sboxBit(((x[1] & 15) << 2) | (x[2] >> 6))] << 20) | (SBOX[3][sboxBit(x[2] & 63)] << 16)
    | (SBOX[4][sboxBit(x[3] >> 2)] << 12) | (SBOX[5][sboxBit(((x[3] & 3) << 4) | (x[4] >> 4))] << 8)
    | (SBOX[6][sboxBit(((x[4] & 15) << 2) | (x[5] >> 6))] << 4) | SBOX[7][sboxBit(x[5] & 63)];
  let r = 0;
  for (let i = 0; i < 32; i++) r |= bitL(s, PERM[i], i);
  return r;
}

function desBlock(input, ks, out) {
  let s0 = 0, s1 = 0;
  for (let i = 0; i < 32; i++) {                      // initial permutation
    const b = 2 * (i >> 3) - 8 * (i & 7);
    s0 |= bit(input, 57 + b, 31 - i);
    s1 |= bit(input, 56 + b, 31 - i);
  }
  for (let i = 0; i < 15; i++) [s0, s1] = [s1, feistel(s1, ks[i]) ^ s0];
  s0 = feistel(s1, ks[15]) ^ s0;
  [3, 2, 1, 0, 7, 6, 5, 4].forEach((o, j) => {        // inverse permutation
    let v = 0;
    for (let m = 0; m < 4; m++) v |= bitR(s1, 7 - j + 8 * m, 7 - 2 * m) | bitR(s0, 7 - j + 8 * m, 6 - 2 * m);
    out[o] = v & 255;
  });
}

let qrcKeys;
export function decodeQrc(hex) {
  if (!hex || hex.length % 2) return '';
  qrcKeys ??= [keySchedule(QRC_KEY.subarray(16, 24), true), keySchedule(QRC_KEY.subarray(8, 16), false), keySchedule(QRC_KEY.subarray(0, 8), true)];
  const buf = Buffer.from(hex, 'hex');
  const a = new Uint8Array(8), b = new Uint8Array(8);
  for (let i = 0; i + 8 <= buf.length; i += 8) {
    desBlock(buf.subarray(i, i + 8), qrcKeys[0], a);
    desBlock(a, qrcKeys[1], b);
    desBlock(b, qrcKeys[2], a);
    buf.set(a, i);
  }
  try { return zlib.inflateSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8'); } catch { return ''; }
}

const xmlText = (s) => s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e] ?? String.fromCharCode(+e.slice(1)));
const qrcContent = (s) => (/LyricContent="([\s\S]*?)"\s*\/>/.exec(s) ? xmlText(RegExp.$1) : s);

// ------------------------------------------------------------------------------------------------- providers
const EAPI_KEY = 'e82ckenh8dichen8';
function eapi(path, data) {
  const text = JSON.stringify(data);
  const digest = crypto.createHash('md5').update(`nobody${path}use${text}md5forencrypt`).digest('hex');
  const c = crypto.createCipheriv('aes-128-ecb', EAPI_KEY, null);
  return { params: Buffer.concat([c.update(`${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`), c.final()]).toString('hex').toUpperCase() };
}
const neteasePost = (url, path, data) => http(url, { method: 'POST', headers: { origin: 'https://music.163.com' }, form: eapi(path, data), directFirst: true });

function zzcSign(text) {
  const h = crypto.createHash('sha1').update(text).digest('hex');
  const pick = (ix) => ix.map((i) => h[i]).join('');
  const mid = Buffer.from([89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]
    .map((v, i) => v ^ parseInt(h.slice(i * 2, i * 2 + 2), 16))).toString('base64').replace(/[\\/+=]/g, '');
  return `zzc${pick([23, 14, 6, 36, 16, 40, 7, 19])}${mid}${pick([16, 1, 32, 12, 19, 27, 8, 5])}`.toLowerCase();
}

const PROVIDERS = {
  netease: {
    async search(q) {
      const b = await neteasePost('https://interface.music.163.com/eapi/batch', '/api/search/song/list/page',
        { keyword: q, needCorrect: '1', channel: 'typing', offset: 0, scene: 'normal', total: true, limit: 10 });
      return (b?.data?.resources ?? []).map((r) => r.baseInfo?.simpleSongData).filter(Boolean)
        .map((s) => ({ id: s.id, title: s.name, artists: (s.ar ?? []).map((a) => a.name), album: s.al?.name, dur: s.dt }));
    },
    async lyrics({ id }, t) {
      const b = await neteasePost('https://interface3.music.163.com/eapi/song/lyric/v1', '/api/song/lyric/v1',
        { id, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0 });
      if (b.code !== 200) throw new Error(`netease ${b.code}`);
      if (b.pureMusic || b.nolyric) return { synced: 'none', instrumental: true, lines: [] };
      if (b.yrc?.lyric) { const l = parseYrc(b.yrc.lyric); if (l.length) return finish(l, b.ytlrc?.lyric || b.tlyric?.lyric, 'word', t); }
      const l = parseLrc(b.lrc?.lyric);
      return finish(l, b.tlyric?.lyric, l.length ? 'line' : 'none', t);
    },
  },
  qq: {
    async search(q) {
      const body = JSON.stringify({
        comm: { ct: '19', cv: '2151', uin: '0', tmeAppID: 'qqmusic', tmeLoginType: 0 },
        req: { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop',
          param: { grp: 1, num_per_page: 10, page_num: 1, query: q, remoteplace: 'txt.newclient.top', search_type: 0 } },
      });
      const b = await http(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${zzcSign(body)}`, { method: 'POST', body, headers: { 'user-agent': 'QQMusic 14090508(android 12)' }, directFirst: true });
      return (b?.req?.data?.body?.song?.list ?? [])
        .map((s) => ({ id: s.id, title: s.title, artists: (s.singer ?? []).map((a) => a.name), album: s.album?.name, dur: (s.interval ?? 0) * 1000 }));
    },
    async lyrics({ id }, t) {
      const body = JSON.stringify({
        comm: { ct: '19', cv: '1859', uin: '0' },
        req: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo',
          param: { format: 'json', crypt: 1, ct: 19, cv: 1873, interval: 0, lrc_t: 0, qrc: 1, qrc_t: 0, roma: 0, roma_t: 0, songID: id, trans: 1, trans_t: 0, type: -1 } },
      });
      const b = await http('https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', body, headers: { referer: 'https://y.qq.com' }, directFirst: true });
      const d = b?.req?.data;
      if (!d) throw new Error('qq: no data');
      const main = qrcContent(decodeQrc(d.lyric));
      const tr = qrcContent(decodeQrc(d.trans));
      const words = parseQrc(main);
      if (words.length) return finish(words, tr, 'word', t);
      const l = parseLrc(main);
      return finish(l, tr, l.length ? 'line' : 'none', t);
    },
  },
  lrclib: {
    async search(q, track) {
      const p = new URLSearchParams({ track_name: track.title, artist_name: track.artists[0] ?? '' });
      const list = await http(`https://lrclib.net/api/search?${p}`, { headers: { 'user-agent': 'dsh-music (DeepSeek Harness plugin)' } });
      return (Array.isArray(list) ? list : []).slice(0, 10).map((s) => ({
        id: s.id, title: s.trackName, artists: splitArtists(s.artistName), album: s.albumName, dur: (s.duration ?? 0) * 1000,
        synced: s.syncedLyrics, plain: s.plainLyrics, instrumental: s.instrumental,
      }));
    },
    async lyrics(c, t) {
      if (c.instrumental) return { synced: 'none', instrumental: true, lines: [] };
      const l = parseLrc(c.synced);
      return finish(l, '', l.length ? 'line' : 'none', t);
    },
  },
};

// ------------------------------------------------------------------------------------------------- matching
// Scores follow Lyricify's CompareHelper: name, artists and duration up to 7 each, album 0.4x, rescaled when a
// field is missing; above 11 counts as a match.
export const splitArtists = (s) => (s ?? '').split(/\s*(?:,|、|&|;|\/|，| feat\.? | ft\.? | x | × | and )\s*/i).map((a) => a.trim()).filter(Boolean);
const normName = (s) => s.toLowerCase().trim().replace(/[’`]/g, "'").replace(/，/g, ',').replace(/[（[【]/g, '(').replace(/[）\]】]/g, ')')
  .replace(/\s+/g, ' ').replace(/ ?\( ?/g, '(').replace(/ \)/g, ')');

function similarity(x, y) {          // longest common subsequence over the longer length, 0..100
  const dp = new Uint16Array((y.length + 1) * 2);
  for (let i = 1; i <= x.length; i++) {
    const cur = (i & 1) * (y.length + 1), prev = (~i & 1) * (y.length + 1);
    for (let j = 1; j <= y.length; j++) dp[cur + j] = x[i - 1] === y[j - 1] ? dp[prev + j - 1] + 1 : Math.max(dp[prev + j], dp[cur + j - 1]);
  }
  return (dp[(x.length & 1) * (y.length + 1) + y.length] / Math.max(x.length, y.length)) * 100;
}

function nameScore(a, b) {
  if (!a?.trim() || !b?.trim()) return null;
  a = normName(a); b = normName(b);
  if (a === b) return 7;
  a = a.replace('acoustic version', 'acoustic'); b = b.replace('acoustic version', 'acoustic');
  const flat = (s) => (s.replace(' - ', ' (').trim() + ')').replace(/ /g, '');
  if (flat(a) === flat(b)) return 6;
  const head = (s, tag) => { const i = s.indexOf('(' + tag); return i < 0 ? null : s.slice(0, i).trim(); };
  for (const tag of ['deluxe', 'explicit', 'special edition', 'bonus track', 'feat', 'with', 'remaster']) {
    if (head(a, tag) === b || head(b, tag) === a) return 6;
  }
  for (const tag of ['feat', 'with']) { const ha = head(a, tag); if (ha !== null && ha === head(b, tag)) return 5; }
  const ia = a.indexOf('('), ib = b.indexOf('(');
  if ((ia > 0 && ib < 0 && a.slice(0, ia).trim() === b) || (ib > 0 && ia < 0 && b.slice(0, ib).trim() === a)) return 4;
  if (a.length === b.length) {          // same length, mostly the same characters: variant forms (繁/简)
    let same = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
    if ((same / a.length >= 0.8 && a.length >= 4) || (same / a.length >= 0.5 && a.length >= 2 && a.length <= 3)) return 5;
  }
  const sim = similarity(a, b);
  return sim > 90 ? 6 : sim > 80 ? 5 : sim > 68 ? 4 : sim > 55 ? 2 : 0;
}

function artistScore(x, y) {
  x = x.map((s) => s.toLowerCase()); y = y.map((s) => s.toLowerCase());
  if (!x.length || !y.length) return null;
  const variant = (p, q) => p === q || (p.length === q.length && p.length <= 4 && [...p].filter((c, i) => c === q[i]).length >= p.length - 1);
  const n = y.filter((b) => x.some((a) => variant(a, b))).length;
  if (n === x.length && x.length === y.length) return 7;
  if ((n + 1 >= x.length && x.length >= 2) || (x.length > 6 && n / x.length > 0.8)) return 6;
  if (n === 1 && x.length === 1 && y.length === 2) return 5;
  if (x.length === 1 && y.length > 1 && (x[0].startsWith(y[0]) || (y[0].length > 3 && x[0].includes(y[0])))) return 5;
  if ((x.length === 1 && y.length > 1 && y[0].length > 1 && x[0].includes(y[0])) || (n === 1 && x.length === 1 && y.length >= 3)) return 4;
  return n >= 2 ? 2 : 0;
}

function durScore(a, b) {
  if (!a || !b) return null;
  const d = Math.abs(a - b);
  return d === 0 ? 7 : d < 300 ? 6 : d < 700 ? 5 : d < 1500 ? 4 : d < 3500 ? 2 : 0;
}

export function matchScore(track, c) {
  const n = nameScore(track.title, c.title) ?? 0, ar = artistScore(track.artists, c.artists) ?? 0;
  const al = nameScore(track.album, c.album), du = durScore(track.dur, c.dur);
  const full = (1 + 1 + 0.4 + 1) * 7;
  const avail = (2 + (al === null ? 0 : 0.4) + (du === null ? 0 : 1)) * 7;
  return ((n + ar + (al ?? 0) * 0.4 + (du ?? 0)) * full) / avail;
}

// ------------------------------------------------------------------------------------------------- entry
const PREFER = { netease: 0, qq: 1, lrclib: 2 };   // on a tie, word-synced sources first

/**
 * @param track {title, artist, album, dur} as the player reports them; `ncmId` when NetEase Cloud Music says which
 *   song it is playing, which skips the search for that source. Returns lyrics, or null when every source answered
 *   and none has them; throws when nothing was found and some source could not be reached (worth trying again).
 */
export async function findLyrics(track, { sources = Object.keys(PROVIDERS), log } = {}) {
  const t = { title: track.title ?? '', artists: splitArtists(track.artist), album: track.album, dur: track.dur };
  let failed = 0;                 // sources that could not be reached (as opposed to having nothing)
  if (track.ncmId) {
    try {
      const ly = await PROVIDERS.netease.lyrics({ id: track.ncmId }, t);
      if (ly.instrumental || ly.synced === 'word' || ly.lines.length) return { src: 'netease', id: track.ncmId, match: 100, ...ly };
    } catch (e) { failed++; log?.(`netease lyrics by id failed: ${e?.cause?.message ?? e?.message ?? e}`); }
  }
  if (!t.title) { if (failed) throw new Error('lyrics: NetEase could not be reached'); return null; }
  const q = `${t.title} ${t.artists[0] ?? ''}`.trim();
  const found = await Promise.allSettled(sources.map(async (src) =>
    (await PROVIDERS[src].search(q, t)).map((c) => ({ ...c, src, score: matchScore(t, c) }))));
  found.forEach((r, i) => { if (r.status === 'rejected') { failed++; log?.(`${sources[i]} search failed: ${r.reason?.cause?.message ?? r.reason?.message ?? r.reason}`); } });
  const cands = found.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((c) => c.score > 11)
    .sort((a, b) => b.score - a.score || PREFER[a.src] - PREFER[b.src]);
  const get = async (c) => {
    try {
      const ly = await PROVIDERS[c.src].lyrics(c, t);
      return ly.instrumental || ly.lines.length ? { src: c.src, id: c.id, match: Math.round(c.score * 10) / 10, ...ly } : null;
    } catch (e) { failed++; log?.(`${c.src} lyrics failed: ${e?.cause?.message ?? e?.message ?? e}`); return null; }
  };
  // Fetch the best match from every source at once; among those within 3 points of the best, word-synced wins.
  const firsts = Object.keys(PREFER).map((src) => cands.find((c) => c.src === src)).filter(Boolean);
  const best = firsts[0] ? Math.max(...firsts.map((c) => c.score)) : 0;
  const got = (await Promise.all(firsts.filter((c) => c.score >= best - 3).map(get))).filter(Boolean);
  const rank = (r) => (r.instrumental ? 1 : r.synced === 'word' ? 3 : r.synced === 'line' ? 2 : 0);
  got.sort((a, b) => rank(b) - rank(a) || b.match - a.match);
  if (got[0]) return got[0];
  for (const c of cands.filter((c) => !firsts.includes(c)).slice(0, 3)) { const r = await get(c); if (r) return r; }
  if (failed) throw new Error(`lyrics: ${failed} source${failed > 1 ? 's' : ''} could not be reached`);
  return null;
}
