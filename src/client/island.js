// The player that unfolds from the cover capsule on the composer row (sample B in tools/samples/controls.html). The
// capsule's frame grows into a small panel above the row and shows its content, which already sits where it will end;
// the capsule's cover and beat bars fly to their places in the panel. Inside: the cover (scroll on it to skip), title
// and artist, three lines of lyrics with the sung one lit word by word, the progress, previous / play-pause / next,
// and the play mode where the player takes it from outside (Spotify does, NetEase does not). Clicking outside, Esc or
// the capsule again folds it back into the capsule. A song change slides the cover, the title and the lyrics the way
// the song went (forward unless it was the previous-song button).
// Needs bars.js (createBars, ICON_NOTE) built in before it.
// env: { t, command(action), media(), cover(), lyrics(), position(), reduced (MediaQueryList), dir(), skip(d), wheelSkip(event) }
const ISLAND_W = 300;
const MODE_ORDER = ['order', 'list', 'one', 'shuffle'];
const ICONS = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.9v10.2a.7.7 0 0 0 1.07.6l8.1-5.1a.7.7 0 0 0 0-1.2l-8.1-5.1a.7.7 0 0 0-1.07.6z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.6" y="2.8" width="3" height="10.4" rx="1" fill="currentColor"/><rect x="9.4" y="2.8" width="3" height="10.4" rx="1" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.4" y="2.8" width="2" height="10.4" rx=".9" fill="currentColor"/><path d="M13.6 3.5v9a.7.7 0 0 1-1.1.58L5.9 8.58a.7.7 0 0 1 0-1.16l6.6-4.5a.7.7 0 0 1 1.1.58z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="11.6" y="2.8" width="2" height="10.4" rx=".9" fill="currentColor"/><path d="M2.4 3.5v9a.7.7 0 0 0 1.1.58l6.6-4.5a.7.7 0 0 0 0-1.16L3.5 2.92a.7.7 0 0 0-1.1.58z" fill="currentColor"/></svg>',
  order: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h11M2.5 8h7M2.5 12h7M11.5 10l2 2-2 2"/></svg>',
  list: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5V7A2.5 2.5 0 0 1 5 4.5h8.5M11.5 2.5l2 2-2 2M13.5 8.5V9A2.5 2.5 0 0 1 11 11.5H2.5M4.5 13.5l-2-2 2-2"/></svg>',
  one: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5V7A2.5 2.5 0 0 1 5 4.5h8.5M11.5 2.5l2 2-2 2M13.5 8.5V9A2.5 2.5 0 0 1 11 11.5H2.5M4.5 13.5l-2-2 2-2"/><path d="M7.4 6.9 8.3 6.3v3.6" stroke-width="1.1"/></svg>',
  shuffle: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h1.8c1.3 0 2.3.6 3 1.7l1.4 3.6c.7 1.1 1.7 1.7 3 1.7h1.8M11.5 9.5l2 2-2 2M2.5 11.5h1.8c.9 0 1.7-.3 2.3-.9M13.5 4.5h-1.8c-.9 0-1.7.3-2.3.9M11.5 2.5l2 2-2 2"/></svg>',
};

/** The player's play mode as one of MODE_ORDER, and the modes it can be set to; none when it takes neither. */
function playModes(m) {
  const sh = m?.shuffle ?? null, rp = m?.repeat ?? null;
  if (sh === null && rp === null) return null;
  const now = sh ? 'shuffle' : rp === 'Track' ? 'one' : rp === 'List' ? 'list' : 'order';
  const can = MODE_ORDER.filter((x) => (x === 'shuffle' ? sh !== null : x === 'order' || rp !== null));
  return { now, can };
}

