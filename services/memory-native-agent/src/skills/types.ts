export type SkillSourceKind = "codex-skill" | "claude-skill" | "claude-command" | "mna-legacy";

export type SkillResourceKind = "reference" | "script" | "asset" | "other";

export type SkillRuntimeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface SkillResource {
  kind: SkillResourceKind;
  relativePath: string;
  absolutePath: string;
}

export interface SkillPackage {
  id: string;
  name: string;
  description: string;
  whenToUse?: string;
  argumentHint?: string;
  source: {
    kind: SkillSourceKind;
    rootDir: string;
    entryFile: string;
    originalPath?: string;
  };
  content: {
    markdown: string;
    resources: SkillResource[];
  };
  invocation: {
    userInvocable: boolean;
    modelInvocable: boolean;
    slashName: string;
    triggerPaths?: string[];
  };
  runtime: {
    shell?: "bash" | "powershell";
    model?: string;
    effort?: SkillRuntimeEffort;
  };
  permissions: {
    preapprovedTools?: string[];
  };
}

export interface ParsedMarkdownSkillFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface SkillImportRecord {
  skill: SkillPackage;
  importedAt: string;
}

export interface SkillInvocation {
  skill: SkillPackage;
  rawInput: string;
  rawArguments: string;
  positionalArguments: string[];
}

export class SkillError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SkillError";
    this.code = code;
    this.details = details;
  }
}

