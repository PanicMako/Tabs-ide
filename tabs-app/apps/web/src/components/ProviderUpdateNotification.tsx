import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import {
  collectProviderUpdateCandidates,
  providerUpdateNotificationKey,
} from "../providerUpdateNotification";
import { serverConfigAtom } from "../state/settings";
import { toastManager } from "./ui/toast";

const seenNotificationKeys = new Set<string>();
type ToastId = ReturnType<typeof toastManager.add>;

export function ProviderUpdateNotification() {
  const navigate = useNavigate();
  const providers = useAtomValue(serverConfigAtom)?.providers ?? [];
  const dismissedKeys = useSettings((settings) => settings.dismissedProviderUpdateNotificationKeys);
  const { updateSettings } = useUpdateSettings();
  const candidates = useMemo(() => collectProviderUpdateCandidates(providers), [providers]);
  const notificationKey = useMemo(() => providerUpdateNotificationKey(candidates), [candidates]);
  const activeToast = useRef<{ key: string; id: ToastId } | null>(null);

  useEffect(
    () => () => {
      if (activeToast.current) toastManager.close(activeToast.current.id);
      activeToast.current = null;
    },
    [],
  );

  useEffect(() => {
    if (activeToast.current && activeToast.current.key !== notificationKey) {
      toastManager.close(activeToast.current.id);
      activeToast.current = null;
    }
    if (
      !notificationKey ||
      activeToast.current ||
      dismissedKeys.includes(notificationKey) ||
      seenNotificationKeys.has(notificationKey)
    ) {
      return;
    }

    seenNotificationKeys.add(notificationKey);
    const title =
      candidates.length === 1
        ? `${candidates[0]!.displayName} update available`
        : `${candidates.length} provider updates available`;
    const description = candidates
      .map((candidate) =>
        candidate.currentVersion
          ? `${candidate.displayName} ${candidate.currentVersion} → ${candidate.latestVersion}`
          : `${candidate.displayName} ${candidate.latestVersion}`,
      )
      .join(" · ");
    let id!: ToastId;
    id = toastManager.add({
      type: "info",
      title,
      description,
      timeout: 0,
      actionProps: {
        children: "Settings",
        onClick: () => {
          toastManager.close(id);
          activeToast.current = null;
          void navigate({ to: "/settings" });
        },
      },
      data: {
        onClose: () => {
          updateSettings({
            dismissedProviderUpdateNotificationKeys: [...dismissedKeys, notificationKey],
          });
          activeToast.current = null;
        },
      },
    });
    activeToast.current = { key: notificationKey, id };
  }, [candidates, dismissedKeys, navigate, notificationKey, updateSettings]);

  return null;
}
