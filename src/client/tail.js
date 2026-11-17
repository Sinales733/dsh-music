// The whale tail in the running indicator, moving to the beat of the music. The motion itself is in groove.js
// (makeBeatClock: the beat period and phase learned from the kicks; makeGroove: the flukes' and whole tail's motion on the
// dsh-motion rig, vendor/rig-model.js + vendor/surface.js). This file puts it on screen:
//   - with dsh-motion installed, as its guest loop (globalThis.__dshWhaleGuest): dsh-motion hands the tail over at
//     the resting pose between two of its loops and takes it back the same way, so neither change shows;
//   - without it, on a canvas of our own laid over the built-in icon, the same size and place dsh-motion uses.
// It never waits at rest: when the music stops, or its beat goes unclear (a quiet intro or bridge), the motion dies
// away quickly and the tail goes back to dsh-motion's own loops (or DSH's own icon), to be taken again once the beat
// is back. A song change is the exception: the tail sways on lightly through the gap at the last tempo and moves over
// to the next song's beat as it comes in. Lively songs (mood C, measured by the host) get dsh-motion's 转身 instead, one turn per beat
// (swaybeat.js); between the two, the groove dies away (or comes in) on the tail while it turns into (or out of) it.
const TAIL_KIND = 'rotate', TAIL_SWAY = 'whip';   // the three fluke moves in turn, the whole tail swinging side to side
const BEAT_LATENCY = 0.08;          // seconds from a kick in the speakers to its event reaching the page
const TAIL_K = 1.75, TAIL_BOX = 10, TAIL_SIZE = 48;   // dsh-motion's canvas geometry (viewBox unit = 1.75 px)
const TAIL_CSS = `
[data-chat-running] [class*="runningIcon"].dshmu-tail, [data-dshmu-pv-running] [class*="runningIcon"].dshmu-tail { overflow: visible !important; contain: none !important; }
[data-chat-running] [class*="runningIcon"].dshmu-tail > [class*="runningWhale"], [data-dshmu-pv-running] [class*="runningIcon"].dshmu-tail > [class*="runningWhale"] { display: none !important; }
.dshmu-whale { position: absolute; left: -35.7143%; top: -35.7143%; width: 171.4286%; height: 171.4286%; pointer-events: none; }
`;

