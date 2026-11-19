import { repositoryGroupingKeyOf, type ExecutionEnvironmentDescriptor } from "@tabs/contracts";
import { MonitorIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../types";
import {
  connectedEnvironmentIds,
  environmentConfig,
  onEnvironmentApiRegistryEvent,
} from "../connection/environmentApiRegistry";
import { toastManager } from "./ui/toast";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

export function resolveComposerMachines(
  project: Project,
  projects: readonly Project[],
  environments: readonly ExecutionEnvironmentDescriptor[],
) {
  const key = project.repositoryIdentity
    ? repositoryGroupingKeyOf(project.repositoryIdentity)
    : null;
  return environments.map((environment) => ({
    environmentId: environment.environmentId,
    label: environment.label,
    project:
      environment.environmentId === project.environmentId
        ? project
        : (projects.find(
            (candidate) =>
              candidate.environmentId === environment.environmentId &&
              key !== null &&
              candidate.repositoryIdentity != null &&
              repositoryGroupingKeyOf(candidate.repositoryIdentity) === key,
          ) ?? null),
  }));
}

/** The next machine after the current one that has this project, wrapping around. */
export function nextComposerMachine<T extends { environmentId: string; project: unknown }>(
  options: readonly T[],
  currentEnvironmentId: string | undefined,
): T | null {
  const usable = options.filter((option) => option.project);
  if (usable.length < 2) return null;
  const index = usable.findIndex((option) => option.environmentId === currentEnvironmentId);
  return usable[(index + 1) % usable.length] ?? null;
}

export const COMPOSER_CYCLE_HOST_EVENT = "tabs:composer-cycle-host";

export function BranchToolbarEnvironmentSelector({
  project,
  projects,
  locked,
  onChange,
}: {
  project: Project;
  projects: readonly Project[];
  locked: boolean;
  onChange?: ((project: Project) => Promise<void>) | undefined;
}) {
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  useEffect(() => onEnvironmentApiRegistryEvent(() => setRevision((value) => value + 1)), []);
  const options = useMemo(() => {
    const environments = connectedEnvironmentIds().flatMap((id) => {
      const descriptor = environmentConfig(id)?.environment;
      return descriptor ? [descriptor] : [];
    });
    return resolveComposerMachines(project, projects, environments);
  }, [project, projects, revision]);
  const active = options.find((option) => option.environmentId === project.environmentId);
  const items = options.map((option) => ({ value: option.environmentId, label: option.label }));
  const disabled =
    locked || pending || !onChange || options.filter((option) => option.project).length < 2;
  const cycleRef = useRef<() => void>(() => {});
  cycleRef.current = () => {
    const target = nextComposerMachine(options, project.environmentId)?.project;
    if (!target || disabled || !onChange) return;
    setPending(true);
    void onChange(target as Project)
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not change machines",
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => setPending(false));
  };
  useEffect(() => {
    const listener = () => cycleRef.current();
    window.addEventListener(COMPOSER_CYCLE_HOST_EVENT, listener);
    return () => window.removeEventListener(COMPOSER_CYCLE_HOST_EVENT, listener);
  }, []);
  // The primary machine exists without any remote connection being configured.
  // A selector only adds information when there is a second connected machine.
  if (options.length < 2) return null;
  return (
    <Select
      value={project.environmentId ?? null}
      items={items}
      onValueChange={(value) => {
        const target = options.find((option) => option.environmentId === value)?.project;
        if (!target || disabled || target.environmentId === project.environmentId) return;
        setPending(true);
        void onChange(target)
          .catch((error) => {
            toastManager.add({
              type: "error",
              title: "Could not change machines",
              description: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => setPending(false));
      }}
    >
      <SelectTrigger
        aria-label="Run on machine"
        variant="ghost"
        size="xs"
        disabled={disabled}
        title={
          locked
            ? "Started conversations stay on their original machine"
            : "Select a connected machine with this project"
        }
      >
        <MonitorIcon className="size-3 shrink-0" aria-hidden="true" />
        <SelectValue className="max-w-36 truncate">{active?.label ?? "Local machine"}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem
            key={option.environmentId}
            value={option.environmentId}
            disabled={!option.project}
          >
            {option.label}
            {!option.project ? " — project not added" : ""}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
