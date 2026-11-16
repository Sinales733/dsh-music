// dsh-music browser half. Shows the song and reports what the AI and you are doing, so the host can move the music:
//   - the chat's running indicator: "Deep diving …" becomes the line being sung, lighting up word by word;
//   - the statistics row under the composer (slot 'conversation.composer.dock'): the current line with a small cover
//     while a song with lyrics plays, DSH's own readings (turns, tok/s, cache hit) and a Music Coding switch on hover,
//     and a play button while nothing plays;
//   - behind the whole window: the cover as slowly flowing colour (backdrop.js), the sidebar turning translucent;
//   - the plugin's own page in the plugin manager (slot 'plugins.bundle.config'): its settings.
// Signals sent to the host: AI working / done (running indicator), waiting for approval (approval card), and in
// Music Coding how hard you are typing and when dictated text lands in the composer.
// Everything here is reversible: remove the plugin and every place is as it was.
const React = require('react');
const { Switch, SegmentedControl, Input } = require('@deepseek-ai/dsh-client-ui-primitives');
const h = React.createElement;

// The indicator lyric is drawn the way DSH draws its own label: the TextShimmer structure (dsh-client-ui-primitives,
// MIT) with a copy of the text in the moving highlight. Words change between two solid colours so glyphs stay crisp.
// The composer row entries copy the statistics pill metrics (ui-chat StatsPills.module.css).
const CSS = `
/* The indicator lyric lies over DSH's label ("Deep diving …"), where the label starts; the two cross-fade. */
[data-chat-running] [class*="runningText"] { transition: opacity .16s ease .06s; }
[data-chat-running].dshmu-on [class*="runningText"] { opacity: 0; transition: opacity .12s ease; }
.dshmu-ts { display: inline-grid; position: absolute; left: var(--dshmu-ts-x, 0px); top: var(--dshmu-ts-y, 0px); width: max-content;
  max-width: min(60vw, 640px); min-width: 0; color: inherit; opacity: 0; visibility: hidden; transition: opacity .12s ease, visibility 0s .12s;
  --dshmu-sung: var(--dsw-alias-label-deep-diving); --dshmu-dim: color-mix(in srgb, var(--dsw-alias-label-deep-diving) 38%, var(--dsw-alias-bg-base)); }
[data-chat-running].dshmu-on .dshmu-ts { opacity: 1; visibility: visible; transition: opacity .16s ease .06s, visibility 0s; }
/* Shown again as it was (DSH rebuilt the indicator or the composer row while the music went on): no fades. */
[data-dshmu-still] [class*="runningText"], [data-dshmu-still] .dshmu-ts, [data-dshmu-still] .dshmu-ts *,
[data-composer-dock][data-dshmu-still] > *, [data-composer-dock][data-dshmu-still] > [data-slot] > *, [data-dshmu-still] .dshmu-strip * { transition: none !important; }
[data-dshmu-still] .dshmu-enter, [data-dshmu-still] .dshmu-in { animation: none !important; }
.dshmu-c { display: block; min-width: 0; white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.dshmu-d { position: absolute; inset: 0; overflow: clip; pointer-events: none; user-select: none; }
.dshmu-s { position: absolute; inset: 0; overflow: hidden; color: var(--dsw-alias-label-shimmer); mask-image: linear-gradient(105deg, transparent 0%, black 40% 60%, transparent 100%);
  transform: translateX(-100%); animation-name: dshmu-sweep; }
.dshmu-s * { color: inherit !important; }
.dshmu-h { width: 100%; height: 100%; transform: translateX(100%); animation-name: dshmu-highlight; }
.dshmu-s, .dshmu-h { animation-duration: 1.5s; animation-delay: .3s; animation-timing-function: steps(48, end); animation-iteration-count: infinite; }
@keyframes dshmu-sweep { 0% { transform: translateX(-100%); } 66.6667%, 100% { transform: translateX(100%); } }
@keyframes dshmu-highlight { 0% { transform: translateX(100%); } 66.6667%, 100% { transform: translateX(-100%); } }
.dshmu-enter { animation: dshmu-enter 220ms cubic-bezier(.2, .8, .2, 1); }
@keyframes dshmu-enter { from { opacity: 0; transform: translateY(4px); } }

.dshmu-strip { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  color: var(--dsw-alias-label-tertiary); white-space: nowrap; --dshmu-sung: var(--dsw-alias-label-secondary); --dshmu-dim: var(--dsw-alias-label-tertiary); }
.dshmu-strip > * { display: none; }
.dshmu-strip[data-mode] > * { display: inline-flex; }
.dshmu-pill { align-items: center; gap: 6px; box-sizing: border-box; min-width: 0; max-width: 100%; padding: 1px 8px; border: 0; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent; color: inherit; font: inherit; line-height: inherit; white-space: nowrap; }
button.dshmu-pill { cursor: pointer; }
@media (hover: hover) { button.dshmu-pill:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); } }
.dshmu-pill svg { width: 12px; height: 12px; flex: none; }
.dshmu-pp { padding: 1px 6px; min-height: calc(1lh + 2px); justify-content: center; }   /* an icon alone: as tall as the text pills beside it */
.dshmu-cover { width: 14px; height: 14px; flex: none; border-radius: 3px; object-fit: cover; }
.dshmu-line { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dshmu-in { animation: dshmu-fade 220ms ease-out; }
.dshmu-sep { margin: 0 6px; }
/* The row. DSH's readings and our play button stay where they are; the lyric lies over the middle of the row (top:
   below the row's 4px top padding, InputBar.module.css .dock). The two take turns, cross-fading (the one going first,
   the one coming a moment later), so neither moves the other: the lyric while a song with lyrics plays and the row is
   left alone; the readings while it is hovered, focused or one of its panels is open, and whenever no lyric plays.
   The row spans the composer while the lyric is up, so hovering anywhere along it brings the readings. Slot entries
   sit inside a display:contents [data-slot] wrapper; the context meter is a direct child. Our entry goes after DSH's
   readings and before the meter. */
[data-composer-dock]:has(.dshmu-strip) { position: relative; }
[data-composer-dock]:has(.dshmu-strip) > [data-slot] > .dshmu-strip { order: 1; }
[data-composer-dock]:has(.dshmu-strip) > :not([data-slot]) { order: 2; }
[data-composer-dock]:has(.dshmu-strip[data-mode="lyric"]) { align-self: stretch; }
.dshmu-strip > .dshmu-lyric { position: absolute; left: 50%; top: 4px; bottom: 0; translate: -50% 0; max-width: 100%; }
[data-composer-dock]:has(.dshmu-strip) > :not([data-slot]), [data-composer-dock]:has(.dshmu-strip) > [data-slot] > :not(.dshmu-strip),
.dshmu-strip > .dshmu-pp { transition: opacity .16s ease .06s, visibility 0s; }
.dshmu-strip > .dshmu-lyric { opacity: 0; visibility: hidden; transition: opacity .12s ease, visibility 0s .12s; }
[data-composer-dock]:not(:hover, :focus-within, :has([aria-expanded="true"])) > [data-slot] > .dshmu-strip[data-mode="lyric"] > .dshmu-lyric {
  opacity: 1; visibility: visible; transition: opacity .16s ease .06s, visibility 0s; }
[data-composer-dock]:has(.dshmu-strip[data-mode="lyric"]):not(:hover, :focus-within, :has([aria-expanded="true"])) > :not([data-slot]),
[data-composer-dock]:has(.dshmu-strip[data-mode="lyric"]):not(:hover, :focus-within, :has([aria-expanded="true"])) > [data-slot] > :not(.dshmu-strip),
[data-composer-dock]:not(:hover, :focus-within, :has([aria-expanded="true"])) > [data-slot] > .dshmu-strip[data-mode="lyric"] > .dshmu-pp {
  opacity: 0; visibility: hidden; transition: opacity .12s ease, visibility 0s .12s; }
/* The context line (ctxline.js) on the composer card's bottom edge; DSH's ring hides while ours is drawn */
[data-dshmu-ctx-root] { position: relative; }
[data-dshmu-ctx] > :not([data-slot]) button[aria-haspopup="dialog"] svg { visibility: hidden; }
.dshmu-ctx { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none;
  --dshmu-glow: var(--dsw-alias-brand-primary-new-colorprimary-new-color, rgb(86, 134, 254)); }
.dshmu-ctx path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.dshmu-ctx-track { stroke: var(--dsw-alias-border-l3); stroke-width: 2; }
.dshmu-ctx-bar { stroke: var(--dsw-alias-border-l3); stroke-width: 1.25; }
.dshmu-ctx-gray { stroke: var(--dsw-alias-label-tertiary); stroke-width: 2; }
.dshmu-ctx-glow { stroke-width: 2; filter: drop-shadow(0 0 2px var(--dshmu-glow)) drop-shadow(0 0 6px color-mix(in srgb, var(--dshmu-glow) 70%, transparent)); }
.dshmu-ctx-stop { stop-color: var(--dshmu-glow); }
@keyframes dshmu-fade { from { opacity: 0; } }

/* Cover background behind the whole window. The layer sits under the app (fixed, z-index -1); while it shows, the
   app's base ground goes transparent (the page's own ground below is the same colour, so that changes nothing) and the
   sidebar turns into a translucent tint of its own colour, from 100% down to 55% as the layer comes in (--dshmu-tint,
   set with the layer's opacity in one step, so the two move together). The originals are captured on body, where the
   theme defines them, so the overrides follow light and dark. Cards, the composer and menus keep their own opaque
   surfaces. */
body { --dshmu-sidebar: var(--dsw-specific-sidebar-fill); }
html[data-dshmu-bg] body > :has([data-shell-bottom]) {
  --dsw-alias-bg-base: transparent;
  --dsw-specific-sidebar-fill: color-mix(in srgb, var(--dshmu-sidebar) var(--dshmu-tint, 55%), transparent);
}
.dshmu-bg { position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: 0; }
.dshmu-bg canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.dshmu-bg .dshmu-veil { position: absolute; inset: 0; background: var(--dsw-alias-bg-base); opacity: calc(1 - var(--dshmu-bg-strength, .32)); transition: opacity .3s ease; }

/* The plugin's settings */
.dshmu-set { display: flex; flex-direction: column; gap: 14px; }
.dshmu-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dshmu-row > span:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dshmu-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dshmu-offsets { display: flex; gap: 10px; flex-wrap: wrap; }
.dshmu-offsets label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshmu-offsets input { width: 84px; }
@media (prefers-reduced-motion: reduce) {
  .dshmu-d { display: none; } .dshmu-enter, .dshmu-in { animation: none !important; }
  .dshmu-ts, .dshmu-strip > *, .dshmu-veil, [data-chat-running] [class*="runningText"],
  [data-composer-dock]:has(.dshmu-strip) > *, [data-composer-dock]:has(.dshmu-strip) > [data-slot] > * { transition: none !important; }
}
`;

