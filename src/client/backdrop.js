// Flowing cover background, after the Apple Music-inspired material in Lyricify-Backgrounds (Apache-2.0,
// AppleMusicIosBackground.hlsl): three copies of the cover turning at their own pace (120 s, 70 s, 90 s), the third
// riding on the first, blurred together into soft colour fields. Drawn small with Canvas 2D and stretched by CSS, so
// it costs little; the page tints it toward its own background colour so it follows the light or dark theme.
//
// createBackdrop(canvas, { time }) -> { setCover(url, onReady), setPlaying(bool), setSpeed(x), pulse(strength), resize(),
//   time(), dispose() }
//   onReady: called once the new cover is drawn (so the layer can start showing with colour already on it)
//   time / time(): where the flow is, to carry it over to a new instance (the plugin reloading) without a jump
// The flow eases to a stop when the music pauses and back up when it plays, like a turntable.
function createBackdrop(canvas, { fps = 20, time: startTime } = {}) {
  const LAYERS = [                                  // scale, translation (view units), turn period (s), rides layer 0
    { s: 1.4, x: 0, y: 0, period: 120, child: false },
    { s: 0.7, x: -0.25, y: 0.15, period: 70, child: false },
    { s: 0.7, x: 0.7, y: 0.7, period: 90, child: true },
  ];
  const BASE = 112;                                 // drawing size of the short side, in pixels
  const work = document.createElement('canvas');    // sharp layers, with a margin so the blur has no dark rim
  const out = canvas.getContext('2d', { alpha: false });
  const wctx = work.getContext('2d');
  let cur = null, prev = null, mixStart = 0, raf = 0, last = 0, time = startTime ?? Math.random() * 600, speed = 1, surge = 0, W = 0, H = 0, pad = 0;
  let flowTo = 0, flow = 0;                         // the flow's pace, easing toward flowTo (1 playing, 0 paused)
  const MIX_MS = 1200, FLOW_TAU = 0.3;              // about a second to stop or get going

  function resize() {
    const r = canvas.getBoundingClientRect();
    const ratio = r.width && r.height ? r.width / r.height : 1;
    W = ratio >= 1 ? Math.round(BASE * ratio) : BASE;
    H = ratio >= 1 ? BASE : Math.round(BASE / ratio);
    pad = Math.round(Math.min(W, H) * 0.25);
    // setting a canvas's size wipes it: leave one that is already right (taken over from the instance before this
    // one, it keeps its picture until this one has drawn)
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    work.width = W + pad * 2; work.height = H + pad * 2;
    draw();
  }

  function layers(img, alpha) {
    const cx = work.width / 2, cy = work.height / 2, u = Math.max(W, H) / 2;
    wctx.globalAlpha = alpha;
    // Fill: the cover stretched over everything, so gaps between the turning copies are its own colours.
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.drawImage(img, 0, 0, work.width, work.height);
    const a0 = (time * 2 * Math.PI) / LAYERS[0].period;
    for (const L of LAYERS) {
      const a = (time * 2 * Math.PI) / L.period;
      wctx.setTransform(1, 0, 0, 1, cx, cy);
      if (L.child) wctx.rotate(-a0);
      wctx.translate(L.x * u, -L.y * u);
      wctx.scale(L.s, L.s);
      wctx.rotate(-a);
      wctx.drawImage(img, -u, -u, 2 * u, 2 * u);
    }
  }

  function draw() {
    if (!W || !cur) return;                         // nothing until a cover is in (no grey first frame)
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.globalAlpha = 1;
    wctx.fillStyle = '#808080';
    wctx.fillRect(0, 0, work.width, work.height);
    const mix = cur ? Math.min(1, (performance.now() - mixStart) / MIX_MS) : 0;
    if (prev && mix < 1) layers(prev, 1);
    if (cur) layers(cur, prev && mix < 1 ? mix * mix * (3 - 2 * mix) : 1);
    out.filter = `blur(${Math.round(Math.min(W, H) * 0.12)}px) saturate(1.35)`;
    out.drawImage(work, -pad, -pad);
    out.filter = 'none';
    if (prev && mix >= 1) prev = null;
  }

  function frame(now) {
    raf = 0;
    if (now - last >= 1000 / fps) {
      const dt = last ? Math.min(now - last, 200) / 1000 : 0;
      surge *= Math.exp(-dt / 0.22);
      flow += (flowTo - flow) * (1 - Math.exp(-dt / FLOW_TAU));
      if (Math.abs(flowTo - flow) < 0.002) flow = flowTo;
      time += dt * speed * flow * (1 + 14 * surge);
      last = now;
      draw();
    }
    if (flow || flowTo || prev) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function setCover(url, onReady) {
    if (!url) return;
    const img = new Image();
    img.onload = () => { prev = cur; cur = img; mixStart = performance.now(); draw(); onReady?.(); kick(); };
    img.src = url;
  }
  function setPlaying(on) { flowTo = on ? 1 : 0; kick(); }
  function setSpeed(x) { speed = x; }
  // A kick in the music: the flow rushes forward for a moment and settles again (strength 0..1).
  function pulse(s) { surge = Math.max(surge, s); kick(); }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  resize();
  kick();
  return {
    setCover, setPlaying, setSpeed, pulse, resize,
    time: () => time,
    dispose() { ro?.disconnect(); if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}
