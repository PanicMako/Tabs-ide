import {
  FlaskConicalIcon,
  HeartIcon,
  PaletteIcon,
  PlusIcon,
  RocketIcon,
  ShieldCheckIcon,
  TerminalIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

/** Emblems a custom teammate can wear. */
export const EMBLEMS: ReadonlyArray<{ id: string; label: string; Icon: LucideIcon }> = [
  { id: "plus", label: "Plus", Icon: PlusIcon },
  { id: "rocket", label: "Rocket", Icon: RocketIcon },
  { id: "shield", label: "Shield", Icon: ShieldCheckIcon },
  { id: "flask", label: "Flask", Icon: FlaskConicalIcon },
  { id: "palette", label: "Palette", Icon: PaletteIcon },
  { id: "terminal", label: "Terminal", Icon: TerminalIcon },
  { id: "heart", label: "Heart", Icon: HeartIcon },
  { id: "zap", label: "Zap", Icon: ZapIcon },
];
export const DEFAULT_EMBLEM = "plus";

const LINE = "rgb(255 255 255 / 0.1)";
const SOFT = "rgb(255 255 255 / 0.06)";

/** A four-point sparkle centred on x, y. */
function sparkle(x: number, y: number, r: number): string {
  const n = r * 0.28;
  return `M ${x} ${y - r} L ${x + n} ${y - n} L ${x + r} ${y} L ${x + n} ${y + n} L ${x} ${y + r} L ${x - n} ${y + n} L ${x - r} ${y} L ${x - n} ${y - n} Z`;
}

/** What sits behind the mascot: a pattern that says what this teammate is about. */
export function RoleBackdrop({ art }: { art: string }) {
  return (
    <svg
      className="tm-art-backdrop"
      viewBox="0 0 200 170"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {art === "reviewer" ? (
        <g>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
            <g key={row}>
              <rect
                x="12"
                y={14 + row * 19}
                width={[120, 150, 90, 140, 70, 130, 100, 150][row]}
                height="7"
                rx="3.5"
                fill={row === 1 || row === 5 ? "var(--notch-body)" : LINE}
                opacity={row === 1 || row === 5 ? 0.35 : 1}
              />
              <text
                x="190"
                y={20 + row * 19}
                textAnchor="end"
                fontSize="9"
                fill={row === 1 || row === 5 ? "var(--notch-body)" : "transparent"}
                fontFamily="var(--font-mono)"
              >
                {row === 1 ? "+" : "−"}
              </text>
            </g>
          ))}
        </g>
      ) : art === "triager" ? (
        <g fill="none" stroke={LINE} strokeWidth="1">
          {[26, 52, 78, 104].map((r) => (
            <circle key={r} cx="100" cy="92" r={r} />
          ))}
          <path d="M100 -20 V 200 M -20 92 H 220" />
          <path d="M100 92 L 160 40 A 76 76 0 0 1 176 92 Z" fill={SOFT} stroke="none" />
          <circle cx="152" cy="62" r="3.5" fill="var(--notch-body)" stroke="none" />
          <circle cx="44" cy="120" r="2.5" fill="var(--notch-body)" stroke="none" opacity="0.7" />
        </g>
      ) : art === "captain" ? (
        <g fill="none" stroke={LINE} strokeWidth="1.2">
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d={`M -10 ${118 + i * 16} Q 20 ${106 + i * 16} 50 ${118 + i * 16} T 110 ${118 + i * 16} T 170 ${118 + i * 16} T 230 ${118 + i * 16}`}
              opacity={1 - i * 0.25}
            />
          ))}
          <path d="M 18 40 C 60 10, 110 70, 182 22" strokeDasharray="2 5" />
          {[
            [24, 28],
            [150, 16],
            [176, 54],
            [60, 56],
          ].map(([x, y]) => (
            <path key={`${x}${y}`} d={sparkle(x!, y!, 4)} fill={LINE} stroke="none" />
          ))}
        </g>
      ) : art === "docs" ? (
        <g>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
            <line
              key={row}
              x1="0"
              x2="200"
              y1={24 + row * 19}
              y2={24 + row * 19}
              stroke={SOFT}
              strokeWidth="1"
            />
          ))}
          <line x1="26" x2="26" y1="0" y2="170" stroke="var(--notch-body)" opacity="0.28" />
          <text
            x="160"
            y="34"
            fontSize="15"
            fill={LINE}
            fontFamily="var(--font-mono)"
            textAnchor="middle"
          >
            {"</>"}
          </text>
        </g>
      ) : (
        <g fill="none" stroke={LINE} strokeWidth="1">
          {[34, 62, 92].map((r) => (
            <circle key={r} cx="100" cy="90" r={r} strokeDasharray={r === 62 ? "3 5" : undefined} />
          ))}
          {[
            [100, -4],
            [186, 112],
            [36, 150],
          ].map(([x, y]) => (
            <circle key={`${x}${y}`} cx={x} cy={y} r="3" fill="var(--notch-body)" stroke="none" />
          ))}
        </g>
      )}
    </svg>
  );
}

const PAPER = "#f6f3ec";

/**
 * What the mascot wears, drawn in the mark's own artwork units (the head is the top left, the
 * open space above the body is on the right) so it moves with the mascot.
 */
export function RoleProps({ art, emblem }: { art: string; emblem?: string }): ReactNode {
  // Only the custom card dresses the mascot: its emblem. The starters wear the plain logo.
  if (art !== "custom") return null;
  const Icon = (EMBLEMS.find((item) => item.id === emblem) ?? EMBLEMS[0]!).Icon;
  return (
    <g>
      <circle cx="278" cy="84" r="52" fill="rgb(255 255 255 / 0.1)" />
      <Icon
        x={236}
        y={42}
        width={84}
        height={84}
        color={PAPER}
        strokeWidth={1.7}
        aria-hidden="true"
      />
    </g>
  );
}
