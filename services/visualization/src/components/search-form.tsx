"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import React, { FormEvent, ReactNode } from "react";

type SearchFormProps = {
  action: Route;
  initialValues?: Record<string, string | undefined>;
  children: ReactNode;
  onSubmitted?(): void;
};

export function SearchForm({ action, children, onSubmitted }: SearchFormProps) {
  const router = useRouter();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    const formData = new FormData(event.currentTarget);
    for (const [key, value] of formData.entries()) {
      const text = String(value).trim();
      if (text.length > 0) {
        query.set(key, text);
      }
    }
    router.push((query.toString() ? `${action}?${query.toString()}` : action) as Route);
    onSubmitted?.();
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "24px" }}>
      <div
        style={{ display: "grid", gap: "17px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        {children}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "12px" }}>
        <button
          type="button"
          onClick={() => { router.push(action); onSubmitted?.(); }}
          className="btn-outline"
        >
          清除
        </button>
        <button
          type="submit"
          className="btn-primary"
        >
          应用
        </button>
      </div>
    </form>
  );
}
