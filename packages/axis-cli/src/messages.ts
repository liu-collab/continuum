export function bilingualMessage(chinese: string, english: string) {
  return `${chinese} | ${english}`;
}

export function bilingualMessageLines(chinese: string, english: string) {
  return `${chinese}\n${english}`;
}

export function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function formatErrorMessageLines(error: unknown) {
  return formatErrorMessage(error)
    .split(/\s+\|\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}
