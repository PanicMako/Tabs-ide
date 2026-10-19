/** Publisher identity verification is separate from package safety. */
export const publisherSealViewBox = "0 0 24 24";
export const publisherVerificationLabel = "Publisher identity checked by Tabs";
export const publisherVerificationExplanation =
  "Publisher identity checked by Tabs. This is not a security guarantee.";

// Shared by React and the public Exchange so the user-supplied design stays identical.
const cy = 14;
const radius = 8.2;
const stems = [1, -1].map((side) => {
  const x = 12 + side * radius * Math.sin(2.4);
  const y = cy + radius * Math.cos(2.4);
  return `M12 ${cy + radius}A${radius} ${radius} 0 0 ${side > 0 ? 0 : 1} ${x.toFixed(2)} ${y.toFixed(2)}`;
});
const leaves = [1, -1].flatMap((side) =>
  Array.from({ length: 7 }, (_, index) => {
    const angle = 0.3 + index * 0.3;
    const x = 12 + side * radius * Math.sin(angle);
    const y = cy + radius * Math.cos(angle);
    const tangent = (Math.atan2(-Math.sin(angle), side * Math.cos(angle)) * 180) / Math.PI;
    const rotation = tangent + side * (index % 2 ? -38 : 38);
    return { x, y, rotation, index };
  }),
);

export const publisherSealCss = `
.publisher-verification{position:relative;display:inline-flex;align-items:center;gap:6px;vertical-align:middle;flex:none}
.publisher-verification:focus-visible{outline:2px solid #6d86ff;outline-offset:3px;border-radius:4px}
.publisher-verification .vb{display:block;overflow:visible;flex:none}
.publisher-verification .vb-tooltip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);padding:6px 9px;border-radius:7px;background:#20283e;color:#fff;font:500 12px/1.4 system-ui,sans-serif;white-space:nowrap;box-shadow:0 3px 12px #0002;opacity:0;visibility:hidden;pointer-events:none;z-index:10}
.publisher-verification:hover .vb-tooltip,.publisher-verification:focus-visible .vb-tooltip,.catalog-publisher-badge-link:focus-visible .vb-tooltip{opacity:1;visibility:visible}
.vb .vb-draw{stroke-dasharray:1;stroke-dashoffset:1;animation:tabs-vb-draw .7s .7s cubic-bezier(.6,0,.2,1) forwards}
.vb .vb-stem{animation-delay:.1s}
.vb .vb-leaf,.vb .vb-disc,.vb .vb-crown{transform-box:fill-box}
.vb .vb-leaf{transform-origin:0 50%;animation:tabs-vb-grow .45s calc(var(--i)*60ms + .15s) cubic-bezier(.3,1.6,.5,1) both}
.vb .vb-disc{transform-origin:center;animation:tabs-vb-grow .5s .5s cubic-bezier(.3,1.6,.5,1) both}
.vb .vb-crown{animation:tabs-vb-drop .6s .75s cubic-bezier(.3,1.5,.5,1) both}
.vb-off *{animation:none!important}.vb-off .vb-draw{stroke-dashoffset:0}
@keyframes tabs-vb-draw{to{stroke-dashoffset:0}}
@keyframes tabs-vb-grow{from{transform:scale(0);opacity:0}}
@keyframes tabs-vb-drop{from{transform:translateY(-4px) scale(.8);opacity:0}60%{transform:translateY(.5px)}}
@media(prefers-reduced-motion:reduce){.vb *{animation:none!important}.vb .vb-draw{stroke-dashoffset:0}}
`;

/** Only fixed SVG geometry and a sanitized internal ID are inserted as markup. Never accepts publisher content. */
export function publisherSealMarkup(instanceId: string): string {
  const id = `tabs-vb-${instanceId.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const gradient = `${id}-g`;
  const dark = `${id}-d`;
  return `<style>${publisherSealCss}</style><defs>
<linearGradient id="${gradient}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8aa3ff"/><stop offset="1" stop-color="#3a4fe0"/></linearGradient>
<linearGradient id="${dark}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d86ff"/><stop offset="1" stop-color="#2b3dc4"/></linearGradient></defs>
${stems.map((d) => `<path class="vb-draw vb-stem" pathLength="1" d="${d}" fill="none" stroke="url(#${dark})" stroke-width="1.1" stroke-linecap="round"/>`).join("")}
${leaves.map(({ x, y, rotation, index }) => `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rotation.toFixed(1)})"><path class="vb-leaf" style="--i:${index}" d="M0 0C1.4-1.8 3.6-1.8 5 0 3.6 1.8 1.4 1.8 0 0z" fill="url(#${dark})"/></g>`).join("")}
<path class="vb-crown" fill="url(#${gradient})" d="M8.2 5.4L7.6 1.6 10.2 3.4 12 .8l1.8 2.6 2.6-1.8-.6 3.8z"/>
<circle class="vb-disc" cx="12" cy="14" r="5" fill="url(#${gradient})"/>
<path class="vb-draw" pathLength="1" d="M9.7 14.1l1.7 1.7 2.9-3.3" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`;
}
