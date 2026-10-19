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

/** Only fixed SVG geometry and a sanitized internal ID are inserted as markup. Never accepts publisher content. */
export function publisherSealMarkup(instanceId: string): string {
  const id = `tabs-vb-${instanceId.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const gradient = `${id}-g`;
  const dark = `${id}-d`;
  return `<defs>
<linearGradient id="${gradient}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8aa3ff"/><stop offset="1" stop-color="#3a4fe0"/></linearGradient>
<linearGradient id="${dark}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d86ff"/><stop offset="1" stop-color="#2b3dc4"/></linearGradient></defs>
${stems.map((d) => `<path class="vb-draw vb-stem" pathLength="1" d="${d}" fill="none" stroke="url(#${dark})" stroke-width="1.1" stroke-linecap="round"/>`).join("")}
${leaves.map(({ x, y, rotation, index }) => `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rotation.toFixed(1)})"><path class="vb-leaf vb-leaf-${index}" d="M0 0C1.4-1.8 3.6-1.8 5 0 3.6 1.8 1.4 1.8 0 0z" fill="url(#${dark})"/></g>`).join("")}
<path class="vb-crown" fill="url(#${gradient})" d="M8.2 5.4L7.6 1.6 10.2 3.4 12 .8l1.8 2.6 2.6-1.8-.6 3.8z"/>
<circle class="vb-disc" cx="12" cy="14" r="5" fill="url(#${gradient})"/>
<path class="vb-draw" pathLength="1" d="M9.7 14.1l1.7 1.7 2.9-3.3" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`;
}
