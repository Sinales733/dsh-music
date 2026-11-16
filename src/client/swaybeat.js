// 转身 to the beat: dsh-motion's official "sway" loop (the tail turning from side-on to face the viewer and back),
// played one turn per beat with the front-facing, flukes-open pose on the beat. For lively songs (mood C).
// vendor/sway-frames.js (frames 27-43 of the loop), vendor/rig-model.js and vendor/surface.js must be loaded first.
//
// The official loop is raster frames, not the rig, so it cannot start from the resting icon on its own. Like
// dsh-motion it gets there on the rig: the resting pose turns into a pose fitted to frame 28 (dsh-motion's HANDOFF.sway,
// made with its tools/fit-official.html), cross-fades into the real frame, plays, and on the way out cross-fades
// from a side-on frame into the pose fitted to frame 27 and turns back to rest.
// It never stands still: the turn into the loop starts at once and takes as long as it needs to reach frame 28 just
// as the beat brings the loop there (SW_RIG_MIN .. SW_RIG_MIN + one beat), and while the tail turns in or out on
// the rig the caller keeps the groove moving on top of the pose (makeGroove's base).
//
// API
//   const sway = makeSwayBeat();
//   sway(dt, clk, want)   clk = what makeBeatClock().step returned; want = keep playing. Returns a step:
//                         { stage: 'in' | 'play' | 'fade' | 'out', pose?: the rig pose to draw (with the groove on it),
//                           raster?: { a, b, w, alpha, fit } the real frames, tailAlpha?: the rig outline's opacity },
//                         or null once it has turned back to rest and is not wanted.
//   swayImages()          the frames as images (loaded once)
//   swDrawRaster(ctx, r, color, box)   draws fr.raster the way dsh-motion draws its official frames

const SW_TURN = 14.5;          // frames per turn of the loop (side 28 -> front -> side 42.5)
const SW_BEAT_F = 36.6;        // the front-facing frame, put on the beat
const SW_ENTER_F = 28;         // the hand-off frame (dsh-motion HANDOFF.sway.k)
const SW_RIG = 0.46, SW_FADE = 0.1;          // dsh-motion RIG_DUR / FADE (the turn back out, the cross-fades)
const SW_RIG_MIN = 0.36;                      // the quickest turn in
const SW_FIT = { s: 1.14, x: -0.25, y: 2 };  // dsh-motion OFF_FIT.sway: the official frames onto the icon's size
const SW_K = 1.75;                            // viewBox unit in canvas px (dsh-motion CV_K)
const SW_POSE = {
  in: { yaw: -0.715, pitch: -0.521, rollB: -0.333, rollT: 0.353, twist: -0.198, flexP: 0.057, dihed: 0.086, curl: -0.015, asym: -0.169, tx: -0.051, ty: -0.017, sx: 1.082, sy: 1.076, ang: 0.043 },
  out: { yaw: -0.715, pitch: -0.521, rollB: -0.291, rollT: 0.353, twist: -0.05, flexP: 0.048, dihed: 0.086, curl: -0.062, asym: -0.096, tx: -0.023, ty: -0.017, sx: 1.065, sy: 1.076, ang: 0.043 },
};
// the fitted poses moved with the frames (as dsh-motion's FITTED)
for (const d of ['in', 'out']) {
  const F = SW_POSE[d], { s, x, y } = SW_FIT;
  SW_POSE[d] = { ...F, sx: F.sx * s, sy: F.sy * s, tx: F.tx * s + x / SW_K, ty: F.ty * s + y / SW_K };
}
const swSmoother = (k) => k * k * k * (k * (k * 6 - 15) + 10);

let swImgs = null;
function swayImages() {
  if (!swImgs) swImgs = SWAY_FRAMES.map((src) => { const im = new Image(); im.src = src; return im; });
  return swImgs;
}

/** the rig between rest (k = 0) and the fitted pose of the hand-off d (k = 1) */
function swRigPose(d, k) {
  const R = sfRestPose(), F = SW_POSE[d], p = { ...R };
  for (const key in F) p[key] = (R[key] ?? 0) + (F[key] - (R[key] ?? 0)) * k;
  return p;
}

