import type { SkillInvocation } from "./types.js";

export function parseSkillArguments(rawArguments: string): string[] {
  const values: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of rawArguments) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        values.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    values.push(current);
  }

  return values;
}

export function expandSkillArguments(template: string, invocation: SkillInvocation): string {
  return template
    .replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, rawIndex: string) => invocation.positionalArguments[Number.parseInt(rawIndex, 10)] ?? "")
    .replace(/\$ARGUMENTS\b/g, invocation.rawArguments)
    .replace(/\$(\d+)\b/g, (_match, rawIndex: string) => invocation.positionalArguments[Number.parseInt(rawIndex, 10)] ?? "");
}

