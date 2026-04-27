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
      style={{
        border: "1px solid rgba(248,113,113,0.3)",
        borderRadius: "var(--radius-lg)",
        background: "var(--rose-bg)",
        padding: "1rem 1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem"
      }}
    >
      <h3 style={{ fontSize: "0.875rem", fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--rose)" }}>
        {title}
      </h3>
      <p style={{ fontSize: "0.8125rem", lineHeight: "1.6", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
        {description}
      </p>
    </div>
  );
}