function makeSwayBeat() {
  const imgs = swayImages();
  let state = 'idle', U = 0, prev = null, debt = 0;
  let t = 0, inStart = 0, inLen = 1, inU = 0, fPrev = 0;
  // the loop's frame at beat-time U: front-facing on every beat, wrapped into 28 .. 42.5
  const frameAt = (V) => { const f = SW_BEAT_F - SW_ENTER_F + SW_TURN * V; return SW_ENTER_F + (f - SW_TURN * Math.floor(f / SW_TURN)); };
  // beat-time (mod 1) at which the loop is at the hand-off frame
  const ENTER_U = (((SW_ENTER_F - SW_BEAT_F) / SW_TURN) % 1 + 1) % 1;
  const frac = (v) => v - Math.floor(v);

  function raster(f, alpha) {
    const i = Math.floor(f), w = f - i, at = (n) => imgs[Math.max(0, Math.min(imgs.length - 1, n - SWAY_FIRST))];
    return { a: at(i), b: at(i + 1), w, alpha, fit: SW_FIT };
  }

  return function sway(dt, clk, want) {
    // own beat counter, as in makeGroove: follows the clock's phase, paying off its corrections over a moment
    if (prev !== null) {
      let d = clk.phase - prev; d -= Math.round(d);
      const run = dt / clk.period;
      debt += d - run; debt -= Math.round(debt);
      const pay = debt * (1 - Math.exp(-dt / 0.1));
      debt -= pay; U += run + pay;
    } else U = (clk.index || 0) + clk.phase;
    prev = clk.phase;
    t += dt;

    if (state === 'idle') {
      if (!want) { prev = null; return null; }
      // turn in now, slowly enough to reach the hand-off pose just as the loop comes round to frame 28
      const min = SW_RIG_MIN / clk.period;
      state = 'in'; inStart = U; inLen = min + frac(ENTER_U - U - min); inU = 0;
    }
    if (state === 'in') {
      inU = Math.max(inU, sfClamp((U - inStart) / inLen));      // never backwards, whatever the clock corrects
      if (inU < 1) return { stage: 'in', pose: swRigPose('in', swSmoother(inU)) };
      state = 'play'; t = 0; fPrev = frameAt(U);
    }
    if (state === 'play') {
      const f = frameAt(U);
      // leave on a side-on frame, where the loop wraps round (42.5 -> 28)
      if (!want && f < fPrev) { state = 'fade'; t = 0; }
      fPrev = f;
      if (state === 'play') {
        const a = sfClamp(t / SW_FADE);                     // just arrived: the fitted pose fades into the real frame
        return a < 1 ? { stage: 'play', pose: swRigPose('in', 1), tailAlpha: 1 - a, raster: raster(f, a) }
          : { stage: 'play', raster: raster(f, 1) };
      }
    }
    if (state === 'fade') {
      const a = 1 - sfClamp(t / SW_FADE);
      if (a > 0) return { stage: 'fade', pose: swRigPose('out', 1), tailAlpha: 1 - a, raster: raster(frameAt(U), a) };
      state = 'out'; t = 0;
    }
    if (state === 'out') {
      const u = sfClamp(t / SW_RIG);
      if (u < 1) return { stage: 'out', pose: swRigPose('out', 1 - swSmoother(u)) };
      state = 'idle'; prev = null;
      return null;
    }
    return null;
  };
}

// ---------------------------------------------------------------- drawing the real frames (own canvas)
// As dsh-motion's drawFrames: each 28 px alpha mask is filled with the colour (twice, the official frames came out
// of a video lighter than the built-in ones), two neighbours cross-faded, then scaled about the tail's base onto the
// icon and cut at the waterline. box = the canvas offset of the 28 px frame (dsh-motion CV_BOX).
let swScratch = null;
function swDrawRaster(ctx, r, color, box) {
  if (!r || r.alpha <= 0.002) return;
  if (!swScratch) swScratch = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = c.height = 28; return c.getContext('2d'); });
  const [xA, xB, xM] = swScratch;
  const tint = (x, img) => {
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, 28, 28);
    if (!img || !img.complete || !img.naturalWidth) return false;
    x.drawImage(img, 0, 0); x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, 28, 28);
    x.globalCompositeOperation = 'source-over';
    return true;
  };
  if (!tint(xA, r.a)) return;
  let src = xA.canvas;
  if (r.b && r.w > 0.01 && tint(xB, r.b)) {
    xM.globalCompositeOperation = 'source-over'; xM.globalAlpha = 1; xM.clearRect(0, 0, 28, 28);
    xM.globalAlpha = 1 - r.w; xM.drawImage(xA.canvas, 0, 0);
    xM.globalCompositeOperation = 'lighter'; xM.globalAlpha = r.w; xM.drawImage(xB.canvas, 0, 0);
    xM.globalCompositeOperation = 'source-over'; xM.globalAlpha = 1;
    src = xM.canvas;
  }
  const ax = box + RIG_MODEL.base[0] * SW_K, ay = box + SF_WATER * SW_K, { s, x, y } = r.fit;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath(); ctx.rect(0, 0, ctx.canvas.width, ay); ctx.clip();
  ctx.globalAlpha = r.alpha;
  ctx.setTransform(s, 0, 0, s, ax + x - s * ax, ay + y - s * ay);
  ctx.drawImage(src, box, box);
  ctx.restore();
}
