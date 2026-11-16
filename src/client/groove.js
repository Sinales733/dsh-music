// Beat-locked whale-tail motion on the dsh-motion rig (rig-model.js + surface.js must be loaded first).
// A reactive tail always moves after the kick it heard. This one runs on a beat clock instead: the clock learns the
// beat period from the kicks and keeps its phase on them, so the motion can lift before a beat and land on it.
//
// API
//   const clock = makeBeatClock();
//     clock.beat(t, strength = 1)   a kick heard at time t (seconds)
//     clock.step(dt, now)           advance; returns { phase 0..1, period (s), conf 0..1, index (beats counted) }
//   const frame = makeGroove(kind = 'rotate', sway = 'none');
//     kind   what the two flukes do:  'slap' | 'swing' | 'wave'  (GV_KINDS), or
//            'rotate'                 the three in turn (GV_ORDER), GV_TURN beats each, changing on a bar line with
//                                     a blend of the bend angles over the beat before it
//     sway   what the whole tail does about its pinned base, under the flukes (GV_SWAYS):
//            'none' | 'whip' (side to side) | 'nod' (toward / away from the viewer) | 'twist' (about its own axis)
//            | 'stir' (the tail goes round a small circle)
//     frame(dt, clk, base)   clk = what clock.step returned -> an sfEmptyFrame() with .tail = the outline path.
//                      Exactly the rest outline (sfPath(sfProject(sfRestPose()))) once clk.conf has gone to 0.
//                      base: a rig pose to move about instead of the resting one (the tail turning into another loop
//                      while the groove dies away on it, or out of one while the groove comes in); clk.tau: how fast
//                      the motion follows clk.conf (default 0.3 s)
//     frame.state()    { kind, next, mix, beat }: the fluke groove playing, the one blending in (mix 0..1), beat count
//     frame.resting()  true once the motion has died away completely (the outline is exactly the base pose)
//   makeGroove('rotate', '<sway>') is the full motion; makeGroove('slap') etc. are the flukes alone, as before.
//
// The point where the tail meets the water (RIG_MODEL.base) never moves and nothing is drawn on the water: every
// sway turns, bends or tilts the tail about that point.

function makeBeatClock() {
  let period = 0.5, phase = 0, last = -1, conf = 0, index = 0, prevPhase = 0;
  const gaps = [];
  return {
    // a kick heard at time t (seconds, on the same clock as step's now)
    beat(t, strength = 1) {
      if (last >= 0) {
        // a gap may span several beats (a kick the detector missed): read it as whole beats of the current period
        const g = t - last, n = Math.max(1, Math.round(g / period)), unit = g / n;
        if (n <= 4 && unit > 0.3 && unit < 0.95 && (gaps.length < 3 || Math.abs(unit - period) / period < 0.2)) {
          gaps.push(unit); if (gaps.length > 9) gaps.shift();
          const p = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
          period += (p - period) * 0.35;
        }
      }
      last = t;
      let err = phase > 0.5 ? phase - 1 : phase;      // > 0: the clock is past the beat already
      if (Math.abs(err) < 0.35) phase -= err * 0.4;   // pull gently; a stray off-beat kick is ignored
      if (phase < 0) phase += 1;
      conf = Math.min(1, conf + 0.2 + 0.25 * strength);
    },
    // a new song: forget the tempo heard so far, so the next song's kicks set it afresh; the clock runs on at the old
    // one meanwhile, and the period glides over to the new one as its kicks come in
    retune() { gaps.length = 0; },
    // the clock as it stands, for a new instance on the same page (the plugin reloading) to go on from
    save: () => ({ period, phase, last, conf, index, gaps: [...gaps] }),
    load(s) { ({ period, phase, last, conf, index } = s); gaps.splice(0, gaps.length, ...s.gaps); },
    step(dt, now) {
      prevPhase = phase;
      phase += dt / period;
      if (phase >= 1) { const k = Math.floor(phase); phase -= k; index += k; }   // a long step (nothing drew for a while)
      if (last < 0 || now - last > period * 2.5) conf *= Math.exp(-dt / 0.7);   // music stopped or a quiet bridge
      return { phase, period, conf, index };
    },
  };
}

