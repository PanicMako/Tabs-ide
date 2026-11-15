import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";

/** A short numbered explainer on one screen, instead of a click-through stepper. */
export function ConnectionGuideDialog(props: {
  readonly title: string;
  readonly summary: string;
  readonly points: ReadonlyArray<{ readonly title: string; readonly body: ReactNode }>;
  readonly triggerLabel: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={props.triggerLabel}
            className="size-6 rounded-full p-0 text-muted-foreground hover:text-foreground"
          >
            <InfoIcon className="size-4" />
          </Button>
        }
      />
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{props.title}</DialogTitle>
          <DialogDescription className="text-[13px]">{props.summary}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="pb-4 pt-2">
          <ol className="space-y-4">
            {props.points.map((point, index) => (
              <li key={point.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-medium tabular-nums text-muted-foreground"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <h4 className="text-[13.5px] font-medium text-foreground">{point.title}</h4>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{point.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}
