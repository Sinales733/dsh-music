// While the composer row shows a lyric, DSH's context meter (a ring, ContextMeter in dsh-client-ui-conversation) is
// hidden with the other readings. This keeps the context usage in sight as a glowing line on the composer card's
// bottom edge, centred, filled from the left by the used share. Hovering the row brings the readings back, and the line
// turns back into the ring.
// The motion (sample H in tools/samples/context-line.html): the used arc is a thread on a spool. Its 0% end leaves the
// ring at 12 o'clock, climbs a short smooth curve onto the card edge and runs left along it; the rest of the arc
// unwinds after it and the line stretches to its length on the edge. The unused part of the ring fades in place.
// The bar is centred under the card and ends where the climb meets the edge, so its right end only ever moves left.
const CTX_R = 5.5, CTX_CIRC = 2 * Math.PI * CTX_R, CTX_MS = 480;

function createContextLine(reduced, { pct: carriedPct } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const lines = new Map();            // dock element -> its line
  let ids = 0;
  // A composer DSH rebuilt while the song played on (another session, back from another page, the plugin reloading)
  // shows the line straight away instead of playing the ring-to-line motion again; the bar slides from the share the
  // last one showed to this session's.
  let lastPct = carriedPct;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const out3 = (x) => 1 - Math.pow(1 - x, 3);
  const pathOf = (list) => (list.length ? 'M' + list.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') : '');

  function lineFor(dock) {
    let ln = lines.get(dock);
    if (ln) return ln;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'dshmu-ctx');
    svg.setAttribute('aria-hidden', 'true');
    const id = `dshmu-ctx-${++ids}`;
    svg.innerHTML = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse"><stop offset="0" class="dshmu-ctx-stop" stop-opacity="0"/>` +
      `<stop offset="1" class="dshmu-ctx-stop" stop-opacity="1"/></linearGradient></defs>` +
      '<path class="dshmu-ctx-track"/><path class="dshmu-ctx-bar"/><path class="dshmu-ctx-gray"/>' +
      `<path class="dshmu-ctx-glow" style="stroke:url(#${id})"/>`;
    const [ring, bar, gray, glow] = svg.querySelectorAll('path');
    ln = { svg, grad: svg.querySelector('linearGradient'), ring, bar, gray, glow, t: 0, from: 0, target: 0, start: 0, g: null, size: '' };
    lines.set(dock, ln);
    return ln;
  }

  /** The ring, the readings row and the card edge, laid out as on hover (so the ring is where it will be shown). */
  function measure(dock) {
    const root = dock.parentElement, card = dock.previousElementSibling;
    const button = dock.querySelector(':scope > :not([data-slot]) button[aria-haspopup="dialog"]');
    const ring = button?.querySelector('svg');
    const pct = Number(/(\d+(?:\.\d+)?)\s*%/.exec(button?.textContent ?? '')?.[1]);
    if (!root || !card || !ring || !Number.isFinite(pct)) return null;
    dock.setAttribute('data-dshmu-measure', '');
    try {
      const o = root.getBoundingClientRect(), c = card.getBoundingClientRect(), r = ring.getBoundingClientRect();
      // the line is drawn in the root's own px: a scaled copy (the settings page's preview) measures smaller on screen
      const k = root.offsetWidth && Math.abs(o.width / root.offsetWidth - 1) > 0.02 ? o.width / root.offsetWidth : 1;
      let left = Infinity, right = -Infinity;
      for (const e of dock.querySelectorAll(':scope > :not([data-slot]), :scope > [data-slot] > :not(.dshmu-strip)')) {
        const b = e.getBoundingClientRect();
        if (b.width) { left = Math.min(left, b.left); right = Math.max(right, b.right); }
      }
      if (!r.width || right <= left) return null;
      const L = right - left;
      return { cx: (r.left + r.width / 2 - o.left) / k, cy: (r.top + r.height / 2 - o.top) / k, x0: (c.left + c.width / 2 - L / 2 - o.left) / k,
        y: (c.bottom - o.top) / k, L: L / k, pct: Math.max(0, Math.min(1, pct / 100)) };
    } finally { dock.removeAttribute('data-dshmu-measure'); }
  }

  function draw(ln) {
    const { g: g0, t } = ln, pct = g0.pct;
    if (t <= 0) { for (const p of [ln.ring, ln.bar, ln.gray, ln.glow]) p.setAttribute('d', ''); return; }
    // The climb: a quintic from the ring's 12 o'clock to the edge that leaves with the ring's curvature and meets the
    // edge with none. Positions are lengths w along ring (w <= 0), climb (0..C) and edge (beyond C, heading left).
    const A = pct * CTX_CIRC, top = g0.cy - CTX_R, h = Math.max(1, top - g0.y), wS = Math.max(16, 2.3 * h), ex = g0.cx - wS;
    const mid = g0.x0 + g0.L / 2, half = Math.max(20, Math.min(g0.L / 2, ex - mid));
    const g = { ...g0, x0: mid - half, L: 2 * half };
    const M = 48, bz = [], cum = [0];
    for (let i = 0; i <= M; i++) {
      const k = i / M, k2 = k * k, k3 = k2 * k, k4 = k3 * k, k5 = k4 * k;
      bz.push([g.cx - wS * k, top + (g.y - top) * (10 * k3 - 15 * k4 + 6 * k5) + wS * wS / CTX_R * (0.5 * k2 - 1.5 * k3 + 1.5 * k4 - 0.5 * k5)]);
      if (i) cum.push(cum[i - 1] + Math.hypot(bz[i][0] - bz[i - 1][0], bz[i][1] - bz[i - 1][1]));
    }
    const C = cum[M];
    const at = (w) => {
      if (w <= 0) { const th = -w / CTX_R; return [g.cx + CTX_R * Math.sin(th), g.cy - CTX_R * Math.cos(th)]; }
      if (w >= C) return [ex - (w - C), g.y];
      let i = 1; while (cum[i] < w) i++;
      const k = (w - cum[i - 1]) / (cum[i] - cum[i - 1]);
      return [bz[i - 1][0] + (bz[i][0] - bz[i - 1][0]) * k, bz[i - 1][1] + (bz[i][1] - bz[i - 1][1]) * k];
    };
    const span = (a, b) => {
      if (b <= a) return [];
      const out = [], hi = Math.min(b, C);
      if (a < hi) { const n = Math.ceil((hi - a) / 0.6); for (let i = 0; i <= n; i++) out.push(at(a + (hi - a) * i / n)); }
      else out.push(at(a));
      if (b > C) out.push(at(b));
      return out;
    };
    const WH = C + ex - g.x0, TF = C + ex - (g.x0 + pct * g.L);   // where head and tail end up
    const ta = 0.08 + 0.32 * pct;                                // the tail is on the edge by here
    const hTa = Math.min(WH * out3(ta), C + pct * g.L);          // the head never runs further than the bar is long
    let grayPts, glowPts;
    if (t < ta) {
      const H = hTa * out3(t) / out3(ta), T = -A + (A + C) * Math.pow(t / ta, 1.5);
      grayPts = span(T, Math.min(H, C)); glowPts = span(Math.max(T, 0), H);
    } else {
      const r = out3((t - ta) / (1 - ta)), H = hTa + (WH - hTa) * r, T = C + (TF - C) * r;
      grayPts = []; glowPts = [[ex - (T - C), g.y], [ex - (H - C), g.y]];
    }
    // the thread lights up as it climbs: gray on the ring, full glow on the edge
    for (const [k, v] of Object.entries({ x1: 0, x2: 0, y1: top, y2: g.y + 0.3 * h })) ln.grad.setAttribute(k, v.toFixed(2));
    const circle = [];
    for (let i = 0; i <= 64; i++) { const th = 2 * Math.PI * i / 64; circle.push([g.cx + CTX_R * Math.sin(th), g.cy - CTX_R * Math.cos(th)]); }
    ln.ring.setAttribute('d', pathOf(circle)); ln.ring.style.opacity = String(1 - ease(seg(t, 0, 0.35)));
    ln.bar.setAttribute('d', pathOf([[g.x0, g.y], [g.x0 + g.L, g.y]])); ln.bar.style.opacity = String(ease(seg(t, 0.15, 0.7)));
    ln.gray.setAttribute('d', pathOf(grayPts));
    ln.glow.setAttribute('d', pathOf(glowPts));
  }

  /**
   * Called every frame for each composer row: `line` is true while the row shows the lyric and is not hovered;
   * `still`: this composer was just rebuilt while the music went on, so the line is already there (no motion in).
   * Returns true while a transition is running (the caller keeps its frame loop going).
   */
  function update(dock, line, still = false) {
    if (!dock?.isConnected) return false;
    const ln = lineFor(dock);
    if (still) ln.still = true;
    const root = dock.parentElement;
    const target = line ? 1 : 0;
    const now = performance.now();
    if (target !== ln.target) {
      // DSH leaves the meter out while it shows other readings (and before a model reports a capacity): look again later
      if (target === 1 && now < (ln.retry ?? 0)) return false;
      const g = measure(dock);
      if (!g && target === 1) { ln.retry = now + 500; return false; }
      if (g) ln.g = g;
      if (target === 1 && !ln.shown && ln.still) {                             // carried over from the previous composer
        ln.t = 1; ln.want = ln.g.pct; ln.g = { ...ln.g, pct: lastPct ?? ln.g.pct };   // the bar slides from the old share
      }
      ln.still = false;
      ln.from = ln.t; ln.target = target; ln.start = now;
    }
    if (!ln.g) return false;
    // follow layout changes (window resize, the context share moving) while the line shows
    const size = `${root.clientWidth}x${root.clientHeight}`;
    if (ln.t === ln.target && ln.target === 1 && size !== ln.size) {
      const g = measure(dock);
      if (g) { ln.want = g.pct; ln.g = { ...g, pct: ln.g.pct }; }   // new layout, but the bar's length still slides
    }
    if (ln.t === 1 && ln.target === 1) {
      const button = dock.querySelector(':scope > :not([data-slot]) button[aria-haspopup="dialog"]');
      const pct = Number(/(\d+(?:\.\d+)?)\s*%/.exec(button?.textContent ?? '')?.[1]) / 100;
      if (Number.isFinite(pct)) ln.want = pct;
      // the bar's length follows the share smoothly
      if (ln.want !== undefined && Math.abs(ln.want - ln.g.pct) > 0.0005) {
        const k = reduced.matches ? 1 : 1 - Math.exp(-(now - (ln.last ?? now)) / 90);
        ln.g = { ...ln.g, pct: ln.g.pct + (ln.want - ln.g.pct) * k };
        if (Math.abs(ln.want - ln.g.pct) <= 0.0005) ln.g = { ...ln.g, pct: ln.want };
      }
      lastPct = ln.g.pct;
    }
    ln.last = now;
    ln.size = size;
    if (ln.t !== ln.target) {
      const span = Math.abs(ln.target - ln.from) * CTX_MS;
      const k = reduced.matches || !span ? 1 : clamp01((now - ln.start) / span);
      ln.t = ln.from + (ln.target - ln.from) * k;
      if (k >= 1) ln.t = ln.target;
    }
    if (ln.t > 0) ln.shown = true;
    if (ln.t > 0) {
      if (ln.svg.parentNode !== root) { root.setAttribute('data-dshmu-ctx-root', ''); root.append(ln.svg); }
      dock.setAttribute('data-dshmu-ctx', '');           // DSH's own ring stays hidden while ours is drawn
    } else {
      ln.svg.remove();
      dock.removeAttribute('data-dshmu-ctx');
    }
    if (ln.t !== ln.drawnT || ln.g !== ln.drawnG) { draw(ln); ln.drawnT = ln.t; ln.drawnG = ln.g; }
    return ln.t !== ln.target || (ln.t === 1 && ln.want !== undefined && ln.want !== ln.g.pct);
  }

  function forget(dock) {
    const ln = lines.get(dock);
    if (!ln) return;
    ln.svg.parentNode?.removeAttribute?.('data-dshmu-ctx-root');
    ln.svg.remove();
    dock.removeAttribute('data-dshmu-ctx');
    lines.delete(dock);
  }

  function dispose() {
    for (const dock of [...lines.keys()]) forget(dock);
    document.querySelectorAll('[data-dshmu-ctx-root]').forEach((e) => e.removeAttribute('data-dshmu-ctx-root'));
  }

  return { update, forget, dispose, pct: () => lastPct };
}