// ---------------------------------------------------------------- fluke grooves
// In a fluke groove only the flukes move; what the rest of the tail does is the sway's business (further down).
// The rig's own fluke parameters (flexP, dihed, curl, asym) turn the flukes in depth, which at 14 px shows only as a
// little foreshortening. What reads is the tips travelling up and down on screen, so the motion here is a spanwise
// bend of the projected outline: each fluke point turns about the fluke root by an angle that grows toward the tip,
// and it reads the motion curve a little later the further out it sits. Root leads, tip trails and swings wider
// (a whip); the tips are the part that lands on the beat. With zero bend the outline stays as projected.
//
// Principles applied: wave action / successive breaking of joints and drag (Art Babbitt; Brian Lemay's notes),
// "the accent pose sits on the beat, the wind-up fills the gap before it" (Animator Island, Animating to Music),
// run the animation clock in beats, not seconds (Sonic Bloom, Koreographer), and whale flukes themselves: the
// tips are the flexible part and trail the centre of the fluke through each stroke (Fish 1998; Fish et al. 2006).

const GV = (() => {
  const { points, s } = SF_MODEL;
  return {
    side: points.map((q) => (q[0] < 0 ? -1 : 1)),
    // 0 at the fluke root .. 1 at the tip; zero for the whole stock
    span: points.map((q, i) => sfClamp((s[i] - 0.42) / 0.2) * Math.min(1, Math.abs(q[0]) / 7.2)),
  };
})();

/** Turn the fluke points of a projected outline about the fluke root, in place. f = 1 at the root .. 0 at the
 *  tip, so a caller can let each point read its curve a little later the further out it sits.
 *  bend(side, f) -> tip angle, + = tip up (the two flukes mirror each other);
 *  rot(f)        -> angle both flukes turn the same way (same sense as the rig's roll), optional */
function gvShape(pts, bend, rot) {
  // hinge of both flukes on screen: middle of the fluke root (between the notch and the top of the stock)
  const n = pts[SF_NOTCH], r = pts[3 + 5], l = pts[3 + 40];
  const ax = (n[0] + (r[0] + l[0]) / 2) / 2, ay = (n[1] + (r[1] + l[1]) / 2) / 2;
  for (let i = 0; i < pts.length; i++) {
    const d = GV.span[i];
    if (d <= 0) continue;
    const phi = -GV.side[i] * bend(GV.side[i], 1 - d) * Math.pow(d, 1.35) + (rot ? rot(1 - d) * d : 0);
    if (!phi) continue;
    const c = Math.cos(phi), sn = Math.sin(phi);
    const x = pts[i][0] - ax, y = pts[i][1] - ay;
    pts[i][0] = ax + x * c - y * sn; pts[i][1] = ay + x * sn + y * c;
  }
  return pts;
}

/** sfProject, except that a pitch away from the rest pitch is taken up gradually over the lower stock: with the
 *  rig's yaw a pitch would otherwise slide the two waterline points a little. Under water nothing moves at all.
 *  rest: the pitch the sways are added to (the resting pose's, or a base pose's) */
function gvProject(pose, rest = RIG_MODEL.rest.pitch) {
  const pts = sfProject(pose);
  if (pose.pitch === rest) return pts;
  const low = sfProject({ ...pose, pitch: rest }), { s } = SF_MODEL;
  for (let i = 0; i < pts.length; i++) {
    const w = sfSmooth(sfClamp(s[i] / 0.3));
    if (w < 1) { pts[i][0] = sfLerp(low[i][0], pts[i][0], w); pts[i][1] = sfLerp(low[i][1], pts[i][1], w); }
  }
  return pts;
}

// what is left of a hit, t beats after it: a damped swing that starts from rest at the extreme (the tip stops dead
// on the beat, then rebounds and settles), so a hold is never frozen
const gvRing = (t, tau, f) => { const w = SF_TAU * f; return Math.exp(-t / tau) * (Math.cos(w * t) + Math.sin(w * t) / (tau * w)); };
// one stretch between two accents: at beat-time u (0..len) after an accent of value v0, settle toward `rest`, drift
// into the wind-up `wind` (reached at `go`), then accelerate into the next accent v1, arriving exactly at len
function gvPhrase(u, len, v0, rest, wind, go, v1, tau = 0.13, f = 2.1, sharp = 2.4) {
  if (u >= go) return sfLerp(wind, v1, Math.pow(sfSeg(u, go, len), sharp));
  return sfLerp(rest, wind, sfSmooth(sfSeg(u, 0.22, go))) + (v0 - rest) * gvRing(u, tau, f);
}

