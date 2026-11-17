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
[data-chat-running] [class*="runningText"], [data-dshmu-pv-running] [class*="runningText"] { transition: opacity .16s ease .06s; }
:is([data-chat-running], [data-dshmu-pv-running]).dshmu-on [class*="runningText"] { opacity: 0; transition: opacity .12s ease; }
.dshmu-ts { display: inline-grid; position: absolute; left: var(--dshmu-ts-x, 0px); top: var(--dshmu-ts-y, 0px); width: max-content;
  max-width: min(60vw, 640px); min-width: 0; color: inherit; opacity: 0; visibility: hidden; transition: opacity .12s ease, visibility 0s .12s;
  --dshmu-sung: var(--dsw-alias-label-deep-diving); --dshmu-dim: color-mix(in srgb, var(--dsw-alias-label-deep-diving) 38%, var(--dsw-alias-bg-base)); }
:is([data-chat-running], [data-dshmu-pv-running]).dshmu-on .dshmu-ts { opacity: 1; visibility: visible; transition: opacity .16s ease .06s, visibility 0s; }
/* Shown again as it was (DSH rebuilt the indicator or the composer row while the music went on): no fades. */
[data-dshmu-still] [class*="runningText"], [data-dshmu-still] .dshmu-ts, [data-dshmu-still] .dshmu-ts *,
[data-composer-dock][data-dshmu-still] > *, [data-composer-dock][data-dshmu-still] > [data-slot] > *, [data-dshmu-still] .dshmu-strip * { transition: none !important; }
[data-dshmu-still] .dshmu-enter, [data-dshmu-still] .dshmu-in, [data-dshmu-still] .dshmu-from-r, [data-dshmu-still] .dshmu-from-l { animation: none !important; }
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
/* The row's controls: the cover capsule (the song's artwork, beat bars after it while it plays) with the play / pause
   button lying on the artwork, which dims under it: one round thing, playing or paused. A click on the capsule plays or
   pauses too. With no player reporting at all, the play button alone starts the one used last. */
.dshmu-ctrl { align-items: center; }
.dshmu-ib { display: inline-grid; place-items: center; flex: none; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 999px;
  background: transparent; color: inherit; font: inherit; cursor: pointer; }
@media (hover: hover) { .dshmu-ib:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); } }
.dshmu-ib:disabled { opacity: .4; cursor: default; }
.dshmu-ib svg { width: 12px; height: 12px; }
.dshmu-ctrl > .dshmu-pp { position: relative; z-index: 1; margin-right: 4px;
  transition: margin-right .3s cubic-bezier(.2, .8, .2, 1), color .2s ease, background-color .12s; }
.dshmu-pp svg { transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
.dshmu-cap { display: inline-flex; align-items: center; height: 22px; padding: 0 3px; border: 0; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover);
  color: inherit; font: inherit; cursor: pointer; transition: background-color .12s; }
@media (hover: hover) { .dshmu-cap:hover { background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-interactive-bg-active)); color: var(--dsw-alias-label-secondary); } }
.dshmu-cap:is([aria-expanded="true"], [data-dshmu-landing]) { visibility: hidden; }
/* Scrolling on the capsule skips songs (down: next, up: previous). Hovered, two faint chevrons just outside its ends
   say so: drawn thin and dim, not as buttons, and they take no clicks. The one the wheel went toward flicks outward. */
.dshmu-cap { position: relative; }
.dshmu-cap-hint { position: absolute; top: 50%; width: 3px; height: 6px; margin-top: -3px; pointer-events: none; color: var(--dsw-alias-label-tertiary);
  opacity: 0; transition: opacity .3s ease, transform .3s cubic-bezier(.2, .8, .2, 1); }
.dshmu-cap-hint svg { display: block; width: 100%; height: 100%; overflow: visible; }
.dshmu-cap-hint[data-d="-1"] { left: -5px; transform: translateX(1.5px); }
.dshmu-cap-hint[data-d="1"] { right: -6px; transform: translateX(-1.5px); }
@media (hover: hover) { .dshmu-ctrl:hover .dshmu-cap-hint { opacity: .4; transform: none; } }
.dshmu-cap .dshmu-cap-hint[data-flick] { opacity: .85; transition: opacity .08s ease, transform .08s ease; }
.dshmu-cap .dshmu-cap-hint[data-flick][data-d="-1"] { transform: translateX(-1.5px); }
.dshmu-cap .dshmu-cap-hint[data-flick][data-d="1"] { transform: translateX(1.5px); }
.dshmu-cap-art { position: relative; display: grid; place-items: center; width: 16px; height: 16px; flex: none; border-radius: 4px; overflow: hidden;
  background: var(--dsw-alias-interactive-bg-hover); transition: filter .2s ease; }
.dshmu-cap-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.dshmu-cap-art svg { width: 11px; height: 11px; transition: opacity .2s; }
.dshmu-cap-art:not([data-blank]) svg { display: none; }
.dshmu-eq { display: inline-flex; align-items: center; gap: 2px; height: 12px; }
.dshmu-eq i { flex: none; width: 2px; height: 3px; border-radius: 1px; background: currentColor; }
.dshmu-cap .dshmu-eq { max-width: 0; margin: 0; opacity: 0; overflow: hidden;
  transition: max-width .26s cubic-bezier(.2, .8, .2, 1), margin .26s cubic-bezier(.2, .8, .2, 1), opacity .16s ease; }
