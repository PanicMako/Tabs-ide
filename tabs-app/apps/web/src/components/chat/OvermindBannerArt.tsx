import { BannerCanvas, hash, rgba, spectrum, type BannerArt } from "./bannerCanvas";
import { band, drawDotField, restingField, sweepAt, type Light, type Paint } from "./dotField";
import { createRippleWash } from "./rippleWash";

/**
 * The live strip in the `/overmind` banner, from the team chevron to the end of
 * the prompt box: a pixel field in the full spectrum, one colour per worker in
 * spirit. Two sweeps cross it while single pixels twinkle in between. When the
 * lead runs at ultrathink, the violet ripples spread underneath the workers.
 */
const sparkle: Light = (c) => {
  let v = restingField(c, 0.24);
  for (let k = 0; k < 2; k += 1) {
    v += band(c.x, c.y, c.h, sweepAt(c.t, c.w, 0.2, k, 2), 1.2, 55) * 0.7;
  }
  const seed = hash(c.row * 311 + c.col);
  const twinkle = Math.max(0, Math.sin(c.t * (1.2 + seed * 2.5) + seed * 60));
  return v + twinkle ** 14 * 0.85;
};

const rainbow: Paint = (c, v, dark) =>
  rgba(spectrum(c.u * 0.8 - c.t * 0.08 + (c.y / c.h) * 0.12), dark ? v : v * 0.9);

const makeArt = (): BannerArt => (frame) => drawDotField(frame, sparkle, rainbow);

const makeUltrathinkArt = (): BannerArt => {
  const wash = createRippleWash();
  return (frame) => {
    wash(frame, frame.dark ? 0.42 : 0.28);
    drawDotField(frame, sparkle, rainbow, { clear: false });
  };
};

export function OvermindBannerArt(props: { readonly ultrathink?: boolean }) {
  return props.ultrathink ? (
    <BannerCanvas artKey="overmind-ultrathink" className="banner-art" makeArt={makeUltrathinkArt} />
  ) : (
    <BannerCanvas artKey="overmind" className="banner-art" makeArt={makeArt} />
  );
}
