import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { marked } from "marked";

const repositoryRoot = path.resolve(process.cwd(), "..", "..");
const docsRoot = "docs";
const absoluteDocsRoot = path.resolve(repositoryRoot, docsRoot);
const defaultDescription = "查看这份文档的完整内容和章节目录。";
const defaultCategoryOrder = 99;
const categoryLabels: Record<string, string> = {
  overview: "公共文档",
  storage: "Storage",
  retrieval: "Retrieval",
  visualization: "Visualization",
  "memory-native-agent": "Memory Native Agent",
};
const categoryOrders: Record<string, number> = {
  overview: 0,
  storage: 10,
  retrieval: 20,
  visualization: 30,
  "memory-native-agent": 40,
};

export type DocHeading = {
  id: string;
  level: 2 | 3;
  text: string;
};

export type DocFrontmatter = {
  title?: string;
  description?: string;
  category?: string;
  categoryOrder?: number;
  order?: number;
  slug?: string;
  hidden?: boolean;
  raw: Record<string, unknown>;
};

export type RepositoryDocFile = {
  relativePath: string;
  markdown: string;
};

export type RepositoryDocIndexEntry = {
  relativePath: string;
  slug: string;
  href: `/docs/${string}`;
  title: string;
  description: string;
  category: {
    key: string;
    label: string;
    order: number;
  };
  order?: number;
  hidden: boolean;
};

export async function readRepositoryDoc(relativePath: string) {
  const normalizedPath = normalizeRepositoryPath(relativePath);
  if (!normalizedPath.startsWith(`${docsRoot}/`) || !normalizedPath.toLowerCase().endsWith(".md")) {
    throw new Error("Repository document path must point to a markdown file under docs.");
  }

  const absolutePath = path.resolve(repositoryRoot, normalizedPath);
  if (!isPathInsideDirectory(absolutePath, absoluteDocsRoot)) {
    throw new Error("Repository document path is outside the docs directory.");
  }

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

export function parseDocFrontmatter(markdown: string): { frontmatter: DocFrontmatter; content: string } {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const raw: Record<string, unknown> = {};

  if (!match) {
    return {
      frontmatter: { raw },
      content: markdown,
    };
  }

  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const fieldMatch = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!fieldMatch) {
      continue;
    }

    raw[normalizeFrontmatterKey(fieldMatch[1])] = parseFrontmatterValue(fieldMatch[2]);
  }

  return {
    frontmatter: {
      title: readFrontmatterString(raw.title),
      description: readFrontmatterString(raw.description),
      category: readFrontmatterString(raw.category),
      categoryOrder: readFrontmatterNumber(raw.categoryOrder),
      order: readFrontmatterNumber(raw.order ?? raw.navOrder),
      slug: readFrontmatterString(raw.slug),
      hidden: readFrontmatterBoolean(raw.hidden),
      raw,
    },
    content: normalized.slice(match[0].length),
  };
}

export function buildRepositoryDocIndex(
  files: RepositoryDocFile[],
  options: { includeHidden?: boolean } = {},
): RepositoryDocIndexEntry[] {
  return files
    .map((file) => buildRepositoryDocIndexEntry(file))
    .filter((entry) => options.includeHidden || !entry.hidden)
    .sort(compareRepositoryDocIndexEntries);
}

export async function getRepositoryDocs(options: { includeHidden?: boolean } = {}) {
  const relativePaths = await collectMarkdownFiles(docsRoot);
  const files = await Promise.all(
    relativePaths.map(async (relativePath) => ({
      relativePath,
      markdown: await readRepositoryDoc(relativePath),
    })),
  );
  return buildRepositoryDocIndex(files, options);
}

export async function findRepositoryDocBySlug(slug: string | string[]) {
  const normalizedSlug = normalizeDocSlug(Array.isArray(slug) ? slug.join("/") : slug);
  if (!normalizedSlug) {
    return undefined;
  }

  const docs = await getRepositoryDocs({ includeHidden: true });
  return docs.find((doc) => doc.slug === normalizedSlug);
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
  const { frontmatter, content } = parseDocFrontmatter(markdown);
  const headings = extractDocHeadings(content);
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

  const html = marked.parse(content, {
    async: false,
    gfm: true,
    breaks: false,
    renderer,
  }) as string;

  return {
    html,
    headings,
    frontmatter,
  };
}

