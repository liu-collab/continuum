"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, ReactNode, useState } from "react";

type SearchFormProps = {
  action: Route;
  initialValues?: Record<string, string | undefined>;
  children: ReactNode;
};

export function SearchForm({ action, initialValues = {}, children }: SearchFormProps) {
  const router = useRouter();
  const [formState, setFormState] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(initialValues).map(([key, value]) => [key, value ?? ""])
    )
  );

  function updateValue(name: string, value: string) {
    setFormState((current) => ({
      ...current,
      [name]: value
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(formState)) {
      if (value.trim().length > 0) {
        query.set(key, value.trim());
      }
    }

    router.push((query.toString() ? `${action}?${query.toString()}` : action) as Route);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        onChange={(event) => {
          const target = event.target as HTMLInputElement | HTMLSelectElement;

          if (target.name) {
            updateValue(target.name, target.value);
          }
        }}
      >
        {children}
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          应用筛选
        </button>
        <button
          type="button"
          onClick={() => router.push(action)}
          className="rounded-full border bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
        >
          清空
        </button>
      </div>
    </form>
  );
}
