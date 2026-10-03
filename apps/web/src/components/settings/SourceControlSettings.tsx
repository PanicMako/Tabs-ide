import { useState } from "react";
import * as Option from "effect/Option";
import { Badge } from "~/components/ui/badge";
import { Switch } from "~/components/ui/switch";
import { Button } from "~/components/ui/button";
import { useSourceControlDiscovery } from "~/lib/sourceControlReactQuery";
import { ChevronDownIcon, RefreshCwIcon, DownloadIcon, LogInIcon } from "lucide-react";
import {
  GitHubIcon,
  GitLabIcon,
  AzureDevOpsIcon,
  BitbucketIcon,
  GitIcon,
  JujutsuIcon,
} from "~/components/Icons";
import { cn } from "~/lib/utils";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SettingsSection } from "./SettingsLayout";
import { useTheme } from "~/hooks/useTheme";
import { getActiveFontCombo } from "~/lib/themes";

const SOURCE_CONTROL_COMMANDS: Record<string, { name: string; install?: string; login?: string }> =
  {
    github: {
      name: "GitHub CLI",
      install: "brew install gh",
      login: "gh auth login",
    },
    gitlab: {
      name: "GitLab CLI",
      install: "brew install glab",
      login: "glab auth login",
    },
    "azure-devops": {
      name: "Azure CLI",
      install: "brew install azure-cli && az extension add --name azure-devops",
      login: "az login",
    },
    git: {
      name: "Git",
      install: "brew install git",
    },
    jujutsu: {
      name: "Jujutsu",
      install: "brew install jujutsu",
    },
  };

const SOURCE_CONTROL_PROVIDER_ICONS = {
  github: GitHubIcon,
  gitlab: GitLabIcon,
  "azure-devops": AzureDevOpsIcon,
  bitbucket: BitbucketIcon,
};

const VCS_ICONS = {
  git: GitIcon,
  jujutsu: JujutsuIcon,
};

function itemStatusDot(item: {
  available?: boolean;
  cliAvailable?: boolean;
  authenticated?: boolean;
}) {
  const available = item.available ?? item.cliAvailable ?? false;
  if (!available) return "bg-muted-foreground/35";
  if ("authenticated" in item && !item.authenticated) return "bg-warning";
  return "bg-success";
}

interface SourceControlSettingsPanelProps {
  readonly startProviderAction: (input: {
    provider: any;
    providerName: string;
    command: string;
    kind: "install" | "login" | "update";
  }) => void;
  readonly providerActionBusy: boolean;
}

