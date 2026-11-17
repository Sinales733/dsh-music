// Light that moves with the music (sample: tools/samples/glow.html).
//   - New session (the composer centred, DSH's "hero"): a thin ring of light along the composer card's edge, brighter
//     on each beat. No lyrics there.
//   - The first message (the composer goes down to the bottom): the composer glides down instead of jumping, and the
//     ring opens at the top centre: its two ends draw back down both sides and along the bottom edge to its middle,
//     bringing the lyric in under the card as they round the bottom corners. Then the window's own edge lights from
//     the bottom centre, a moment along the bottom, then quickly up both sides to meet at the top.
//   - In a conversation, the window's edge glows with the beat, quietly. Back to a new session, it draws back the way
//     it came and the ring grows up from the bottom centre round the card. From a page with no conversation (the
//     settings, the plugin manager) straight to a new session, nothing travels: the ring fades in, the edge fades out. Paused, the light fades out slowly and
//     comes back with the music; the music stopping (the player gone) draws it back. The window's edge can be turned
//     off in the settings (edgeOn).
// Colour: picked from the cover (a clear mid-tone of its most colourful part), DSH's blue without a cover.
// env: { reduced, state() -> 'playing' | 'paused' | 'none', edgeOn() -> bool, cover() -> url | null, carried }

// On Windows the minimise / maximise / close buttons are drawn by the system over the page's top right, on a fill of
// their own. DSH takes that fill from a hidden probe reading the title strip's colour, and the page under the buttons is
// that same strip. While the window's edge is lit, or the cover background shows (the strip turns translucent over it),
// the probe reads clear: the buttons sit on the page itself, and neither the light nor the cover's colour stops at them.
// Called whenever either changes (glow.js, music.js); it reads both from the page, so any instance can call it.
function dshmuCaption() {
  const html = document.documentElement;
  let on = false;
  if (html.hasAttribute('data-windows-titlebar')) {
    on = html.hasAttribute('data-dshmu-bg');
    if (!on) for (const e of document.querySelectorAll('.dshmu-edge, .dshmu-edge-css')) if (e.style.display !== 'none') { on = true; break; }
  }
  const s = document.getElementById('dshmu-caption');
  if (on === !!s) return;
  if (!on) { s.remove(); return; }
  const style = document.createElement('style');
  style.id = 'dshmu-caption';
  style.textContent = 'body > span[style*="--dsw-specific-sidebar-fill"] { background-color: transparent !important; }';
  document.head.append(style);
}

