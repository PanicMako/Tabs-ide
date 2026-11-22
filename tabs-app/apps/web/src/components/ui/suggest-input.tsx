import type * as React from "react";

import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "./autocomplete";

/**
 * Text input with a themed suggestion list. Replaces `<input list>` + `<datalist>`: free
 * text stays valid, suggestions filter as you type and never block submitting.
 */
export function SuggestInput({
  value,
  onValueChange,
  suggestions,
  className,
  popupClassName,
  ...inputProps
}: {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: ReadonlyArray<string>;
  className?: string;
  popupClassName?: string;
  "aria-label": string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
}) {
  return (
    <Autocomplete
      items={suggestions as string[]}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      mode="list"
    >
      <AutocompleteInput className={className} {...inputProps} />
      {suggestions.length > 0 ? (
        <AutocompletePopup align="start" className={popupClassName}>
          <AutocompleteList className="max-h-60 overflow-y-auto p-1">
            {(item: string) => (
              <AutocompleteItem key={item} value={item}>
                <span className="truncate">{item}</span>
              </AutocompleteItem>
            )}
          </AutocompleteList>
        </AutocompletePopup>
      ) : null}
    </Autocomplete>
  );
}
