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
        border: "1px solid var(--surface-tile-1)",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface-tile-1)",
        padding: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}
    >
      <h3 style={{ fontSize: "21px", fontWeight: 600, lineHeight: 1.19, letterSpacing: 0, color: "var(--body-on-dark)" }}>
        {title}
      </h3>
      <p style={{ fontSize: "17px", lineHeight: 1.47, letterSpacing: 0, color: "var(--body-muted)" }}>
        {description}
      </p>
    </div>
  );
}
