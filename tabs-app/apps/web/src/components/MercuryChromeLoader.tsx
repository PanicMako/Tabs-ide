import { useId } from "react";
import "./loaders.css";
import { cn } from "~/lib/utils";

interface MercuryChromeLoaderProps {
  /** Size of the loader container in pixels (default: 120) */
  size?: number;
  /** Custom CSS color string. If omitted, uses currentColor to adapt to light/dark mode */
  color?: string;
  className?: string;
}

export function MercuryChromeLoader({
  size = 120,
  color = "currentColor",
  className,
}: MercuryChromeLoaderProps) {
  const filterId = useId().replace(/:/g, "");
  const dotSize = size * 0.2; // 24px dot for 120px container
  const blurAmount = size * (10 / 120); // 10px blur for 120px container

  return (
    <div
      className={cn("relative flex items-center justify-center loader-respect-motion", className)}
      style={{
        color,
        width: size,
        height: size,
      }}
    >
      {/* Invisible SVG definition for the 3D chrome liquid physics */}
      <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
        <defs>
          <filter id={filterId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation={blurAmount} result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feSpecularLighting
              in="goo"
              surfaceScale="7"
              specularConstant="1.2"
              specularExponent="30"
              lightingColor="#ffffff"
              result="specular"
            >
              <fePointLight x="0" y="-100" z="200" />
            </feSpecularLighting>
            <feComposite in="specular" in2="goo" operator="in" result="specularMasked" />
            <feMerge>
              <feMergeNode in="goo" />
              <feMergeNode in="specularMasked" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      <div
        className="relative"
        style={{
          filter: `url(#${filterId})`,
          width: size,
          height: size,
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`absolute inset-0 ms-w${i}`}>
            <div
              style={{
                backgroundColor: "currentColor",
                position: "absolute",
                top: 0,
                left: "50%",
                marginLeft: -dotSize / 2,
                width: dotSize,
                height: dotSize,
                borderRadius: "50%",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