const GV_KINDS = {
  // 拍: both flukes lift a little, slap down together on the beat, bounce back up and settle
  slap: {
    lag: 0.13,
    bend(U) {
      const n = Math.floor(U), u = U - n;
      const hit = (k) => (k & 1 ? -0.18 : -0.225);             // every other beat a touch lighter
      const v = gvPhrase(u, 1, hit(n), 0.012, 0.1, 0.845, hit(n + 1));
      return () => v;
    },
  },
  // 跷跷板: one fluke snaps down on a beat while the other lifts, the next beat they swap
  swing: {
    lag: 0.15,
    bend(U) {
      const one = (W) => {                                      // one fluke over two beats: down at 0, up at 1
        const w = W - 2 * Math.floor(W / 2);
        return w < 1 ? gvPhrase(w, 1, -0.23, -0.05, -0.065, 0.76, 0.085, 0.14, 1.9, 1.7)
          : gvPhrase(w - 1, 1, 0.085, 0.06, 0.105, 0.85, -0.23, 0.2, 1.4, 2.6);
      };
      const R = one(U), L = one(U + 1);
      return (side) => (side > 0 ? R : L);
    },
  },
  // 波浪: a wave runs out along both flukes without ever stopping, each crest reaching the tips on the beat
  wave: {
    lag: 0.34,
    bend(U) {
      return (side) => {
        const V = U - (side < 0 ? 0.035 : 0);                   // the two flukes a hair apart, like two hands
        const u = V - Math.floor(V);
        // falls for two thirds of the beat, then sweeps up into the crest: slow out, fast in
        const ps = u < 0.66 ? 0.5 * (u / 0.66) : 0.5 + 0.5 * ((u - 0.66) / 0.34);
        return -0.05 + 0.13 * Math.cos(SF_TAU * ps) + 0.02 * Math.cos(SF_TAU * 2 * ps);
      };
    },
  },
};

// ---------------------------------------------------------------- whole-tail sways
// The tail as a whole swings under the fluke grooves, always about the pinned base. Each sway is a curve in beats
// that the tail reads at two moments: the stock `lag` beats ahead, the flukes on time. So the stock leads, the
// flukes trail behind it and are thrown a little further (a whip), and it is the fluke tips that arrive on the beat.
// A sway adds to the pose for sfProject and, where the trailing shows in the screen plane, returns a turn of the
// flukes for gvShape. `a` (0..1) scales everything; at 0 the pose is the rest pose.

// the same throw for everything that changes side every beat: +1 on even beats, -1 on odd ones
const gvAlt = (V) => {
  const n = Math.floor(V), s = n & 1 ? -1 : 1;
  return gvPhrase(V - n, 1, s, 0.52 * s, 0.66 * s, 0.56, -s, 0.14, 1.7, 2.1);
};
// beat-time that leaves a beat slowly and arrives at the next one fast
const gvLate = (V) => V + 0.5 * (Math.cos(SF_TAU * V) - 1) / SF_TAU;

const GV_SWAYS = {
  none: null,
  // 左右甩: the stock bends to one side, the next beat to the other (a pendulum on its head); the bottom of the
  // stock does not move at all, the bend grows from there up to the fluke root
  whip(U, a, p) {
    const lag = 0.17, A = 0.115 * a, root = gvAlt(U + lag);
    p.rollT += A * root;
    return (f) => { const v = gvAlt(U + lag * f); return A * (0.65 * (v - root) + 0.3 * v); };
  },
  // 前后点: the tail tips away from the viewer on the beat (it gets shorter) and rises back toward the viewer
  // between beats; the flukes stroke after it (flexP) and their tips curl
  nod(U, a, p) {
    const lag = 0.15, hit = (k) => (k & 1 ? -0.78 : -1);
    const cv = (V) => { const n = Math.floor(V); return gvPhrase(V - n, 1, hit(n), 0.05, 0.36, 0.72, hit(n + 1), 0.15, 1.8, 1.9); };
    const root = cv(U + lag), tip = cv(U);
    p.pitch += 0.17 * a * root;
    const fl = 0.17 * a * (1.3 * (tip - root) + 0.55 * tip);
    p.flexP += fl; p.curl += 0.7 * fl;
    return null;
  },
  // 扭: the tail twists about its own axis like wringing a towel, one way on a beat and back on the next. The
  // twist is zero at the water and grows with height; the flukes turn last (asym) and furthest
  twist(U, a, p) {
    const lag = 0.17, T = 0.25 * a, root = gvAlt(U + lag), tip = gvAlt(U);
    p.twist += T * root; p.yaw += 0.8 * T * root;           // sfProject: yaw + twist * (s - 0.8), so T * root * s
    p.asym += T * (0.8 * (tip - root) + 0.3 * tip);
    return null;
  },
  // 画圈: side to side and toward / away a quarter turn apart, so the fluke root goes round a small flat circle
  // once every two beats without ever stopping; it is furthest out to one side on every beat
  stir(U, a, p) {
    const lag = 0.2, A = 0.088 * a, P = 0.19 * a;
    const W0 = Math.PI * gvLate(U + lag), W1 = Math.PI * gvLate(U), c0 = Math.cos(W0);
    p.rollT += A * c0;
    p.pitch += P * Math.sin(W0);
    p.flexP += P * (1.2 * (Math.sin(W1) - Math.sin(W0)) + 0.4 * Math.sin(W1));
    return (f) => { const v = Math.cos(Math.PI * gvLate(U + lag * f)); return A * (0.65 * (v - c0) + 0.3 * v); };
  },
};

