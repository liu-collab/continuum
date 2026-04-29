export function bilingualMessage(chinese: string, english: string) {
  return `${chinese} | ${english}`;
}

export function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
