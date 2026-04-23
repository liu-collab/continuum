import { readFile } from "node:fs/promises";
import path from "node:path";

import { marked } from "marked";

const repositoryRoot = path.resolve(process.cwd(), "..", "..");

export type DocHeading = {
  id: string;
  level: 2 | 3;
  text: string;
};

export async function readRepositoryDoc(relativePath: string) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  return readFile(absolutePath, "utf8");
}

export function createSlug(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=\[\]{}|\\:;"'<>,.?/]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function extractDocHeadings(markdown: string): DocHeading[] {
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.match(/^(#{2,3})\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      level: match[1].length as 2 | 3,
      text: match[2].trim(),
      id: createSlug(match[2]),
    }));
}

export async function renderRepositoryMarkdown(relativePath: string) {
  const markdown = await readRepositoryDoc(relativePath);
  return renderMarkdownDocument(markdown);
}

export function renderMarkdownDocument(markdown: string) {
  const headings = extractDocHeadings(markdown);
  const headingIds = new Map(headings.map((heading) => [heading.text, heading.id]));

  const renderer = new marked.Renderer();

  renderer.heading = ({ tokens, depth }) => {
    const text = tokens.map((token) => ("text" in token ? String(token.text) : "")).join("").trim();
    const id = headingIds.get(text) ?? createSlug(text);
    const content = marked.Parser.parseInline(tokens);
    return `<h${depth} id="${id}">${content}</h${depth}>`;
  };

  renderer.link = ({ href, title, tokens }) => {
    const text = marked.Parser.parseInline(tokens);
    const titleAttribute = title ? ` title="${escapeHtmlAttribute(title)}"` : "";
    const isExternal = /^https?:\/\//.test(href);
    const extra = isExternal ? ' target="_blank" rel="noreferrer"' : "";
    return `<a href="${escapeHtmlAttribute(href)}"${titleAttribute}${extra}>${text}</a>`;
  };

  const html = marked.parse(markdown, {
    async: false,
    gfm: true,
    breaks: false,
    renderer,
  }) as string;

  return {
    html,
    headings,
  };
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
