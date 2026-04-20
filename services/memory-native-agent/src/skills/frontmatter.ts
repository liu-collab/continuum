import { parse as parseYaml } from "yaml";

import type { ParsedMarkdownSkillFile } from "./types.js";

const FRONTMATTER_BOUNDARY = "---";

export function parseMarkdownWithFrontmatter(markdown: string): ParsedMarkdownSkillFile {
  const normalized = markdown.replace(/^\uFEFF/, "");
  if (!normalized.startsWith(`${FRONTMATTER_BOUNDARY}\n`) && !normalized.startsWith(`${FRONTMATTER_BOUNDARY}\r\n`)) {
    return {
      frontmatter: {},
      body: normalized.trim(),
    };
  }

  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatter: {},
      body: normalized.trim(),
    };
  }

  const [, rawFrontmatter = "", body = ""] = match;
  const parsed = rawFrontmatter.trim().length > 0 ? parseYaml(rawFrontmatter) : {};
  return {
    frontmatter: isPlainObject(parsed) ? parsed : {},
    body: body.trim(),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

