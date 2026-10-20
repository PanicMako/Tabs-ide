export interface StartupSplashState {
  ready: boolean;
  error: string | null;
  delayed: boolean;
}

const initial: StartupSplashState = { ready: false, error: null, delayed: false };
let snapshot = initial;
let active = false;
const listeners = new Set<() => void>();

export function activateStartupSplash(): () => void {
  active = true;
  snapshot = initial;
  return () => {
    active = false;
  };
}

export function hasEarlyStartupSplash(): boolean {
  return active;
}

export function getStartupSplashState(): StartupSplashState {
  return snapshot;
}

export function subscribeStartupSplash(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateStartupSplash(update: Partial<StartupSplashState>): void {
  snapshot = { ...snapshot, ...update };
  for (const listener of listeners) listener();
}
