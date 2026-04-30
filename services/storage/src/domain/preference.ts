export type PreferencePolarity = "positive" | "negative" | "neutral";

export interface CanonicalPreference {
  subject: string;
  axis: string;
  value: string;
  polarity: PreferencePolarity;
  predicate_canonical: string;
}

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  eight: 8,
  "二": 2,
  "两": 2,
  "三": 3,
  "四": 4,
  "八": 8,
};

const NEGATIVE_PATTERNS = [
  "do not",
  "don't",
  "not ",
  "avoid",
  "dislike",
  "hate",
  "不用",
  "不要",
  "不喜欢",
  "避免",
  "别用",
];

const POSITIVE_PATTERNS = [
  "prefer",
  "preferred",
  "like",
  "love",
  "want",
  "default",
  "usually",
  "always",
  "偏好",
  "喜欢",
  "默认",
  "习惯",
  "通常",
];

const RESPONSE_KEYWORDS = [
  "answer",
  "reply",
  "response",
  "respond",
  "output",
  "回答",
  "回复",
  "输出",
];

const COMMENT_KEYWORDS = ["comment", "comments", "注释", "commenting"];

const VERBOSITY_CONCISE = [
  "concise",
  "brief",
  "short",
  "simple",
  "简洁",
  "简短",
  "精简",
  "精炼",
];

const VERBOSITY_DETAILED = [
  "detailed",
  "verbose",
  "thorough",
  "详细",
  "展开",
  "完整",
];

const NAMING_STYLES: Array<{ match: string[]; value: string }> = [
  { match: ["camelcase", "camel case"], value: "camel_case" },
  { match: ["snake_case", "snake case"], value: "snake_case" },
  { match: ["pascalcase", "pascal case"], value: "pascal_case" },
  { match: ["kebab-case", "kebab case"], value: "kebab_case" },
];

export function canonicalizePreference(input: {
  summary: string;
  details: Record<string, unknown>;
}): CanonicalPreference {
  const subject = normalizeText(stringOrFallback(input.details.subject, "user"));
  const predicateSource = stringOrFallback(
    input.details.predicate,
    input.summary,
  );
  const explicitAxis = normalizeText(stringOrFallback(input.details.preference_axis, ""));
  const explicitValue = normalizeText(stringOrFallback(input.details.preference_value, ""));
  const explicitPolarity = normalizePolarity(
    stringOrFallback(input.details.preference_polarity, ""),
  );
  const explicitPredicateCanonical = normalizeText(
    stringOrFallback(input.details.predicate_canonical, ""),
  );
  const inferred = inferPreferenceDescriptor(
    explicitPredicateCanonical || predicateSource || input.summary,
  );

  return {
    subject,
    axis: explicitAxis || inferred.axis || normalizeSemanticPredicate(predicateSource),
    value: explicitValue || inferred.value || normalizeSemanticPredicate(predicateSource),
    polarity:
      explicitPolarity !== "neutral" ? explicitPolarity : inferred.polarity,
    predicate_canonical:
      explicitPredicateCanonical ||
      inferred.predicate_canonical ||
      normalizeSemanticPredicate(predicateSource),
  };
}

export function buildPreferenceDedupeKey(
  scope: string,
  preference: CanonicalPreference,
): string {
  return `preference:${scope}:${preference.subject}:${preference.axis}`;
}

export function isSamePreference(
  left: CanonicalPreference,
  right: CanonicalPreference,
): boolean {
  return (
    left.axis === right.axis &&
    left.value === right.value &&
    left.polarity === right.polarity
  );
}

export function isConflictingPreference(
  left: CanonicalPreference,
  right: CanonicalPreference,
): boolean {
  if (left.axis !== right.axis) {
    return false;
  }

  if (left.value !== right.value) {
    return true;
  }

  return (
    left.polarity !== "neutral" &&
    right.polarity !== "neutral" &&
    left.polarity !== right.polarity
  );
}

function inferPreferenceDescriptor(text: string): Omit<
  CanonicalPreference,
  "subject"
> {
  const normalized = normalizeText(text);

  const indentation = detectIndentation(normalized);
  if (indentation) {
    return indentation;
  }

  const responseLanguage = detectLanguagePreference(normalized, RESPONSE_KEYWORDS);
  if (responseLanguage) {
    return responseLanguage;
  }

  const commentLanguage = detectLanguagePreference(normalized, COMMENT_KEYWORDS);
  if (commentLanguage) {
    return {
      ...commentLanguage,
      axis: "comment_language",
    };
  }

  const verbosity = detectVerbosity(normalized);
  if (verbosity) {
    return verbosity;
  }

  const namingStyle = detectNamingStyle(normalized);
  if (namingStyle) {
    return namingStyle;
  }

  const predicateCanonical = normalizeSemanticPredicate(text);
  return {
    axis: predicateCanonical,
    value: predicateCanonical,
    polarity: inferPolarity(normalized),
    predicate_canonical: predicateCanonical,
  };
}

