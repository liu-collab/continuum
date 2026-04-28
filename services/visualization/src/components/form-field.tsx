"use client";

import React, { useState } from "react";

import { SelectField } from "@/components/select-field";
import { useAppI18n } from "@/lib/i18n/client";

type FormFieldProps = {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  type?: "text" | "date" | "number";
};

export function FormField({ label, name, defaultValue, placeholder, options, type = "text" }: FormFieldProps) {
  const [selectedValue, setSelectedValue] = useState(defaultValue ?? "");
  const { t } = useAppI18n();

  return (
    <label style={{ display: "grid", gap: "8px", position: "relative" }}>
      <span style={{
        fontSize: "14px",
        fontWeight: 600,
        lineHeight: 1.29,
        letterSpacing: 0,
        color: "var(--text-muted)",
      }}>
        {label}
      </span>
      {options ? (
        <SelectField
          name={name}
          value={selectedValue}
          onChange={setSelectedValue}
          options={[{ label: t("common.all"), value: "" }, ...options]}
        />
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          className="field"
        />
      )}
    </label>
  );
}