// ---------------------------------------------------------------- taking turns
const GV_ORDER = ['slap', 'swing', 'wave'];
const GV_TURN = 16;               // beats each groove plays (4 bars of 4); the last one of them blends into the next

function makeGroove(kind = 'rotate', sway = 'none') {
  if (kind !== 'rotate' && !GV_KINDS[kind]) throw new Error(`makeGroove: unknown kind "${kind}"`);
  if (!(sway in GV_SWAYS)) throw new Error(`makeGroove: unknown sway "${sway}"`);
  const S = GV_SWAYS[sway];
  const REST = sfPath(sfProject(sfRestPose()));
  let U = 0, prev = null, debt = 0, amp = 0, lastA = 0;
  // which groove plays at beat-time U, which one is coming, and how far in it is (0 until the last beat of a turn)
  const turn = () => {
    if (kind !== 'rotate') return { kind, next: kind, mix: 0 };
    const k = Math.floor(U / GV_TURN), n = GV_ORDER.length;
    return { kind: GV_ORDER[((k % n) + n) % n], next: GV_ORDER[(((k + 1) % n) + n) % n], mix: sfSmooth(sfClamp(U - k * GV_TURN - (GV_TURN - 1))) };
  };
  function frame(dt, clk, base = null) {
    // own beat counter: follows the clock's phase, but pays off its corrections (and a moved lead slider) over a
    // moment instead of jumping. It starts on the clock's beat index, so turns change on the clock's bar lines.
    if (prev !== null) {
      let d = clk.phase - prev; d -= Math.round(d);
      const run = dt / clk.period;
      debt += d - run; debt -= Math.round(debt);
      const pay = debt * (1 - Math.exp(-dt / 0.1));
      debt -= pay; U += run + pay;
    } else U = (clk.index || 0) + clk.phase;
    prev = clk.phase;
    amp += (clk.conf - amp) * (1 - Math.exp(-dt / (clk.tau ?? 0.3)));
    const a = sfSmooth(sfSeg(amp, 0.04, 0.7));                  // exactly the rest pose once the beat is gone
    lastA = a;
    const fr = sfEmptyFrame();
    if (a <= 0) { fr.tail = base ? sfPath(sfProject(base)) : REST; return fr; }
    const pose = base ? { ...base } : sfRestPose();
    const rot = S ? S(U, a, pose) : null;
    const { kind: k0, next: k1, mix } = turn();
    const K0 = GV_KINDS[k0], K1 = GV_KINDS[k1];
    // every point reads the curve at its own moment: the tip at U, the root `lag` beats ahead of it
    const bend = mix <= 0 ? (side, f) => a * K0.bend(U + K0.lag * f)(side)
      : (side, f) => a * sfLerp(K0.bend(U + K0.lag * f)(side), K1.bend(U + K1.lag * f)(side), mix);
    fr.tail = sfPath(gvShape(gvProject(pose, base ? base.pitch : undefined), bend, rot));
    return fr;
  }
  frame.state = () => ({ ...turn(), beat: Math.floor(U) });
  frame.resting = () => lastA <= 0;                // back on the base pose (the resting one) exactly
  return frame;
}