const LOCALE = {
  zh: {
    play: '播放音乐', resume: '播放', pause: '暂停',
    summaryBg: '背景 {bg}',
    musicCoding: 'Music Coding 模式', musicCodingHint: 'AI 干完活音乐渐弱到静音，你打字、说话、发消息时再回来；新歌淡入；静音时跳过不合适的歌',
    backdrop: '封面背景', backdropHint: '整个窗口底下流动的封面颜色', off: '关', light: '淡', medium: '中', strong: '浓',
    duck: '等你批准时的音量', fadeIn: '新歌淡入（Music Coding）', beat: '跟鼓点', beatHint: '鲸尾和背景跟着重拍动',
    offsets: '歌词快慢（毫秒，正数＝歌词提前）', model: '判断歌曲情绪用的模型', modelHint: '只在 Music Coding 里、本地测不准时问，每首一次',
    summary: 'Music Coding {mc} · 背景 {bg}', on: '开',
  },
  en: {
    play: 'Play music', resume: 'Play', pause: 'Pause',
    summaryBg: 'Background {bg}',
    musicCoding: 'Music Coding mode', musicCodingHint: 'Music fades out when the AI is done and comes back as you type, speak or send; new songs fade in; unsuitable songs are skipped while silent',
    backdrop: 'Cover background', backdropHint: 'The cover as flowing colour behind the whole window', off: 'Off', light: 'Light', medium: 'Medium', strong: 'Strong',
    duck: 'Volume while waiting for approval', fadeIn: 'New song fade-in (Music Coding)', beat: 'Follow the beat', beatHint: 'The whale tail and the background move with the kick',
    offsets: 'Lyric timing (ms, positive = earlier)', model: 'Model for song moods', modelHint: 'Asked only in Music Coding, once per song, when measuring is not enough',
    summary: 'Music Coding {mc} · background {bg}', on: 'on',
  },
};
const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.9v10.2a.7.7 0 0 0 1.07.6l8.1-5.1a.7.7 0 0 0 0-1.2l-8.1-5.1a.7.7 0 0 0-1.07.6z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.6" y="2.8" width="3" height="10.4" rx="1" fill="currentColor"/><rect x="9.4" y="2.8" width="3" height="10.4" rx="1" fill="currentColor"/></svg>';
// Music Coding is set aside for now (2026-11-16): no switch on the page, and the host keeps it off. The code stays;
// set this and MUSIC_CODING in src/host/index.js to true to bring it back.
const MUSIC_CODING = false;