.dshmu-strip[data-play="playing"] .dshmu-cap .dshmu-eq { max-width: 20px; margin: 0 5px 0 6px; opacity: 1; }
.dshmu-strip:not([data-play="none"]):not(:has(.dshmu-cap:is([aria-expanded="true"], [data-dshmu-landing]))) .dshmu-pp { margin-right: -22px; color: #fff; }
.dshmu-strip:not([data-play="none"]):not(:has(.dshmu-cap:is([aria-expanded="true"], [data-dshmu-landing]))) .dshmu-pp svg { transform: scale(.72); }
.dshmu-strip:not([data-play="none"]):not(:has(.dshmu-cap:is([aria-expanded="true"], [data-dshmu-landing]))) .dshmu-pp:hover { background: transparent; }
.dshmu-strip:not([data-play="none"]):not(:has(.dshmu-cap:is([aria-expanded="true"], [data-dshmu-landing]))) .dshmu-cap-art { filter: brightness(.62); }
.dshmu-strip:not([data-play="none"]):not(:has(.dshmu-cap:is([aria-expanded="true"], [data-dshmu-landing]))) .dshmu-ctrl:has(> .dshmu-pp:hover) .dshmu-cap-art { filter: brightness(.45); }
.dshmu-strip:not([data-play="none"]):not(:has(.dshmu-cap:is([aria-expanded="true"], [data-dshmu-landing]))) .dshmu-ctrl:has(.dshmu-cap-art[data-blank]) > .dshmu-pp { color: inherit; }
.dshmu-strip:not([data-play="none"]):not(:has(.dshmu-cap:is([aria-expanded="true"], [data-dshmu-landing]))) .dshmu-cap-art[data-blank] { filter: none; }
.dshmu-strip:not([data-play="none"]):not(:has(.dshmu-cap:is([aria-expanded="true"], [data-dshmu-landing]))) .dshmu-cap-art[data-blank] svg { opacity: 0; }
.dshmu-strip[data-play="none"] .dshmu-cap { display: none; }
.dshmu-strip[data-play="none"] .dshmu-pp { margin-right: 0; }
/* a new song's first words come in from the side the song went */
.dshmu-from-r { animation: dshmu-from-r .3s cubic-bezier(.2, .8, .2, 1); }
.dshmu-from-l { animation: dshmu-from-l .3s cubic-bezier(.2, .8, .2, 1); }
@keyframes dshmu-from-r { from { opacity: 0; transform: translateX(14px); } }
@keyframes dshmu-from-l { from { opacity: 0; transform: translateX(-14px); } }
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
.dshmu-strip > .dshmu-ctrl { transition: opacity .16s ease .06s, visibility 0s; }
.dshmu-strip > .dshmu-lyric { opacity: 0; visibility: hidden; transition: opacity .12s ease, visibility 0s .12s, width .28s cubic-bezier(.2, .8, .2, 1); }
[data-composer-dock]:not(:hover, :focus-within, :has([aria-expanded="true"])) > [data-slot] > .dshmu-strip[data-mode="lyric"] > .dshmu-lyric {
  opacity: 1; visibility: visible; transition: opacity .16s ease .06s, visibility 0s, width .28s cubic-bezier(.2, .8, .2, 1); }
/* While the lyric glides to the width of its new line (glideWidth), the text is cut off plainly rather than with "…" */
.dshmu-lyric[data-dshmu-glide] .dshmu-line { text-overflow: clip; }
[data-composer-dock]:has(.dshmu-strip[data-mode="lyric"]):not(:hover, :focus-within, :has([aria-expanded="true"])) > :not([data-slot]),
[data-composer-dock]:has(.dshmu-strip[data-mode="lyric"]):not(:hover, :focus-within, :has([aria-expanded="true"])) > [data-slot] > :not(.dshmu-strip),
[data-composer-dock]:not(:hover, :focus-within, :has([aria-expanded="true"])) > [data-slot] > .dshmu-strip[data-mode="lyric"] > .dshmu-ctrl {
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
body { --dshmu-sidebar: var(--dsw-specific-sidebar-fill); --dshmu-base: var(--dsw-alias-bg-base); }
html[data-dshmu-bg] body > :has([data-shell-bottom]) {
  --dsw-alias-bg-base: transparent;
  --dsw-specific-sidebar-fill: color-mix(in srgb, var(--dshmu-sidebar) var(--dshmu-tint, 55%), transparent);
}
.dshmu-bg { position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: 0; }
.dshmu-bg canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.dshmu-bg .dshmu-veil { position: absolute; inset: 0; background: var(--dsw-alias-bg-base); opacity: calc(1 - var(--dshmu-bg-strength, .32)); transition: opacity .3s ease; }

/* The player unfolded from the capsule (island.js): laid out in the window, over the page. The frame grows from the
   capsule to the panel; the cover and the bars fly from the capsule to their places. --dshmu-isl-k: how far open. */
.dshmu-isl { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 40; color: var(--dsw-alias-label-secondary); font: 12px/1.5 var(--dsw-font-family);
  --dshmu-isl-sung: var(--dsw-alias-label-primary); --dshmu-isl-dim: var(--dsw-alias-label-tertiary); }
.dshmu-isl[hidden] { display: none; }
.dshmu-isl-clip { position: fixed; overflow: hidden; backdrop-filter: blur(20px) saturate(1.2);
  background: color-mix(in srgb, var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1)) calc(var(--dshmu-isl-k, 0) * 100%), var(--dsw-alias-interactive-bg-hover));
  box-shadow: 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-border-l2) calc(var(--dshmu-isl-k, 0) * 100%), transparent), 0 calc(8px * var(--dshmu-isl-k, 0)) calc(28px * var(--dshmu-isl-k, 0)) rgb(0 0 0 / calc(.13 * var(--dshmu-isl-k, 0))); }
