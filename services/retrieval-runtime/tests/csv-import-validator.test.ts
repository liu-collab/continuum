import { describe, expect, it } from "vitest";

import {
  buildCsvImportErrorReportRows,
  validateCsvImportRows,
  type CsvImportField,
} from "../src/importer/index.js";

interface UserImportRow extends Record<string, unknown> {
  name: string;
  email: string;
  age?: number;
}

const userFields: Array<CsvImportField<UserImportRow>> = [
  { key: "name", header: "Name", required: true },
  {
    key: "email",
    header: "Email",
    required: true,
    validate: (value) => (String(value).includes("@") ? undefined : "Email must contain @."),
  },
  {
    key: "age",
    header: "Age",
    parse: (value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) {
        throw new Error("Age must be an integer.");
      }
      return parsed;
    },
    validate: (value) => (Number(value) >= 0 ? undefined : "Age must be greater than or equal to 0."),
  },
];

describe("CSV import validator", () => {
  it("returns valid rows and row-level validation errors", () => {
    const report = validateCsvImportRows<UserImportRow>({
      fields: userFields,
      rows: [
        { Name: " Ada ", Email: "ada@example.test", Age: "36" },
        { Name: "Grace", Email: "", Age: "41" },
        { Name: "Linus", Email: "linus.example.test", Age: "-1" },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.validRows).toEqual([
      {
        name: "Ada",
        email: "ada@example.test",
        age: 36,
      },
    ]);
    expect(report.invalidRows).toEqual([
      {
        rowNumber: 3,
        rawRow: { Name: "Grace", Email: "", Age: "41" },
        errors: [
          expect.objectContaining({
            field: "email",
            code: "missing_required_value",
          }),
        ],
      },
      {
        rowNumber: 4,
        rawRow: { Name: "Linus", Email: "linus.example.test", Age: "-1" },
        errors: [
          expect.objectContaining({
            field: "email",
            message: "Email must contain @.",
          }),
          expect.objectContaining({
            field: "age",
            message: "Age must be greater than or equal to 0.",
          }),
        ],
      },
    ]);
    expect(report.errorCount).toBe(3);
  });

  it("reports missing required headers without importing rows", () => {
    const report = validateCsvImportRows<UserImportRow>({
      fields: userFields,
      headers: ["Name", "Age"],
      rows: [{ Name: "Ada", Age: "not-a-number" }],
    });

    expect(report.ok).toBe(false);
    expect(report.validRows).toEqual([]);
    expect(report.invalidRows).toEqual([]);
    expect(report.errorCount).toBe(1);
    expect(report.headerErrors).toEqual([
      expect.objectContaining({
        field: "email",
        code: "missing_required_header",
        expectedHeaders: ["Email"],
      }),
    ]);
  });

  it("matches headers case-insensitively and supports aliases", () => {
    const report = validateCsvImportRows<UserImportRow>({
      fields: [
        { key: "name", header: "Name", aliases: ["Full Name"], required: true },
        { key: "email", header: "Email Address", aliases: ["Email"], required: true },
      ],
      rows: [{ "full name": "Ada Lovelace", EMAIL: "ada@example.test" }],
    });

    expect(report.ok).toBe(true);
    expect(report.validRows).toEqual([
      {
        name: "Ada Lovelace",
        email: "ada@example.test",
      },
    ]);
  });

  it("flattens header and row errors for error row reports", () => {
    const report = validateCsvImportRows<UserImportRow>({
      fields: userFields,
      headers: ["Name", "Email", "Age"],
      firstDataRowNumber: 10,
      rows: [{ Name: "Ada", Email: "ada@example.test", Age: "not-a-number" }],
    });

    expect(buildCsvImportErrorReportRows(report)).toEqual([
      {
        rowNumber: 10,
        field: "age",
        header: "Age",
        code: "invalid_value",
        message: "Age must be an integer.",
        rawValue: "not-a-number",
      },
    ]);
  });

  it("includes expected headers in flat header error report rows", () => {
    const report = validateCsvImportRows<UserImportRow>({
      fields: userFields,
      headers: ["Name"],
      rows: [{ Name: "Ada" }],
    });

    expect(buildCsvImportErrorReportRows(report)).toEqual([
      {
        field: "email",
        code: "missing_required_header",
        message: 'Missing required CSV header for field "email".',
        expectedHeaders: ["Email"],
      },
    ]);
  });

  it("keeps structured validation codes and multiple field issues", () => {
    const report = validateCsvImportRows<UserImportRow>({
      fields: [
        { key: "name", header: "Name", required: true },
        {
          key: "email",
          header: "Email",
          required: true,
          validate: () => [
            { code: "blocked_domain", message: "Email domain is blocked." },
            "Email must be manually reviewed.",
          ],
        },
      ],
      rows: [{ Name: "Ada", Email: "ada@example.test" }],
    });

    expect(report.errorCount).toBe(2);
    expect(buildCsvImportErrorReportRows(report)).toEqual([
      {
        rowNumber: 2,
        field: "email",
        header: "Email",
        code: "blocked_domain",
        message: "Email domain is blocked.",
        rawValue: "ada@example.test",
      },
      {
        rowNumber: 2,
        field: "email",
        header: "Email",
        code: "invalid_value",
        message: "Email must be manually reviewed.",
        rawValue: "ada@example.test",
      },
    ]);
  });

  it("passes parse context and partial record into custom field validation", () => {
    const seenContexts: Array<{ rowNumber: number; fieldKey: string; header: string; rawRowName?: string }> = [];

    const report = validateCsvImportRows<UserImportRow>({
      fields: [
        { key: "name", header: "Name", required: true },
        {
          key: "email",
          header: "Email",
          required: true,
          parse: (value, context) => {
            seenContexts.push({
              rowNumber: context.rowNumber,
              fieldKey: context.fieldKey,
              header: context.header,
              rawRowName: context.rawRow.Name,
            });
            return value.toLowerCase();
          },
          validate: (_value, context) =>
            context.record.name === "Ada Lovelace" ? undefined : "Name must be parsed first.",
        },
      ],
      rows: [{ Name: "Ada Lovelace", Email: "ADA@EXAMPLE.TEST" }],
    });

    expect(report.ok).toBe(true);
    expect(report.validRows).toEqual([{ name: "Ada Lovelace", email: "ada@example.test" }]);
    expect(seenContexts).toEqual([
      {
        rowNumber: 2,
        fieldKey: "email",
        header: "Email",
        rawRowName: "Ada Lovelace",
      },
    ]);
  });

  it("omits blank optional fields and can preserve whitespace when trimming is disabled", () => {
    const report = validateCsvImportRows<UserImportRow>({
      fields: [
        { key: "name", header: "Name", required: true },
        { key: "email", header: "Email", required: true },
        { key: "age", header: "Age" },
      ],
      trimValues: false,
      rows: [{ Name: " Ada ", Email: " ada@example.test ", Age: "" }],
    });

    expect(report.ok).toBe(true);
    expect(report.validRows).toEqual([{ name: " Ada ", email: " ada@example.test " }]);
  });
});
