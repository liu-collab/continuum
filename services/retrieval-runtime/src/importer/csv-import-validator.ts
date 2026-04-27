export type CsvImportRawRow = Record<string, string | undefined>;

export type CsvImportErrorCode =
  | "missing_required_header"
  | "missing_required_value"
  | "invalid_value";

export interface CsvImportFieldIssue {
  code?: string;
  message: string;
}

export type CsvImportFieldIssueInput =
  | string
  | CsvImportFieldIssue
  | Array<string | CsvImportFieldIssue>
  | null
  | undefined
  | false;

export interface CsvImportFieldContext {
  rowNumber: number;
  fieldKey: string;
  header: string;
  rawRow: CsvImportRawRow;
}

export interface CsvImportValidationContext<TRecord extends Record<string, unknown>>
  extends CsvImportFieldContext {
  record: Partial<TRecord>;
}

export interface CsvImportField<TRecord extends Record<string, unknown>> {
  key: Extract<keyof TRecord, string>;
  header?: string;
  aliases?: string[];
  required?: boolean;
  parse?: (value: string, context: CsvImportFieldContext) => unknown;
  validate?: (
    value: unknown,
    context: CsvImportValidationContext<TRecord>,
  ) => CsvImportFieldIssueInput;
}

export interface CsvImportRowError {
  rowNumber: number;
  field: string;
  header?: string;
  code: CsvImportErrorCode | string;
  message: string;
  rawValue?: string;
}

export interface CsvImportHeaderError {
  field: string;
  expectedHeaders: string[];
  code: "missing_required_header";
  message: string;
}

export interface CsvImportInvalidRow {
  rowNumber: number;
  rawRow: CsvImportRawRow;
  errors: CsvImportRowError[];
}

export interface CsvImportReport<TRecord extends Record<string, unknown>> {
  ok: boolean;
  validRows: TRecord[];
  invalidRows: CsvImportInvalidRow[];
  headerErrors: CsvImportHeaderError[];
  errorCount: number;
}

export interface ValidateCsvImportRowsOptions<TRecord extends Record<string, unknown>> {
  fields: Array<CsvImportField<TRecord>>;
  rows: CsvImportRawRow[];
  headers?: string[];
  firstDataRowNumber?: number;
  trimValues?: boolean;
}

export interface CsvImportErrorReportRow {
  rowNumber?: number;
  field: string;
  header?: string;
  expectedHeaders?: string[];
  code: CsvImportErrorCode | string;
  message: string;
  rawValue?: string;
}

interface ResolvedField<TRecord extends Record<string, unknown>> {
  field: CsvImportField<TRecord>;
  header?: string;
  expectedHeaders: string[];
}

