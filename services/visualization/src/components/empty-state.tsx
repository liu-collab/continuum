import React from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  testId?: string;
  className?: string;
};

export function EmptyState({ title, description, testId, className }: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className={cn("rounded-lg border border-dashed bg-surface-muted/40 px-6 py-10 text-center", className)}
    >
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
