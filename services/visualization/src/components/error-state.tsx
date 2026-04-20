import React from "react";

type ErrorStateProps = {
  title: string;
  description: string;
  testId?: string;
};

export function ErrorState({ title, description, testId }: ErrorStateProps) {
  return (
    <div data-testid={testId} className="rounded-xl border border-rose-200 bg-rose-50/80 px-6 py-5">
      <h3 className="text-sm font-semibold text-rose-800">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-rose-700">{description}</p>
    </div>
  );
}
