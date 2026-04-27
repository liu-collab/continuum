"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import React, { FormEvent, ReactNode, useState } from "react";

type SearchFormProps = {
  action: Route;
  initialValues?: Record<string, string | undefined>;
  children: ReactNode;
  onSubmitted?(): void;
};

const btnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.25rem",
  borderRadius: "var(--radius-md)",
  padding: "0.375rem 0.75rem",
  fontSize: "0.8125rem",
  fontFamily: "var(--font-mono)",
  fontWeight: 500,
  cursor: "pointer",
  transition: "all 80ms ease",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-secondary)"
};

export function SearchForm({ action, initialValues = {}, children, onSubmitted }: SearchFormProps) {
  const router = useRouter();
  const [formState, setFormState] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(initialValues).map(([k, v]) => [k, v ?? ""])
    )
  );

  function updateValue(name: string, value: string) {
    setFormState((cur) => ({ ...cur, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(formState)) {
      if (v.trim().length > 0) query.set(k, v.trim());
    }
    router.push((query.toString() ? `${action}?${query.toString()}` : action) as Route);
    onSubmitted?.();
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
      <div
        style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
        onChange={(event) => {
          const t = event.target as HTMLInputElement | HTMLSelectElement;
          if (t.name) updateValue(t.name, t.value);
        }}
      >
        {children}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={() => { router.push(action); onSubmitted?.(); }}
          style={btnStyle}
        >
          Clear
        </button>
        <button
          type="submit"
          style={{
            ...btnStyle,
            background: "var(--cyan)",
            color: "var(--bg)",
            border: "none"
          }}
        >
          Apply
        </button>
      </div>
    </form>
  );
}
