"use client";

import { Check, ChevronDown } from "lucide-react";
import React, { useMemo, useState } from "react";

type SelectFieldOption = {
  label: string;
  value: string;
};

type SelectFieldProps = {
  value: string;
  options: SelectFieldOption[];
  onChange(value: string): void;
  name?: string;
  testId?: string;
  ariaLabel?: string;
};

export function SelectField({ value, options, onChange, name, testId, ariaLabel }: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? options[0]?.label ?? "",
    [options, value]
  );

  return (
    <div className="relative">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        type="button"
        className="field-button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div className="field-popover" role="listbox">
          {options.map((option) => {
            const active = option.value === value;

            return (
              <button
                key={option.value || "__empty"}
                type="button"
                role="option"
                aria-selected={active}
                className={`field-option ${active ? "field-option-active" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {active ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
