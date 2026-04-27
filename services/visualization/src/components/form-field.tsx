import React from "react";

type FormFieldProps = {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  type?: "text" | "date";
};

export function FormField({ label, name, defaultValue, placeholder, options, type = "text" }: FormFieldProps) {
  return (
    <label style={{ display: "grid", gap: "0.375rem" }}>
      <span style={{
        fontSize: "0.6875rem",
        fontWeight: 500,
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        textTransform: "uppercase",
        letterSpacing: "0.08em"
      }}>
        {label}
      </span>
      {options ? (
        <select
          name={name}
          defaultValue={defaultValue ?? ""}
          style={{
            width: "100%",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            padding: "0.375rem 0.5rem",
            fontSize: "0.8125rem",
            fontFamily: "var(--font-mono)",
            outline: "none"
          }}
        >
          <option value="">全部</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          style={{
            width: "100%",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            padding: "0.375rem 0.5rem",
            fontSize: "0.8125rem",
            fontFamily: "var(--font-mono)",
            outline: "none"
          }}
        />
      )}
    </label>
  );
}
