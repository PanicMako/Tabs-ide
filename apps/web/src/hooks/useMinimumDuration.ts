import { useState, useEffect } from "react";

/**
 * Ensures a boolean state only becomes true after a minimum amount of time has elapsed.
 * Useful for preventing loading spinners or splash screens from flashing for a single frame.
 */
export function useMinimumDuration(ready: boolean, minMs: number): boolean {
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, minMs);
    return () => {
      clearTimeout(timer);
    };
  }, [minMs]);

  return ready && minTimeElapsed;
}
