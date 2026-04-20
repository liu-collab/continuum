import React from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  testId?: string;
};

export function EmptyState({ title, description, testId }: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-dashed bg-surface-muted/40 px-6 py-10 text-center"
    >
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
