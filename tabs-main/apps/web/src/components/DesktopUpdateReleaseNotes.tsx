import ReactMarkdown from "react-markdown";
import type { ReactNode } from "react";
import type { DesktopUpdateState } from "@tabs/contracts";
import { XIcon } from "lucide-react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function isSafeExternalReleaseNotesUrl(href: string | undefined): href is string {
  if (!href) return false;
  try {
    const protocol = new URL(href).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function ReleaseNotesLink({
  href,
  children,
}: {
  href?: string | undefined;
  children?: ReactNode | undefined;
}) {
  if (!isSafeExternalReleaseNotesUrl(href)) return <span>{children}</span>;
  return (
    <a
      href={href}
      className="text-primary underline underline-offset-2"
      onClick={(event) => {
        if (!window.desktopBridge) return;
        event.preventDefault();
        void window.desktopBridge.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

const releaseNotesMarkdownComponents = { a: ReleaseNotesLink };

export function DesktopUpdateReleaseNotes({ state }: { readonly state: DesktopUpdateState }) {
  const notes = state.releaseNotes?.trim();
  if (!notes) return null;

  const version = state.availableVersion ?? state.downloadedVersion ?? "available";
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button size="xs" variant="ghost" aria-label={`What's new in Tabs ${version}`}>
            What’s new
          </Button>
        }
      />
      <DialogPopup
        showCloseButton={false}
        bottomStickOnMobile={false}
        backdropClassName="bg-black/60 backdrop-blur-xl"
        className="max-h-[84vh] max-w-2xl overflow-hidden rounded-3xl border border-border/70 bg-popover shadow-2xl"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-primary/12 to-transparent"
        />
        <DialogHeader className="relative gap-0 border-b border-border/60 px-7 pt-7 pb-6 pr-16 sm:px-9 sm:pt-9 sm:pb-7 sm:pr-20">
          <span className="mb-3 w-fit rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-semibold tracking-[0.16em] text-primary uppercase">
            Tabs {version}
          </span>
          <DialogTitle className="text-2xl leading-tight tracking-tight sm:text-3xl">
            What’s new in Tabs {version}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed">
            A closer look at what changed in this update.
          </DialogDescription>
          <DialogClose
            aria-label="Close what’s new"
            className="absolute top-5 right-5 sm:top-7 sm:right-7"
            render={<Button size="icon" variant="ghost" className="rounded-full" />}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </DialogClose>
        </DialogHeader>
        <DialogPanel
          scrollFade
          className="max-h-[55vh] space-y-3 px-7 py-6 text-sm leading-7 text-muted-foreground break-words sm:px-9 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_li]:my-2 [&_p]:my-3 [&_strong]:font-semibold [&_strong]:text-foreground"
        >
          <ReactMarkdown components={releaseNotesMarkdownComponents}>{notes}</ReactMarkdown>
        </DialogPanel>
        <DialogFooter
          variant="bare"
          className="border-t border-border/60 bg-muted/25 px-7 py-4 sm:px-9"
        >
          <DialogClose
            render={
              <Button size="sm" variant="outline">
                Done
              </Button>
            }
          />
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