.dshmu-isl-tint { position: absolute; inset: -40px; pointer-events: none; }
.dshmu-isl-tint img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(34px) saturate(1.5); opacity: 0; transition: opacity .5s ease; }
.dshmu-isl-tint img[data-on] { opacity: .26; }
body[data-ds-dark-theme] .dshmu-isl-tint img[data-on] { opacity: .34; }
.dshmu-isl-body { position: absolute; width: 300px; box-sizing: border-box; padding: 14px 14px 10px; }
.dshmu-isl-head { display: flex; align-items: center; gap: 12px; height: 52px; }
.dshmu-isl-slot { width: 52px; height: 52px; flex: none; }
.dshmu-isl-meta { min-width: 0; flex: 1; display: grid; }
.dshmu-isl-meta > div { grid-area: 1 / 1; min-width: 0; transition: transform .3s cubic-bezier(.2, .8, .2, 1), opacity .22s ease; }
.dshmu-isl-t { font-size: 13px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshmu-isl-a { font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshmu-isl-eqslot { width: 17px; height: 14px; flex: none; align-self: flex-start; margin-top: 4px; }
.dshmu-isl-ly { position: relative; height: 66px; margin-top: 12px; overflow: hidden; text-align: center; mask-image: linear-gradient(transparent, #000 32%, #000 68%, transparent); }
.dshmu-isl-col { position: absolute; left: 0; right: 0; top: 0; transition: transform .42s cubic-bezier(.2, .8, .2, 1), opacity .25s ease; }
.dshmu-isl-col > div { height: 22px; line-height: 22px; font-size: 13px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transform: scale(.92); transition: transform .42s cubic-bezier(.2, .8, .2, 1), color .3s ease; }
.dshmu-isl-col > div[data-cur] { transform: none; color: var(--dsw-alias-label-secondary); }
.dshmu-isl-col[data-none] > div { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dshmu-isl-seek { position: relative; display: flex; align-items: center; height: 14px; margin: 7px 0 -1px; touch-action: none; }
.dshmu-isl-seek[data-can] { cursor: pointer; }
.dshmu-isl-seek[hidden] { display: flex; visibility: hidden; }
.dshmu-isl-bar { position: relative; flex: 1; height: 3px; border-radius: 3px; background: var(--dsw-alias-border-l3); overflow: hidden; transition: height .15s ease; }
.dshmu-isl-seek[data-can]:hover .dshmu-isl-bar, .dshmu-isl-seek[data-drag] .dshmu-isl-bar { height: 5px; }
.dshmu-isl-knob { position: absolute; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--dsw-alias-label-primary);
  box-shadow: 0 1px 3px rgb(0 0 0 / .2); opacity: 0; transform: scale(.4); transition: opacity .15s ease, transform .15s ease; pointer-events: none; }
.dshmu-isl-seek[data-can]:hover .dshmu-isl-knob, .dshmu-isl-seek[data-drag] .dshmu-isl-knob { opacity: 1; transform: none; }
.dshmu-isl-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--dsw-alias-label-secondary); }
.dshmu-isl-times { display: flex; justify-content: space-between; height: 17px; font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dshmu-isl-times[hidden] { display: flex; visibility: hidden; }
.dshmu-isl-btns { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 6px; }
.dshmu-isl-btns .dshmu-ib { width: 30px; height: 30px; border-radius: 8px; color: var(--dsw-alias-label-secondary); }
.dshmu-isl-btns .dshmu-ib[hidden] { display: inline-grid; visibility: hidden; }
.dshmu-isl-btns .dshmu-ib svg { width: 14px; height: 14px; }
.dshmu-isl-btns .dshmu-isl-pp { width: 36px; height: 36px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshmu-isl-btns .dshmu-isl-pp svg { width: 16px; height: 16px; transition: transform .25s cubic-bezier(.3, 1.6, .5, 1); }
.dshmu-isl-btns .dshmu-isl-pp[data-pop] svg { transform: scale(.7); transition: none; }
.dshmu-isl-btns .dshmu-isl-mode svg { width: 15px; height: 15px; transition: transform .35s cubic-bezier(.2, .8, .2, 1), opacity .2s; }
.dshmu-isl-btns .dshmu-isl-mode[data-on="true"] { color: var(--dsw-alias-label-primary); }
.dshmu-isl-btns .dshmu-isl-mode[data-turn] svg { transform: rotate(-90deg) scale(.6); opacity: 0; transition: none; }
.dshmu-isl-gap { width: 30px; flex: none; }
.dshmu-isl-say { position: absolute; left: 0; right: 0; bottom: 4px; text-align: center; font-size: 11px; color: var(--dsw-alias-label-tertiary); opacity: 0; transition: opacity .2s; pointer-events: none; }
.dshmu-isl-say[data-show] { opacity: 1; }
.dshmu-isl-cover { position: fixed; z-index: 1; overflow: hidden; display: grid; place-items: center; background: var(--dsw-alias-interactive-bg-hover);
  box-shadow: 0 calc(2px * var(--dshmu-isl-k, 0)) calc(10px * var(--dshmu-isl-k, 0)) rgb(0 0 0 / calc(.14 * var(--dshmu-isl-k, 0))); }
.dshmu-isl-cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform .38s cubic-bezier(.2, .8, .2, 1), opacity .3s ease; }
.dshmu-isl-note { display: none; width: 45%; height: 45%; color: var(--dsw-alias-label-tertiary); }
.dshmu-isl-note svg { width: 100%; height: 100%; }
.dshmu-isl-cover[data-blank] .dshmu-isl-note { display: block; }
.dshmu-isl-eq { position: fixed; z-index: 1; transform-origin: 0 50%; color: var(--dsw-alias-label-secondary); transition: opacity .2s; }

/* The light with the music (glow.js): a ring along the composer card in a new session, the window's edge in a
   conversation. Colour: --dshmu-glow-c (from the cover, set on body), DSH's blue without one. The composer row's lyric
   waits (data-dshmu-hold) while the ring draws back to bring it in. */
.dshmu-ring, .dshmu-edge, .dshmu-edge-css { --dshmu-g: var(--dshmu-glow-c, var(--dsw-alias-brand-primary-new-colorprimary-new-color, rgb(86, 134, 254))); }
[data-dshmu-ring-root] { position: relative; }
.dshmu-ring { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2; }
.dshmu-ring path, .dshmu-edge path { fill: none; stroke: var(--dshmu-g); stroke-linecap: round; }
.dshmu-ring path { stroke-width: 1.25; filter: drop-shadow(0 0 2px var(--dshmu-g)) drop-shadow(0 0 7px color-mix(in srgb, var(--dshmu-g) 60%, transparent)); }
.dshmu-edge { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; overflow: visible; pointer-events: none; z-index: 2147483000; }
.dshmu-edge path { stroke-width: 1.5; filter: drop-shadow(0 0 3px var(--dshmu-g)) drop-shadow(0 0 12px color-mix(in srgb, var(--dshmu-g) 55%, transparent)); }
.dshmu-edge-css { position: fixed; inset: 0; border-radius: 8px; pointer-events: none; z-index: 2147483000; will-change: opacity;
  box-shadow: inset 0 0 0 1.5px var(--dshmu-g), inset 0 0 4px 1px color-mix(in srgb, var(--dshmu-g) 80%, transparent),
    inset 0 0 14px 2px color-mix(in srgb, var(--dshmu-g) 45%, transparent); }
[data-composer-dock][data-dshmu-hold] > [data-slot] > .dshmu-strip > .dshmu-lyric { opacity: 0 !important; visibility: hidden !important; transition: none !important; }

/* The settings page's preview: a copy of the DSH window as it last showed a conversation (the page itself takes the
   conversation's place), with this plugin's things live on it: the lyric row, the running indicator, the window's edge
   and the cover background, all as the settings now make them. Only the composer row takes the pointer. */
.dshmu-pv { position: relative; width: 100%; overflow: hidden; border-radius: 8px; isolation: isolate; background: var(--dshmu-base);
  box-shadow: 0 0 0 .5px var(--dsw-alias-border-l2), 0 6px 24px rgb(0 0 0 / .08); }
.dshmu-pv-bg { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
.dshmu-pv-bg canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.dshmu-pv-bg .dshmu-veil { position: absolute; inset: 0; background: var(--dshmu-base); opacity: calc(1 - var(--dshmu-bg-strength, .32)); }
.dshmu-pv-scale { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.dshmu-pv-app { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; pointer-events: none; }
.dshmu-pv-app [data-composer-dock], .dshmu-pv-app [data-composer-dock] * { pointer-events: auto; }
html[data-dshmu-bg] .dshmu-pv-app { --dsw-alias-bg-base: transparent;
  --dsw-specific-sidebar-fill: color-mix(in srgb, var(--dshmu-sidebar) var(--dshmu-tint, 55%), transparent); }
.dshmu-pv-edge { position: absolute; inset: 0; border-radius: 8px; pointer-events: none; z-index: 2147483000; opacity: 0;
  --dshmu-g: var(--dshmu-glow-c, var(--dsw-alias-brand-primary-new-colorprimary-new-color, rgb(86, 134, 254)));
  box-shadow: inset 0 0 0 1.5px var(--dshmu-g), inset 0 0 4px 1px color-mix(in srgb, var(--dshmu-g) 80%, transparent),
    inset 0 0 14px 2px color-mix(in srgb, var(--dshmu-g) 45%, transparent); }
.dshmu-pv-ring { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2;
  --dshmu-g: var(--dshmu-glow-c, var(--dsw-alias-brand-primary-new-colorprimary-new-color, rgb(86, 134, 254))); }
.dshmu-pv-ring path { fill: none; stroke: var(--dshmu-g); stroke-width: 1.25; filter: drop-shadow(0 0 2px var(--dshmu-g)) drop-shadow(0 0 7px color-mix(in srgb, var(--dshmu-g) 60%, transparent)); }
.dshmu-pv-none { padding: 28px 16px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; border-radius: 8px; box-shadow: 0 0 0 .5px var(--dsw-alias-border-l2); }
.dshmu-range { display: inline-flex; align-items: center; gap: 10px; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dshmu-range input { width: 180px; accent-color: var(--dsw-alias-brand-primary-new-colorprimary-new-color, rgb(86, 134, 254)); }
.dshmu-range span { width: 36px; text-align: right; }

/* On this plugin's own page in DSH's plugin manager, its README (the page's long description) and the one-line
   description under its name are left out, so the settings and their preview come first. GitHub and npm still show
   both. */
:has(> section[data-plugin-config] .dshmu-set) > section[data-detail-document] { display: none !important; }
:has(> * > section[data-plugin-config] .dshmu-set) > :has(> p > code[data-plugin-name]) > p:not(:has(> code[data-plugin-name])) { display: none !important; }

/* The plugin's settings */
.dshmu-set { display: flex; flex-direction: column; gap: 14px; }
.dshmu-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dshmu-row > span:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dshmu-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
/* lyric timing: pick the player, then its number (DSH's own selects: a native select drawn like its inputs) */
.dshmu-offsets { display: flex; gap: 8px; align-items: center; }
.dshmu-offsets input { width: 72px; }
.dshmu-select { appearance: none; height: 32px; padding: 0 30px 0 10px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center / 12px 12px;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; cursor: pointer; }
.dshmu-select:focus-visible { border-color: var(--dsw-alias-state-business-primary); }
.dshmu-select option { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
@media (prefers-reduced-motion: reduce) {
  .dshmu-d { display: none; } .dshmu-enter, .dshmu-in, .dshmu-from-r, .dshmu-from-l { animation: none !important; }
  .dshmu-ts, .dshmu-strip > *, .dshmu-strip .dshmu-ctrl *, .dshmu-isl *, .dshmu-veil, [data-chat-running] [class*="runningText"],
  [data-composer-dock]:has(.dshmu-strip) > *, [data-composer-dock]:has(.dshmu-strip) > [data-slot] > * { transition: none !important; }
}
`;

const LOCALE = {
  zh: {
    play: '播放音乐', resume: '播放', pause: '暂停', prev: '上一首', next: '下一首',
    mode: '播放模式', mode_order: '顺序播放', mode_list: '列表循环', mode_one: '单曲循环', mode_shuffle: '随机播放',
    noSeek: '这个播放器不允许从外部调进度', nowPlaying: '正在播放：{title}', pausedSong: '已暂停：{title}', searchingLyrics: '正在找歌词…', noLyrics: '这首歌没有歌词',
    summaryBg: '背景 {bg}',
    musicCoding: 'Music Coding 模式', musicCodingHint: 'AI 干完活音乐渐弱到静音，你打字、说话、发消息时再回来；新歌淡入；静音时跳过不合适的歌',
    backdrop: '封面背景', backdropHint: '整个窗口底下流动的封面颜色',
    lyricsOn: '显示歌词', lyricsOnHint: '关掉后输入栏下面只显示歌名和封面',
    translation: '显示翻译', translationHint: '外文歌的歌词后面跟着中文翻译',
    previewNone: '打开一个对话之后，这里会显示 DSH 窗口放歌时的样子', previewMessage: '帮我看看这个函数为什么报错', previewFolders: 'my-app|website|scripts|notes', previewSessions: '整理项目的目录结构|把配置改成从环境变量读|给登录页加记住密码|修一下分页的边界情况|写一份接口文档|优化首页加载速度',
    edgeGlow: '窗口边缘光', edgeGlowHint: '对话时窗口四周的边缘跟着节拍轻轻发亮', off: '关', light: '淡', medium: '中', strong: '浓',
    duck: '等你批准时的音量', fadeIn: '新歌淡入（Music Coding）', beat: '跟鼓点', beatHint: '鲸尾和背景跟着重拍动',
    offsets: '歌词快慢', offsetsHint: '先选播放器，再填它的歌词要提前多少毫秒（负数＝推后）', offsetsPlayer: '播放器',
    player_cloudmusic: '网易云音乐', player_QQMusic: 'QQ 音乐', player_KuGou: '酷狗音乐', player_SodaMusic: '汽水音乐', player_kwmusic: '酷我音乐', player_bodian_pc: '波点音乐', 'player_Microsoft.Media.Player': '媒体播放器',
    model: '判断歌曲情绪用的模型', modelHint: '只在 Music Coding 里、本地测不准时问，每首一次',
    summary: 'Music Coding {mc} · 背景 {bg}', on: '开',
  },
  en: {
    play: 'Play music', resume: 'Play', pause: 'Pause', prev: 'Previous', next: 'Next',
    mode: 'Play mode', mode_order: 'In order', mode_list: 'Repeat all', mode_one: 'Repeat one', mode_shuffle: 'Shuffle',
    noSeek: 'This player does not let others move its position', nowPlaying: 'Now playing: {title}', pausedSong: 'Paused: {title}', searchingLyrics: 'Looking for lyrics…', noLyrics: 'No lyrics for this song',
    summaryBg: 'Background {bg}',
    musicCoding: 'Music Coding mode', musicCodingHint: 'Music fades out when the AI is done and comes back as you type, speak or send; new songs fade in; unsuitable songs are skipped while silent',
    backdrop: 'Cover background', backdropHint: 'The cover as flowing colour behind the whole window',
    lyricsOn: 'Show lyrics', lyricsOnHint: 'Off: the row under the input shows only the song and its cover',
    translation: 'Show translations', translationHint: 'A translation after each line, for songs in other languages',
    previewNone: 'Open a conversation, and the DSH window with the music will show here', previewMessage: 'Why does this function throw?', previewFolders: 'my-app|website|scripts|notes', previewSessions: 'Tidy up the project layout|Read the config from env vars|Remember me on the login page|Fix the pagination edge case|Write the API docs|Speed up the home page',
    edgeGlow: 'Window edge light', edgeGlowHint: 'In a conversation, the window\'s edge lights softly with the beat', off: 'Off', light: 'Light', medium: 'Medium', strong: 'Strong',
    duck: 'Volume while waiting for approval', fadeIn: 'New song fade-in (Music Coding)', beat: 'Follow the beat', beatHint: 'The whale tail and the background move with the kick',
    offsets: 'Lyric timing', offsetsHint: 'Pick a player, then how many ms earlier its lyrics show (negative = later)', offsetsPlayer: 'Player',
    player_cloudmusic: 'NetEase Cloud Music', player_QQMusic: 'QQ Music', player_KuGou: 'KuGou', player_SodaMusic: 'Soda Music', player_kwmusic: 'Kuwo', player_bodian_pc: 'Bodian', 'player_Microsoft.Media.Player': 'Media Player',
    model: 'Model for song moods', modelHint: 'Asked only in Music Coding, once per song, when measuring is not enough',
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
  // A click (play / pause, a place on the progress bar) answers at once. Until the player shows it took it, or HOLD
  // passes, reports still describing it as it was do not undo it: the host repeats its last look when it passes the
  // command on, and the player takes a moment to change. Without this the button flips back, then on again.
  const HOLD = 2500;
  let want = null, raw = null, wantTimer = 0;   // want: { song, status, pos, at, until, status?/pos? to check }
  const songOf = (m) => m && `${m.app}\u0000${m.title}\u0000${m.artist}`;
  const livePos = (m, now) => m.pos + (m.status === 'Playing' ? now - m.at : 0);
  function ask(status, pos, check) {
    const now = Date.now(), prev = want && now < want.until && want.song === songOf(media) ? want : null;
    want = { song: songOf(media), status, pos: Math.max(0, Math.round(pos)), at: now, until: now + HOLD,
      checkStatus: check === 'status' || !!prev?.checkStatus, checkPos: check === 'pos' || !!prev?.checkPos };
    media = { ...media, status, pos: want.pos, at: now };
    clearTimeout(wantTimer);
    wantTimer = setTimeout(() => {   // the player never showed it: what it reports stands
      if (lifetime.signal.aborted || !want || Date.now() < want.until) return;
      want = null;
      if (raw && media) { setMedia(raw, cover); background(); kick(); island?.update(); glow.update(); }
    }, HOLD + 30);
  }
  function held(m) {
    raw = m;
    if (!want) return m;
    const now = Date.now();
    if (!m || songOf(m) !== want.song || now > want.until) { want = null; return m; }
    const statusOk = !want.checkStatus || m.status === want.status;
    const posOk = !want.checkPos || Math.abs(livePos(m, now) - livePos(want, now)) < 1500;
    if (statusOk && posOk) { want = null; return m; }
    return { ...m, status: want.status, pos: want.pos, at: want.at };
  }
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
            } else { clearTimeout(gone); gone = 0; setMedia(held(ev.media), ev.cover); }
            aiIdle = !!ev.aiIdle; mood = ev.mood ?? null;
            lyricsStatus = ev.lyricsStatus ?? null;
            if (lyricsStatus === 'none' || lyricsStatus === 'idle') expect = 0;   // this song has none
            else if (lyricsStatus === 'searching' && !lyrics && !expect && live(media)) expectLyrics();
            // on (re)connecting, put the host right about the approval card: it may still hold the music down for
            // one this page no longer shows (a reload), or have let go while one is still waiting
            if (!synced) { synced = true; waiting = awaitingApproval(); if (!!ev.waiting !== waiting) command(waiting ? 'approval-on' : 'approval-off'); }
            if (ev.settings && JSON.stringify(ev.settings) !== JSON.stringify(settings)) { settings = ev.settings; for (const f of settingsListeners) f(); }
            background();
            island?.update();
            glow.update();
          } else if (ev?.t === 'lyrics') {
            if (ev.lyrics) expect = 0;
            else if (lyricRow()) expectLyrics();
            lyrics = ev.lyrics;
            island?.update();
          }
          else if (ev?.t === 'beat') {
            if (settings.beat !== false && !reduced.matches) bg?.view.pulse(ev.s);   // the flow rushes on each kick
            tail?.beat(ev.s);
            for (const f of beatListeners) f(ev.s);
            for (const s of strips) s._bars?.beat(ev.s);   // the capsule's bars, and the island's
            island?.beat(ev.s);
            glow.beat(ev.s);
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
    background(); kick(); glow.update();
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
  // Lyrics turned off in the settings, a live cut with no lyrics timed for it (nameOnly), or a player that tells no
  // place in the song (noPos: KuGou, a build whose place the bridge cannot read): no lyrics show, the row names the
  // song while it plays.
  const lyricsOn = () => settings.lyrics !== false && !lyrics?.nameOnly && !media?.noPos;
  const playing = () => !!(lyricsOn() && media && media.status === 'Playing' && lyrics?.lines?.length && !lyrics.instrumental);
  // the lyric row: while a song with lyrics plays, and while a playing song's lyrics are on their way (named until
  // they come, however long the search takes)
  const lyricRow = () => !media?.changing && (playing() || (live(media) && (!lyricsOn() || expect > Date.now() || lyricsStatus === 'searching')));
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
  // A song change passes through Stopped and Changing (QQ Music) and a moment with no lyrics: the row keeps showing
  // the lyric (the song's name, until its lyrics come) through up to ROW_HOLD of that, so it and the context line do
  // not fold and come back. A pause folds it at once.
  const ROW_HOLD = 1500;
  let offSince = 0;
  function syncRow() {
    let m = media === undefined ? undefined : lyricRow() ? 'lyric' : media === null ? 'idle' : 'off';   // undefined: no report yet
    if (rowMode === 'lyric' && m === 'off' && media?.status !== 'Paused' && !media?.changing) {
      const now = performance.now();
      if (!offSince) { offSince = now; setTimeout(kick, ROW_HOLD + 30); }
      if (now - offSince < ROW_HOLD) m = 'lyric';
    } else if (m === 'lyric') offSince = 0;
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
    const ctrl = el('dshmu-ctrl', s);
    const pp = el('dshmu-ib dshmu-pp', ctrl, 'button');
    pp.type = 'button';
    // A mouse press must not leave focus on a button: focus inside the row keeps the readings up (:focus-within),
    // so the lyric would not come back when the pointer leaves. Keyboard focus still works as usual.
    pp.addEventListener('mousedown', (e) => e.preventDefault());
    pp.addEventListener('click', () => { if (!media) command('launch'); else toggle(); });
    const capsule = el('dshmu-cap', ctrl, 'button');
    capsule.type = 'button';
    capsule.addEventListener('mousedown', (e) => e.preventDefault());
    // the island (island.js) is set aside for now: without it the capsule plays and pauses, like the button on it
    if (typeof createIsland === 'function') { capsule.setAttribute('aria-haspopup', 'dialog'); capsule.setAttribute('aria-expanded', 'false'); }
    capsule.addEventListener('click', () => { if (island) island.toggle(capsule); else if (media) toggle(); });
    const art = el('dshmu-cap-art', capsule);
    el('', art, 'img').alt = '';
    art.insertAdjacentHTML('beforeend', ICON_NOTE);
    const eq = el('dshmu-eq', capsule);
    for (let k = 0; k < 4; k++) el('', eq, 'i');
    s._bars = createBars([...eq.children]);
    for (const d of [-1, 1]) {
      const h = el('dshmu-cap-hint', capsule, 'span');
      h.dataset.d = String(d); h.setAttribute('aria-hidden', 'true');
      h.innerHTML = `<svg viewBox="0 0 3 6"><path d="${d < 0 ? 'M2.6.5.4 3l2.2 2.5' : 'M.4.5 2.6 3 .4 5.5'}" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    // the wheel anywhere on the controls: the play / pause button lies on the capsule's cover, playing or paused
    ctrl.addEventListener('wheel', (e) => {
      if (!media) return;
      e.preventDefault();
      const d = wheelSkip(e);
      if (!d) return;
      const h = capsule.querySelector(`.dshmu-cap-hint[data-d="${d}"]`);
      h.setAttribute('data-flick', ''); clearTimeout(h._flick);
      h._flick = setTimeout(() => h.removeAttribute('data-flick'), 160);
    }, { passive: false });
  }
  function toggle() {
    const on = media.status === 'Playing';
    ask(on ? 'Paused' : 'Playing', livePos(media, Date.now()), 'status');   // answer the click at once
    command('toggle'); background(); kick(); island?.update(); glow.update();
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
    const play = !media ? 'none' : media.status === 'Playing' ? 'playing' : 'paused';
    if (s.dataset.play !== play) s.dataset.play = play;
    const cap = s.querySelector('.dshmu-cap');
    if (cap._cover !== cover) {
      const img = cap.querySelector('.dshmu-cap-art > img');
      // a new song's cover slides in the way the song went, as on the island (not a late cover for the same song)
      const dir = cap._cover && cover && cap._coverSong !== undefined && cap._coverSong !== song && !reduced.matches ? skipDir() : 0;
      if (dir) {
        const old = img.cloneNode(), ease = 'cubic-bezier(.2, .8, .2, 1)';
        img.after(old);
        old.animate([{ transform: 'none' }, { transform: `translateX(${-dir * 100}%)` }], { duration: 320, easing: ease, fill: 'forwards' })
          .finished.then(() => old.remove(), () => old.remove());
        img.animate([{ transform: `translateX(${dir * 100}%)` }, { transform: 'none' }], { duration: 320, easing: ease });
      }
      cap._cover = cover; cap._coverSong = song;
      img.hidden = !cover; if (cover) img.src = cover;
      cap.firstChild.toggleAttribute('data-blank', !cover);
    }
    const capLabel = media ? t(media.status === 'Playing' ? 'nowPlaying' : 'pausedSong', { title: media.title ?? '' }) : '';
    if (cap.getAttribute('aria-label') !== capLabel) cap.setAttribute('aria-label', capLabel);
    const dock = s.closest('[data-composer-dock]');
    if (dock && ctxLine.update(dock, mode === 'lyric' && !dock.matches(':hover, :focus-within') && !dock.querySelector('[aria-expanded="true"]'), still)) moving = true;
    if (mode !== 'lyric') return;   // the lyric keeps its last words while it fades out
    const img = s.querySelector('.dshmu-cover'), line = s.querySelector('.dshmu-line');
    if (img._src !== cover) { img._src = cover; if (cover) img.src = cover; img.hidden = !cover; }
    const l = i >= 0 ? lyrics.lines[i] : null;
    const showTr = settings.translation !== false;
    if (line._l !== l || line._lyrics !== lyrics || (!l && line._title !== media.title) || line._tr !== showTr) {
      const w0 = still ? 0 : ownWidth(line.parentElement);
      line._l = l; line._lyrics = lyrics; line._title = media.title; line._tr = showTr;
      const words = el('dshmu-words');
      if (l) words.append(...wordSpans(l)); else words.textContent = [media.title, media.artist].filter(Boolean).join(' · ');
      line.replaceChildren(words);
      if (l?.tr && showTr) { el('dshmu-sep', line).textContent = '·'; el('dshmu-tr', line).textContent = l.tr; }
      const newSong = line._song !== undefined && line._song !== song;
      line._song = song;
      line.classList.remove('dshmu-in', 'dshmu-from-r', 'dshmu-from-l');
      restart(line, newSong ? (skipDir() < 0 ? 'dshmu-from-l' : 'dshmu-from-r') : 'dshmu-in');
      glideWidth(line.parentElement, w0);
    }
    if (l) paint(line.firstChild, pos);
  }

  // The lyric sits centred on the row, so a new line (or song) of another length would move its cover and both ends at
  // once: from the width it had, it glides to the new one instead (the CSS transition on width), then lets go.
  // an element's width in its own px (the settings page's preview shows the row scaled down)
  function ownWidth(e) {
    const w = e.getBoundingClientRect().width, k = e.offsetWidth ? w / e.offsetWidth : 1;
    return Math.abs(k - 1) < 0.02 ? w : e.offsetWidth;
  }
  function glideWidth(e, w0) {
    clearTimeout(e._glide);
    e.style.width = '';
    const w1 = ownWidth(e);
    if (!w0 || !w1 || Math.abs(w1 - w0) < 1 || reduced.matches) { e.removeAttribute('data-dshmu-glide'); return; }
    e.setAttribute('data-dshmu-glide', '');
    e.style.transition = 'none';
    e.style.width = `${w0}px`;
    void e.offsetWidth;
    e.style.transition = '';
    e.style.width = `${w1}px`;
    e._glide = setTimeout(() => { e.style.width = ''; e.removeAttribute('data-dshmu-glide'); }, 320);
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

  // ------------------------------------------------------------------ the settings page's preview
  // DSH shows the plugin manager in the conversation's place, so the preview is a copy: of the window as it is (its
  // sidebar and frame), with the conversation as it last looked put back where the page is. The conversation is
  // copied every few seconds while it shows (one in progress preferred over a new session's), and the copy is
  // cleaned of this plugin's own things, which then run live on it: a lyric row of its own in the composer row, the
  // running indicator, the window's edge, the cover background, the ring in a new session. Its DSH markers are renamed
  // so neither DSH nor this plugin takes it for the real page (an approval card in it does not hold the music down).
  const pv = { active: null, hero: null, box: null, strip: null, edge: null, ring: null, card: null, bgc: null, bgl: null, ro: null };
  // The copy leaves out what the preview drops anyway (shapeConversation): the chat's history and every message but
  // the first, so a long conversation is not copied whole every few seconds.
  function lightCopy(main, c) {
    const column = [...c.querySelectorAll('[data-chat-flow]')].find((e) => !e.hasAttribute('data-step-process-content'));
    const flow = column && (column.querySelector('[data-slot="conversation.chat.flow"]') ?? column);
    const dropped = (e) => { const x = e.closest('[data-chat-history], [data-text-interaction-surface]'); return !!x && !!column?.contains(x); };
    const bubble = flow && [...flow.querySelectorAll('[data-message-bubble]')].find((b) => !dropped(b));
    const item = bubble?.closest('[data-chat-flow-kind]');
    const keep = item && flow.contains(item) && item !== flow ? item : null;
    const copy = (n) => {
      if (n.nodeType === 1 && column?.contains(n) && n.matches('[data-chat-history], [data-text-interaction-surface]')) return null;
      if (n === flow) { const f = n.cloneNode(false); if (keep) f.append(keep.cloneNode(true)); return f; }
      const out = n.cloneNode(false);
      for (const ch of n.childNodes) { const k = copy(ch); if (k) out.append(k); }
      return out;
    };
    return copy(main);
  }
  function snapConversation() {
    if (document.hidden) return;
    const c = [...document.querySelectorAll('[data-conversation-content]')].find((e) => !embedded(e));
    const main = c?.closest('[data-slot="main"]');
    if (!main) return;
    const phase = c.getAttribute('data-content-phase') ?? c.closest('[data-phase]')?.getAttribute('data-phase');
    if (phase === 'hero') pv.hero = lightCopy(main, c);
    else {
      pv.active = lightCopy(main, c);
      // DSH shows the session's title as "<title> — <product>": it is replaced in the copy
      const dt = document.title, k = dt.lastIndexOf(' — ');
      pv.title = k > 0 ? dt.slice(0, k).trim() : null;
    }
    const run = document.querySelector('[data-chat-running]:not([data-holding])');
    if (run && !embedded(run)) pv.running = run.cloneNode(true);
  }
  // A running indicator as DSH draws it (RunningStatus, ui-chat), for when none has been seen yet: DSH's own CSS
  // module classes, found by the one that only its running whale has.
  const WHALE_PATH = 'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742';
  function runningIndicator() {
    let hash = null;
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) { const m = /\.([\w-]+)_runningWhaleAnimated(?![\w-])/.exec(r.selectorText ?? ''); if (m) { hash = m[1]; break; } }
      if (hash) break;
    }
    if (!hash) return null;
    const c = (n) => `${hash}_${n}`;
    const run = el(c('running'), null, 'div');
    run.innerHTML = `<span class="${c('runningDivider')}" aria-hidden="true"></span><span class="${c('runningContent')}"><span class="${c('runningIcon')}" aria-hidden="true">`
      + `<span class="${c('runningWhaleAnimated')}"></span><svg class="${c('runningWhaleStill')}" width="100%" height="100%" viewBox="0 0 16 16" fill="none"><path d="${WHALE_PATH}" stroke="currentColor" stroke-width="1"/></svg>`
      + `</span><span class="${c('runningText')}">Deep diving ···</span></span>`;
    return run;
  }
  const textNodes = (root) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), out = []; while (w.nextNode()) out.push(w.currentNode); return out; };
  // The copied conversation keeps nothing of the real chat: one message of the preview's own (its title in place of
  // the session's), and the AI at work on it, the running indicator after it.
  function shapeConversation(copy) {
    const msg = t('previewMessage');
    if (pv.title) for (const n of textNodes(copy)) if (n.nodeValue.trim() === pv.title) n.nodeValue = msg;
    // the sidebar's folders and sessions: made-up names (the selected session is the preview's message), no times
    const made = t('previewSessions').split('|'), folders = t('previewFolders').split('|');
    [...copy.querySelectorAll('[data-row-key^="workspace:"]')].forEach((row, i) => {
      const title = row.querySelector('[class*="_title"]');
      if (title) title.textContent = folders[i % folders.length];
    });
    [...copy.querySelectorAll('[data-row-key^="session:"]')].forEach((row, i) => {
      const title = row.querySelector('[class*="_title"]') ?? row.querySelector(':scope > span:nth-of-type(2)');
      if (title) title.textContent = /_selected(\s|$)/.test(row.className) ? msg : made[i % made.length];
      for (const n of textNodes(row)) if (!title?.contains(n) && /^\s*\d+\s*[a-z\u4e00-\u9fff]{1,3}\s*$/i.test(n.nodeValue)) n.nodeValue = '';
    });
    const conv = copy.querySelector('[data-dshmu-pv-content]');
    const column = conv && [...conv.querySelectorAll('[data-chat-flow]')].find((e) => !e.hasAttribute('data-step-process-content'));
    if (!column) return;
    column.querySelectorAll('[data-chat-history], [data-text-interaction-surface]').forEach((e) => e.remove());
    const flow = column.querySelector('[data-slot="conversation.chat.flow"]') ?? column;
    const item = flow.querySelector('[data-message-bubble]')?.closest('[data-chat-flow-kind]') ?? null;
    flow.replaceChildren();
    if (item) {
      item.querySelectorAll('[data-message-attachments]').forEach((e) => e.remove());
      item.querySelector('[data-message-bubble]').textContent = msg;
      flow.append(item);
    }
    const run = pv.running?.cloneNode(true) ?? runningIndicator();
    if (run) {
      cleanCopy(run);
      run.removeAttribute('data-chat-running'); run.removeAttribute('data-holding'); run.removeAttribute('aria-hidden');
      for (const k of [...run.classList]) if (k.startsWith('dshmu-')) run.classList.remove(k);
      run.setAttribute('data-dshmu-pv-running', '');
      flow.append(run);
    }
  }
  const snapTimer = setInterval(snapConversation, 3000);
  if (globalThis.__dshmuTestHooks) Object.assign(globalThis.__dshmuTestHooks, { mountPreview, snapConversation });   // tools/samples/harness.html ?settings=1
  const RENAME = { 'data-conversation-content': 'data-dshmu-pv-content', 'data-composer-card': 'data-dshmu-pv-card', 'data-chat-running': 'data-dshmu-pv-running' };
  function cleanCopy(root) {
    for (const e of [...root.querySelectorAll('*')]) {
      const first = (e.getAttribute('class') ?? '').split(' ')[0];
      if (first.startsWith('dshmu-') || e.matches('canvas, video, iframe, .dshm-whale')) { e.remove(); continue; }
      for (const a of [...e.attributes]) {
        if (a.name.startsWith('data-dshmu-') || ['id', 'data-approval-key', 'contenteditable', 'autofocus'].includes(a.name)) e.removeAttribute(a.name);
        else if (RENAME[a.name]) { e.setAttribute(RENAME[a.name], a.value); e.removeAttribute(a.name); }
      }
      for (const c of [...(e.classList ?? [])]) if (c.startsWith('dshmu-')) e.classList.remove(c);
      if (e.matches('a, button, input, textarea, select, [tabindex]')) e.setAttribute('tabindex', '-1');
    }
  }
  function mountPreview(box) {
    const app = document.querySelector('body > :has([data-shell-bottom])');
    const src = pv.active ?? pv.hero;
    const copy = app?.cloneNode(true), main = copy?.querySelector('[data-slot="main"]');
    if (!src || !main) {
      const none = el('dshmu-pv-none', null, 'div');
      none.textContent = t('previewNone');
      box.replaceChildren(none);
      return () => box.replaceChildren();
    }
    main.replaceWith(src.cloneNode(true));
    cleanCopy(copy);
    shapeConversation(copy);
    copy.classList.add('dshmu-pv-app');
    copy.setAttribute('aria-hidden', 'true');
    const W = Math.min(innerWidth, 960), H = Math.round(W * 0.46);
    const frame = el('dshmu-pv', null, 'div'), back = el('dshmu-pv-bg', frame, 'div'), scale = el('dshmu-pv-scale', frame, 'div');
    pv.bgc = el('', back, 'canvas'); el('dshmu-veil', back, 'div'); pv.bgl = back;
    scale.style.width = `${W}px`; scale.style.height = `${H}px`;
    scale.append(copy);
    pv.edge = el('dshmu-pv-edge', scale, 'div');
    // a lyric row of its own in the copied composer row (the real one's code paints it, hover and all)
    const slot = copy.querySelector('[data-slot="conversation.composer.dock"]');
    if (slot) { const st = el('dshmu-strip', null); slot.prepend(st); st._born = performance.now(); strips.add(st); pv.strip = st; }
    // the ring round the copied composer, for a new session's look
    pv.card = copy.querySelector('[data-content-phase="hero"] [data-dshmu-pv-card], [data-phase="hero"] [data-dshmu-pv-card]');
    if (pv.card) {
      pv.card.parentElement.style.position = 'relative';
      pv.ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      pv.ring.setAttribute('class', 'dshmu-pv-ring');
      pv.ring.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
      pv.card.parentElement.append(pv.ring);
    }
    box.replaceChildren(frame);
    const fit = () => { const w = box.clientWidth; frame.style.height = `${Math.round((w * H) / W)}px`; scale.style.transform = `scale(${w / W})`; };
    fit();
    pv.ro = new ResizeObserver(fit); pv.ro.observe(box);
    pv.box = box;
    kick();
    return () => {
      pv.ro?.disconnect();
      if (pv.strip) strips.delete(pv.strip);
      Object.assign(pv, { box: null, strip: null, edge: null, ring: null, card: null, bgc: null, bgl: null, ro: null });
      box.replaceChildren();
    };
  }
  function paintPreview() {
    if (!pv.box) return;
    // the cover background: the real layer's picture, as strong as the real layer shows now
    const real = bg?.layer;
    const shown = real ? Number(real.style.opacity || 0) : 0;
    pv.bgl.style.opacity = String(shown);
    if (shown > 0) {
      const from = real.querySelector('canvas');
      if (pv.bgc.width !== from.width || pv.bgc.height !== from.height) { pv.bgc.width = from.width; pv.bgc.height = from.height; }
      pv.bgc.getContext('2d').drawImage(from, 0, 0);
    }
    pv.edge.style.opacity = String(pv.card ? 0 : glow.edgeOpacity());
    if (pv.ring) {
      pv.ring.firstChild.setAttribute('d', glow.ringPath(pv.card));
      pv.ring.style.opacity = media?.status === 'Playing' ? String(0.42 + 0.58 * glow.level()) : '0';
    }
  }
  function Preview() {
    const ref = React.useRef(null);
    React.useEffect(() => mountPreview(ref.current), []);
    return h('div', { ref, className: 'dshmu-pv-box' });
  }

  // ------------------------------------------------------------------ settings page
  // The lyric timing field. Held as typed: a number field reads "" while it holds "-" or "1." on the way to a number,
  // and setting it from the saved value then would wipe what is being typed. Back to the saved value on leaving it.
  function OffsetInput({ player, value, label }) {
    const [text, setText] = React.useState(String(value));
    React.useEffect(() => { setText((cur) => (cur !== '' && Number(cur) === value ? cur : String(value))); }, [player, value]);
    return h(Input, { type: 'number', step: 100, value: text, 'aria-label': label,
      onChange: (e) => {
        const v = e.target.value;
        setText(v);
        if (v.trim() !== '' && Number.isFinite(Number(v))) setSettings({ offsets: { [player]: Math.round(Number(v)) } });
      },
      onBlur: () => setText(String(value)) });
  }
  const useSettings = () => React.useSyncExternalStore((f) => { settingsListeners.add(f); return () => settingsListeners.delete(f); }, () => settings);
  function Settings({ view }) {
    const s = useSettings();
    const [pick, setPick] = React.useState(null);   // the player whose lyric timing is shown
    const bgName = s.backdrop === 0 ? 'off' : s.backdrop < 0.26 ? 'light' : s.backdrop < 0.4 ? 'medium' : 'strong';
    if (view === 'summary') return MUSIC_CODING ? t('summary', { mc: s.musicCoding ? t('on') : t('off'), bg: t(bgName) }) : t('summaryBg', { bg: t(bgName) });
    const row = (label, hint, control) => h('div', { className: 'dshmu-row' },
      h('span', null, h('span', null, label), hint ? h('span', { className: 'dshmu-hint' }, hint) : null), control);
    const seg = (id, label, value, options, onChange) => h(SegmentedControl, { id: `dshmu-${id}`, label, value, options, onChange });
    // the player playing now first, then those with a timing set, then the common ones
    const players = Array.from(new Set([media?.proc, ...Object.keys(s.offsets ?? {}).filter((p) => s.offsets[p]), 'Spotify', 'cloudmusic', 'QQMusic', 'KuGou'].filter(Boolean)));
    const player = players.includes(pick) ? pick : players[0];
    const playerName = (p) => { const k = `player_${p}`, v = t(k); return v && v !== k ? v : p; };
    const signed = (v) => `${v > 0 ? '+' : ''}${v}`;
    const duck = Math.round((s.duck ?? 0.5) * 100);
    return h('div', { className: 'dshmu-set' },
      view === 'page' && h(Preview),
      MUSIC_CODING && row(t('musicCoding'), t('musicCodingHint'), h(Switch, { checked: !!s.musicCoding, label: t('musicCoding'), onChange: (v) => setSettings({ musicCoding: v }) })),
      row(t('backdrop'), t('backdropHint'), seg('bg', t('backdrop'), bgName,
        ['off', 'light', 'medium', 'strong'].map((v) => ({ value: v, label: t(v) })),
        (v) => setSettings({ backdrop: { off: 0, light: 0.2, medium: 0.32, strong: 0.5 }[v] }))),
      row(t('lyricsOn'), t('lyricsOnHint'), h(Switch, { checked: s.lyrics !== false, label: t('lyricsOn'), onChange: (v) => setSettings({ lyrics: v }) })),
      row(t('translation'), t('translationHint'), h(Switch, { checked: s.translation !== false, disabled: s.lyrics === false, label: t('translation'), onChange: (v) => setSettings({ translation: v }) })),
      row(t('edgeGlow'), t('edgeGlowHint'), h(Switch, { checked: s.edgeGlow !== false, label: t('edgeGlow'), onChange: (v) => setSettings({ edgeGlow: v }) })),
      row(t('duck'), null, h('label', { className: 'dshmu-range' },
        h('input', { type: 'range', min: 0, max: 100, step: 5, value: duck, 'aria-label': t('duck'), onChange: (e) => setSettings({ duck: Number(e.target.value) / 100 }) }),
        h('span', null, `${duck}%`))),
      MUSIC_CODING && row(t('fadeIn'), null, seg('fade', t('fadeIn'), String(s.fadeIn ?? 8),
        ['5', '8', '10'].map((v) => ({ value: v, label: `${v}s` })), (v) => setSettings({ fadeIn: Number(v) }))),
      row(t('beat'), t('beatHint'), h(Switch, { checked: s.beat !== false, label: t('beat'), onChange: (v) => setSettings({ beat: v }) })),
      row(t('offsets'), t('offsetsHint'), h('div', { className: 'dshmu-offsets' },
        h('select', { className: 'dshmu-select', value: player, 'aria-label': t('offsetsPlayer'), onChange: (e) => setPick(e.target.value) },
          players.map((p) => h('option', { key: p, value: p }, s.offsets?.[p] ? `${playerName(p)}（${signed(s.offsets[p])}）` : playerName(p)))),
        h(OffsetInput, { player, value: s.offsets?.[player] ?? 0, label: `${t('offsets')} · ${playerName(player)}` }))),
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

  // ------------------------------------------------------------------ skipping songs; the player unfolded from the capsule
  // Songs changed from here slide the way they went (scrolled up / the previous-song button: back); any other change
  // goes forward. island.js is not built into the plugin for now (build.mjs); everything here runs without it.
  let skip = { dir: 1, at: 0 };
  const skipDir = () => (Date.now() - skip.at < 8000 ? skip.dir : 1);
  function skipSong(d) { skip = { dir: d, at: Date.now() }; command(d > 0 ? 'next' : 'prev'); }
  // The wheel on the capsule (or the island's cover): one song per notch, at most one every 450 ms (a trackpad's run of
  // small deltas counts once). Returns the way it went, or 0 when it did nothing.
  let wheelAt = 0;
  function wheelSkip(e) {
    const now = performance.now(), dy = e.deltaY || e.deltaX;
    if (now - wheelAt < 450 || Math.abs(dy) < 4) return 0;
    wheelAt = now;
    const d = dy > 0 ? 1 : -1;
    if (!media || (d > 0 ? media.next : media.prev) === false) return 0;
    skipSong(d);
    return d;
  }
  const island = typeof createIsland === 'function' ? createIsland({
    t, command, reduced, toggle, dir: skipDir, wheelSkip,
    media: () => media, cover: () => cover, lyrics: () => lyrics, position: () => position(),
    skip: skipSong,
    seek(ms) {   // answer the drag at once; the player's own report follows
      if (!media) return;
      ask(media.status, ms, 'pos');
      command(`seek ${Math.round(ms)}`); kick();
    },
    lyricsWord: () => t(lyricsStatus === 'searching' || expect > Date.now() ? 'searchingLyrics' : 'noLyrics'),
  }) : null;
  const BG_MS = 1500, BG_TINT = 55;
  let bg = null;   // { layer, view, cover, ready, want, p (0..1 shown), to, rate, raf, inMs }
  const smooth = (x) => x * x * (3 - 2 * x);
  function bgSet(b, p) {
    b.p = p;
    const e = smooth(p), html = document.documentElement;
    b.layer.style.opacity = String(e);
    if (p > 0) {
      if (!html.hasAttribute('data-dshmu-bg')) { html.setAttribute('data-dshmu-bg', ''); dshmuCaption(); }
      html.style.setProperty('--dshmu-tint', `${100 - (100 - BG_TINT) * e}%`);
    } else {
      if (html.hasAttribute('data-dshmu-bg')) { html.removeAttribute('data-dshmu-bg'); dshmuCaption(); }
      html.style.removeProperty('--dshmu-tint');
    }
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
    if (lifetime.signal.aborted) return;   // stopped: the next instance owns the layer now
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
  const glow = createGlow({
    reduced, carried: carried?.glow, cover: () => cover, edgeOn: () => settings.edgeGlow !== false,
    state: () => (!media ? 'none' : media.status === 'Playing' ? 'playing' : 'paused'),
  });
  let moving = false, lastFrame = 0;
  function frame(now) {
    raf = 0;
    const dt = Math.min(50, lastFrame ? now - lastFrame : 0); lastFrame = now;
    const hosts = [...indicators(), ...(pv.box ? pv.box.querySelectorAll('[data-dshmu-pv-running]') : [])].filter((e) => !embedded(e));
    const on = playing();
    const pos = on ? position() : 0, i = on ? lineAt(pos) : -1;
    if (hosts.length) {
      const l = on ? indicatorLine(pos, i) : null;
      for (const host of hosts) paintIndicator(host, pos, l);
      indKey = lineKey(l);
    }
    moving = false;
    // the capsule's beat bars move while they can be seen: the music plays and the row shows its controls
    let bars = false;
    for (const s of strips) {
      paintStrip(s, pos, i);
      if (s._bars && s.dataset.play === 'playing' && !reduced.matches
        && (s.dataset.mode !== 'lyric' || s.closest('[data-composer-dock]')?.matches(':hover, :focus-within'))) { s._bars.step(dt, true); bars = true; }
    }
    paintPreview();
    if ((on && (hosts.length || strips.size)) || moving || bars || (pv.box && media?.status === 'Playing')) raf = requestAnimationFrame(frame);
    else lastFrame = 0;
  }
  function kick() { if (!raf && !lifetime.signal.aborted) raf = requestAnimationFrame(frame); }   // a late timer after stop: nothing

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
      ctxPct: ctxLine.pct(), tail: tail?.save?.() ?? null, bg: !!bg && bg.p > 0, glow: glow.save() };
  }
  const onPageHide = () => { try { sessionStorage.setItem(CARRY_KEY, JSON.stringify({ ...carryOut(), tail: null })); } catch { } };

  // ------------------------------------------------------------------ lifetime
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-whale-music';
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
    clearTimeout(wantTimer);
    cancelAnimationFrame(raf); raf = 0;
    document.querySelectorAll('.dshmu-ts').forEach((e) => e.remove());
    document.querySelectorAll('.dshmu-on').forEach((e) => e.classList.remove('dshmu-on'));
    for (const s of strips) { delete s.dataset.mode; s.replaceChildren(); }
    clearInterval(snapTimer);
    ctxLine.dispose();
    island?.dispose();
    glow.dispose();
    tail?.dispose();
    const html = document.documentElement;
    const clear = () => { style.remove(); html.removeAttribute('data-dshmu-bg'); html.style.removeProperty('--dshmu-tint'); html.style.removeProperty('--dshmu-bg-strength'); dshmuCaption(); };
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
      { name: 'conversation.composer.dock', id: 'dsh-whale-music', order: -1 }, music.Strip));
    child.slots.inject('plugins.bundle.config', () => child.slots.register(
      { name: 'plugins.bundle.config', key: 'dsh-whale-music' }, music.Settings));
  });
  try { await ui; } catch (error) { await ui.dispose?.(); await unmount(); throw error; }
  return async () => { await ui.dispose?.(); await unmount(); };
}

exports.apply = apply;
exports.inject = ['remote', 'slots', 'locale'];
