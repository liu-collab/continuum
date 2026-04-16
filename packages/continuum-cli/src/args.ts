export type ParsedCommand = {
  command: string[];
  options: Record<string, string | boolean>;
};

function normalizeOptionName(token: string) {
  return token.replace(/^--/, "").trim();
}

export function parseArgs(argv: string[]): ParsedCommand {
  const command: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith("--")) {
      command.push(token);
      continue;
    }

    const optionName = normalizeOptionName(token);
    const nextToken = argv[index + 1];

    if (!nextToken || nextToken.startsWith("--")) {
      options[optionName] = true;
      continue;
    }

    options[optionName] = nextToken;
    index += 1;
  }

  return { command, options };
}
