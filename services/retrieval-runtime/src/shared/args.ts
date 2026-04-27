export type ParsedArgScalar = string | boolean;
export type ParsedArgValue = ParsedArgScalar | ParsedArgScalar[];

export type ParsedArgs = {
  options: Record<string, ParsedArgValue>;
  positionals: string[];
};

export function readLastStringArg(value: ParsedArgValue | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const last = value.at(-1);
  return typeof last === "string" ? last : undefined;
}

export function readLastBooleanArg(value: ParsedArgValue | undefined): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const last = value.at(-1);
  return typeof last === "boolean" ? last : undefined;
}

export function readLastIntegerArg(value: ParsedArgValue | undefined): number | undefined {
  const raw = readLastStringArg(value);
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function appendOption(
  options: Record<string, ParsedArgValue>,
  name: string,
  value: ParsedArgScalar,
): void {
  const current = options[name];
  if (current === undefined) {
    options[name] = value;
    return;
  }

  options[name] = Array.isArray(current) ? [...current, value] : [current, value];
}

function isNegativeNumberToken(value: string): boolean {
  return value.startsWith("-") && value.length > 1 && Number.isFinite(Number(value));
}

function isShortOptionToken(value: string): boolean {
  return value.startsWith("-") && value !== "-" && !value.startsWith("--") && !isNegativeNumberToken(value);
}

function canReadSeparatedLongValue(value: string | undefined): value is string {
  return value !== undefined && value !== "--" && (value === "-" || !value.startsWith("-") || isNegativeNumberToken(value));
}

function canReadSeparatedShortValue(value: string | undefined): value is string {
  return value !== undefined && value !== "--" && (value === "-" || !value.startsWith("-") || isNegativeNumberToken(value));
}

function parseShortOption(
  argv: readonly string[],
  index: number,
  options: Record<string, ParsedArgValue>,
  positionals: string[],
): number {
  const current = argv[index];
  if (current === undefined) {
    return index;
  }

  const rawName = current.slice(1);
  const equalsIndex = rawName.indexOf("=");
  if (equalsIndex >= 0) {
    const name = rawName.slice(0, equalsIndex);
    if (name.length !== 1) {
      positionals.push(current);
      return index;
    }

    appendOption(options, name, rawName.slice(equalsIndex + 1));
    return index;
  }

  if (rawName.length > 1) {
    for (const name of rawName) {
      appendOption(options, name, true);
    }
    return index;
  }

  const next = argv[index + 1];
  if (canReadSeparatedShortValue(next)) {
    appendOption(options, rawName, next);
    return index + 1;
  }

  appendOption(options, rawName, true);
  return index;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: Record<string, ParsedArgValue> = {};
  const positionals: string[] = [];
  let parseOptions = true;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === undefined) {
      continue;
    }

    if (!parseOptions) {
      positionals.push(current);
      continue;
    }

    if (current === "--") {
      parseOptions = false;
      continue;
    }

    if (current.startsWith("--")) {
      const rawName = current.slice(2);
      if (!rawName) {
        positionals.push(current);
        continue;
      }

      const equalsIndex = rawName.indexOf("=");
      if (equalsIndex >= 0) {
        const name = rawName.slice(0, equalsIndex);
        if (!name) {
          positionals.push(current);
          continue;
        }
        appendOption(options, name, rawName.slice(equalsIndex + 1));
        continue;
      }

      if (rawName.startsWith("no-") && rawName.length > 3) {
        appendOption(options, rawName.slice(3), false);
        continue;
      }

      const next = argv[index + 1];
      if (canReadSeparatedLongValue(next)) {
        appendOption(options, rawName, next);
        index += 1;
        continue;
      }

      appendOption(options, rawName, true);
      continue;
    }

    if (isShortOptionToken(current)) {
      index = parseShortOption(argv, index, options, positionals);
      continue;
    }

    positionals.push(current);
  }

  return { options, positionals };
}
