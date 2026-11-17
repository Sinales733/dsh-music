// The capsule's beat bars and the note shown on it without a cover; shared with island.js when that is built in.
const ICON_NOTE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 11.5V3.8l6-1.3v7.4"/><circle cx="5" cy="11.6" r="1.6"/><circle cx="11" cy="10" r="1.6"/></svg>';

/** Beat bars: each beat makes every bar jump, a little after one another; between beats they breathe a little. */
function createBars(els) {
  const env = els.map(() => 0), kicks = [];
  return {
    copy(from) { from.forEach((e, k) => { if (k < env.length) env[k] = Math.max(0, Math.min(1, (parseFloat(e.style.height) - 3) / 9 || 0)); }); },
    beat(s) { const now = performance.now(); els.forEach((_, k) => kicks.push({ k, at: now + k * 32, v: Math.min(1, 0.35 + 0.65 * s) * (0.7 + Math.random() * 0.3) })); },
    step(dt, playing) {
      const now = performance.now();
      for (let i = kicks.length - 1; i >= 0; i--) if (kicks[i].at <= now) { env[kicks[i].k] = Math.max(env[kicks[i].k], kicks[i].v); kicks.splice(i, 1); }
      els.forEach((e, k) => {
        env[k] *= Math.exp(-dt / 210);
        const idle = playing ? 0.12 + 0.06 * Math.sin(now / 260 + k * 1.7) : 0;
        const hgt = (3 + 9 * Math.min(1, Math.max(idle, env[k]))).toFixed(1);
        if (e._h !== hgt) { e._h = hgt; e.style.height = `${hgt}px`; }
      });
    },
  };
}
