/** Horizontal collision on the same project lane, in CSS pixels. */
export function overlaps(
  itemX: number,
  playerX: number,
  itemLane: number,
  playerLane: number,
): boolean {
  return itemLane === playerLane && Math.abs(itemX - playerX) < 35;
}

/** Jump immunity follows the board's actual height, including takeoff and landing. */
export function jumpHeight(remaining: number, duration: number): number {
  return Math.sin(Math.max(0, Math.min(1, remaining / duration)) * Math.PI) * 90;
}
export function runComplete(score: number, counts: number[], goal: number, quota: number): boolean {
  return score >= goal && counts.length === 3 && counts.every((count) => count >= quota);
}
export const intensity = {
  chill: {
    speed: 0.36,
    cap: 500,
    acceleration: 3,
    spawn: 1.1,
    obstacles: 0.32,
    lives: 4,
    goal: 15,
    duration: 100,
    quota: 3,
    jumpDuration: 0.65,
  },
  flow: {
    speed: 0.5,
    cap: 700,
    acceleration: 4,
    spawn: 0.85,
    obstacles: 0.45,
    lives: 3,
    goal: 20,
    duration: 80,
    quota: 5,
    jumpDuration: 0.55,
  },
  turbo: {
    speed: 0.7,
    cap: 980,
    acceleration: 6,
    spawn: 0.65,
    obstacles: 0.56,
    lives: 2,
    goal: 24,
    duration: 70,
    quota: 6,
    jumpDuration: 0.48,
  },
} as const;
export type Intensity = keyof typeof intensity;
