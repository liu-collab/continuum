import { ReactNode } from "react";

type FilterBarProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function FilterBar({ title, description, children }: FilterBarProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">筛选</p>
          <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
