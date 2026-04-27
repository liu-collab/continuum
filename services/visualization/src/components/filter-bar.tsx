import { ReactNode } from "react";

type FilterBarProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

export function FilterBar({ title, description, actions, children }: FilterBarProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem"
    }}>
      <div>
        <h1 style={{
          fontSize: "1.375rem",
          fontWeight: 500,
          fontFamily: "\"SF Pro Display\", system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
          color: "var(--text)",
          letterSpacing: 0
        }}>
          {title}
        </h1>
        {description ? (
          <p style={{
            marginTop: "0.25rem",
            fontSize: "14px",
            color: "var(--text-muted)"
          }}>
            {description}
          </p>
        ) : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
        {actions ?? children}
      </div>
    </div>
  );
}