export function validateCsvImportRows<TRecord extends Record<string, unknown>>(
  options: ValidateCsvImportRowsOptions<TRecord>,
): CsvImportReport<TRecord> {
  const trimValues = options.trimValues ?? true;
  const firstDataRowNumber = options.firstDataRowNumber ?? 2;
  const headers = options.headers ?? collectHeaders(options.rows);
  const resolvedFields = resolveFields(options.fields, headers);
  const headerErrors = resolvedFields
    .filter((resolved) => resolved.field.required === true && !resolved.header)
    .map((resolved) => ({
      field: resolved.field.key,
      expectedHeaders: resolved.expectedHeaders,
      code: "missing_required_header" as const,
      message: `Missing required CSV header for field "${resolved.field.key}".`,
    }));

  const validRows: TRecord[] = [];
  const invalidRows: CsvImportInvalidRow[] = [];

  if (headerErrors.length > 0) {
    return {
      ok: false,
      validRows,
      invalidRows,
      headerErrors,
      errorCount: headerErrors.length,
    };
  }

  options.rows.forEach((rawRow, index) => {
    const rowNumber = firstDataRowNumber + index;
    const record: Partial<TRecord> = {};
    const errors: CsvImportRowError[] = [];

    for (const resolved of resolvedFields) {
      if (!resolved.header) {
        continue;
      }

      const field = resolved.field;
      const rawValue = rawRow[resolved.header];
      const value = trimValues ? (rawValue ?? "").trim() : rawValue ?? "";

      if (field.required === true && value.length === 0) {
        errors.push({
          rowNumber,
          field: field.key,
          header: resolved.header,
          code: "missing_required_value",
          message: `Field "${field.key}" is required.`,
          rawValue,
        });
        continue;
      }

      if (value.length === 0) {
        continue;
      }

      const context: CsvImportFieldContext = {
        rowNumber,
        fieldKey: field.key,
        header: resolved.header,
        rawRow,
      };

      let parsedValue: unknown = value;
      if (field.parse) {
        try {
          parsedValue = field.parse(value, context);
        } catch (error) {
          errors.push({
            rowNumber,
            field: field.key,
            header: resolved.header,
            code: "invalid_value",
            message: error instanceof Error ? error.message : `Field "${field.key}" is invalid.`,
            rawValue,
          });
          continue;
        }
      }

      const validationIssues = normalizeFieldIssues(
        field.validate?.(parsedValue, {
          ...context,
          record,
        }),
      );
      if (validationIssues.length > 0) {
        errors.push(
          ...validationIssues.map((issue) => ({
            rowNumber,
            field: field.key,
            header: resolved.header,
            code: issue.code ?? "invalid_value",
            message: issue.message,
            rawValue,
          })),
        );
        continue;
      }

      record[field.key] = parsedValue as TRecord[Extract<keyof TRecord, string>];
    }

    if (errors.length > 0) {
      invalidRows.push({ rowNumber, rawRow, errors });
      return;
    }

    validRows.push(record as TRecord);
  });

  const errorCount =
    headerErrors.length + invalidRows.reduce((total, invalidRow) => total + invalidRow.errors.length, 0);

  return {
    ok: errorCount === 0,
    validRows: headerErrors.length === 0 ? validRows : [],
    invalidRows,
    headerErrors,
    errorCount,
  };
}

export function buildCsvImportErrorReportRows<TRecord extends Record<string, unknown>>(
  report: CsvImportReport<TRecord>,
): CsvImportErrorReportRow[] {
  return [
    ...report.headerErrors.map((error) => ({
      field: error.field,
      expectedHeaders: error.expectedHeaders,
      code: error.code,
      message: error.message,
    })),
    ...report.invalidRows.flatMap((invalidRow) =>
      invalidRow.errors.map((error) => ({
        rowNumber: error.rowNumber,
        field: error.field,
        header: error.header,
        code: error.code,
        message: error.message,
        rawValue: error.rawValue,
      })),
    ),
  ];
}

function resolveFields<TRecord extends Record<string, unknown>>(
  fields: Array<CsvImportField<TRecord>>,
  headers: string[],
): Array<ResolvedField<TRecord>> {
  const normalizedHeaders = new Map(headers.map((header) => [normalizeHeader(header), header]));

  return fields.map((field) => {
    const expectedHeaders = [field.header ?? field.key, ...(field.aliases ?? [])];
    const header = expectedHeaders
      .map((candidate) => normalizedHeaders.get(normalizeHeader(candidate)))
      .find((candidate): candidate is string => Boolean(candidate));

    return { field, header, expectedHeaders };
  });
}

function collectHeaders(rows: CsvImportRawRow[]): string[] {
  const headers = new Set<string>();
  for (const row of rows) {
    for (const header of Object.keys(row)) {
      headers.add(header);
    }
  }

  return [...headers];
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function normalizeFieldIssues(input: CsvImportFieldIssueInput): CsvImportFieldIssue[] {
  if (!input) {
    return [];
  }

  const issues = Array.isArray(input) ? input : [input];
  return issues.map((issue) => (typeof issue === "string" ? { message: issue } : issue));
}