const el = (cls, parent, tag = 'span') => { const e = document.createElement(tag); e.className = cls; parent?.append(e); return e; };
const wordsOf = (l) => l.w ?? [[l.t, l.d, l.text]];
function wordSpans(l) {
  return wordsOf(l).map(([t, d, s]) => { const w = el('dshmu-w'); w.textContent = s; w.dataset.t = t; w.dataset.d = Math.max(1, d); return w; });
}
// Sung words take the place's "sung" colour, the rest its "dim" one; steps of 5% keep style writes rare.
function paint(words, pos) {
  for (const w of words.children) {
    const k = Math.round(Math.max(0, Math.min(1, (pos - w.dataset.t) / w.dataset.d)) * 20) * 5;
    if (w.dataset.k === String(k)) continue;
    w.dataset.k = k;
    w.style.color = `color-mix(in srgb, var(--dshmu-sung) ${k}%, var(--dshmu-dim))`;
  }
}
function restart(e, cls = 'dshmu-enter') { e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); }
const CARRY_KEY = 'dsh-music:carry', CARRY_MS = 20000;   // state handed to the next instance (see createMusic)

function createMusic(remote, t) {
  let media, cover = null, lyrics = null, lyricsStatus = null, settings = {}, aiIdle = false, mood = null, raf = 0, busy = null;
  // The song's lyrics are on their way until this time: the row is up meanwhile, naming the song (a song starting, or
  // changing: the host clears the lyrics before the next song's arrive), so it and the context line come in once, and
  // do not fold back and out again on a song change. Given up after LYRICS_WAIT.
  let expect = 0;
  const LYRICS_WAIT = 8000;
  // A player that drops out of Windows' list for a moment (between two tracks) is not gone: wait this long first.
  const MEDIA_GRACE = 1000;
  let gone = 0, heard = false, song = null;
  const lifetime = new AbortController();
  const strips = new Set();
  const beatListeners = new Set();
  const settingsListeners = new Set();
  const live = (m) => m?.status === 'Playing' || m?.status === 'Changing';
  function expectLyrics() { expect = Date.now() + LYRICS_WAIT; setTimeout(kick, LYRICS_WAIT + 50); }
  function setMedia(m, c) {
    media = m; cover = c;
    if (!m) heard = false;
    else if (m.status === 'Playing') heard = true;   // the background comes in once the music has played
    const key = m && `${m.app}\u0000${m.title}\u0000${m.artist}`;
    if (key && song && key !== song) tail?.songChange();
    if (key) song = key;
  }

  // ------------------------------------------------------------------ stream from the host
  async function watch() {
    let delay = 500;
    while (!lifetime.signal.aborted) {
      try {
        let synced = false;
        for await (const ev of remote.dshMusic.watch(lifetime.signal)) {
          delay = 500;
          if (ev?.t === 'state') {
            if (ev.media === null && media) {
              if (!gone) gone = setTimeout(() => { gone = 0; setMedia(null, null); background(); kick(); }, MEDIA_GRACE);
            } else { clearTimeout(gone); gone = 0; setMedia(ev.media, ev.cover); }
            aiIdle = !!ev.aiIdle; mood = ev.mood ?? null;
            lyricsStatus = ev.lyricsStatus ?? null;
            if (lyricsStatus === 'none' || lyricsStatus === 'idle') expect = 0;   // this song has none
            else if (lyricsStatus === 'searching' && !lyrics && !expect && live(media)) expectLyrics();
            // on (re)connecting, put the host right about the approval card: it may still hold the music down for
            // one this page no longer shows (a reload), or have let go while one is still waiting
            if (!synced) { synced = true; waiting = awaitingApproval(); if (!!ev.waiting !== waiting) command(waiting ? 'approval-on' : 'approval-off'); }
            if (ev.settings && JSON.stringify(ev.settings) !== JSON.stringify(settings)) { settings = ev.settings; for (const f of settingsListeners) f(); }
            background();
          } else if (ev?.t === 'lyrics') {
            if (ev.lyrics) expect = 0;
            else if (lyricRow()) expectLyrics();
            lyrics = ev.lyrics;
          }
          else if (ev?.t === 'beat') {
            if (settings.beat !== false && !reduced.matches) bg?.view.pulse(ev.s);   // the flow rushes on each kick
            tail?.beat(ev.s);
            for (const f of beatListeners) f(ev.s);
            continue;
          }
          kick();
        }
      } catch { /* reconnect below */ }
      if (lifetime.signal.aborted) return;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 10000);
    }
  }
  const command = (action) => { try { remote.dshMusic.command(action, lifetime.signal)?.catch?.(() => {}); } catch { } };
  const setSettings = (patch) => {
    settings = { ...settings, ...patch, offsets: { ...settings.offsets, ...patch.offsets } };
    for (const f of settingsListeners) f();
    command(`set ${JSON.stringify(patch)}`);
    background(); kick();
  };

  // ------------------------------------------------------------------ AI state from the page
  // Working: the running indicator is up. Waiting for you: an approval card that has not been answered yet
  // (ui-approval marks it data-approval-key, aria-busy once answered).
  const indicators = () => document.querySelectorAll('[data-chat-running]');
  let waiting = false;
  const awaitingApproval = () => !!document.querySelector('[data-approval-key]:not([aria-busy="true"])');
  function checkBusy() {
    const now = indicators().length > 0;
    if (now !== busy) {
      if (busy !== null || now) command(now ? 'ai-busy' : 'ai-idle');   // no "idle" before a turn has been seen
      busy = now;
      kick();
    }
    const wait = awaitingApproval();
    if (wait !== waiting) { waiting = wait; command(wait ? 'approval-on' : 'approval-off'); }
  }

  // ------------------------------------------------------------------ Music Coding: your typing and dictation
  // Typing in the composer brings the music back in proportion to its pace (about six characters a second is full);
  // a block of text arriving at once (pasted, or dictated by Typeless) brings it back in full.
  const keys = [];
  let sentTyping = 0, typingTimer = 0;
  function onInput(e) {
    if (!settings.musicCoding || !aiIdle) return;
    const target = e.target;
    if (!(target instanceof Element) || !target.closest('[data-conversation-content]')) return;
    if (!(target.isContentEditable || target.tagName === 'TEXTAREA')) return;
    const text = e.data ?? '';
    if (/^insertFrom(Paste|Drop)/.test(e.inputType ?? '') || text.length > 24) { command('swell'); return; }
    keys.push(performance.now());
    if (!typingTimer) typingTimer = setInterval(typingTick, 400);
  }
  function typingTick() {
    const now = performance.now();
    while (keys.length && now - keys[0] > 3000) keys.shift();
    const energy = Math.min(1, keys.length / 3 / 6);
    if (Math.abs(energy - sentTyping) >= 0.05 || (energy === 0 && sentTyping !== 0)) { sentTyping = energy; command(`typing ${energy.toFixed(2)}`); }
    if (!keys.length) { clearInterval(typingTimer); typingTimer = 0; }
  }

  // ------------------------------------------------------------------ where the song is
  const playing = () => !!(media && media.status === 'Playing' && lyrics?.lines?.length && !lyrics.instrumental);
  // the lyric row: while a song with lyrics plays, and while a playing song's lyrics are on their way
  const lyricRow = () => playing() || (expect > Date.now() && live(media));
  const position = () => media.pos + (Date.now() - media.at) + (settings.offsets?.[media.proc] ?? 0);
  function lineAt(pos) {
    let i = -1;
    for (let k = 0; k < lyrics.lines.length && lyrics.lines[k].t <= pos; k++) i = k;
    return i;
  }

  // ------------------------------------------------------------------ shown again as it was
  // What the composer row shows (its mode) and since when, and the line the indicators show. DSH rebuilds the composer
  // row and the running indicator often while the music goes on (another session, back from another page, the plugin
  // reloading): a new one that comes up while these have not changed shows them at once, with no fade or motion in.
  // Fades and motion are for the music changing.
  let rowMode, rowSince = -Infinity, indKey = null;
  const lineKey = (l) => l && `${l.t}\u0000${l.text}`;
  function syncRow() {
    const m = media === undefined ? undefined : lyricRow() ? 'lyric' : media === null ? 'idle' : 'off';   // undefined: no report yet
    if (m !== rowMode) { rowMode = m; rowSince = performance.now(); }
    return m;
  }
  function holdStill(e) {
    e.setAttribute('data-dshmu-still', '');
    requestAnimationFrame(() => requestAnimationFrame(() => e.removeAttribute('data-dshmu-still')));
  }

  // ------------------------------------------------------------------ the running indicator
  // One persistent shimmer per indicator, so the sweep keeps its rhythm across lines; only the text inside changes.
  // It lies over DSH's label where the label starts (measured once; the icon before it has a fixed size).
  function shimmerOf(host) {
    let slot = host.querySelector('.dshmu-ts');
    if (!slot) {
      const label = host.querySelector('[class*="runningText"]');
      if (!label) return null;
      slot = el('dshmu-ts');
      slot.setAttribute('aria-hidden', 'true');
      el('dshmu-c', slot);
      el('dshmu-h dshmu-c', el('dshmu-s', el('dshmu-d', slot)));
      label.after(slot);
      slot.style.setProperty('--dshmu-ts-x', `${label.offsetLeft}px`);
      slot.style.setProperty('--dshmu-ts-y', `${label.offsetTop}px`);
    }
    return slot;
  }
  // The line an indicator shows at pos: the one being sung, and it stays through the pause after it; in a long break
  // (an instrumental over 9 s to the next line) DSH's label comes back 6 s in, until the next line.
  function indicatorLine(pos, i) {
    if (i < 0) return null;
    const l = lyrics.lines[i], end = l.t + l.d, next = lyrics.lines[i + 1]?.t ?? (media.dur || Infinity);
    return next - end > 9000 && pos > end + 6000 ? null : l;
  }
  function paintIndicator(host, pos, l) {
    const fresh = !host.querySelector('.dshmu-ts');
    const slot = l && shimmerOf(host);
    if (fresh && slot && lineKey(l) === indKey) holdStill(host);   // a new indicator showing the line the last one did
    host.classList.toggle('dshmu-on', !!slot);
    if (!slot) return;
    if (slot._l !== l) {
      const first = !slot._l;
      slot._l = l;
      slot.firstChild.replaceChildren(...wordSpans(l));
      slot.querySelector('.dshmu-h').textContent = wordsOf(l).map((w) => w[2]).join('');
      if (!first) restart(slot);   // the next line slides in; the first one fades in over the label
    }
    paint(slot.firstChild, pos);
  }

  // ------------------------------------------------------------------ the composer row entries
  // Modes: 'lyric' while a song with lyrics plays (the line stays up through short gaps; before the first line, and
  // while the lyrics are on their way, it names the song), 'idle' while no player reports anything, otherwise 'off'.
  // The button beside DSH's readings: play/pause, or with nothing playing, start the player last used.
  function buildStrip(s) {
    const lyric = el('dshmu-pill dshmu-lyric', s);
    el('dshmu-cover', lyric, 'img').alt = '';
    el('dshmu-line', lyric);
    const pp = el('dshmu-pill dshmu-pp', s, 'button');
    pp.type = 'button';
    // A mouse press must not leave focus on the button: focus inside the row keeps the readings up (:focus-within),
    // so the lyric would not come back when the pointer leaves. Keyboard focus still works as usual.
    pp.addEventListener('mousedown', (e) => e.preventDefault());
    pp.addEventListener('click', () => {
      if (!media) { command('launch'); return; }
      media = { ...media, status: media.status === 'Playing' ? 'Paused' : 'Playing' };   // answer the click at once
      command('toggle'); background(); kick();
    });
  }
  function paintStrip(s, pos, i) {
    if (!s.firstChild) buildStrip(s);
    const mode = syncRow();
    let still = false;
    if (!s._painted && mode !== undefined) {
      s._painted = true;
      // DSH built this row while the row's state went on unchanged: show it as it is, without fading in
      if (rowSince < s._born) { still = true; const dock = s.closest('[data-composer-dock]'); if (dock) holdStill(dock); }
    }
    if (mode === undefined) delete s.dataset.mode;
    else if (s.dataset.mode !== mode) s.dataset.mode = mode;
    const pp = s.querySelector('.dshmu-pp'), state = media === null ? 'play' : media?.status === 'Playing' ? 'pause' : 'resume';
    if (pp.dataset.state !== state) {
      pp.dataset.state = state;
      pp.innerHTML = state === 'pause' ? ICON_PAUSE : ICON_PLAY;
      if (state === 'play') pp.removeAttribute('title'); else pp.title = t(state);   // no words on the start button
      pp.setAttribute('aria-label', t(state));
    }
    const dock = s.closest('[data-composer-dock]');
    if (dock && ctxLine.update(dock, mode === 'lyric' && !dock.matches(':hover, :focus-within') && !dock.querySelector('[aria-expanded="true"]'), still)) moving = true;
    if (mode !== 'lyric') return;   // the lyric keeps its last words while it fades out
    const img = s.querySelector('.dshmu-cover'), line = s.querySelector('.dshmu-line');
    if (img._src !== cover) { img._src = cover; if (cover) img.src = cover; img.hidden = !cover; }
    const l = i >= 0 ? lyrics.lines[i] : null;
    if (line._l !== l || line._lyrics !== lyrics || (!l && line._title !== media.title)) {
      line._l = l; line._lyrics = lyrics; line._title = media.title;
      const words = el('dshmu-words');
      if (l) words.append(...wordSpans(l)); else words.textContent = [media.title, media.artist].filter(Boolean).join(' · ');
      line.replaceChildren(words);
      if (l?.tr) { el('dshmu-sep', line).textContent = '·'; el('dshmu-tr', line).textContent = l.tr; }
      restart(line, 'dshmu-in');
    }
    if (l) paint(line.firstChild, pos);
  }

  // A subagent's chat in the right sidebar has a composer of its own: that one stays as DSH draws it.
  const embedded = (e) => !!e.closest('[data-sidebar-chat]');
  function Strip() {
    const ref = React.useRef(null);
    // painted before the browser shows the new row, so a rebuilt row never shows DSH's readings for a frame first
    (React.useLayoutEffect ?? React.useEffect)(() => {
      const s = ref.current;
      if (embedded(s)) { s.style.display = 'none'; return undefined; }
      s._born = performance.now();
      strips.add(s);
      const on = playing(), pos = on ? position() : 0;
      paintStrip(s, pos, on ? lineAt(pos) : -1);
      kick();
      const dock = s.closest('[data-composer-dock]');
      return () => { strips.delete(s); if (dock) ctxLine.forget(dock); };
    }, []);
    return h('span', { ref, className: 'dshmu-strip' });
  }

  // ------------------------------------------------------------------ settings page
  const useSettings = () => React.useSyncExternalStore((f) => { settingsListeners.add(f); return () => settingsListeners.delete(f); }, () => settings);
  function Settings({ view }) {
    const s = useSettings();
    const bgName = s.backdrop === 0 ? 'off' : s.backdrop < 0.26 ? 'light' : s.backdrop < 0.4 ? 'medium' : 'strong';
    if (view === 'summary') return MUSIC_CODING ? t('summary', { mc: s.musicCoding ? t('on') : t('off'), bg: t(bgName) }) : t('summaryBg', { bg: t(bgName) });
    const row = (label, hint, control) => h('div', { className: 'dshmu-row' },
      h('span', null, h('span', null, label), hint ? h('span', { className: 'dshmu-hint' }, hint) : null), control);
    const seg = (id, label, value, options, onChange) => h(SegmentedControl, { id: `dshmu-${id}`, label, value, options, onChange });
    const players = Array.from(new Set(['Spotify', 'cloudmusic', 'QQMusic', ...Object.keys(s.offsets ?? {}), media?.proc].filter(Boolean)));
    return h('div', { className: 'dshmu-set' },
      MUSIC_CODING && row(t('musicCoding'), t('musicCodingHint'), h(Switch, { checked: !!s.musicCoding, label: t('musicCoding'), onChange: (v) => setSettings({ musicCoding: v }) })),
      row(t('backdrop'), t('backdropHint'), seg('bg', t('backdrop'), bgName,
        ['off', 'light', 'medium', 'strong'].map((v) => ({ value: v, label: t(v) })),
        (v) => setSettings({ backdrop: { off: 0, light: 0.2, medium: 0.32, strong: 0.5 }[v] }))),
      row(t('duck'), null, seg('duck', t('duck'), String(s.duck ?? 0.5),
        ['0.3', '0.5', '0.7'].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` })), (v) => setSettings({ duck: Number(v) }))),
      MUSIC_CODING && row(t('fadeIn'), null, seg('fade', t('fadeIn'), String(s.fadeIn ?? 8),
        ['5', '8', '10'].map((v) => ({ value: v, label: `${v}s` })), (v) => setSettings({ fadeIn: Number(v) }))),
      row(t('beat'), t('beatHint'), h(Switch, { checked: s.beat !== false, label: t('beat'), onChange: (v) => setSettings({ beat: v }) })),
      row(t('offsets'), null, h('div', { className: 'dshmu-offsets' }, players.map((p) => h('label', { key: p }, p,
        h(Input, { type: 'number', step: 100, value: s.offsets?.[p] ?? 0, 'aria-label': `${t('offsets')} ${p}`,
          onChange: (e) => setSettings({ offsets: { [p]: Math.round(Number(e.target.value) || 0) } }) }))))),
      MUSIC_CODING && row(t('model'), t('modelHint'), h(Input, { value: s.moodModel ?? 'haiku', 'aria-label': t('model'), style: { width: 160 },
        onChange: (e) => setSettings({ moodModel: e.target.value || 'haiku' }) })),
    );
  }

  // ------------------------------------------------------------------ cover background behind the window
  // Comes in once the music has played (not while a player merely sits there paused), stays through pauses holding
  // still, and goes when the player does. The layer's opacity and the sidebar's tint move together (bgSet), BG_MS each
  // way, eased; the flow eases to a stop and back up with the music (backdrop.js). The layer starts showing only once
  // the cover is drawn on it.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const BG_MS = 1500, BG_TINT = 55;
  let bg = null;   // { layer, view, cover, ready, want, p (0..1 shown), to, rate, raf, inMs }
  const smooth = (x) => x * x * (3 - 2 * x);
  function bgSet(b, p) {
    b.p = p;
    const e = smooth(p), html = document.documentElement;
    b.layer.style.opacity = String(e);
    if (p > 0) { html.setAttribute('data-dshmu-bg', ''); html.style.setProperty('--dshmu-tint', `${100 - (100 - BG_TINT) * e}%`); }
    else { html.removeAttribute('data-dshmu-bg'); html.style.removeProperty('--dshmu-tint'); }
  }
  function bgFade(b, to, ms) {
    b.to = to; b.rate = reduced.matches ? Infinity : 1 / ms;
    if (b.raf || b.p === to) return;
    let last = performance.now();
    const step = (now) => {
      b.raf = 0;
      const d = (now - last) * b.rate; last = now;
      bgSet(b, b.to > b.p ? Math.min(b.to, b.p + d) : Math.max(b.to, b.p - d));
      if (b.p !== b.to) b.raf = requestAnimationFrame(step);
    };
    b.raf = requestAnimationFrame(step);
  }
  function bgLayer() {
    // the instance before this one (the plugin reloading) leaves its layer up for this one to go on with
    const ghost = globalThis.__dshmuBg;
    if (ghost) { delete globalThis.__dshmuBg; ghost.adopt(); }
    let layer = ghost?.layer;
    if (!layer?.isConnected) {
      layer = el('dshmu-bg', null, 'div');
      layer.setAttribute('aria-hidden', 'true');
      el('', layer, 'canvas');
      el('dshmu-veil', layer, 'div');
      document.body.append(layer);
    }
    const b = { layer, view: createBackdrop(layer.querySelector('canvas'), { time: ghost?.time }), cover: null, ready: false, want: false, p: 0, to: 0, rate: 0, raf: 0 };
    bgSet(b, ghost?.p ?? 0);
    return b;
  }
  function background() {
    const html = document.documentElement;
    const strength = settings.backdrop ?? 0.32;
    html.style.setProperty('--dshmu-bg-strength', String(strength));
    if (media && cover && strength > 0 && heard) {
      bg ??= bgLayer();
      const b = bg;
      b.want = true;
      b.view.setPlaying(media.status === 'Playing' && !reduced.matches);
      if (b.cover !== cover) {
        b.cover = cover;
        b.view.setCover(cover, () => { b.ready = true; if (bg === b && b.want) bgFade(b, 1, b.inMs ?? BG_MS); });
      } else if (b.ready) bgFade(b, 1, b.inMs ?? BG_MS);
    } else if (bg?.want) {
      bg.want = false;
      bg.view.setPlaying(false);
      bgFade(bg, 0, BG_MS);
    }
  }

  // ------------------------------------------------------------------ frame loop, only while something shows a lyric
  // (or the context line is still turning back into DSH's ring)
  const carried = carryIn();
  const ctxLine = createContextLine(reduced, { pct: carried?.ctxPct });
  let moving = false;
  function frame() {
    raf = 0;
    const hosts = [...indicators()].filter((e) => !embedded(e));
    const on = playing();
    const pos = on ? position() : 0, i = on ? lineAt(pos) : -1;
    if (hosts.length) {
      const l = on ? indicatorLine(pos, i) : null;
      for (const host of hosts) paintIndicator(host, pos, l);
      indKey = lineKey(l);
    }
    moving = false;
    for (const s of strips) paintStrip(s, pos, i);
    if ((on && (hosts.length || strips.size)) || moving) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  // ------------------------------------------------------------------ the tail to the beat (tail.js, when built in)
  const tail = typeof createTail === 'function'
    ? createTail(() => settings.beat !== false && media?.status === 'Playing' && !reduced.matches, () => mood, carried?.tail ?? null)
    : null;

  // ------------------------------------------------------------------ carried over
  // The plugin reloading (an update) hands its state to the next instance on the same page (globalThis), and DSH
  // reloading its page hands it on through sessionStorage, so the next one starts out showing what this one showed:
  // the lyric row and context line as they were, the background taken over as it is (on the same page) or quickly
  // back (after a page reload), the tail's beat (same page only: its clock is the page's). The host's first report
  // follows within a moment and puts anything stale right.
  function carryIn() {
    let c = globalThis.__dshmuCarry;
    delete globalThis.__dshmuCarry;
    if (!c) {
      try { c = JSON.parse(sessionStorage.getItem(CARRY_KEY) ?? 'null'); sessionStorage.removeItem(CARRY_KEY); } catch { c = null; }
      if (c) c = { ...c, reload: true, tail: null };
    }
    return c && Date.now() - c.at < CARRY_MS ? c : null;
  }
  function carryOut() {
    return { at: Date.now(), media, cover, heard, lyrics, lyricsStatus, mood, settings, expect, indKey, song,
      ctxPct: ctxLine.pct(), tail: tail?.save?.() ?? null, bg: !!bg && bg.p > 0 };
  }
  const onPageHide = () => { try { sessionStorage.setItem(CARRY_KEY, JSON.stringify({ ...carryOut(), tail: null })); } catch { } };

  // ------------------------------------------------------------------ lifetime
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-music';
  style.textContent = CSS;
  document.head.append(style);
  if (carried) {
    media = carried.media ?? undefined; cover = carried.cover ?? null; heard = !!carried.heard; song = carried.song ?? null;
    lyrics = carried.lyrics ?? null; lyricsStatus = carried.lyricsStatus ?? null; mood = carried.mood ?? null;
    settings = carried.settings ?? {}; expect = carried.expect ?? 0; indKey = carried.indKey ?? null;
    syncRow(); rowSince = -Infinity;   // what the row shows now is what it showed before: no entrance
    background();
    if (bg && carried.reload) bg.inMs = 400;
  }
  addEventListener('pagehide', onPageHide);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; checkBusy(); });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
  document.addEventListener('input', onInput, true);
  checkBusy();
  void watch();

  const stop = () => {
    globalThis.__dshmuCarry = carryOut();
    lifetime.abort();
    observer.disconnect();
    removeEventListener('pagehide', onPageHide);
    document.removeEventListener('input', onInput, true);
    clearInterval(typingTimer);
    clearTimeout(gone);
    if (raf) cancelAnimationFrame(raf);
    document.querySelectorAll('.dshmu-ts').forEach((e) => e.remove());
    document.querySelectorAll('.dshmu-on').forEach((e) => e.classList.remove('dshmu-on'));
    for (const s of strips) { delete s.dataset.mode; s.replaceChildren(); }
    ctxLine.dispose();
    tail?.dispose();
    const html = document.documentElement;
    const clear = () => { style.remove(); html.removeAttribute('data-dshmu-bg'); html.style.removeProperty('--dshmu-tint'); html.style.removeProperty('--dshmu-bg-strength'); };
    const b = bg;
    bg = null;
    if (!b) { clear(); return; }
    b.view.dispose();
    cancelAnimationFrame(b.raf); b.raf = 0;
    if (b.p <= 0) { b.layer.remove(); clear(); return; }
    // Leave the background (and the styles it needs) up for the next instance to take over. If none does within a
    // moment (the plugin was turned off), fade it out and put the window back as it was.
    let timer = 0;
    const ghost = { layer: b.layer, time: b.view.time(), p: b.p, adopt() { clearTimeout(timer); cancelAnimationFrame(b.raf); style.remove(); } };
    timer = setTimeout(() => {
      if (globalThis.__dshmuBg === ghost) delete globalThis.__dshmuBg;
      bgFade(b, 0, BG_MS);
      timer = setTimeout(() => { cancelAnimationFrame(b.raf); b.layer.remove(); clear(); }, BG_MS + 100);
    }, 2500);
    globalThis.__dshmuBg = ghost;
  };
  return { stop, Strip, Settings, onBeat: (f) => { beatListeners.add(f); return () => beatListeners.delete(f); } };
}

async function apply(ctx) {
  const unmount = await ctx.remote.$mount(MUSIC_REMOTE);
  ctx.effect(() => ctx.locale.register('dshMusic', LOCALE));
  const t = ctx.locale.bind('dshMusic');
  const ui = ctx.inject(['remote.dshMusic', 'slots'], (child) => {
    const music = createMusic(child.remote, t);
    child.effect(() => music.stop, 'dsh-music: lyrics');
    child.slots.inject('conversation.composer.dock', () => child.slots.register(
      { name: 'conversation.composer.dock', id: 'dsh-music', order: -1 }, music.Strip));
    child.slots.inject('plugins.bundle.config', () => child.slots.register(
      { name: 'plugins.bundle.config', key: 'dsh-music' }, music.Settings));
  });
  try { await ui; } catch (error) { await ui.dispose?.(); await unmount(); throw error; }
  return async () => { await ui.dispose?.(); await unmount(); };
}

exports.apply = apply;
exports.inject = ['remote', 'slots', 'locale'];
