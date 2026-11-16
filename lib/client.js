window.__ModuleLoader__.load({
	id: "dsh-music",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// The browser half of the "dshMusic" Remote: a hand-written equivalent of what dsh-typert-generator emits
		// (createTypertRemoteInfo from @deepseek-ai/dsh-typert-protocol/remote-info, condensed), mounted with
		// ctx.remote.$mount(). Stream items and results are plain JSON, so the result codecs only accept anything.
		const zod = require('zod');

		const PKG = 'dsh-music';
		const anyResult = (endpoint, description) => ({ mode: 'strict', typeSymbol: `${PKG}#${endpoint}:result`, create: () => zod.z.unknown(), description, jsonSchema: {} });
		const stringParam = (endpoint, name, description) => {
		  const codec = { mode: 'strict', typeSymbol: `${PKG}#${endpoint}:${name}`, create: () => zod.z.string(), jsonSchema: { type: 'string' } };
		  return { name, description, source: 'json', codec, strictCodec: codec };
		};

		const SPEC = {
		  package: PKG,
		  methods: {
		    'dshMusic/watch': {
		      service: 'dshMusic', description: 'Now playing, lyrics and volume state, replayed on open and then live.',
		      mode: 'stream', invocation: { kind: 'direct' }, parameters: [], cancellation: { parameter: 'signal' },
		      result: anyResult('dshMusic/watch', 'state and lyrics events'),
		    },
		    'dshMusic/command': {
		      service: 'dshMusic', description: 'AI state changes and player controls.',
		      invocation: { kind: 'direct' }, parameters: [stringParam('dshMusic/command', 'action', 'ai-busy, ai-idle, play, pause, toggle, next, prev, duck or unduck')],
		      cancellation: { parameter: 'signal' },
		      result: anyResult('dshMusic/command', 'whether the action was understood'),
		    },
		  },
		};

		class NamedInput {
		  constructor(parameters, strict) { this.parameters = parameters; this.strict = strict; }
		  codec(p) { return this.strict ? p.strictCodec : p.codec; }
		  create = () => (this.schema ??= zod.z.strictObject(Object.fromEntries(this.parameters.map((p) => [p.wire, this.codec(p).create().nonoptional()]))));
		  get jsonSchema() {
		    return { type: 'object', properties: Object.fromEntries(this.parameters.map((p) => [p.wire, { ...this.codec(p).jsonSchema, description: p.description }])), required: this.parameters.map((p) => p.wire), additionalProperties: false };
		  }
		}

		class RemoteInfo {
		  constructor(spec) { this.spec = spec; }
		  get package() { return this.spec.package; }
		  get descriptors() { return this.resolve().descriptors; }
		  get methods() { return this.resolve().methods; }
		  resolve() {
		    if (this.index) return this.index;
		    const descriptors = [], methods = Object.create(null);
		    for (const [endpoint, def] of Object.entries(this.spec.methods)) {
		      const cut = endpoint.indexOf('/');
		      const namespace = endpoint.slice(0, cut), method = endpoint.slice(cut + 1);
		      const parameters = def.parameters.map((p) => ({ ...p, wire: p.wire ?? p.name }));
		      const d = { ...def, id: `${this.spec.package}#${endpoint}`, namespace, method, parameters };
		      const inputs = [];
		      methods[endpoint] = Object.assign(d, {
		        input: (o) => (inputs[o?.strict === true ? 1 : 0] ??= new NamedInput(parameters, o?.strict === true)),
		        invoke(remote, input, signal) {
		          const values = parameters.map((p) => input[p.wire]);
		          if (def.cancellation) values.push(signal);
		          const receiver = Reflect.get(remote, namespace);
		          return Reflect.get(receiver, method).apply(receiver, values);
		        },
		      });
		      descriptors.push(d);
		    }
		    return (this.index = { descriptors, methods });
		  }
		}

		const MUSIC_REMOTE = new RemoteInfo(SPEC);

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

		// Generated by rig/fit.py �� 3D whale-tail model fitted to the built-in outline. Do not edit.
		const RIG_MODEL = {"base": [6.885, 13.742], "knee": [0.18, 0.42], "points": [[2.1648, -0.0016, 0.0], [2.5462, -1.51, -0.0004], [2.0344, -3.6863, -0.0001], [1.3734, -4.6359, -0.0], [1.0082, -5.3867, 0.0002], [0.9886, -6.0534, 0.0002], [1.5413, -6.1487, -0.4709], [3.3841, -6.7788, -0.4777], [4.2735, -7.2531, -0.4309], [4.9285, -7.6921, -0.3103], [6.0607, -8.4485, -0.1513], [6.8386, -9.8354, -0.0521], [7.1885, -10.8489, -0.0112], [7.2554, -11.0282, 0.0068], [7.069, -11.143, 0.0291], [6.9179, -11.0664, 0.0661], [5.8869, -10.5186, 0.1101], [4.6929, -10.6348, 0.1337], [3.4987, -10.6507, 0.1184], [2.0883, -10.6563, 0.0665], [0.8233, -10.0037, 0.0091], [0.2285, -9.6087, -0.0382], [0.0745, -9.5058, -0.0788], [-0.1082, -9.5465, -0.0788], [-0.1419, -9.6861, -0.0382], [-0.5374, -10.6821, 0.0091], [-1.905, -11.3309, 0.0665], [-4.0535, -11.0106, 0.1184], [-5.1383, -10.8464, 0.1337], [-6.1247, -11.0136, 0.1101], [-6.67, -11.2182, 0.0661], [-6.8127, -11.2576, 0.0291], [-7.0008, -11.1758, 0.0068], [-7.047, -11.0305, -0.0112], [-7.3238, -10.0486, -0.0521], [-7.4806, -8.0805, -0.1513], [-3.6684, -6.8861, -0.3103], [-3.0167, -6.6776, -0.4309], [-2.4376, -6.5536, -0.4777], [-1.9529, -5.8045, -0.4709], [-1.4515, -5.568, 0.0002], [-1.4988, -4.4487, 0.0002], [-1.3157, -4.3275, -0.0], [-1.7135, -2.4827, -0.0001], [-1.7151, -1.6541, -0.0004], [-2.1648, 0.0016, 0.0]], "s": [-0.0, 0.1186, 0.2326, 0.3386, 0.375, 0.438, 0.4567, 0.4908, 0.5084, 0.5306, 0.6349, 0.7463, 0.8119, 0.8222, 0.8292, 0.8244, 0.802, 0.8024, 0.8107, 0.8142, 0.7654, 0.7169, 0.71, 0.71, 0.7169, 0.7654, 0.8142, 0.8107, 0.8024, 0.802, 0.8244, 0.8292, 0.8222, 0.8119, 0.7463, 0.6349, 0.5306, 0.5084, 0.4908, 0.4567, 0.438, 0.375, 0.3386, 0.2326, 0.1186, -0.0], "rest": {"yaw": -0.46469391334349025, "pitch": -0.32070425005395803, "rollB": -0.15598880189699324, "rollT": 0.20289452554434081}};

		// Surface loops for the "Deep diving" whale tail. The flat cut at the bottom of the built-in icon is the
		// waterline (SF_WATER): the tail model's stock is continued below it and everything under the line is
		// clipped, so the tail only ever rises out of / slides into the water. The water itself is not drawn; it
		// shows only where something touches it (ripples, collars, drips, bubbles, blows).
		// RIG_MODEL (rig-model.js) is the built-in outline lifted into 3D: 46 cubic control points of a
		// mirror-symmetric tail whose rest pose projects exactly onto the icon. Loops: surface-anims.js (SF_DEFS);
		// the spout's blow: noto-blow.js.
		
		const SF_WATER = 13.742;
		const SF_TAU = Math.PI * 2;
		const SF_SR = 120;
		const sfClamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
		const sfSeg = (t, a, b) => sfClamp((t - a) / (b - a));
		const sfSmooth = (k) => k * k * (3 - 2 * k);
		const sfEaseIn = (k) => k * k;
		const sfEaseOut = (k) => 1 - (1 - k) * (1 - k);
		const sfEaseOut3 = (k) => 1 - Math.pow(1 - k, 3);
		const sfEaseInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
		const sfBackOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
		const sfBump = (t, a, b) => Math.sin(Math.PI * sfSeg(t, a, b));
		const sfLerp = (a, b, k) => a + (b - a) * k;
		/** 0 outside [a, b], eases in and out inside: envelope for small "alive" motions during holds */
		const sfEnv = (t, a, b, edge = 0.25) => sfSmooth(sfSeg(t, a, a + edge)) * (1 - sfSmooth(sfSeg(t, b - edge, b)));
		
		// ---------------------------------------------------------------- tail model (stock continued under water)
		const SF_MODEL = (() => {
		  const P = RIG_MODEL.points, S = RIG_MODEL.s;
		  // right line: deep → just below p0 (keeps the tangent at p0); left line: just below p45 → deep
		  const r = [[2.9, 7.2, 0], [2.24, 3.4, 0], [2.012, 0.602, 0]];
		  const l = [[-2.345, 0.664, 0], [-2.66, 3.4, 0], [-3.2, 7.2, 0]];
		  return { points: [...r, ...P, ...l], s: [-0.5, -0.3, -0.1, ...S, -0.1, -0.3, -0.5] };
		})();
		// indices into the projected outline: fluke tips, trailing-edge notch, a point on each lower (leading) edge
		const SF_TIP_R = 3 + 13, SF_TIP_L = 3 + 32, SF_NOTCH = 3 + 22, SF_EDGE_R = 3 + 9, SF_EDGE_L = 3 + 37;
		
		/** Default pose = the original icon. All angles in radians, lengths in 16-unit viewBox units. */
		function sfRestPose() {
		  const r = RIG_MODEL.rest;
		  return {
		    yaw: r.yaw, pitch: r.pitch, rollB: r.rollB, rollT: r.rollT,
		    twist: 0,        // extra yaw at the flukes relative to the base (stock twists like a rope)
		    flexP: 0,        // flukes pitch about their span axis (fluke stroke)
		    dihed: 0,        // flukes fold toward (+) / away from (−) the viewer (wing dihedral)
		    curl: 0,         // tips curl, grows with |x|
		    asym: 0,         // both flukes roll the same way about the stock (one tip rises, the other drops)
		    tx: 0, ty: 0, sx: 1, sy: 1,
		    ang: 0,          // rotation in the screen plane about the base
		  };
		}
		
		/** Project the extended tail: fold / flex the flukes, yaw (with twist along the height), pitch, roll
		 *  bending from base to flukes, then squash/stretch about the base, rotation `ang` and translation. */
		function sfProject(p) {
		  const { base, knee } = RIG_MODEL;
		  const { points, s } = SF_MODEL;
		  const out = new Array(points.length);
		  const cP = Math.cos(p.pitch), sP = Math.sin(p.pitch);
		  const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
		  for (let i = 0; i < points.length; i++) {
		    let [x, y, z] = points[i];
		    const si = s[i];
		    const w = Math.min(1, Math.max(0, (si - knee[0]) / (knee[1] - knee[0])));   // stock → fluke
		    const fl = Math.min(1, Math.max(0, (si - 0.42) / 0.2));                     // fluke membership
		    if (fl > 0) {
		      const ax = Math.min(1, Math.abs(x) / 7);
		      // dihedral (each fluke hinges about a vertical line at its root) and asym
		      const fold = p.dihed * Math.sign(x) + p.asym;
		      if (fold) {
		        const a = fold * fl * Math.pow(ax, 0.5);
		        const c = Math.cos(a), sn = Math.sin(a);
		        const x0 = x, z0 = z;
		        x = x0 * c + z0 * sn;
		        z = -x0 * sn + z0 * c;
		      }
		      // chordwise flex: flukes pitch about the span axis through the root (y ≈ -6)
		      const f = (p.flexP + p.curl * ax * ax) * fl;
		      if (f) {
		        const yr = -6.2, dy = y - yr, c = Math.cos(f), sn = Math.sin(f);
		        y = yr + dy * c - z * sn;
		        z = dy * sn + z * c;
		      }
		    }
		    const yaw = p.yaw + p.twist * (si - 0.8);
		    const cy = Math.cos(yaw), sy = Math.sin(yaw);
		    let X = x * cy + z * sy, Z = -x * sy + z * cy, Y = y;
		    const Y2 = Y * cP - Z * sP;
		    Z = Y * sP + Z * cP; Y = Y2;
		    const roll = p.rollB + (p.rollT - p.rollB) * w;
		    const cr = Math.cos(roll), sr = Math.sin(roll);
		    let px = X * cr - Y * sr, py = X * sr + Y * cr;
		    px *= p.sx; py *= p.sy;
		    out[i] = [base[0] + px * ca - py * sa + p.tx, base[1] + px * sa + py * ca + p.ty, Z];   // Z: depth, larger = further away
		  }
		  return out;
		}
		
		const sfR = (v) => Math.round(v * 1000) / 1000;
		function sfPath(pts) {
		  let d = `M${sfR(pts[0][0])} ${sfR(pts[0][1])}`;
		  for (let i = 1; i + 2 < pts.length; i += 3) d += `C${sfR(pts[i][0])} ${sfR(pts[i][1])} ${sfR(pts[i + 1][0])} ${sfR(pts[i + 1][1])} ${sfR(pts[i + 2][0])} ${sfR(pts[i + 2][1])}`;
		  return d;
		}
		function sfPoly(pts) {
		  let d = '';
		  for (let i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + sfR(pts[i][0]) + ' ' + sfR(pts[i][1]);
		  return d;
		}
		/** x positions where the outline crosses the waterline */
		function sfCrossings(pts) {
		  const xs = [];
		  const bez = (a, b, c, d, u) => { const v = 1 - u; return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d; };
		  let px = pts[0][0], py = pts[0][1];
		  for (let i = 1; i + 2 < pts.length; i += 3) {
		    for (let k = 1; k <= 8; k++) {
		      const u = k / 8;
		      const x = bez(pts[i - 1][0], pts[i][0], pts[i + 1][0], pts[i + 2][0], u), y = bez(pts[i - 1][1], pts[i][1], pts[i + 1][1], pts[i + 2][1], u);
		      if ((py - SF_WATER) * (y - SF_WATER) < 0) xs.push(px + ((SF_WATER - py) / (y - py)) * (x - px));
		      px = x; py = y;
		    }
		  }
		  return xs;
		}
		
		// ---------------------------------------------------------------- frames
		/** an empty frame: everything sfDraw can draw, as lists (see sfDraw for the fields) */
		const sfEmptyFrame = () => ({ tail: null, ghosts: [], shapes: [], ripples: [], drops: [], rings: [], strokes: [], fills: [] });
		/** afterimages of the tail where it moves fast: prevPts are the projected tails 1, 2, 3 steps earlier */
		function sfGhosts(fr, main, prevPts) {
		  let prev = main;
		  prevPts.forEach((g, i) => {
		    let disp = 0;
		    for (let j = 3; j < g.length - 3; j += 3) disp = Math.max(disp, Math.hypot(g[j][0] - prev[j][0], g[j][1] - prev[j][1]));
		    const a = sfClamp((disp - 0.6) / 2.2) * [0.28, 0.15, 0.08][i];
		    if (a > 0.02) fr.ghosts.push({ d: sfPath(g), a });
		    prev = g;
		  });
		}
		
		// ---------------------------------------------------------------- water fx
		// Everything is a pure function of t, so any frame can be drawn on its own. A frame can be limited to the
		// effects that start inside [fr.fxMin, fr.fxMax] (a loop entered or left halfway keeps only its own share).
		const sfFx = (fr, t0) => (fr.fxMin == null || t0 >= fr.fxMin) && (fr.fxMax == null || t0 <= fr.fxMax);
		
		/** ripple ring on the water: grows from r0 to r1 and fades; rings weaken as they spread */
		function sfRipple(fr, t, t0, dur, cx, r0, r1, a0, flat = 0.2, w = 0.55, dash = null) {
		  if (sfFx(fr, t0)) sfRipple0(fr, t, t0, dur, cx, r0, r1, a0, flat, w, dash);
		}
		function sfRipple0(fr, t, t0, dur, cx, r0, r1, a0, flat = 0.2, w = 0.55, dash = null) {
		  const k = (t - t0) / dur;
		  if (k <= 0 || k >= 1) return;
		  const rx = r0 + (r1 - r0) * sfEaseOut3(k);
		  fr.ripples.push({ cx, cy: SF_WATER + 0.12, rx, ry: Math.max(0.2, rx * flat), a: a0 * Math.pow(1 - k, 1.4), w, dash });
		}
		/** the calm, smooth patch a diving tail leaves behind (a "flukeprint"), drawn as a faint dashed oval */
		function sfPrint(fr, t, t0, dur, cx, w0) {
		  const k = (t - t0) / dur;
		  if (k <= 0 || k >= 1 || !sfFx(fr, t0)) return;
		  const rx = w0 * (1 + 0.55 * sfEaseOut(k));
		  fr.ripples.push({ cx, cy: SF_WATER + 0.15, rx, ry: rx * 0.17, a: 0.42 * Math.sin(Math.PI * Math.pow(k, 0.6)), w: 0.42, dash: [0.5, 0.75] });
		}
		function sfLand(y, vy, g) {
		  const c = y - SF_WATER - 0.25, disc = vy * vy - 2 * g * c;
		  return (-vy + Math.sqrt(Math.max(0, disc))) / g;
		}
		/** ballistic drop with air drag; shrinks a little as it flies and leaves a tiny ring where it lands */
		function sfDrop(fr, t, t0, x, y, vx, vy, r = 0.45, g = 40, ring = 0.5) {
		  const k = t - t0;
		  if (k <= 0 || !sfFx(fr, t0)) return;
		  const tl = sfLand(y, vy, g);
		  if (k < tl) {
		    fr.drops.push({ x: x + vx * k, y: y + vy * k + 0.5 * g * k * k, r: r * (1 - 0.25 * k / tl), a: 1 });
		    return;
		  }
		  if (ring) sfRipple0(fr, t, t0 + tl, 0.42, x + vx * tl, 0.25, 1.5 * ring, 0.5 * ring, 0.25, 0.45);
		}
		/** water running off an edge: a drip hangs and stretches, pinches off, falls (with a short streak while
		 *  it is fast) and lands with a tiny ring. A drip that could not land (ring included) before `until` is
		 *  never started, so nothing is cut off at the end of a loop. */
		function sfStreak(fr, t, t0, x, y, len = 0.9, ring = 0.45, until = Infinity) {
		  const k = t - t0;
		  if (k <= 0 || !sfFx(fr, t0)) return;
		  const hang = 0.12;
		  if (t0 + hang + sfLand(y + len, 0, 38) + (ring ? 0.4 : 0) > until) return;
		  if (k < hang) {
		    const s = sfEaseIn(k / hang) * len;
		    fr.strokes.push({ d: `M${sfR(x)} ${sfR(y)}L${sfR(x)} ${sfR(y + s)}`, a: 0.85, w: 0.5 });
		    return;
		  }
		  const g = 38, kk = k - hang, y0 = y + len;
		  const tl = sfLand(y0, 0, g);
		  if (kk < tl) {
		    const yy = y0 + 0.5 * g * kk * kk, v = g * kk;
		    const tail = Math.min(1.6, 0.035 * v);
		    if (tail > 0.15) fr.strokes.push({ d: `M${sfR(x)} ${sfR(yy - tail)}L${sfR(x)} ${sfR(yy)}`, a: 0.45, w: 0.4 });
		    fr.drops.push({ x, y: yy, r: 0.36, a: 1 });
		    return;
		  }
		  if (ring) sfRipple0(fr, t, t0 + hang + tl, 0.4, x, 0.2, 1.3 * ring, 0.5 * ring, 0.25, 0.42);
		}
		/** bubble that rises to the surface, sits for a moment and pops */
		function sfBubble(fr, t, t0, x, r = 0.5) {
		  const k = t - t0;
		  if (k <= 0 || k > 0.75 || !sfFx(fr, t0)) return;
		  if (k < 0.5) {
		    const g = sfBackOut(sfClamp(k / 0.2), 2.0);
		    const wob = 1 + 0.06 * Math.sin(k * 40) * (1 - k / 0.5);
		    fr.rings.push({ x, y: SF_WATER - r * g * 0.85, rx: r * g * wob, ry: r * g / wob, a: 0.95, w: 0.5 });
		  } else {
		    const q = (k - 0.5) / 0.25;
		    fr.rings.push({ x, y: SF_WATER - r * 0.85, rx: r * (1 + 1.1 * q), ry: r * (1 + 0.6 * q), a: 0.75 * (1 - q), w: 0.4 });
		    if (q < 0.6) for (const s of [-1, 1]) fr.drops.push({ x: x + s * r * (0.8 + 1.4 * q), y: SF_WATER - r - 0.9 * q + 1.2 * q * q, r: 0.2, a: 1 - q / 0.6 });
		  }
		}
		/** water clinging to something crossing the surface: a lip pulled up beside it (k > 0, rising),
		 *  or a little dimple pulled in (k < 0, sinking) */
		function sfCollar(fr, xs, k) {
		  const a = sfClamp((Math.abs(k) - 0.12) / 0.6);
		  if (a <= 0) return;
		  for (const x of xs) {
		    for (const s of [-1, 1]) {
		      const x1 = x + s * 0.12, x2 = x + s * (0.55 + 0.3 * a);
		      const lift = k > 0 ? 0.5 * a : -0.25 * a;
		      fr.strokes.push({ d: `M${sfR(x2)} ${sfR(SF_WATER + 0.05)}Q${sfR(x + s * 0.28)} ${sfR(SF_WATER + 0.02)} ${sfR(x1)} ${sfR(SF_WATER - lift)}`, a: 0.6 * a, w: 0.45 });
		    }
		  }
		}
		/** top of a body that is mostly under water: a circle of radius r whose centre sits `depth` below the
		 *  surface; only the part above the water shows (clipped by the waterline) */
		function sfHump(cx, depth, r) {
		  const cy = SF_WATER + depth, pts = [];
		  for (let i = 0; i <= 40; i++) { const a = -Math.PI + (i / 40) * Math.PI; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
		  return pts;
		}
		
		// ---------------------------------------------------------------- baking
		function sfBake(def) {
		  const N = Math.round(def.period * SF_SR);
		  const frames = new Array(N + 1);
		  const springs = {}, prevv = {};
		  const dt = 1 / SF_SR;
		  const events = [];
		  let last = null;
		  for (let n = 0; n <= N; n++) {
		    const t = n * dt;
		    const p = sfRestPose();
		    const c = {
		      spring(name, target, hz, zeta) {
		        let s = springs[name];
		        if (!s) s = springs[name] = { x: target, v: 0 };
		        const w = SF_TAU * hz;
		        for (let i = 0; i < 4; i++) {
		          const h = dt / 4;
		          s.v += (-w * w * (s.x - target) - 2 * zeta * w * s.v) * h;
		          s.x += s.v * h;
		        }
		        return s.x;
		      },
		      vel(name, value) {
		        const pv = prevv[name];
		        prevv[name] = value;
		        return pv === undefined ? 0 : (value - pv) / dt;
		      },
		    };
		    def.drive(t, p, c);
		    // last quarter second: ease whatever the springs still carry back onto the resting pose, so the next
		    // loop starts exactly where this one ends
		    const end = sfSmooth(sfSeg(t, def.period - 0.25, def.period));
		    if (end > 0) {
		      const r = sfRestPose();
		      r.yaw += SF_TAU * Math.round((p.yaw - r.yaw) / SF_TAU);     // whole turns look the same: don't unwind them
		      for (const key in p) p[key] = sfLerp(p[key], r[key], end);
		    }
		    frames[n] = p;
		    // tracked points (fluke tips, notch) crossing the waterline
		    const pts = sfProject(p);
		    if (last) {
		      for (const idx of def.track) {
		        const y0 = last[idx][1], y1 = pts[idx][1];
		        if ((y0 - SF_WATER) * (y1 - SF_WATER) < 0) events.push({ t, idx, x: pts[idx][0], dir: y1 > y0 ? 'in' : 'out' });
		      }
		    }
		    last = pts;
		  }
		  return { frames, def, events, cache: new Map() };
		}
		function sfPoseAt(baked, t) {
		  const f = baked.frames;
		  const x = Math.max(0, Math.min(f.length - 1.0001, t * SF_SR));
		  const n = Math.floor(x), k = x - n;
		  const a = f[n], b = f[n + 1];
		  const p = {};
		  for (const key in a) p[key] = a[key] + (b[key] - a[key]) * k;
		  return p;
		}
		/** projected tail at time t, memoised (fx use it to launch drips from the flukes) */
		function sfTailAt(baked, t) {
		  const key = Math.round(t * 1000);
		  let v = baked.cache.get(key);
		  if (!v) { v = sfProject(sfPoseAt(baked, key / 1000)); baked.cache.set(key, v); }
		  return v;
		}
		
		const SF_BAKED = {};
		
		/** Everything needed to draw one frame of loop `name` at time t.
		 *  opt.noTail: water only; opt.fxMin / opt.fxMax: keep only effects that start inside that window. */
		function sfFrame(name, t, opt = {}) {
		  const baked = SF_BAKED[name] || (SF_BAKED[name] = sfBake(SF_DEFS[name]));
		  const def = baked.def;
		  const fr = Object.assign(sfEmptyFrame(), { fxMin: opt.fxMin, fxMax: opt.fxMax });
		  const pose = sfPoseAt(baked, t);
		  const main = sfProject(pose);
		  if (!opt.noTail) {
		    fr.tail = sfPath(main);
		    sfGhosts(fr, main, [1, 2, 3].map((k) => sfProject(sfPoseAt(baked, Math.max(0, t - k * 0.024)))));
		    // water clinging to the tail where it crosses the surface, while it moves up or down
		    if (def.collar !== false) {
		      const vy = (pose.ty - sfPoseAt(baked, Math.max(0, t - 1 / 60)).ty) * 60;
		      sfCollar(fr, sfCrossings(main), -vy / 9);
		    }
		  }
		  // tracked points (fluke tips, notch) slipping in / popping out of the water: a small ring each, plus a
		  // flicked drop on the way in unless the loop asks for rings only (tipFx: 'ring')
		  for (const e of baked.events) {
		    if (!sfFx(fr, e.t)) continue;
		    if (e.dir === 'in') {
		      sfRipple(fr, t, e.t, 0.55, e.x, 0.25, 2.0, 0.6, 0.24, 0.45);
		      if (def.tipFx !== 'ring') sfDrop(fr, t, e.t + 0.01, e.x, SF_WATER - 0.3, (e.idx === SF_TIP_L ? -1 : 1) * 0.9, -6.5, 0.32, 40, 0);
		    } else {
		      sfRipple(fr, t, e.t, 0.5, e.x, 0.25, 1.6, 0.45, 0.24, 0.42);
		    }
		  }
		  def.fx(t, fr, (tt) => sfTailAt(baked, tt));
		  return fr;
		}
		
		/** Draw a frame; ctx must already map viewBox units. k scales every opacity (cross-fades).
		 *  ripples / rings: ellipses on / at the water; ghosts, shapes (the head) and the tail: paths, clipped to
		 *  above the waterline; strokes: small paths (drips, collars); drops: filled dots; fills: solid water (blows). */
		function sfDraw(ctx, fr, color, k = 1) {
		  ctx.strokeStyle = ctx.fillStyle = color;
		  ctx.lineJoin = ctx.lineCap = 'round';
		  for (const r of fr.ripples) {
		    ctx.globalAlpha = r.a * k; ctx.lineWidth = r.w;
		    if (r.dash) ctx.setLineDash(r.dash);
		    ctx.beginPath(); ctx.ellipse(r.cx, r.cy, r.rx, r.ry, 0, 0, SF_TAU); ctx.stroke();
		    if (r.dash) ctx.setLineDash([]);
		  }
		  ctx.save();
		  ctx.beginPath(); ctx.rect(-40, -40, 96, 40 + SF_WATER); ctx.clip();
		  ctx.lineWidth = 1;
		  for (const g of fr.ghosts) { ctx.globalAlpha = g.a * k; ctx.stroke(new Path2D(g.d)); }
		  ctx.globalAlpha = k;
		  for (const s of fr.shapes) ctx.stroke(new Path2D(s.d));
		  if (fr.tail) ctx.stroke(new Path2D(fr.tail));
		  ctx.restore();
		  for (const s of fr.strokes) { ctx.globalAlpha = s.a * k; ctx.lineWidth = s.w; ctx.stroke(new Path2D(s.d)); }
		  for (const r of fr.rings) {
		    ctx.globalAlpha = r.a * k; ctx.lineWidth = r.w;
		    ctx.beginPath(); ctx.ellipse(r.x, r.y, r.rx, r.ry, 0, 0, SF_TAU); ctx.stroke();
		  }
		  for (const d of fr.drops) {
		    if (d.r <= 0.03 || d.a <= 0.02) continue;
		    ctx.globalAlpha = d.a * k;
		    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, SF_TAU); ctx.fill();
		  }
		  // solid water (blows): kept above clipY (the blowhole) and out of the hole (the head it comes out of)
		  for (const f of fr.fills) {
		    ctx.save();
		    ctx.beginPath(); ctx.rect(-40, -40, 96, 40 + f.clipY); ctx.clip();
		    if (f.hole) {
		      const cp = new Path2D();
		      cp.rect(-40, -40, 96, 96);
		      cp.moveTo(f.hole[0] + f.hole[2], f.hole[1]); cp.arc(f.hole[0], f.hole[1], f.hole[2], 0, SF_TAU);
		      ctx.clip(cp, 'evenodd');
		    }
		    ctx.globalAlpha = k;
		    ctx.fill(new Path2D(f.d));
		    ctx.restore();
		  }
		  ctx.globalAlpha = k;
		}

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

		// Frames 27-43 of the official DSH "sway" (转身) whale-tail loop, copied from dsh-motion/src/official-frames.js
		// (recovered there from a screen recording of DSH; 28x28 alpha masks). One turn: side (27/28) -> front (~36.6)
		// -> side again (~42.5). Do not edit.
		const SWAY_FIRST = 27;
		const SWAY_FRAMES = ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABe0lEQVR42u3UTUhUYRTG8d8dawaUwYpCFMGkwDa2adGiDyIQwUULBcVV0NJ1tJh1i1ZSFBgEQZtIqGgRFNRKjARRCDd+gB9Bg2KQOKWZc2dadBmw7tid1p3VAy//c85zzuGleqT8Q6Q9sCBXO3xV2SdFIw7UBo764phHyu5rrAV8blVa2m2hlxqSg/dsaULgltDj5A33KukHde4oGkgKHlbwJNL1lk0nn+8Lm1oqjX9zJOmS76p3LdIzMtqTVqwzbTZKfMJXq67LJENfyVemec6U0Ji2v2NnbXu65whv+GHR8f2xNnn5P3xdsWFBR3Ws0QcbLoBgz0uf75ZdrD7R0CCyHlrxTk5TJUGPNSsOxre5Y1SAYUWvLdm1adgZh7QYsm4mfo05JecRmDMhkNbtraJQwY6yeZ2/O/h1ElMyOoVS5n10OdrqKV06FIx7Yzuu3km7bkb6mc/xbuJO7rSUyUgvysomBZtteR/pglKMmarfVGtFH3XJ/6g9fgKefmAXYjTndgAAAABJRU5ErkJggg==","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABgElEQVR42u3SvWtTcRjF8c9NTQhqBetrUnGyWIcqWNxURHHzZREc3JwcBQdRV0GRLoKLRXBxEBWKEv8AwerQFoQWcWjRRSxIi5AmoXm5dfkRrMnVG2fPdA78vvwOz/OQrEjWP2iLkq8u9w4+1vRRw5nesAErXilYsGSkF/C0NRcxasmi4c4HmQRwKxYx47y8CRvTgitiRfDWTUOupK06qO5e8Flz5m1IB2bMmhWFNK5ic7qqsZf2OxTSgpxC2rIHNN0JflTNd9fTXdJ2NePtdNyU2BuDfwevabr0S866peGT3X/GjqialPvt6C+omNSfjBXN+2EYfQrrln9Vy4R8EvhA3Vns9E5s2RPHwmoiY9Y8ay9qnfZa9VSEh1bd9VpV03Pn9OuzzYyagW7gDbGjYM40IkPuq4iVfVHW8kgm6nIz0/JGtPBB7HCouMspJxV9U1JS7/xvn4bbwb+wnLT0zpM7KGMq+M82JQ2/Eyyoeh98Wdx9ft2Us6ftdzjhv3rXTzbQYBRUTDWmAAAAAElFTkSuQmCC","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABeUlEQVR42u3Uv2uTURTG8c81VdRiFS21WFoQBYcakU4uRUVwUHBRN3EQO3a2i/4Dzv5AJxEk0E0nB8daJdCtrYtBpREkUCQJmLfkbVwuAU1efePsmZ57zv1yDuece8m2YId/sBPeWnVmUGyXVXVVX00NBl7XMW/WlvdGBgEfaxrFvNQbe/KDizbsRHBH25P8YEkt5glKWmZ+v5DV8C8OGAUd9xTcyAsuKTgbdcWmibylDqt6JcRil31wPC/6yA+Ho76ppemhg3nAWzpOd09FL6UqTv0NC0oaxn7xXLPpm+k/g+e0POvxzviuYjIbG/dR1RGMuKCo0I1c0bKS3eMHEpdwzGcd29Yt2BdjtyXKhvphkxKLAl5omnPXmlTNU5dNu2pdw/5+4ILtOPw17+Iju+i1RKotVTcnBL27VDbspDZWDHUHEIybNWbDklq/fFO23I/6ubrd/dvQu6tFBeWoP9mb9Yx7wQmJ5agb2kL+3+ZoVx9y3n8b3H4CEYJfClwOflMAAAAASUVORK5CYII=","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABe0lEQVR42uXUu2sUYRTG4Wcnq6vxkphGwWxlRJAQOy+dbP6BYKOgFpHYKmihha2FoJBCAiLBJoWFGNIoeIlIMCm0sAqICtkUioWCkAQ3c1mbYRB31sym9a3ec77vxzmc70J7lWxCQ16bNdAp1mPJTyve29kZeEXTGRckpnV3Aj63rKLkltgL24uDnz0BgRsiU4Ki4CfPUhe4L3S8KPhSXTn1A2I3W7fkNzGn35Gs+hfHbClWcdC6ySyaFFl0Td/GYMljaw6kUcVlS0LfnN/4NtUkxv6IK0Z8ELut69/gCU0X/8rtNiM2no0tV3dEDrdkt5mSeGRXO6zqhzcCXc56YMKY/nSlbFzkYTvwrkhNyTmJXxrWNcy46qRDTvmqnn+MVQ3TArxS16PXsHu+S4RiiVWj+dO9rqkGFs1n2W5HjbrktP35bQbe+ZhObk693cm19rrXkKeitOI+O4qCg8repn7ZVr1FwarQQupXhJpFn1TFwczvUdvcX/ef6zcU018QjSOpGQAAAABJRU5ErkJggg==","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABfUlEQVR42u3UMUiUYRzH8c/ZXRdEJySBlbV0WEuCEBQ4VBBBgejS0ODWpDS4NSQEknuDQbU4ukmLNbsIIkheFKJkJpjoIIWGeu+913K+HPq+511zv+l5fvB9nuf3f/7Pwz/qRKzb46nffjS6WLdAybauxrAmc9bc8dO63kbAvMAIbllRNCRVL/hA6BG44KPAQL3gQ+UKyGlTtrTEJzqs70IdlfGOV3K6672geV9kK7Pzfln03D0nj0f7lT2JZr2WFIVWDDpVG8z5bFNrVZy8Z+aFZuVro132DR/yMvr9saEvodtAylfTMf5NC0rGauX9ZgqkXXHZmaoY75S8IB2LXdVmDG3e61S265MZBWtapHE2ab83Au14bc+Il94q2FMSCu0b1xyPXbRrQgoFs5F7yQ333T2odtxRH8saVQZh5K5arX0VKdOWZcAHmzFNmdCr53SaVAQLmpPyHAWvyZiLjpdJqmBTTGlCM5XxtqAq5THKuh69+pzb9f8A/xXpL5Y4X5/1T99gAAAAAElFTkSuQmCC","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABdElEQVR42u3SsWsUURTF4W9MzEpWgyyCwkIUbBSiSIhYqAT/hoDYmkIEi2AhWNjbqJWioLViGi0UDGKhglgYC4OWCusWcSEiY0J21syMzbCFziwv1p7q3gO/e9677/GPGirx9jlrTWezo8a1ZX6a3ix4U+q8ZStmSs9ToWEtr0QmLcnM2x4K7rbuOtjhltTj0NQ9Etf6i7sqcyYMHLHseb9r6HgRmnlX14F+d8OGr56YMyEaDE7quW9b0dVdtqAl1TPv4CA4ckfPxT92PeWertg5tWp0zBux5l/+IYsyi6aq0RMyF0r8UZesiB1muBT8IrML7HVK3Q+ftCR+eaBpzhEfyhOPy81i2qpcLpfaEOtIZN5pVCXOWvcMV6yZ8d1OE8aN2eqb1xYk5XlNXY9E+Oht1Rq2lHin1dyWIwn/5EReahsBD8VFFZDYcNRTPfDZqEYouF/NUlG3DRXPEgA25d4X9apUFnrHmmP9cXUnS9f3X4P1G3NQZY0Hh3k4AAAAAElFTkSuQmCC","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABdElEQVR42u3TvUvVURzH8de9FvcqUaaZPVBQXXRUXIKaorbCBq81RVNbtDb0BwQNjUaE4NASToIgoty5oUVLihx6gESxTOzp1v09tFwugvfI704tfabP4XzffM/5nPPl32qve2aNtg5eldhQ88Dh1sBJ606ZktgypjsrlresgrxLZsUW9GYFP5hr+GuqKvKh4rZtPjWsZEyM1JK8mw4qGdKv6utuPe+KXW6sDpjzRyIVicy4oT0E9lqzvC3RNscNGHDFQ19E3roTyntEzYumm4fcsiS27nwzMOe2X146EohvVORJ8545ZVWPGqVdTivpM2jYfatqyuGQnvqhG2dUVCUSiUis5rnrcrCnKfhGUacN44ZMeGfTPptWvfJRutuzTPtmv4LPnoV/y04dddG8LVH9wJnBsoLHiK040cqMzFtTAON+6sjasdNZ036D94p6soIndXhd95/kQl9sJ3hMarHuv4vFWW9YcKExbEXnwhP5X0H9BUDEZSsVGFlfAAAAAElFTkSuQmCC","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABcklEQVR42u3UTUtUYRjG8d/JUcdMSgvKlkFBwuyKgjZSm7Bv0EfIRbgIoXYtWhZFm0B6IVoHSRGigURT4FLKIAmTFi3EmTzGOJ3OTJthCOY5eGzTpmt1PS//m/vl4eHf6ojS32AXbEk9MLxTcFbVY4maGRd15cWKYk90GfXQmoaXhvKBu/0w1fKDbqib0519vdB2NRVHRZqouCYy6Y2aIU0VM6YtaoaD3FP/o6vdbvnos3fmrUilFlx1XNQJjoi9tS+Y12nXLWlK3Ayhl6VeO5BRVo+TPtiwp/MoMqHuq9GO/YJB5z3zy1O7QlEj53wRO9FalVxx34JlsYZNtw1kd3pExXMwKZH4bskrd407uN1MH6nq06+qrKQ31I5CENyvLtWnqGwxHDtU6LCzyn7aFDu2k8d+ScMYmLcSSjNLL6wrgjsSe/OmOuCMaVtgVcGhvOBh/T61/DeyRhACI+9bfkNDmrfCXmPtIfU4lf8n+K+2fgNhxWM+4qvskQAAAABJRU5ErkJggg==","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABbUlEQVR42u3Uz0tUYRTG8c+dUiYXoTBS0UCLokAGchaKoYG6jzYughYRCf0HSRlt/BPaKLhxIbQz3BS0aBtulNkYRVERaThMGpYMM/dOiy7i5E3vbMVndd4f38M5z3t4Ofo6AQI33FZVFraGD6mLRMpWvPFU4XDkJBiQMSZvQKece8Y9Mq2gT7+Cj2pWffdZyXozfl/DYBwHrnih7odQpKLkq4qaUOSD083giLoHe9YdHnruiT5tAhlZeb3mNBSbwXZvrbt0oIm3/FRy6t+Dftu+GBQk+nDdgrpVF5NyjtqwY8FobNjffns89knotxm55GIyLpi1qaakJ96ZVFW1ZFI+sZY4O+RMqNjSi2GhV4oyaceh6Jd53BEZ+d+lpGzLll3Ge8GBTu9Tty3PkFW22Ap4V8NN8NK3PR4fqkUb8UNPiZxN22PWNa/tgDWBc2nBM7q8i+M10oPn2QU3RappO8wa07E72lfjP+JYregPWY1dxMJlzSgAAAAASUVORK5CYII=","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABbElEQVR42u3SMUiUYRgH8N93l3eGhR5kpTbUcmShDantLQ0RmTQ1GESjCNEU7Q1CUFONbSI4GDpVIg0RBLYLmSAGBYddhxlefvc59CHep+Z3u//pef7P+/+/z/O+D4f4h0CTIEntjLMIRXHeoseA89p1K3jrnlq916DLsrr0aJOx4JUJrR4adlJg3W9fZPUbML/zzhE1VX+t+mTKlK9CKyo2fXDfBQU5gReqztY3+9Kaok75OM8b8d6kqzLbZy765U1yyiE1o/99mkuWVPQm6bzPyq4n/WLkPLCm7NpexaJlG965o0O2rtJvXmRW937NnPJMSWTDkhm35ECvilWjCbNdOO6G52aVhOa0YkxVX/otOeax0BM8FTrX2IItmsOQyO1GhG3KxtHip9eNCIfV3ATTfmhOL5xUchQ8Eu03ZWYXc8QVH/0B39GVVnjCaQtx/A2daYVnBBbjuGzTetoJm91V2P6Y4kF7c4g9sAUpwVgy5zIcsgAAAABJRU5ErkJggg==","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABa0lEQVR42u3SQUuUURjF8d91RmOCCCkNs0VhtIkiwUVuBJcFiVELaVHrojZFIbRoE7rwE/QJQnAXURg0gZULA5EWhagMlUVYMTBFYzPzvm0GkdF3eN17Vg+X87/ce57DrqDFaWe1NLNkZDcZWvW67pH3/qq6s9We1eWcB/JWfLVg3FFtrppXFfnttTGrZhqx2z5bFylb8dyUt8pKvogU3HVSuyBjWb4RrFgwYcRxGRD0mZR3w94NzxlV441gyUu5puHkzCrpaTweVfPCgGwCtsdTkVvbhT2qqGbZY/ecd2JTrsGgjyoeJi2j231v/BCJVcwZrp/f9M93Q0KznwQ5vUaM+WTdJfQoe+VI+qYcUPBOMCh2JblOW/XTBwcFa2JdO+lmu6Ip7LfmyU7Aa2IXETzzLWlN2z31gl+mEZtzSEdasFW/GX9AQXAsLdih02J9XkV3WvCwYKk+F9VU0kbT5rJ9G9eeSuzwrpL1H4CJXuazXeApAAAAAElFTkSuQmCC","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABcklEQVR42u3SP2hTURTH8U9M+2zBUhtpFKpCEUFwUYQ66CI6denkn0GXDo4dFBwcdBKULgUHXR0d/IedO7nZRiwqqUgK0QxVqBW1kbzk6vIISemjz73f4XI55/zOPeeewzap5NpnZK8jCoKSZa3EHxlQNGbCmim/OqW9rnisZEWsJWgJ5k3Y6YSHquoagjXBtU5Zjyn3/FTxykdvVA0655KnvhvSUPJCRVlZ2YHuYu9rOLWhgYLbnrvjsFzSzDHBze6gQ1Z9diEJSOOBpqMbjad9EVsy7ayB9hudH3hZ05PNUg+6YVEsWLfgln0dvl3uanhvOK2YHUZNeuSd2DcnE9ukmmC2K1UKeWes+KAH1/1VcVE+61pMiw2L1LzWn1bgZoxaV9dnyFv17GtY9Nsz9Ppq9n/296pgHMypbjHfLl5a1QdmNO3O2mNkzJw/oCLvYFZh0R6fknsN+7MKR+SUk/sPTXHWDiPn27PLO559+Nu0+QdAfWMt9V6CeQAAAABJRU5ErkJggg==","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABhklEQVR42u3Tv2tTURQH8E/aahvSqlSxtSK1k4OCJoiSQV30L1AQR906FaSgIDg5OImDIvYPUBQzqFBEVFzFIkIXBV3EH6QSCJi0NXkvz+UZlLwkbxX8Tt977v2ec7/nnss/g8E2G1UwLrDecSbTK8EBFS2Rmm/eeGDedBoZcwLXzLnpodeqAnU3ZPtfea+mRWNxjTFHLGpaMtHP43erZh32SgUNn9xVds4ePxTsN2nNT0MiUWcLLlpTNm+0Hbki1BIJtaxaseK5zUnW8646Ydllj+LMMwpqMrbLmzSt6JRS0tWHnfVFYMFIwu55LcXujdpqQeB6R3zcBx9t7D0WT1Tk/opNeKrl9O/lUKIwVDUY+99inxlFZ+Rccr/3q+5W81hGzh3rGprqXjjWfxxuaziEC0L3zDrafRD+xJS6kgyWvO9ixkBC7KSsWyJkVQXpv9pLn20AJeWYpai4Sd4zTfDWNlNphbvkvIv5VwN2pBXuxHLMa0KNtA6HHW93csTBxPb9R2/8ArZ1Zv02+rzDAAAAAElFTkSuQmCC","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABiElEQVR42u3Uv2tTURQH8M+rJakOCkUUtMRAIKJCkVrq0jooSBF0qAiKoJurkzi4OamLlC6O/gEtFAfRWSG6RNEqYgd/DSqIQRtrX9K85+CjpK15eS5Ofqfz/XK/99x7zrmXf40NbXGg7Lx+dfW/22SjT0KxhocuGhQkek834xahaWfd9l5T032jK+ZUBB74rIQ+o276IXRt1WU6Ytw3j21LWNEdkSvZcp4TemZXwvPuaRjMVqIzQk/tT1hB3WvXnbKve5GOW/DFoYSdMCcSWVZ1QUEuzTrsrZq9K70umnDVR5GmD4bTrEMW3VqjbXbSpNgk9HYwPvfVToG4Tftuxg7MpWU8reXyGq3HhLonNv1uwJ9QULFoRE3ZMTkty/KOOmzeuDed801ZcgQjFkRisVhL3Q39accs+mlagFk1YwbsNqSsr1sfL4mMgZcq2R9XoGo+Ge2KV52WrR+j7fa4qwUeKdma1ViS8yKJ3+ntVI71xgEt1SReEmlkvWPegbYhO5jtD/iPVfgFsQtkc4Z61bMAAAAASUVORK5CYII=","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABe0lEQVR42u3Tu2uTURzG8c9powUlpYPiUK1aFVKk3larLoKriLObm/+Amzg4VBC6OEjtRScVKYiDk+CgEO8aCrUgog5FROkt1SR9E5dDbauvvgFHn+k5P/jyux7+qbqNGrStefCqujmzTmlpDnzioT1KEtd0aM0OFr0VdBjxzXu92cF+ib3gmBlTdmcFD6i6FP1RXzzSlg0M7prVFV/nNBzJmnO/iitxLNstuJwVDO5YsA/kFE3pFrKhXT67Ff1xZWVDNmcBW7z0NGYJet1Q8dXJv+c9rGZ42eUEfSbUnLHmT1iPjz7pXBXd5J5FD2xNw9o9N68PtK2413X6fXc/reABNaeRd920SRftjKvJOWHGzd9jO1TcFjAgMaaoJjFh2Khn6t6llXpW3SEEJS8EQY8LXps3bdJ5G9PW8MobrQjGFZdNNW/9z35//ahbFIxJ0DBul1yMN8wpq6eDBTml6D9ol08rbLU6VT2OvqxqMet5r1VY8hsc9F/N6wc9QWSZXEwo1AAAAABJRU5ErkJggg==","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABeUlEQVR42u3Tv0uVURzH8de5j0VGvyySfhFOQdgPiiCkWhpscLWhxaH+DgenaIhsyHaXIIyGIogKEpOi5YJGoYuIoJIoGmXofe5TyyFM78N9bnOf6XMO3zfn++uQr0TJP6jNO190NYoFb/ww65uOxsCj1gxo99Wsk42Al2Vu4pIFc05vDcgrf5sgxajrdhqyv+iLh6y7F323VH9RsGTKqBAb9daCvcVSzQw76xj45ZkD0dcFGdCsJ/ppQVvRZLebNBKTPWLRvJ5im1Ty0UQEuWpC1QsH64OdUg83nHe7Y92Heuh582Y2BQW3rHmtOR9rMWnJBbDjr8p6ZZ7YlQf2q7iBFo+t+KxPqyRWflvF89ptOiH1CNxX9VRZ1bK72iWCVmN+2lcL7JXpQDCuLEhc81JFasqYFZkHQqgxhnGcURV88t3FeHtOtytKpg16Ja2VaEVf9EMWNeWNebNOSZT/rNqevA5uBQ9b9T76Vams+I4e3/ArO/1X4/oNDXlgIBK7/8oAAAAASUVORK5CYII=","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAABe0lEQVR42u3SvWtTcRTG8U/Sl6BVsYolpiAUSpaixaEu7SBKBnER1NFJN3GQDoKzuirdLCgIXUqhpdg/QIwgSIcUITg4mKmDraZY+pLce+tyCZoXeuPsMz3nx/nynN/h0Fkpaf+gkxZ9da978JVARd217rBTtiwZtm5TvhuwIHIHk76rGE2K9bnpQAFctm3VkeaW9nuLbCIL3nnoovtJM4fsm4l9j7Ky3iSJbKiYiptDReeah+0ERlacNx5XVRlnkw47LvQk9hds+2FaX7Jf7phtVFesOlCUOxycFrn7R53xSM2Xw9AJvxQdbTr6W/Z9MNAZO61sQx5pub8aHwgtd0ZnBG5j2Ht1VW9caqQ+FViQaoeNqpsHL9U8t2BXYMV1A3pklewZbAc+FpkCn30CeS9sifz0zY7Ia6nWyLSSfmNCrKmZiN+zbig4bt1by+qteSNqnsV+TlWm/RpaT25Mr1LsK445kRTM2fMx9rsCYdIb7TfS8Gdc9V/d6zfIUWKkDOfXNwAAAABJRU5ErkJggg=="];

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
		[data-chat-running] [class*="runningIcon"].dshmu-tail { overflow: visible !important; contain: none !important; }
		[data-chat-running] [class*="runningIcon"].dshmu-tail > [class*="runningWhale"] { display: none !important; }
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
		  style.dataset.plugin = 'dsh-music';
		  style.textContent = TAIL_CSS;
		  document.head.append(style);
		
		  function tick(t) {
		    raf = 0;
		    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
		    last = t;
		    const hosts = [...document.querySelectorAll('[data-chat-running] [class*="runningIcon"]')]
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
		      let left = Infinity, right = -Infinity;
		      for (const e of dock.querySelectorAll(':scope > :not([data-slot]), :scope > [data-slot] > :not(.dshmu-strip)')) {
		        const b = e.getBoundingClientRect();
		        if (b.width) { left = Math.min(left, b.left); right = Math.max(right, b.right); }
		      }
		      if (!r.width || right <= left) return null;
		      const L = right - left;
		      return { cx: r.left + r.width / 2 - o.left, cy: r.top + r.height / 2 - o.top, x0: c.left + c.width / 2 - L / 2 - o.left,
		        y: c.bottom - o.top, L, pct: Math.max(0, Math.min(1, pct / 100)) };
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
		        if (Math.abs(ln.want - ln.g.pct) <= 0.0005) ln.g.pct = ln.want;
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
		    draw(ln);
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

		return module.exports;
	}
});
