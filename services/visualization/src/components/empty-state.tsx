import React from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  testId?: string;
  className?: string;
  style?: React.CSSProperties;
};

export function EmptyState({ title, description, testId, className, style }: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "3rem 1.5rem",
        textAlign: "center",
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface)",
        ...style
      }}
    >
      <div style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        border: "1.5px solid var(--border-hover)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: "0.75rem"
      }}>
        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>~</span>
      </div>
      <h3 className="text-[14px] font-[var(--font-mono)] font-medium text-text">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">{description}</p>
      ) : null}
    </div>
  );
}