function detectIndentation(
  normalized: string,
): Omit<CanonicalPreference, "subject"> | null {
  if (
    !containsAny(normalized, ["indent", "indentation", "缩进", "tab", "space", "spaces", "空格"])
  ) {
    return null;
  }

  const explicitSpaces = normalized.match(
    /(\d+|two|three|four|eight|二|两|三|四|八)\s*(?:spaces?|空格)/,
  );
  if (explicitSpaces?.[1]) {
    const parsed = parseNumberToken(explicitSpaces[1]);
    if (parsed) {
      return {
        axis: "indentation",
        value: `spaces:${parsed}`,
        polarity: "positive",
        predicate_canonical: `indentation spaces ${parsed}`,
      };
    }
  }

  if (containsAny(normalized, ["tab", "tabs", "制表符"])) {
    return {
      axis: "indentation",
      value: "tab",
      polarity: inferPolarity(normalized),
      predicate_canonical: "indentation tab",
    };
  }

  if (containsAny(normalized, ["space", "spaces", "空格"])) {
    return {
      axis: "indentation",
      value: "spaces",
      polarity: inferPolarity(normalized),
      predicate_canonical: "indentation spaces",
    };
  }

  return null;
}

function detectLanguagePreference(
  normalized: string,
  scopeKeywords: string[],
): Omit<CanonicalPreference, "subject"> | null {
  const hasScopeKeyword = containsAny(normalized, scopeKeywords);
  const languages = [
    { tokens: ["中文", "chinese"], value: "zh" },
    { tokens: ["英文", "english"], value: "en" },
  ];

  for (const language of languages) {
    if (!containsAny(normalized, language.tokens)) {
      continue;
    }

    if (!hasScopeKeyword && !normalized.startsWith(language.tokens[0]!)) {
      continue;
    }

    return {
      axis: scopeKeywords === COMMENT_KEYWORDS ? "comment_language" : "response_language",
      value: language.value,
      polarity: inferPolarity(normalized),
      predicate_canonical: `${
        scopeKeywords === COMMENT_KEYWORDS ? "comment_language" : "response_language"
      } ${language.value}`,
    };
  }

  return null;
}

function detectVerbosity(
  normalized: string,
): Omit<CanonicalPreference, "subject"> | null {
  if (containsAny(normalized, VERBOSITY_CONCISE)) {
    return {
      axis: "response_verbosity",
      value: "concise",
      polarity: inferPolarity(normalized),
      predicate_canonical: "response_verbosity concise",
    };
  }

  if (containsAny(normalized, VERBOSITY_DETAILED)) {
    return {
      axis: "response_verbosity",
      value: "detailed",
      polarity: inferPolarity(normalized),
      predicate_canonical: "response_verbosity detailed",
    };
  }

  return null;
}

function detectNamingStyle(
  normalized: string,
): Omit<CanonicalPreference, "subject"> | null {
  for (const item of NAMING_STYLES) {
    if (!containsAny(normalized, item.match)) {
      continue;
    }

    return {
      axis: "naming_style",
      value: item.value,
      polarity: inferPolarity(normalized),
      predicate_canonical: `naming_style ${item.value}`,
    };
  }

  return null;
}

function parseNumberToken(token: string): number | null {
  if (/^\d+$/.test(token)) {
    return Number.parseInt(token, 10);
  }

  return NUMBER_WORDS[token] ?? null;
}

function normalizePolarity(value: string): PreferencePolarity {
  if (value === "positive" || value === "negative" || value === "neutral") {
    return value;
  }

  return "neutral";
}

function inferPolarity(input: string): PreferencePolarity {
  if (containsAny(input, NEGATIVE_PATTERNS)) {
    return "negative";
  }

  if (containsAny(input, POSITIVE_PATTERNS)) {
    return "positive";
  }

  return "neutral";
}

function normalizeSemanticPredicate(input: string): string {
  return normalizeText(input)
    .replace(/\b(do not|don't|not|dislike|avoid|hate)\b/g, "")
    .replace(/\b(prefers|prefer|likes|like|love|loves|wants|want)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase();
}

function containsAny(input: string, patterns: string[]): boolean {
  return patterns.some((pattern) => input.includes(pattern));
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}
