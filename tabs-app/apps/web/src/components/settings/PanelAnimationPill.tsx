import type { CSSProperties } from "react";
import "./PanelAnimationPill.css";

/** A native slider supplies pointer, touch and keyboard behavior beneath the value pill. */
export function PanelAnimationPill({
  value,
  onValueChange,
  onBlur,
}: {
  value: number;
  onValueChange: (value: number) => void;
  onBlur?: () => void;
}) {
  const duration = Math.max(0, Math.min(400, value));
  return (
    <div
      className="panel-animation-pill"
      style={{ "--duration-progress": duration / 400 } as CSSProperties}
    >
      <div className="panel-animation-pill-track" aria-hidden="true">
        <div className="panel-animation-pill-fill" />
        <div className="panel-animation-pill-detents">
          {[0, 100, 200, 300, 400].map((mark) => (
            <span key={mark} />
          ))}
        </div>
        <span className="panel-animation-pill-value">
          {duration === 0 ? "Off" : `${duration} ms`}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={400}
        step={25}
        value={duration}
        aria-label="Panel animation duration"
        aria-valuetext={duration === 0 ? "Off, instant panel changes" : `${duration} milliseconds`}
        onChange={(event) => onValueChange(Number(event.target.value))}
        onBlur={onBlur}
      />
    </div>
  );
}
