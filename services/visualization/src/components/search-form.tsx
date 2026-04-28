"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import React, { FormEvent, ReactNode, useState, useTransition } from "react";

import { useAppI18n } from "@/lib/i18n/client";

type SearchFormProps = {
  action: Route;
  initialValues?: Record<string, string | undefined>;
  children: ReactNode;
  onSubmitted?(): void;
};

export function SearchForm({ action, children, onSubmitted }: SearchFormProps) {
  const router = useRouter();
  const { t } = useAppI18n();
  const [navigationStarted, setNavigationStarted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = navigationStarted || isPending;

  function navigateTo(href: Route) {
    setNavigationStarted(true);
    startTransition(() => {
      router.push(href);
      onSubmitted?.();
    });
  }

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
    navigateTo((query.toString() ? `${action}?${query.toString()}` : action) as Route);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "24px" }} aria-busy={busy}>
      {busy ? (
        <div
          role="status"
          data-testid="search-form-pending"
          className="notice notice-info flex items-center gap-2"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("common.loadingResults")}
        </div>
      ) : null}
      <div
        style={{ display: "grid", gap: "17px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        {children}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "12px" }}>
        <button
          type="button"
          onClick={() => navigateTo(action)}
          className="btn-outline"
          disabled={busy}
        >
          {t("common.clear")}
        </button>
        <button
          type="submit"
          className="btn-primary"
          disabled={busy}
        >
          {t("common.apply")}
        </button>
      </div>
    </form>
  );
}
