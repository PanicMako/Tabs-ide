export type SnapShotSoundStyle = "soft-pop" | "camera-shutter";

export interface SnapShotFeedbackOptions {
  readonly flash: boolean;
  /** The sound to play, or null for silence. */
  readonly sound: SnapShotSoundStyle | null;
  /** The person asked for less motion; the flash is skipped, the sound is not affected. */
  readonly reducedMotion: boolean;
}

/** What to show and play for a capture, given the settings and the motion preference. */
export function snapShotFeedbackPlan(options: SnapShotFeedbackOptions): {
  readonly flash: boolean;
  readonly sound: SnapShotSoundStyle | null;
} {
  return { flash: options.flash && !options.reducedMotion, sound: options.sound };
}

function flashScreen(): void {
  const veil = document.createElement("div");
  veil.setAttribute("aria-hidden", "true");
  Object.assign(veil.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "#fff",
    pointerEvents: "none",
    opacity: "0",
  });
  document.body.appendChild(veil);
  const animation = veil.animate([{ opacity: 0.55 }, { opacity: 0 }], {
    duration: 180,
    easing: "ease-out",
  });
  const remove = () => veil.remove();
  animation.addEventListener("finish", remove);
  animation.addEventListener("cancel", remove);
}

/** Each style as [start offset, frequency, wave, length] steps, synthesized so no sound file ships. */
const SOUND_STEPS: Record<
  SnapShotSoundStyle,
  ReadonlyArray<readonly [number, number, OscillatorType, number]>
> = {
  "soft-pop": [[0, 520, "sine", 0.09]],
  "camera-shutter": [
    [0, 1800, "square", 0.04],
    [0.045, 900, "square", 0.04],
  ],
};

function playSound(style: SnapShotSoundStyle): void {
  const Context =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  const audio = new Context();
  const now = audio.currentTime;
  for (const [offset, frequency, type, length] of SOUND_STEPS[style]) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.06, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + length);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + length + 0.005);
  }
  window.setTimeout(() => void audio.close(), 400);
}

/** The visible and audible cue that a capture was taken. Never throws: it is only a cue. */
export function playSnapShotFeedback(options: SnapShotFeedbackOptions): void {
  const plan = snapShotFeedbackPlan(options);
  try {
    if (plan.flash) flashScreen();
    if (plan.sound) playSound(plan.sound);
  } catch {
    // A blocked audio context or a missing document must never break the capture.
  }
}