function createIsland(env) {
  const { t, command, reduced } = env;
  let root = null, ui = null;
  let cap = null;             // the capsule it came from
  let k = 0, from = 0, to = 0, t0 = 0, geo = null, raf = 0, last = 0;
  let songKey = null, coverShown, lineShown = -2, modeShown = null, sayTimer = 0;
  let pendingMode = null;     // the mode just asked for, shown until the player reports it (or 2 s pass)
  let closing = null;         // null (open or opening) | 'land' (folding back) | 'fade' (nothing to fold into: fading where it is)
  let landing = 'cap';        // folding back into the capsule, or into the row's lyric (the row goes back to the lyric)
  let fadeT0 = 0, colSnap = false, drag = null;
  const listeners = new AbortController();
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, x) => a + (b - a) * x;
  const smooth = (x) => x * x * (3 - 2 * x);
  const seg = (x, a, b) => clamp01((x - a) / (b - a));
  // out on a slightly springy curve, back on a quick calm one
  function spring(s, zeta, w) {
    if (zeta >= 1) return 1 - Math.exp(-w * s) * (1 + w * s);
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w * s) * (Math.cos(wd * s) + (zeta * w / wd) * Math.sin(wd * s));
  }
  const node = (html) => { const tpl = document.createElement('template'); tpl.innerHTML = html.trim(); return tpl.content.firstChild; };
  function button(cls, label) {
    const b = node(`<button type="button" class="dshmu-ib ${cls}"></button>`);
    b.setAttribute('aria-label', label);
    b.addEventListener('mousedown', (e) => e.preventDefault());   // keep the composer's focus
    return b;
  }

  function build() {
    root = node(`<div class="dshmu-isl" role="dialog" hidden>
      <div class="dshmu-isl-clip"><div class="dshmu-isl-tint"><img alt=""><img alt=""></div>
        <div class="dshmu-isl-body">
          <div class="dshmu-isl-head"><span class="dshmu-isl-slot"></span><div class="dshmu-isl-meta"></div><span class="dshmu-isl-eqslot"></span></div>
          <div class="dshmu-isl-ly"><div class="dshmu-isl-col"></div></div>
          <div class="dshmu-isl-seek"><div class="dshmu-isl-bar"><i></i></div><b class="dshmu-isl-knob"></b></div>
          <div class="dshmu-isl-times"><span></span><span></span></div>
          <div class="dshmu-isl-btns"></div>
          <div class="dshmu-isl-say" aria-live="polite"></div>
        </div></div>
      <div class="dshmu-isl-cover"><img alt=""><span class="dshmu-isl-note">${ICON_NOTE}</span></div>
      <span class="dshmu-eq dshmu-isl-eq"><i></i><i></i><i></i><i></i></span></div>`);
    const $ = (s) => root.querySelector(s);
    ui = { clip: $('.dshmu-isl-clip'), body: $('.dshmu-isl-body'), tints: [...root.querySelectorAll('.dshmu-isl-tint img')], tint: $('.dshmu-isl-tint'),
      meta: $('.dshmu-isl-meta'), col: $('.dshmu-isl-col'), bar: $('.dshmu-isl-bar i'), barBox: $('.dshmu-isl-bar'), times: root.querySelectorAll('.dshmu-isl-times span'),
      timesBox: $('.dshmu-isl-times'), seek: $('.dshmu-isl-seek'), knob: $('.dshmu-isl-knob'), cover: $('.dshmu-isl-cover'), eq: $('.dshmu-isl-eq'), say: $('.dshmu-isl-say'), btns: $('.dshmu-isl-btns') };
    ui.bars = createBars([...ui.eq.querySelectorAll('i')]);
    ui.mode = button('dshmu-isl-mode', t('mode'));
    ui.prev = button('', t('prev'));
    ui.pp = button('dshmu-isl-pp', t('pause'));
    ui.next = button('', t('next'));
    ui.prev.innerHTML = ICONS.prev; ui.next.innerHTML = ICONS.next;
    ui.btns.append(ui.mode, ui.prev, ui.pp, ui.next, node('<span class="dshmu-isl-gap"></span>'));
    ui.pp.addEventListener('click', () => { env.toggle(); ui.pp.setAttribute('data-pop', ''); requestAnimationFrame(() => requestAnimationFrame(() => ui.pp.removeAttribute('data-pop'))); });
    ui.prev.addEventListener('click', () => env.skip(-1));
    ui.next.addEventListener('click', () => env.skip(1));
    ui.mode.addEventListener('click', cycleMode);
    ui.seek.addEventListener('pointerdown', (e) => {
      const m = env.media();
      if (e.button !== 0 || !m?.seek || !m.dur) return;
      e.preventDefault();   // keeps the composer's focus
      try { ui.seek.setPointerCapture(e.pointerId); } catch { }
      ui.seek.setAttribute('data-drag', '');
      const at = (ev) => { const r = ui.barBox.getBoundingClientRect(); return clamp01((ev.clientX - r.left) / r.width) * m.dur; };
      drag = { ms: at(e) };
      const move = (ev) => { if (drag) drag.ms = at(ev); };
      const end = (ev, done) => {
        ui.seek.removeEventListener('pointermove', move); ui.seek.removeEventListener('pointerup', up); ui.seek.removeEventListener('pointercancel', cancel);
        ui.seek.removeAttribute('data-drag');
        if (done && drag) env.seek(at(ev));
        drag = null;
      };
      const up = (ev) => end(ev, true), cancel = (ev) => end(ev, false);
      ui.seek.addEventListener('pointermove', move); ui.seek.addEventListener('pointerup', up); ui.seek.addEventListener('pointercancel', cancel);
    });
    ui.cover.addEventListener('wheel', (e) => { e.preventDefault(); env.wheelSkip(e); }, { passive: false });
    document.body.append(root);
    const sig = { signal: listeners.signal };
    document.addEventListener('pointerdown', (e) => { if (cap && to === 1 && !root.contains(e.target) && !cap.contains(e.target)) close(); }, { ...sig, capture: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cap && to === 1) close(); }, sig);
    addEventListener('resize', () => close('fade'), sig);
  }

  function cycleMode() {
    const pm = playModes(env.media());
    if (!pm) return;
    const cur = pendingMode?.at > performance.now() - 2000 ? pendingMode.mode : pm.now;
    const nextMode = pm.can[(pm.can.indexOf(cur) + 1) % pm.can.length];
    pendingMode = { mode: nextMode, at: performance.now() };
    command(`mode ${nextMode}`);
    paintButtons(true);
    say(t(`mode_${nextMode}`));
  }
  function say(text) {
    ui.say.textContent = text; ui.say.setAttribute('data-show', '');
    clearTimeout(sayTimer); sayTimer = setTimeout(() => ui.say.removeAttribute('data-show'), 1100);
  }

  const rectOf = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  // Where it comes from and goes back to: the capsule (its artwork and bars), or, folding back into a row that will show
  // the lyric again, the lyric with its small cover. Measured every frame, so it lands where they are by then (the
  // capsule narrows when the music pauses, the row re-centres).
  function source() {
    if (landing === 'lyric') {
      const pill = cap.closest('.dshmu-strip')?.querySelector('.dshmu-lyric');
      const img = pill?.querySelector('.dshmu-cover');
      if (pill?.getClientRects().length) {
        const p = rectOf(pill), c = img && !img.hidden ? rectOf(img) : { x: p.x + 8, y: p.y + (p.h - 14) / 2, w: 14, h: 14 };
        return { cap: p, capR: 8, capCover: c, coverR: 3, capEq: { x: c.x + c.w, y: c.y + 1 } };
      }
    }
    const c = rectOf(cap), cc = rectOf(cap.querySelector('.dshmu-cap-art')), ce = rectOf(cap.querySelector('.dshmu-eq'));
    return { cap: c, capR: c.h / 2, capCover: cc, coverR: 4, capEq: ce.w ? ce : { x: cc.x + cc.w, y: cc.y + 2 } };
  }
  function panelAt(c) {
    const H = ui.body.offsetHeight;
    const x = Math.max(12, Math.min(innerWidth - ISLAND_W - 12, c.x + c.w / 2 - ISLAND_W / 2));
    const y = Math.max(12, c.y - 10 - H);
    return { panel: { x, y, w: ISLAND_W, h: H }, cover: { x: x + 14, y: y + 14, w: 52 }, eq: { x: x + ISLAND_W - 14 - 17, y: y + 18 } };
  }

  function open(capsule) {
    if (!root) build();
    if (cap && cap !== capsule) { cap.setAttribute('aria-expanded', 'false'); k = 0; }
    cap = capsule; closing = null; landing = 'cap';
    root.style.opacity = '';
    cap.removeAttribute('data-dshmu-landing');
    cap.setAttribute('aria-expanded', 'true');
    paint(true);
    root.hidden = false;
    const src = source();
    geo = { ...src, ...panelAt(src.cap) };
    ui.bars.copy([...cap.querySelectorAll('.dshmu-eq i')]);
    colSnap = true;
    from = k; to = 1; t0 = performance.now();
    if (reduced.matches) k = 1;
    kick();
  }
  // how: fold back (the default), or 'fade' where there is nothing to fold into (the player gone, another session, the
  // window resized)
  function close(how) {
    if (!cap || closing === 'fade') return;
    if (how === 'fade' || reduced.matches) { closing = 'fade'; fadeT0 = performance.now(); kick(); return; }
    if (closing === 'land') return;
    closing = 'land';
    // clicked away from the row, which will show the lyric again: fold into the lyric rather than the capsule
    const strip = cap.closest('.dshmu-strip'), dock = cap.closest('[data-composer-dock]');
    landing = strip?.dataset.mode === 'lyric' && !dock?.matches(':hover, :focus-within') ? 'lyric' : 'cap';
    from = k; to = 0; t0 = performance.now();
    kick();
  }
  function finish() {
    root.hidden = true; root.style.opacity = '';
    if (cap?.getAttribute('aria-expanded') === 'true') cap.setAttribute('aria-expanded', 'false');
    cap = null; closing = null; drag = null;
    cancelAnimationFrame(raf); raf = 0;
  }
  // Folding into the lyric: the row starts back over to it a moment before the end, the capsule staying out of sight
  // meanwhile, so the lyric comes in as the island goes and nothing flashes up in between.
  function release() {
    const c = cap;
    c.setAttribute('data-dshmu-landing', '');
    c.setAttribute('aria-expanded', 'false');
    setTimeout(() => c.removeAttribute('data-dshmu-landing'), 320);
  }
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

  function place() {
    const g = geo, kc = clamp01(k);
    const r = { x: lerp(g.cap.x, g.panel.x, k), y: lerp(g.cap.y, g.panel.y, k), w: lerp(g.cap.w, g.panel.w, k), h: lerp(g.cap.h, g.panel.h, k) };
    const cs = ui.clip.style;
    cs.left = `${r.x}px`; cs.top = `${r.y}px`; cs.width = `${r.w}px`; cs.height = `${r.h}px`; cs.borderRadius = `${lerp(g.capR, 18, kc)}px`;
    cs.setProperty('--dshmu-isl-k', kc.toFixed(3));
    ui.body.style.left = `${g.panel.x - r.x}px`; ui.body.style.top = `${g.panel.y - r.y}px`;
    ui.body.style.opacity = (smooth(seg(k, 0.4, 0.95))).toFixed(3);
    ui.tint.style.opacity = kc.toFixed(3);
    const s = lerp(g.capCover.w, g.cover.w, k);
    const vs = ui.cover.style;
    vs.left = `${lerp(g.capCover.x, g.cover.x, k)}px`; vs.top = `${lerp(g.capCover.y, g.cover.y, k)}px`; vs.width = vs.height = `${s}px`;
    vs.borderRadius = `${lerp(g.coverR, 10, kc)}px`;
    vs.setProperty('--dshmu-isl-k', kc.toFixed(3));
    const es = ui.eq.style;
    es.left = `${lerp(g.capEq.x, g.eq.x, k)}px`; es.top = `${lerp(g.capEq.y, g.eq.y, k)}px`; es.transform = `scale(${lerp(1, 1.2, kc)})`;
  }

  function wordSpans(l) {
    const d = document.createElement('div');
    for (const [wt, wd, ws] of l.w ?? [[l.t, l.d, l.text]]) { const s = document.createElement('span'); s.textContent = ws; s.dataset.t = wt; s.dataset.d = Math.max(1, wd); d.append(s); }
    return d;
  }
  // in from one side, the old one out the other
  function slideIn(el, dir, px, unit = 'px') {
    el.style.transition = 'none'; el.style.transform = `translateX(${dir * px}${unit})`; el.style.opacity = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; }));
  }
  function slideOut(el, dir, px, unit = 'px') { el.style.transform = `translateX(${-dir * px}${unit})`; el.style.opacity = '0'; setTimeout(() => el.remove(), 420); }

  // The song, its lines and the buttons.
  function paint(force) {
    if (!root) return;
    const m = env.media(), cover = env.cover(), lyrics = env.lyrics();
    const key = m ? `${m.app}\u0000${m.title}\u0000${m.artist}` : null;
    const ly = lyrics?.lines?.length && !lyrics.instrumental ? lyrics : null;
    const lyKey = `${key}\u0000${ly ? ly.lines.length + ':' + ly.lines[0].t : '-'}`;
    const changed = !force && songKey !== null && key !== songKey.split('\u0001')[0];
    if (force || `${key}\u0001${lyKey}` !== songKey) {
      const dir = changed && !reduced.matches ? env.dir() : 0;
      if (force || changed) {
        // the cover: the old one slides off, the new one comes in from the other side; the colour behind follows
        const imgs = [...ui.cover.querySelectorAll('img')], old = imgs.at(-1);
        if (dir) {
          const img = document.createElement('img'); img.alt = '';
          if (cover) img.src = cover; else img.hidden = true;
          ui.cover.insertBefore(img, ui.cover.querySelector('.dshmu-isl-note'));
          slideIn(img, dir, 100, '%'); slideOut(old, dir, 100, '%');
        } else {
          for (const i of imgs.slice(0, -1)) i.remove();
          old.hidden = !cover; if (cover) old.src = cover;
        }
        setTint(cover);
        coverShown = cover;
        // title and artist
        const meta = node('<div><div class="dshmu-isl-t"></div><div class="dshmu-isl-a"></div></div>');
        meta.firstChild.textContent = m?.title ?? ''; meta.lastChild.textContent = m?.artist ?? '';
        root.setAttribute('aria-label', [m?.title, m?.artist].filter(Boolean).join(' · '));
        for (const o of [...ui.meta.children]) { if (dir) slideOut(o, dir, 16); else o.remove(); }
        ui.meta.append(meta);
        if (dir) slideIn(meta, dir, 16);
      }
      // the lines, one column that scrolls; without any, a word on why
      ui.col.replaceChildren(...(ly ? ly.lines.map(wordSpans) : [node('<div data-cur></div>')]));
      if (!ly) ui.col.firstChild.textContent = env.lyricsWord();
      ui.col.toggleAttribute('data-none', !ly);
      lineShown = -2; colSnap = true;
      if (dir) { ui.col.style.transition = 'none'; ui.col.style.opacity = '0'; requestAnimationFrame(() => { ui.col.style.transition = ''; ui.col.style.opacity = ''; }); }
      songKey = `${key}\u0001${lyKey}`;
    }
    // the artwork often comes a moment after the title: put it in without any motion
    if (cover !== coverShown) {
      coverShown = cover;
      const img = [...ui.cover.querySelectorAll('img')].at(-1);
      img.hidden = !cover; if (cover) img.src = cover;
      setTint(cover);
    }
    if (!ly && ui.col.hasAttribute('data-none')) ui.col.firstChild.textContent = env.lyricsWord();
    paintButtons(false);
  }
  function setTint(cover) {
    ui.cover.toggleAttribute('data-blank', !cover);
    const [a, b] = ui.tints, on = a.hasAttribute('data-on') ? a : b, off = on === a ? b : a;
    if (cover) { off.src = cover; off.setAttribute('data-on', ''); } else off.removeAttribute('data-on');
    on.removeAttribute('data-on');
  }
  function paintButtons(turn) {
    const m = env.media(), pm = playModes(m);
    if (pendingMode && (pendingMode.at < performance.now() - 2000 || pm?.now === pendingMode.mode)) pendingMode = null;
    const playing = m?.status === 'Playing';
    const ppState = playing ? 'pause' : 'play';
    if (ui.pp.dataset.state !== ppState) { ui.pp.dataset.state = ppState; ui.pp.innerHTML = ICONS[ppState]; ui.pp.setAttribute('aria-label', t(playing ? 'pause' : 'resume')); }
    ui.prev.disabled = !m || m.prev === false; ui.next.disabled = !m || m.next === false;   // unknown counts as possible
    ui.mode.hidden = !pm;
    const mode = pendingMode?.mode ?? pm?.now ?? null;
    if (mode && mode !== modeShown) {
      const first = modeShown === null;
      modeShown = mode;
      ui.mode.innerHTML = ICONS[mode];
      ui.mode.dataset.on = String(mode !== 'order');
      ui.mode.title = t(`mode_${mode}`);
      if (turn && !first && !reduced.matches) { ui.mode.setAttribute('data-turn', ''); requestAnimationFrame(() => requestAnimationFrame(() => ui.mode.removeAttribute('data-turn'))); }
    }
    root.toggleAttribute('data-playing', playing);
  }
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function scrollCol(y) {
    if (!colSnap) { ui.col.style.transform = `translateY(${y}px)`; return; }
    colSnap = false;
    ui.col.style.transition = 'none'; ui.col.style.transform = `translateY(${y}px)`;
    void ui.col.offsetHeight;
    ui.col.style.transition = '';
  }
  function frame(now) {
    raf = 0;
    const dt = Math.min(50, now - last); last = now;
    if (!cap) return;
    // the capsule gone (another session) or out of the row (the player gone): nothing to fold into
    if (closing !== 'fade' && (!cap.isConnected || !cap.getClientRects().length)) close('fade');
    if (closing === 'fade') {
      const q = 1 - smooth(seg(now - fadeT0, 0, 180));
      root.style.opacity = q.toFixed(3);
      if (q <= 0) { finish(); return; }
    } else {
      if (k !== to || reduced.matches) {
        const s = (now - t0) / 1000;
        k = reduced.matches ? to : to === 1 ? lerp(from, 1, spring(s, 0.78, 13)) : from * (1 - spring(s, 1, 24));
        if (to === 1 && s > 1.2) k = 1;
      }
      Object.assign(geo, source());
      if (closing === 'land') {
        if (landing === 'lyric') {
          root.style.opacity = smooth(seg(k, 0, 0.35)).toFixed(3);
          if (k < 0.22 && cap.getAttribute('aria-expanded') === 'true') release();
        }
        if (k < 0.002) { k = 0; finish(); return; }
      }
    }
    place();
    const m = env.media(), playing = m?.status === 'Playing';
    const lyrics = env.lyrics();
    const live = m ? Math.max(0, m.pos + (playing ? Date.now() - m.at : 0)) : 0;
    if (lyrics?.lines?.length && !lyrics.instrumental && m) {
      const pos = drag ? drag.ms + (env.position() - live) : env.position();   // dragging: the lines follow the bar
      let i = -1;
      for (let n = 0; n < lyrics.lines.length && lyrics.lines[n].t <= pos; n++) i = n;
      if (i !== lineShown) {
        lineShown = i;
        [...ui.col.children].forEach((d, n) => d.toggleAttribute('data-cur', n === i));
        scrollCol((1 - Math.max(i, -1)) * 22);
      }
      for (const w of ui.col.children[i]?.children ?? []) {
        const q = Math.round(clamp01((pos - w.dataset.t) / w.dataset.d) * 20) * 5;
        if (w._q !== q) { w._q = q; w.style.color = `color-mix(in srgb, var(--dshmu-isl-sung) ${q}%, var(--dshmu-isl-dim))`; }
      }
    } else if (lineShown !== -3) { lineShown = -3; scrollCol(22); }
    const dur = m?.dur || 0;
    ui.seek.hidden = ui.timesBox.hidden = !dur;
    const can = !!(m?.seek && dur);
    if (ui.seek.hasAttribute('data-can') !== can) { ui.seek.toggleAttribute('data-can', can); ui.seek.title = dur && !can ? t('noSeek') : ''; }
    if (dur) {
      const pos = Math.min(dur, drag ? drag.ms : live), f = `${((pos / dur) * 100).toFixed(2)}%`;
      ui.bar.style.width = f; ui.knob.style.left = f;
      ui.times[0].textContent = fmt(pos); ui.times[1].textContent = fmt(dur);
    }
    // folding into the lyric, the bars sink into the cover
    ui.eq.style.opacity = !playing ? '0' : closing === 'land' && landing === 'lyric' ? smooth(seg(k, 0.15, 0.6)).toFixed(3) : '1';
    ui.bars.step(dt, playing && !reduced.matches);
    raf = requestAnimationFrame(frame);
  }

  return {
    open, close,
    toggle(capsule) { if (cap === capsule && to === 1) close(); else open(capsule); },
    isOpen: (capsule) => cap === capsule,
    update() { if (!cap) return; if (!env.media()) close('fade'); else paint(false); },
    beat(s) { if (cap && ui) ui.bars.beat(s); },
    dispose() { listeners.abort(); cancelAnimationFrame(raf); clearTimeout(sayTimer); root?.remove(); root = null; cap = null; },
  };
}