function createGlow(env) {
  const NS = 'http://www.w3.org/2000/svg';
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const seg = (x, a, b) => clamp01((x - a) / (b - a));
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const out3 = (x) => 1 - Math.pow(1 - x, 3);
  const smooth = (x) => x * x * (3 - 2 * x);
  const RETRACT_MS = 1050, GROW_MS = 1000;
  let raf = 0, last = 0, kick_ = 0, pulse = 0, edgeOut = 0, disposed = false;
  let ringGeo = null;         // the ring's path for the card's present box: { key, rr, w, h, r }
  let content = null, phase = null, card = null, root = null, cardTop = null;
  let flip = null;            // { seat, dy, t0, ms }
  let leftNone = -Infinity;   // when the page last went from showing no conversation to showing one
  let hold = null;            // the composer row whose lyric waits for the ring
  const ring = { svg: null, line: null, k: 0, anim: null };   // k: shown (fades); anim: { kind: 'retract' | 'grow', t0, edgeAt }
  const edge = { svg: null, line: null, css: null, s: 0, o: 0, anim: null, want: false, size: '' };
  if (env.carried?.edge) { edge.s = 1; edge.o = 1; edge.want = true; edgeElements(); }
  if (env.carried?.ring) ring.k = 1;

  // ---------------------------------------------------------------- the colour
  let colourOf = null;
  function colour() {
    const url = env.cover();
    if (url === colourOf) return;
    colourOf = url;
    const html = document.body;   // where the theme colours are, so a colour named by token resolves
    if (!url) { html.style.removeProperty('--dshmu-glow-c'); return; }
    const img = new Image();
    img.onload = () => {
      if (colourOf !== url) return;
      try {
        const c = document.createElement('canvas'); c.width = c.height = 32;
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 32, 32);
        const px = x.getImageData(0, 0, 32, 32).data, list = [];
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          list.push({ r, g, b, w: (mx - mn) * (0.4 + mx) });
        }
        list.sort((p, q) => q.w - p.w);
        const top = list.slice(0, 80);
        let r = 0, g = 0, b = 0;
        for (const p of top) { r += p.r; g += p.g; b += p.b; }
        r /= top.length; g /= top.length; b /= top.length;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
        let hue = 0;
        if (d) hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
        html.style.setProperty('--dshmu-glow-c', s < 0.08
          ? 'var(--dsw-alias-label-tertiary)'   // a grey cover: a quiet grey light
          : `hsl(${Math.round(hue * 60 + 360) % 360} ${Math.round(Math.max(0.6, s) * 100)}% 56%)`);
      } catch { html.style.removeProperty('--dshmu-glow-c'); }
    };
    img.src = url;
  }

  // ---------------------------------------------------------------- geometry
  // A rounded rectangle as one closed path from the middle of its top (or bottom) edge, clockwise, its length L and
  // the length q of one corner. The corners follow the CSS corner-shape the box draws with: DSH rounds its surfaces
  // as superellipse(1.5) (squarer than a circle), so a circular arc would cut inside the composer's corners. k is the
  // superellipse's K (1 = a circular arc, 2 = a squircle); its corner is |x|^n + |y|^n = r^n with n = 2^k.
  function roundRect(x, y, w, h, r, from, k = 1) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (Math.abs(k - 1) < 0.01) {
      const L = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
      const a = (x2, y2) => `A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
      const d = from === 'top'
        ? `M${x + w / 2} ${y}H${x + w - r}${a(x + w, y + r)}V${y + h - r}${a(x + w - r, y + h)}H${x + r}${a(x, y + h - r)}V${y + r}${a(x + r, y)}Z`
        : `M${x + w / 2} ${y + h}H${x + r}${a(x, y + h - r)}V${y + r}${a(x + r, y)}H${x + w - r}${a(x + w, y + r)}V${y + h - r}${a(x + w - r, y + h)}Z`;
      return { d, L, q: (Math.PI * r) / 2 };
    }
    // the corner sampled finely enough to read as a curve; c = its centre, (sx, sy) which way it bulges, `fromV`:
    // it starts on the vertical side (t from 0 to pi/2), else on the horizontal one (t from pi/2 to 0)
    const e = 2 / Math.pow(2, k), N = 18;
    let q = 0;
    const corner = (cx, cy, sx, sy, fromV) => {
      let out = '', px = 0, py = 0;
      for (let i = 0; i <= N; i++) {
        const t = ((fromV ? i : N - i) / N) * (Math.PI / 2);
        const X = cx + sx * r * Math.pow(Math.cos(t), e), Y = cy + sy * r * Math.pow(Math.sin(t), e);
        if (i) { out += `L${X.toFixed(2)} ${Y.toFixed(2)}`; q += Math.hypot(X - px, Y - py) / 4; }
        px = X; py = Y;
      }
      return out;
    };
    const tr = corner(x + w - r, y + r, 1, -1, false), br = corner(x + w - r, y + h - r, 1, 1, true);
    const bl = corner(x + r, y + h - r, -1, 1, false), tl = corner(x + r, y + r, -1, -1, true);
    const L = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 4 * q;
    const d = from === 'top'
      ? `M${x + w / 2} ${y}H${x + w - r}${tr}V${y + h - r}${br}H${x + r}${bl}V${y + r}${tl}Z`
      : `M${x + w / 2} ${y + h}H${x + r}${bl}V${y + r}${tl}H${x + w - r}${tr}V${y + h - r}${br}Z`;
    return { d, L, q };
  }
  // The K of a box's top-left corner-shape (superellipse(K), round = 1, squircle = 2); 1 for anything else.
  function cornerK(el) {
    const v = getComputedStyle(el).getPropertyValue('corner-top-left-shape').trim();
    if (!v || v === 'round') return 1;
    if (v === 'squircle') return 2;
    const m = /^superellipse\(\s*([\d.]+)\s*\)$/.exec(v);
    return m ? Math.max(0.5, Math.min(4, Number(m[1]))) : 1;
  }
  // Show only the part of a closed path within s of position c, both ways round.
  function lit(el, L, c, s) {
    if (s <= 0.01) { el.style.visibility = 'hidden'; return; }
    el.style.visibility = '';
    if (s >= L / 2) { el.style.strokeDasharray = ''; el.style.strokeDashoffset = ''; return; }
    el.style.strokeDasharray = `${(2 * s).toFixed(2)} ${(L - 2 * s).toFixed(2)}`;
    el.style.strokeDashoffset = String(-((((c - s) % L) + L) % L).toFixed(2));
  }

  // ---------------------------------------------------------------- the page: the main conversation and its composer
  function findContent() {
    if (content?.isConnected) return content;
    content = [...document.querySelectorAll('[data-conversation-content]')].find((e) => !e.closest('[data-sidebar-chat]')) ?? null;
    return content;
  }
  function attachRing(cd) {
    card = cd;
    root?.removeAttribute('data-dshmu-ring-root');
    root = cd?.parentElement ?? null;
    if (!root) { ring.svg?.remove(); return; }
    if (!ring.svg) {
      ring.svg = document.createElementNS(NS, 'svg');
      ring.svg.setAttribute('class', 'dshmu-ring');
      ring.svg.setAttribute('aria-hidden', 'true');
      ring.line = document.createElementNS(NS, 'path');
      ring.svg.append(ring.line);
    }
    root.setAttribute('data-dshmu-ring-root', '');
    root.append(ring.svg);
  }
  function setHold(dock) {
    if (hold === dock) return;
    hold?.removeAttribute('data-dshmu-hold');
    hold = dock;
    hold?.setAttribute('data-dshmu-hold', '');
  }

  // DSH swaps the composer between the centre and the bottom without motion; the music playing, it glides instead.
  function glide(ms) {
    const seat = card?.closest('[data-composer-seat]');
    if (!seat || cardTop === null) return;
    flip?.seat.style.removeProperty('transform');
    const dy = cardTop - card.getBoundingClientRect().top;
    if (Math.abs(dy) < 4) { flip = null; return; }
    flip = { seat, dy, t0: performance.now(), ms };
    seat.style.transform = `translateY(${dy.toFixed(1)}px)`;
  }
  function phaseChanged(from, to, playing) {
    if (!playing) return;
    if (from === 'hero' && to !== 'hero' && ring.k > 0.05) {
      ring.anim = { kind: 'retract', t0: performance.now(), edgeAt: null };
      setHold(root?.querySelector(':scope > [data-composer-dock]') ?? null);
      glide(560);
    } else if (to === 'hero' && from !== 'hero') {
      if (performance.now() - leftNone < 600) return;   // from a page with no conversation: the ring fades in (frame)
      ring.anim = { kind: 'grow', t0: performance.now() };
      ring.k = 1;
      glide(620);
    }
  }

  // ---------------------------------------------------------------- the window's edge
  function edgeTo(kind, ms) {
    edge.anim = { kind, t0: performance.now(), s0: edge.s, o0: edge.o, ms };
  }
  function edgeElements() {
    if (edge.svg) return;
    // the instance before this one (the plugin reloading) leaves its lit edge up for this one to go on with
    const ghost = globalThis.__dshmuEdge;
    if (ghost) {
      delete globalThis.__dshmuEdge;
      clearTimeout(ghost.timer);
      if (ghost.svg.isConnected) { edge.svg = ghost.svg; edge.line = ghost.svg.firstChild; edge.css = ghost.css; edge.css.style.transition = ''; return; }
    }
    edge.svg = document.createElementNS(NS, 'svg');
    edge.svg.setAttribute('class', 'dshmu-edge');
    edge.svg.setAttribute('aria-hidden', 'true');
    edge.line = document.createElementNS(NS, 'path');
    edge.svg.append(edge.line);
    edge.css = document.createElement('div');
    edge.css.className = 'dshmu-edge-css';
    edge.css.setAttribute('aria-hidden', 'true');
    document.body.append(edge.svg, edge.css);
  }
  function hideEdge() {
    edgeOut = 0;
    if (edge.svg && (edge.svg.style.display !== 'none' || edge.css.style.display !== 'none')) { edge.svg.style.display = 'none'; edge.css.style.display = 'none'; }
    dshmuCaption();
  }
  function paintEdge(now, level) {
    if (edge.o <= 0.001 && !edge.anim) { hideEdge(); return; }
    edgeElements();
    const W = innerWidth, H = innerHeight, rr = roundRect(0.75, 0.75, W - 1.5, H - 1.5, 8, 'bottom');
    if (edge.anim) {
      const t = now - edge.anim.t0, a = edge.anim;
      if (a.kind === 'in') {
        const bottom = (W / 2) / (rr.L / 2);
        // from nothing: a moment along the bottom, then quickly up both sides; part-way (it was drawing back): on from there
        edge.s = a.s0 < 0.02
          ? (t < 300 ? bottom * out3(t / 300) : bottom + (1 - bottom) * easeIO(seg(t, 340, 1000)))
          : a.s0 + (1 - a.s0) * easeIO(seg(t, 0, 600));
        edge.o = a.o0 + (1 - a.o0) * smooth(seg(t, 0, 220));
        if (t >= (a.s0 < 0.02 ? 1000 : 600)) { edge.s = 1; edge.o = 1; edge.anim = null; }
      } else if (a.kind === 'out') {
        edge.s = a.s0 * (1 - easeIO(seg(t, 0, 700)));
        edge.o = a.o0 * (1 - smooth(seg(t, 450, 700)));
        if (t >= 700) { edge.s = 0; edge.o = 0; edge.anim = null; }
      } else if (a.kind === 'fadeIn') {
        edge.s = 1; edge.o = a.o0 + (1 - a.o0) * smooth(seg(t, 0, 600));
        if (t >= 600) { edge.o = 1; edge.anim = null; }
      } else {
        const ms = a.ms ?? 1200;
        edge.o = a.o0 * (1 - smooth(seg(t, 0, ms)));
        if (t >= ms) { edge.o = 0; edge.anim = null; }
      }
    }
    if (edge.o <= 0.001 && !edge.anim) { hideEdge(); return; }   // gone out this frame: the loop may sleep after it
    const o = (edge.o * (0.28 + 0.42 * level)).toFixed(3);
    edgeOut = edge.o > 0.001 ? Number(o) : 0;
    // all the way round, the edge is a plain layer whose opacity alone changes (cheap to draw every frame); on the way
    // round, the path
    if (edge.s >= 1) {
      edge.svg.style.display = 'none';
      edge.css.style.display = ''; edge.css.style.opacity = o;
    } else {
      edge.css.style.display = 'none';
      edge.svg.style.display = '';
      const size = `${W}x${H}`;
      if (edge.size !== size) { edge.size = size; edge.line.setAttribute('d', rr.d); }
      lit(edge.line, rr.L, 0, edge.s * rr.L / 2);
      edge.line.style.opacity = o;
    }
    dshmuCaption();
  }

  // ---------------------------------------------------------------- one frame
  function frame(now) {
    raf = 0;
    const dt = Math.min(50, last ? now - last : 16); last = now;
    const st = env.state(), reduced = env.reduced.matches, playing = st === 'playing' && !reduced;
    kick_ *= Math.exp(-dt / 300);
    pulse += (kick_ - pulse) * Math.min(1, dt / 45);
    const level = clamp01(pulse);

    // where the composer is, and whether DSH just moved it
    const c = findContent();
    const ph = c?.getAttribute('data-content-phase') ?? 'none';
    const cd = c?.querySelector('[data-composer-card]') ?? null;
    if (cd !== card || (cd && root !== cd.parentElement)) attachRing(cd);
    if (ph !== phase) {
      const was = phase; phase = ph;
      // no conversation on the page (the ring is gone with its card): back to one, the ring starts from nothing
      if (ph === 'none') { ring.k = 0; ring.anim = null; } else if (was === 'none') leftNone = now;
      if (was !== null && card) phaseChanged(was, ph, playing);
    }

    // the composer gliding to where DSH put it
    if (flip) {
      const k = out3(seg(now - flip.t0, 0, flip.ms));
      if (k >= 1 || !flip.seat.isConnected) { flip.seat.style.removeProperty('transform'); flip = null; }
      else flip.seat.style.transform = `translateY(${(flip.dy * (1 - k)).toFixed(1)}px)`;
    }
    if (card) cardTop = card.getBoundingClientRect().top - (flip ? flip.dy * (1 - out3(seg(now - flip.t0, 0, flip.ms))) : 0);

    // the ring
    if (card && ring.svg && !ring.anim) {
      // fade in with the music (0.6 s), out slowly when it pauses (1.2 s)
      const want = playing && phase === 'hero';
      ring.k = want ? Math.min(1, ring.k + dt / 600) : Math.max(0, ring.k - dt / 1200);
    }
    const ringShown = !!(card && ring.svg && (ring.k > 0.001 || ring.anim));
    if (ring.svg && ring.svg.style.display !== (ringShown ? '' : 'none')) ring.svg.style.display = ringShown ? '' : 'none';
    if (ringShown) {
      const x = card.offsetLeft + 0.5, y = card.offsetTop + 0.5, w = card.offsetWidth - 1, h = card.offsetHeight - 1;
      const key = `${x},${y},${w},${h}`;
      if (ringGeo?.key !== key || ringGeo.card !== card) {
        const r = Math.max(0, (parseFloat(getComputedStyle(card).borderTopLeftRadius) || 28) - 0.5);
        ringGeo = { key, card, w, h, r, rr: roundRect(x, y, w, h, r, 'top', cornerK(card)) };
        ring.line.setAttribute('d', ringGeo.rr.d);
      }
      const { rr, r } = ringGeo, half = rr.L / 2;
      let gap = 0;
      if (ring.anim?.kind === 'retract') {
        const t = now - ring.anim.t0;
        gap = easeIO(seg(t, 0, RETRACT_MS)) * half;
        // the two ends round the bottom corners: the lyric comes in, and the window's edge starts to light
        const toBottom = w / 2 - r + 2 * rr.q + (h - 2 * r);
        if (gap >= toBottom - 40) setHold(null);
        if (ring.anim.edgeAt === null && gap >= toBottom - rr.q) ring.anim.edgeAt = now;
        if (t >= RETRACT_MS) { ring.anim = null; ring.k = 0; setHold(null); }
      } else if (ring.anim?.kind === 'grow') {
        const t = now - ring.anim.t0;
        gap = (1 - easeIO(seg(t, 0, GROW_MS))) * half;
        if (t >= GROW_MS || phase !== 'hero') ring.anim = null;
      }
      lit(ring.line, rr.L, half, half - gap);
      ring.line.style.opacity = (smooth(ring.k) * (0.42 + 0.58 * level) * (ring.anim?.kind === 'retract' ? 1 - smooth(seg(now - ring.anim.t0, RETRACT_MS - 200, RETRACT_MS)) : 1)).toFixed(3);
    }

    // the window's edge
    const want = env.edgeOn() && playing && phase !== 'hero' && !(ring.anim?.kind === 'retract' && ring.anim.edgeAt === null);
    if (want !== edge.want) {
      edge.want = want;
      if (want) edgeTo(edge.s >= 1 && edge.anim?.kind !== 'out' ? 'fadeIn' : 'in');
      else if (phase === 'hero' && now - leftNone < 600) edgeTo('fadeOut', 600);   // from a page with no conversation
      else edgeTo(st === 'paused' && phase !== 'hero' && env.edgeOn() && edge.s >= 1 ? 'fadeOut' : 'out');
    }
    paintEdge(now, reduced ? 0 : level);

    const busy = playing || flip || ring.anim || ring.k > 0 || edge.anim || hold;
    if (busy) raf = requestAnimationFrame(frame);
    else { last = 0; phase = null; cardTop = null; }   // asleep: the next time starts from the page as it is then
  }
  function kick() { if (!raf && !disposed) raf = requestAnimationFrame(frame); }

  return {
    update() { if (disposed) return; colour(); kick(); },
    beat(s) { kick_ = Math.max(kick_, s); kick(); },
    // for the settings page's preview: the beat's glow (0..1), the window edge's opacity now, a composer card's ring
    level: () => clamp01(pulse),
    edgeOpacity: () => edgeOut,
    ringPath(cd) {
      const r = Math.max(0, (parseFloat(getComputedStyle(cd).borderTopLeftRadius) || 28) - 0.5);
      return roundRect(cd.offsetLeft + 0.5, cd.offsetTop + 0.5, cd.offsetWidth - 1, cd.offsetHeight - 1, r, 'top', cornerK(cd)).d;
    },
    save: () => ({ edge: edge.want && edge.s >= 1 && edge.o > 0.5, ring: ring.k > 0.5 && !ring.anim }),
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf); raf = 0;
      flip?.seat.style.removeProperty('transform');
      setHold(null);
      root?.removeAttribute('data-dshmu-ring-root');
      ring.svg?.remove();
      const clear = () => { edge.svg?.remove(); edge.css?.remove(); dshmuCaption(); document.body.style.removeProperty('--dshmu-glow-c'); };
      if (!(edge.css && edge.want && edge.s >= 1 && edge.o > 0.5)) { clear(); return; }
      // lit all the way round: left up for the next instance (the plugin reloading); faded out if none comes
      const ghost = { svg: edge.svg, css: edge.css };
      ghost.timer = setTimeout(() => {
        if (globalThis.__dshmuEdge === ghost) delete globalThis.__dshmuEdge;
        edge.css.style.transition = 'opacity .6s ease'; edge.css.style.opacity = '0';
        setTimeout(clear, 700);
      }, 2500);
      globalThis.__dshmuEdge = ghost;
    },
  };
}