function createTail(wanted, mood = () => null, carried = null) {
  const clock = makeBeatClock();
  if (carried) { clock.load(carried.clock); }   // the plugin reloaded: go on with the beat it had
  const motion = makeGroove(TAIL_KIND, TAIL_SWAY);
  const sway = typeof makeSwayBeat === 'function' ? makeSwayBeat() : null;
  let beating = false, swaying = false, carry = carried?.carry ?? 0, clockAt = carried?.clockAt ?? -1, disposed = 0;
  const now = () => performance.now() / 1000;
  // The clock runs on the wall clock, whether or not a whale is on screen, so a whale shown again (another session,
  // the AI starting again) picks up on the beat where the music is.
  function clockNow() {
    const t = now(), dt = clockAt < 0 ? 0 : Math.min(t - clockAt, 60);
    clockAt = t;
    return clock.step(dt, t);
  }
  const SONG_CARRY = 12;              // seconds the tail sways on between two songs, waiting for the next one's beat
  const confident = () => clockNow().conf > 0.3 || now() < carry;

  // One step of the motion; null once it is back at rest with no clear beat. raster: the one drawing it can draw
  // the official frames (our own canvas; dsh-motion from the version that sets __dshWhaleRaster)
  function frame(dt, raster = true) {
    const clk = clockNow();
    const on = wanted(), t = now();
    if (on && clk.conf > 0.3) beating = true;               // a little hysteresis, so a missed kick does not let go
    else if (!on || (clk.conf < 0.15 && t >= carry)) beating = false;
    // between two songs the beat is gone for a while: sway on lightly at the last tempo until the next song's kicks
    // set the clock again (its period glides over to the new tempo, so the motion follows smoothly)
    const light = beating && t < carry && clk.conf < 0.3;
    const lively = !!sway && raster && beating && !light && mood() === 'C';
    const step = swaying || lively ? sway(dt, clk, lively) : null;
    swaying = !!step;
    // the groove: full while it plays on its own; dying away while the tail turns into the 转身 and gone while that
    // plays; coming back in on the tail as it turns back out, if the beat goes on. It always counts the beats, so
    // it picks up on the beat again.
    const g = step ? step.stage === 'out' && beating : beating;
    const fr = motion(dt, { ...clk, conf: g ? (light ? 0.5 : 1) : 0, tau: g ? (light ? 1 : 0.3) : 0.15 }, step?.pose ?? null);
    if (step) {
      if (!step.pose) fr.tail = null;
      fr.raster = step.raster ?? null;
      fr.tailAlpha = step.tailAlpha ?? 1;
      return fr;
    }
    return !beating && motion.resting() ? null : fr;
  }
  // dsh-motion draws a whale in every running indicator, and each one asks for a frame: with two sessions at work
  // (split view) that is two calls per screen refresh. Step once per refresh and hand every whale the same picture
  // (a copy each: dsh-motion takes a frame apart as it draws it).
  // The same refresh: the same animation-frame time, and asked within a few milliseconds (a stale timeline time,
  // as in a page that gets no animation frames, never holds the motion).
  let shared = { stamp: null, at: -1e9, fr: null };
  const guest = {
    wants: () => wanted() && confident(),
    frame: (dt) => {
      // replaced by a new instance (the plugin reloading): a whale still playing this one goes on with that one's
      // frames; until it is there, this one keeps going on its own for a moment
      if (disposed) {
        const next = globalThis.__dshWhaleGuest;
        if (next && next !== guest) return next.frame(dt);
        if (now() - disposed > 3) return null;
      }
      const stamp = document.timeline?.currentTime ?? null, at = performance.now();
      if (stamp === null || stamp !== shared.stamp || at - shared.at > 12) shared = { stamp, at, fr: frame(dt, !!globalThis.__dshWhaleRaster) };
      return shared.fr && Object.assign(sfEmptyFrame(), shared.fr);
    },
  };
  globalThis.__dshWhaleGuest = guest;

  // ---------------------------------------------------------------- our own canvas, when dsh-motion is not there
  const own = new Map();            // icon host -> { canvas, ctx }
  let raf = 0, last = 0;
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-whale-music';
  style.textContent = TAIL_CSS;
  document.head.append(style);

  function tick(t) {
    raf = 0;
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
    last = t;
    const hosts = [...document.querySelectorAll(':is([data-chat-running], [data-dshmu-pv-running]) [class*="runningIcon"]')]
      .filter((h) => !h.querySelector('.dshm-whale'));          // dsh-motion draws this one; it asks us as its guest
    const active = own.size > 0 || (hosts.length && guest.wants());
    const fr = active ? frame(dt) : null;
    for (const h of hosts) {
      if (fr && !own.has(h)) {
        const canvas = document.createElement('canvas');
        canvas.className = 'dshmu-whale';
        canvas.width = canvas.height = TAIL_SIZE;
        h.classList.add('dshmu-tail');
        h.append(canvas);
        own.set(h, { canvas, ctx: canvas.getContext('2d') });
      }
      const o = own.get(h);
      if (!o) continue;
      if (!fr) { o.canvas.remove(); h.classList.remove('dshmu-tail'); own.delete(h); continue; }
      o.ctx.setTransform(1, 0, 0, 1, 0, 0);
      o.ctx.clearRect(0, 0, TAIL_SIZE, TAIL_SIZE);
      const color = getComputedStyle(h).color;
      if (fr.raster) swDrawRaster(o.ctx, fr.raster, color, TAIL_BOX);
      o.ctx.setTransform(TAIL_K, 0, 0, TAIL_K, TAIL_BOX, TAIL_BOX);
      sfDraw(o.ctx, fr, color, fr.tailAlpha ?? 1);
    }
    for (const [h, o] of own) if (!h.isConnected) { o.canvas.remove(); own.delete(h); }
    if (own.size || (hosts.length && wanted())) raf = requestAnimationFrame(tick);
    else last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  return {
    beat(strength) { clockNow(); clock.beat(now() - BEAT_LATENCY, strength); kick(); },
    // the song changed: keep the tail going through the gap, and let the next song's kicks set the tempo afresh
    songChange() { if (beating) carry = now() + SONG_CARRY; clock.retune(); kick(); },
    kick,
    save: () => ({ clock: clock.save(), clockAt, carry }),
    dispose() {
      disposed = now();
      if (globalThis.__dshWhaleGuest === guest) delete globalThis.__dshWhaleGuest;
      if (raf) cancelAnimationFrame(raf);
      for (const [h, o] of own) { o.canvas.remove(); h.classList.remove('dshmu-tail'); }
      own.clear();
      style.remove();
    },
  };
}
