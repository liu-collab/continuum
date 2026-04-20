import React from "react";

type ErrorStateProps = {
  title: string;
  description: string;
  testId?: string;
};

export function ErrorState({ title, description, testId }: ErrorStateProps) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-rose-200 bg-rose-50 px-5 py-4"
    >
      <h3 className="text-sm font-semibold text-rose-800">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-rose-700">{description}</p>
    </div>
  );
}
