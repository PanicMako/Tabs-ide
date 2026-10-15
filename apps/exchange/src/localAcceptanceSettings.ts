import { fixtureEndpoint } from "./browserFixture.ts";

/** A narrowly scoped launcher for the user-confirmed owner and local services. */
export function localAcceptanceSettings(environment: Record<string, string | undefined>) {
  if (environment.EXCHANGE_ORIGIN !== "http://localhost:8787")
    throw new Error("Local acceptance requires the registered http://localhost:8787 origin.");
  if (environment.EXCHANGE_VISIBILITY !== "private")
    throw new Error("Local acceptance must remain private.");
  if (environment.EXCHANGE_OPERATOR_GITHUB_IDS?.trim() !== "121330302")
    throw new Error("Local acceptance requires the confirmed PanicMako operator ID.");
  const allowed = (environment.EXCHANGE_ALLOWED_GITHUB_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!allowed.includes("121330302") || allowed.some((id) => !/^[1-9][0-9]*$/.test(id)))
    throw new Error(
      "The private allowlist must contain the confirmed owner and valid numeric IDs.",
    );
  if (!environment.GITHUB_CLIENT_ID?.trim() || !environment.GITHUB_CLIENT_SECRET?.trim())
    throw new Error(
      "Save the OAuth Client ID and client secret in the private local configuration first.",
    );
  if (environment.NODE_ENV === "test" || environment.TABS_EXCHANGE_BROWSER_FIXTURE === "1")
    throw new Error("Real-account acceptance cannot use fixture authentication.");
  const database = fixtureEndpoint(
    environment.TEST_DATABASE_URL ??
      "postgres://tabs_exchange:testpassword@127.0.0.1:5433/tabs_exchange",
    ["postgres:", "postgresql:"],
  );
  const storage = fixtureEndpoint(environment.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9090", [
    "http:",
  ]);
  if (
    database.search ||
    database.hash ||
    !database.username ||
    storage.username ||
    storage.password ||
    storage.search ||
    storage.pathname !== "/"
  )
    throw new Error("Use explicit loopback test-service endpoints without extra URL settings.");
  return { database, storage };
}

export interface LocalAcceptanceState {
  version: 1;
  kind: "real-github-local";
  database: string;
  bucket: string;
  createdAt: string;
}
export function acceptanceState(value: unknown): LocalAcceptanceState {
  if (!value || typeof value !== "object") throw new Error("Invalid local acceptance state.");
  const state = value as Partial<LocalAcceptanceState>;
  if (
    state.version !== 1 ||
    state.kind !== "real-github-local" ||
    typeof state.database !== "string" ||
    !/^tabs_exchange_auth_[a-f0-9]{16}$/.test(state.database) ||
    typeof state.bucket !== "string" ||
    !/^tabs-exchange-auth-[a-f0-9]{16}$/.test(state.bucket) ||
    state.database.slice("tabs_exchange_auth_".length) !==
      state.bucket.slice("tabs-exchange-auth-".length) ||
    typeof state.createdAt !== "string" ||
    !Number.isFinite(Date.parse(state.createdAt))
  )
    throw new Error(
      "Invalid local acceptance resource identity. Refusing to open unrelated resources.",
    );
  return state as LocalAcceptanceState;
}