export function SourceControlSettingsPanel({
  startProviderAction,
  providerActionBusy,
}: SourceControlSettingsPanelProps) {
  const { fontPreferences } = useTheme();
  const activeFontCombo = getActiveFontCombo(fontPreferences);
  const { data, isLoading, error, refetch, isFetching } = useSourceControlDiscovery();
  const [isJjExpanded, setIsJjExpanded] = useState(false);

  const handleScan = () => {
    refetch();
  };

  const scanButton = (
    <Button
      size="icon-xs"
      variant="ghost"
      className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
      onClick={handleScan}
      disabled={isLoading || isFetching}
      aria-label="Rescan server environment"
    >
      <RefreshCwIcon className={cn("size-3.5", (isLoading || isFetching) && "animate-spin")} />
    </Button>
  );

  if (isLoading && !data) {
    return (
      <div className="space-y-6">
        <div className="mb-2 space-y-1.5">
          <h2
            className={cn(
              "text-[28px] leading-relaxed pb-1 text-foreground mb-2 font-bold",
              activeFontCombo.sansClass,
            )}
            style={{ fontFamily: "var(--font-sans)", textTransform: "capitalize" }}
          >
            Source Control
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage version control systems, code hosting providers, and authentication status.
          </p>
        </div>
        <SettingsSection title="Version Control" headerAction={scanButton}>
          <div className="p-6 text-center text-xs text-muted-foreground">
            Scanning environment...
          </div>
        </SettingsSection>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="mb-2 space-y-1.5">
          <h2
            className={cn(
              "text-[28px] leading-relaxed pb-1 text-foreground mb-2 font-bold",
              activeFontCombo.sansClass,
            )}
            style={{ fontFamily: "var(--font-sans)", textTransform: "capitalize" }}
          >
            Source Control
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage version control systems, code hosting providers, and authentication status.
          </p>
        </div>
        <SettingsSection title="Version Control" headerAction={scanButton}>
          <div className="p-6 text-center text-xs text-destructive">
            Failed to scan environment: {error instanceof Error ? error.message : String(error)}
          </div>
        </SettingsSection>
      </div>
    );
  }

  const vcs = (data?.versionControlSystems ?? []).map((item) => ({
    system: item.kind === "jj" ? "jujutsu" : item.kind,
    available: item.status === "available",
    version: Option.getOrNull(item.version),
  }));
  const providers = (data?.sourceControlProviders ?? []).map((item) => ({
    provider: item.kind,
    cliAvailable: item.status === "available",
    authenticated: item.auth.status === "authenticated",
    authenticatedAs: Option.getOrNull(item.auth.account),
    version: Option.getOrNull(item.version),
    installInstructions: item.installHint,
  }));

  return (
    <div className="space-y-6">
      <div>
        <div className="space-y-1.5">
          <h2
            className={cn(
              "text-[28px] leading-relaxed pb-1 text-foreground mb-2 font-bold",
              activeFontCombo.sansClass,
            )}
            style={{ fontFamily: "var(--font-sans)", textTransform: "capitalize" }}
          >
            Source Control
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage version control systems, code hosting providers, and authentication status.
          </p>
        </div>
        <div
          className="h-[5px] w-full my-5 rounded-full dark:block hidden"
          style={{ background: "linear-gradient(to right, rgba(255,255,255,0.25), transparent)" }}
        />
        <div
          className="h-[5px] w-full my-5 rounded-full dark:hidden block"
          style={{ background: "linear-gradient(to right, rgba(0,0,0,0.12), transparent)" }}
        />
      </div>

      <SettingsSection title="Version Control" headerAction={scanButton}>
        {vcs.map((item) => {
          const Icon = VCS_ICONS[item.system as keyof typeof VCS_ICONS];
          const dotClassName = itemStatusDot(item);
          const hasDetails = item.system === "jujutsu";
          const isExpanded = item.system === "jujutsu" && isJjExpanded;

          return (
            <div key={item.system} className="border-t border-border/60 first:border-t-0">
              <div className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {Icon && (
                        <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
                          <Icon className="size-4.5 text-foreground/80" aria-hidden />
                          <span
                            className={cn(
                              "pointer-events-none absolute -left-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background",
                              dotClassName,
                            )}
                            aria-hidden
                          />
                        </span>
                      )}
                      <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground capitalize">
                        {item.system}
                      </span>
                      {item.version ? (
                        <code className="text-xs text-muted-foreground">{item.version}</code>
                      ) : null}
                      {item.system === "jujutsu" && (
                        <Badge variant="warning" size="sm">
                          Coming Soon
                        </Badge>
                      )}
                      {item.available && (
                        <Badge variant="success" size="sm">
                          Available
                        </Badge>
                      )}
                    </div>
                    <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground/80">
                      {item.system === "git" ? (
                        <span>Git is configured and available for code operations.</span>
                      ) : (
                        <span>Support for Jujutsu is coming soon.</span>
                      )}
                    </p>
                  </div>
                  <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
                    {!item.available && SOURCE_CONTROL_COMMANDS[item.system]?.install && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 px-2.5 text-xs"
                        disabled={providerActionBusy}
                        onClick={() =>
                          startProviderAction({
                            provider: item.system,
                            providerName: SOURCE_CONTROL_COMMANDS[item.system]!.name,
                            command: SOURCE_CONTROL_COMMANDS[item.system]!.install!,
                            kind: "install",
                          })
                        }
                      >
                        <DownloadIcon className="size-3.5" />
                        Install
                      </Button>
                    )}
                    {hasDetails && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setIsJjExpanded((open) => !open)}
                      >
                        <ChevronDownIcon
                          className={cn(
                            "size-3.5 transition-transform",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </Button>
                    )}
                    <Switch checked={item.available} disabled />
                  </div>
                </div>
              </div>
              {hasDetails && isExpanded && (
                <div className="border-t border-border/60 bg-muted/10 px-4 py-3 text-xs text-muted-foreground sm:px-5">
                  Jujutsu (jj) is a next-generation Git-compatible version control system. Support
                  for local Jujutsu workspaces is coming in a future release.
                </div>
              )}
            </div>
          );
        })}
      </SettingsSection>

      <SettingsSection title="Source Control Providers">
        {providers.map((item) => {
          const Icon =
            item.provider in SOURCE_CONTROL_PROVIDER_ICONS
              ? SOURCE_CONTROL_PROVIDER_ICONS[
                  item.provider as keyof typeof SOURCE_CONTROL_PROVIDER_ICONS
                ]
              : null;
          const dotClassName = itemStatusDot(item);

          return (
            <div key={item.provider} className="border-t border-border/60 first:border-t-0">
              <div className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {Icon && (
                        <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
                          <Icon className="size-4.5 text-foreground/80" aria-hidden />
                          <span
                            className={cn(
                              "pointer-events-none absolute -left-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background",
                              dotClassName,
                            )}
                            aria-hidden
                          />
                        </span>
                      )}
                      <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground capitalize">
                        {item.provider === "azure-devops" ? "Azure DevOps" : item.provider}
                      </span>
                      {item.cliAvailable && item.version ? (
                        <code className="text-xs text-muted-foreground">{item.version}</code>
                      ) : null}
                      {item.cliAvailable && !item.authenticated && (
                        <Badge variant="warning" size="sm">
                          Not authenticated
                        </Badge>
                      )}
                      {item.cliAvailable && item.authenticated && (
                        <Badge variant="success" size="sm">
                          Authenticated
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground/80">
                      {item.cliAvailable ? (
                        item.authenticated ? (
                          <span>
                            Authenticated as{" "}
                            <strong>
                              <RedactedSensitiveText
                                value={item.authenticatedAs}
                                ariaLabel="Toggle source control account visibility"
                                revealTooltip="Click to reveal account"
                                hideTooltip="Click to hide account"
                              />
                            </strong>
                            . Pull request and issue integrations are enabled.
                          </span>
                        ) : (
                          <span>
                            CLI is installed, but not authenticated. Run the authentication command
                            for <strong>{item.provider}</strong> on your server host to enable pull
                            request integrations.
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground/60 leading-relaxed block">
                          {item.installInstructions}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
                    {!item.cliAvailable && SOURCE_CONTROL_COMMANDS[item.provider]?.install && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 px-2.5 text-xs"
                        disabled={providerActionBusy}
                        onClick={() =>
                          startProviderAction({
                            provider: item.provider,
                            providerName: SOURCE_CONTROL_COMMANDS[item.provider]!.name,
                            command: SOURCE_CONTROL_COMMANDS[item.provider]!.install!,
                            kind: "install",
                          })
                        }
                      >
                        <DownloadIcon className="size-3.5" />
                        Install
                      </Button>
                    )}
                    {item.cliAvailable &&
                      !item.authenticated &&
                      SOURCE_CONTROL_COMMANDS[item.provider]?.login && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 px-2.5 text-xs"
                          disabled={providerActionBusy}
                          onClick={() =>
                            startProviderAction({
                              provider: item.provider,
                              providerName: SOURCE_CONTROL_COMMANDS[item.provider]!.name,
                              command: SOURCE_CONTROL_COMMANDS[item.provider]!.login!,
                              kind: "login",
                            })
                          }
                        >
                          <LogInIcon className="size-3.5" />
                          Sign in
                        </Button>
                      )}
                    <Switch checked={item.cliAvailable && item.authenticated} disabled />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </SettingsSection>

      <p className="text-xs text-muted-foreground/60 px-0.5">
        Install the required CLI tools to enable provider authentication and pull request
        integrations. Tabs scans your environment automatically — hit the refresh icon above to
        re-scan.
      </p>
    </div>
  );
}