function buildRepositoryDocIndexEntry(file: RepositoryDocFile): RepositoryDocIndexEntry {
  const { frontmatter, content } = parseDocFrontmatter(file.markdown);
  const category = resolveDocCategory(file.relativePath, frontmatter);
  const title = frontmatter.title ?? extractDocTitle(content) ?? titleFromPath(file.relativePath);
  const description = frontmatter.description ?? extractDocDescription(content) ?? defaultDescription;
  const slug = normalizeDocSlug(frontmatter.slug ?? slugFromPath(file.relativePath));

  return {
    relativePath: normalizeRepositoryPath(file.relativePath),
    slug,
    href: `/docs/${slug}`,
    title,
    description,
    category,
    order: frontmatter.order,
    hidden: frontmatter.hidden ?? false,
  };
}

function compareRepositoryDocIndexEntries(left: RepositoryDocIndexEntry, right: RepositoryDocIndexEntry) {
  const categoryOrder = left.category.order - right.category.order;
  if (categoryOrder !== 0) {
    return categoryOrder;
  }

  const entryOrder = (left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY);
  if (entryOrder !== 0) {
    return entryOrder;
  }

  const titleOrder = left.title.localeCompare(right.title, "zh-Hans");
  if (titleOrder !== 0) {
    return titleOrder;
  }

  return left.relativePath.localeCompare(right.relativePath, "zh-Hans");
}

async function collectMarkdownFiles(relativeDirectory: string): Promise<string[]> {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  const entries = (await readdir(absoluteDirectory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = normalizeRepositoryPath(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(relativePath)));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(relativePath);
    }
  }

  return files;
}

function resolveDocCategory(relativePath: string, frontmatter: DocFrontmatter): RepositoryDocIndexEntry["category"] {
  const frontmatterCategory = frontmatter.category ? normalizeCategoryKey(frontmatter.category) : undefined;
  const key = frontmatterCategory ?? deriveCategoryKey(relativePath);
  return {
    key,
    label: categoryLabels[key] ?? frontmatter.category ?? titleFromSegment(key),
    order: frontmatter.categoryOrder ?? categoryOrders[key] ?? defaultCategoryOrder,
  };
}

function deriveCategoryKey(relativePath: string) {
  const normalized = normalizeRepositoryPath(relativePath);
  const parts = normalized.split("/");
  const docsIndex = parts[0] === docsRoot ? 1 : 0;
  const firstPart = parts[docsIndex];
  const isRootDoc = parts.length <= docsIndex + 1;
  return isRootDoc || !firstPart ? "overview" : normalizeCategoryKey(firstPart);
}

function normalizeRepositoryPath(value: string) {
  return value.split(/[\\/]+/).filter(Boolean).join("/");
}

function normalizeDocSlug(value: string) {
  return value
    .split(/[\\/]+/)
    .map((segment) => createSlug(segment))
    .filter(Boolean)
    .join("/");
}

function slugFromPath(relativePath: string) {
  const normalized = normalizeRepositoryPath(relativePath);
  const withoutRoot = normalized.startsWith(`${docsRoot}/`) ? normalized.slice(docsRoot.length + 1) : normalized;
  const withoutExtension = withoutRoot.replace(/\.md$/i, "");
  const withoutIndex = withoutExtension.replace(/(^|\/)(README|index)$/i, "$1");
  return withoutIndex.replace(/\/+$/, "") || "readme";
}

function extractDocTitle(markdown: string) {
  const match = markdown.replace(/\r\n/g, "\n").match(/^#\s+(.+)$/m);
  return match ? stripInlineMarkdown(match[1]) : undefined;
}

function extractDocDescription(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("- ") ||
      trimmed.startsWith("* ") ||
      trimmed.startsWith(">") ||
      trimmed.startsWith("|") ||
      trimmed.startsWith("```")
    ) {
      continue;
    }

    return truncateDescription(stripInlineMarkdown(trimmed));
  }

  return undefined;
}

function titleFromPath(relativePath: string) {
  const normalized = normalizeRepositoryPath(relativePath);
  const withoutExtension = normalized.replace(/\.md$/i, "");
  const base = withoutExtension.split("/").pop() ?? withoutExtension;
  if (/^(README|index)$/i.test(base)) {
    return "文档目录";
  }
  return titleFromSegment(base);
}

function titleFromSegment(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .trim();
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function truncateDescription(value: string) {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function normalizeCategoryKey(value: string) {
  return createSlug(value.replace(/_/g, "-"));
}

function normalizeFrontmatterKey(value: string) {
  return value.replace(/[-_]+([A-Za-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function parseFrontmatterValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}

function readFrontmatterString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readFrontmatterNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readFrontmatterBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isPathInsideDirectory(absolutePath: string, absoluteDirectory: string) {
  const relativePath = path.relative(absoluteDirectory, absolutePath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}
