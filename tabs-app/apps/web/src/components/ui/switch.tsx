"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "~/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0 outline-none transition-[background-color,border-color,box-shadow] duration-150 [container-type:size] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-checked:border-primary data-unchecked:bg-input data-unchecked:border-border/60 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 box-border w-[100cqh] rounded-full border-2 border-transparent bg-clip-padding shadow-xs transition-[left,background-color] duration-150 ease-out data-checked:left-[calc(100%-100cqh)] data-checked:bg-primary-foreground data-unchecked:left-0 data-unchecked:bg-foreground",
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
