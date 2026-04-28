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
        padding: "48px 24px",
        textAlign: "center",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius-lg)",
        background: "var(--canvas)",
        ...style
      }}
    >
      <div style={{
        width: 44,
        height: 44,
        borderRadius: "50%",
        border: "1px solid var(--hairline)",
        background: "var(--surface-pearl)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: "12px"
      }}>
        <span style={{ color: "var(--primary)", fontSize: "17px" }}>-</span>
      </div>
      <h3 className="headline-display text-[21px] font-semibold leading-tight text-text">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-[17px] leading-[1.47] text-muted">{description}</p>
      ) : null}
    </div>
  );
}
