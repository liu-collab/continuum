"use client";

import { Check, ChevronDown } from "lucide-react";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

type PopoverLayout = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

export function SelectField({ value, options, onChange, name, testId, ariaLabel }: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [popoverLayout, setPopoverLayout] = useState<PopoverLayout | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? options[0]?.label ?? "",
    [options, value]
  );
  const updatePopoverLayout = useCallback(() => {
    const button = buttonRef.current;
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const gap = 8;
    const viewportPadding = 16;
    const spaceBelow = viewportHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(140, openUpward ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(360, availableHeight);

    setPopoverLayout({
      left: rect.left,
      top: openUpward ? Math.max(viewportPadding, rect.top - gap - maxHeight) : rect.bottom + gap,
      width: rect.width,
      maxHeight
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    updatePopoverLayout();
  }, [open, updatePopoverLayout]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("resize", updatePopoverLayout);
    window.addEventListener("scroll", updatePopoverLayout, true);
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", updatePopoverLayout);
      window.removeEventListener("scroll", updatePopoverLayout, true);
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, updatePopoverLayout]);

  const popover = open && popoverLayout && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={popoverRef}
          className="field-popover"
          role="listbox"
          style={{
            position: "fixed",
            left: popoverLayout.left,
            right: "auto",
            top: popoverLayout.top,
            width: popoverLayout.width,
            maxHeight: popoverLayout.maxHeight,
            zIndex: 80
          }}
        >
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
        </div>,
        document.body
      )
    : null;

  return (
    <div className="relative">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        ref={buttonRef}
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
      {popover}
    </div>
  );
}
