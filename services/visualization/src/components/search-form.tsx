"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, ReactNode, useState } from "react";

type SearchFormProps = {
  action: Route;
  initialValues?: Record<string, string | undefined>;
  children: ReactNode;
  onSubmitted?(): void;
};

export function SearchForm({ action, initialValues = {}, children, onSubmitted }: SearchFormProps) {
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
    onSubmitted?.();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div
        className="grid gap-3 sm:grid-cols-2"
        onChange={(event) => {
          const target = event.target as HTMLInputElement | HTMLSelectElement;

          if (target.name) {
            updateValue(target.name, target.value);
          }
        }}
      >
        {children}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            router.push(action);
            onSubmitted?.();
          }}
          className="btn-outline"
        >
          清空
        </button>
        <button type="submit" className="btn-primary">
          应用
        </button>
      </div>
    </form>
  );
}
