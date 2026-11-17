// Playing position for NetEase Cloud Music. Its Windows media session names the song but reports no timeline, so the
// position comes from the client's own log, cloudmusic.elog: each song start ("_plv": song id and length), play and
// pause are written there with a millisecond tick (milliseconds since Windows started). The log is byte-substituted;
// the decoding table comes from WallpaperEngine.NeteaseMusicLyricDesktop (MIT).
// Each song's name comes from the "checkPlayPrivilege" line written just before its start, so the host can tell
// whether the log has caught up with the song Windows reports. Dragging the progress bar writes
// "setPlayingPosition",<seconds>.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOG = path.join(process.env.LOCALAPPDATA ?? '', 'NetEase', 'CloudMusic', 'cloudmusic.elog');
const TABLE = Uint8Array.from({ length: 256 }, (_, i) => ((i >> 4) ^ 3) | ((((i >> 4) ^ 8 ^ (i & 15)) << 4) & 255));
const LINE = /:(\d+):INFO:[^\]]*\] .*?【(曙光点位|playing)】,(.*)$/;

/** The JSON object at the start of s: some lines carry more comma-separated values after it. */
function firstObject(s) {
  let depth = 0, str = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (str) { if (ch === '\\') i++; else if (ch === '"') str = false; continue; }
    if (ch === '"') str = true;
    else if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && --depth === 0) return s.slice(0, i + 1);
  }
  return s;
}

/** createNcmClock(onChange) ->{ now(): {id, name, dur, pos, at, playing} | null, dispose() } */
export function createNcmClock(onChange, { file = LOG, pollMs = 500 } = {}) {
  let st = null, size = 0, rest = '', timer = 0;
  // One decoder kept across reads: a read can end inside a character (a song name in Chinese), whose other bytes come
  // with the next read.
  let decoder = new TextDecoder();
  const decode = (buf) => decoder.decode(buf.map((b) => TABLE[b]), { stream: true });
  const names = new Map();          // song id -> name, from the line before each start
  // A tick in the log is GetTickCount; os.uptime() is the same clock, so the gap to now gives the wall time.
  const wall = (tick) => Date.now() - (os.uptime() * 1000 - tick);

  function onLine(line) {
    const m = LINE.exec(line);
    if (!m) return false;
    const t = wall(Number(m[1]));
    if (m[2] === '曙光点位') {
      if (!m[3].includes('"action":"_plv"')) return false;
      let d;
      try { d = JSON.parse(m[3]).data; } catch { return false; }
      const id = String(d.id);
      st = { id, name: names.get(id), dur: (Number(d.resource_time) || 0) * 1000, pos: 0, at: t, playing: true };
      return true;
    }
    if (m[3].startsWith('"checkPlayPrivilege",')) {
      try {
        const d = JSON.parse(firstObject(m[3].slice('"checkPlayPrivilege",'.length)));
        if (d?.id != null && typeof d.name === 'string') {
          names.set(String(d.id), d.name);
          if (names.size > 500) names.delete(names.keys().next().value);
        }
      } catch { /* a line cut short */ }
      return false;
    }
    const seek = /^"setPlayingPosition",([\d.]+)/.exec(m[3]);
    if (seek && st) { st.pos = Number(seek[1]) * 1000; st.at = t; return true; }
    const p = /^"native播放state",(\d),"(\d+)/.exec(m[3]);
    if (!p || !st) return false;
    if (p[2] !== st.id) st = { id: p[2], name: names.get(p[2]), dur: 0, pos: 0, at: t, playing: false };
    if (p[1] === '1' && !st.playing) { st.at = t; st.playing = true; return true; }
    if (p[1] === '2' && st.playing) { st.pos += t - st.at; st.at = t; st.playing = false; return true; }
    return false;
  }

  function read(from, to) {
    if (to <= from) return false;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(to - from);
    try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
    const lines = (rest + decode(buf)).split('\n');
    rest = lines.pop() ?? '';
    let changed = false;
    for (const l of lines) changed = onLine(l) || changed;
    return changed;
  }

  function poll() {
    try {
      const now = fs.statSync(file).size;
      if (now < size) { size = 0; rest = ''; decoder = new TextDecoder(); }   // log rotated: start over from its beginning
      const changed = read(size, now);
      size = now;
      if (changed) onChange?.();
    } catch { /* NetEase not installed or the log is being replaced */ }
  }

  // Replay the recent past first, so a song already playing when DSH starts has its position.
  try {
    size = fs.statSync(file).size;
    read(Math.max(0, size - 4 * 1024 * 1024), size);
    rest = '';
  } catch { size = 0; }
  timer = setInterval(poll, pollMs);
  timer.unref?.();

  return {
    now: () => st && { ...st },
    dispose: () => clearInterval(timer),
  };
}
