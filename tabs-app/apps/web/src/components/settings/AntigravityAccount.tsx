import { ProviderAuthState, type ProviderInstanceId } from "@tabs/contracts";
import { Schema } from "effect";
import { CheckCircle2Icon, ArrowUpRightIcon, LoaderIcon } from "lucide-react";
import { GoogleLogo } from "../Icons";
import { useEffect, useRef, useState } from "react";
import { createWsNativeApi, getWsTransport } from "~/wsNativeApi";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function AntigravityAccount({
  instanceId,
  authenticated,
  onComplete,
}: {
  instanceId: ProviderInstanceId;
  authenticated: boolean;
  onComplete: () => void;
}) {
  const [auth, setAuth] = useState<ProviderAuthState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    if (!getWsTransport()) createWsNativeApi();
    let lastPhase: string | undefined;
    return getWsTransport()?.subscribeRpc(
      "provider.auth.subscribe",
      () => ({ instanceId }),
      Schema.decodeUnknownSync(ProviderAuthState),
      (next) => {
        setAuth(next);
        if (next.phase === "succeeded" && lastPhase !== "succeeded") complete.current();
        lastPhase = next.phase;
      },
      () => setError("Account status is unavailable. Refresh providers and try again."),
    );
  }, [instanceId]);
  const active =
    pending ||
    auth?.phase === "starting" ||
    auth?.phase === "waiting" ||
    auth?.phase === "verifying";
  const run = async (method: string, input: unknown) => {
    setPending(true);
    setError(null);
    try {
      await getWsTransport()?.request(method, input);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account operation failed.");
    } finally {
      setPending(false);
    }
  };
  const signedIn = authenticated || auth?.phase === "succeeded";
  return (
    <section
      className="border-t border-border/60 px-4 py-4 sm:px-5"
      aria-label="Antigravity Google account"
    >
      <div className="rounded-xl border border-border/60 bg-muted/15 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70">
              <GoogleLogo className="size-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <h3 className="text-sm font-medium">Google account</h3>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {signedIn ? (
                    <>
                      <CheckCircle2Icon className="size-3 text-emerald-500" /> Connected
                    </>
                  ) : active ? (
                    <>
                      <LoaderIcon className="size-3 animate-spin motion-reduce:animate-none" />{" "}
                      Connecting
                    </>
                  ) : (
                    "Connect to unlock your available models"
                  )}
                </span>
              </div>
              <p
                className="text-xs leading-relaxed text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {signedIn
                  ? "Google account connected. Available models are discovered from your account."
                  : (auth?.message ??
                    "Connect your Google account to discover the Antigravity models you can use.")}
              </p>
              {error ? (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              {active ? (
                <p className="text-xs text-muted-foreground font-medium" role="status">
                  {auth?.phase === "waiting"
                    ? "Waiting for Google sign-in…"
                    : auth?.phase === "verifying"
                      ? "Checking account and discovering models…"
                      : "Starting account check…"}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
            {!signedIn && !active ? (
              <Button
                size="sm"
                className="gap-2 rounded-full cursor-pointer"
                onClick={() => void run("provider.auth.start", { instanceId })}
              >
                Connect Google account <ArrowUpRightIcon className="size-3.5" />
              </Button>
            ) : null}
            {active && auth?.authorizationUrl ? (
              <Button
                size="sm"
                className="gap-2 rounded-full cursor-pointer"
                onClick={() =>
                  void ensureNativeApi()
                    .shell.openExternal(auth.authorizationUrl!)
                    .catch(() => setError("Could not open your browser. Try again."))
                }
              >
                Open Google sign-in
              </Button>
            ) : null}
            {active && auth?.flowId ? (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full cursor-pointer"
                disabled={pending}
                onClick={() =>
                  void run("provider.auth.cancel", { instanceId, flowId: auth.flowId })
                }
              >
                Cancel sign-in
              </Button>
            ) : null}
          </div>
        </div>

        {active && auth?.authorizationUrl ? (
          <div className="border-t border-border/40 pt-3">
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">
                Sign-in redirect did not finish automatically?
              </summary>
              <label className="block mt-2">
                Redirect URL
                <Input
                  type="password"
                  autoComplete="off"
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder="Paste the URL after Google sign-in"
                />
              </label>
              <Button
                size="sm"
                className="mt-2"
                disabled={pending || !callbackUrl.trim()}
                onClick={() => {
                  const url = callbackUrl.trim();
                  setCallbackUrl("");
                  void run("provider.auth.complete", {
                    instanceId,
                    flowId: auth.flowId,
                    callbackUrl: url,
                  });
                }}
              >
                Complete sign-in
              </Button>
            </details>
          </div>
        ) : null}
      </div>
    </section>
  );
}
