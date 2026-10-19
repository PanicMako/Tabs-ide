import { Children, isValidElement, useId, type ComponentProps, type ReactNode } from "react";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
/** Uses the shared custom listbox while keeping option definitions close to their settings. */
export function ExtensionChoice({
  value,
  onValueChange,
  disabled,
  className,
  children,
  "aria-label": label,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const options = Children.toArray(children).filter(
    isValidElement<{ value: string; children: ReactNode }>,
  );
  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue>
          {options.find((option) => option.props.value === value)?.props.children ??
            "Choose an option"}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.props.value} value={option.props.value}>
            {option.props.children}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** Keep contextual names when the shared checkbox discovers a wrapping label. */
export function ExtensionCheckbox(props: ComponentProps<typeof Checkbox>) {
  const labelId = useId();
  return (
    <>
      <Checkbox {...props} aria-labelledby={labelId} />
      <span id={labelId} className="sr-only">
        {props["aria-label"]}
      </span>
    </>
  );
}
