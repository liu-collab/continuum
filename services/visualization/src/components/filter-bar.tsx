import { ReactNode } from "react";

type FilterBarProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

export function FilterBar({ title, description, actions, children }: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions ?? children}</div>
    </div>
  );
}
