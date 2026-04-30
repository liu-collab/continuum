export function nowIso(): string {
  return new Date().toISOString();
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  let cjkChars = 0;
  let otherChars = 0;

  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjkChars += 1;
      continue;
    }

    otherChars += 1;
  }

  return Math.max(1, Math.ceil(cjkChars * 1.5 + otherChars / 4));
}

export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// Keep Unicode letters and digits, but normalize accents and separators into a stable slug.
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/['\u2018\u2019]+/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncateFromTail(text: string | undefined, maxLength: number): string {
  const normalized = normalizeText(text ?? "");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(normalized.length - maxLength);
}

export function textToLines(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?。！？])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

export function tokenizeForOverlap(text: string): string[] {
  const normalized = normalizeText(text).toLowerCase();
  const tokens: string[] = [];

  for (const rawToken of normalized.split(/[^a-z0-9\u4e00-\u9fff]+/i)) {
    const token = rawToken.trim();
    if (!token) {
      continue;
    }

    if (/^[\u4e00-\u9fff]+$/u.test(token)) {
      if (token.length >= 2) {
        tokens.push(token);
      }
      for (let index = 0; index < token.length - 1; index += 1) {
        tokens.push(token.slice(index, index + 2));
      }
      continue;
    }

    if (token.length >= 2) {
      tokens.push(token);
    }
  }

  return tokens;
}

export function buildSemanticQueryTerms(text: string, maxTerms = 48): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const rawToken of tokenizeForOverlap(text)) {
    const term = rawToken.trim().toLowerCase();
    if (!term || seen.has(term)) {
      continue;
    }

    seen.add(term);
    terms.push(term);
    if (terms.length >= maxTerms) {
      break;
    }
  }

  return terms;
}

export function jaccardOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokenizeForOverlap(left));
  const rightTokens = new Set(tokenizeForOverlap(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

const HISTORY_REFERENCE_PATTERNS = [
  "上次",
  "上回",
  "之前",
  "前几天",
  "上周",
  "你还记得",
  "还记得吗",
  "我们讨论过",
  "之前提过",
  "沿用之前",
  "偏好",
  "我一般",
  "last time",
  "previously",
  "earlier",
  "we discussed",
  "as before",
  "remember when",
  "你叫什么",
  "你是谁",
  "你是啥",
  "你是什么",
  "你叫啥",
  "你的名字",
  "怎么称呼你",
  "称呼你",
  "叫你什么",
  "让你叫什么",
];

export function matchesHistoryReference(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  return HISTORY_REFERENCE_PATTERNS.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

export function matchesContextDependentShortReference(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  if (normalized.length < 2) {
    return false;
  }

  return [
    /^(继续|接着|照旧|还是那个|按之前|按上次|沿用|恢复)$/u,
    /^(继续|接着).{0,8}(任务|方案|这个|那个|它)$/u,
    /^(这个|那个|它|他|她|这版|上一版|刚才的).{0,8}(继续|照旧|可以|不行|改一下|删掉|保留)$/u,
    /^.{1,12}(叫什么|名字|称呼)$/u,
  ].some((pattern) => pattern.test(normalized));
}
