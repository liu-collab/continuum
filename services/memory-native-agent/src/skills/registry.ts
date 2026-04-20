import fs from "node:fs";
import path from "node:path";

import { discoverSkillInputs, importSkillFromPath } from "./importer.js";
import type { SkillImportRecord, SkillPackage } from "./types.js";

interface PersistedRegistryFile {
  version: 1;
  entries: Array<{
    source_path: string;
    imported_at: string;
  }>;
}

export interface SkillRegistryOptions {
  persistencePath?: string;
}

export class SkillRegistry {
  private readonly byId = new Map<string, SkillImportRecord>();
  private readonly bySlashName = new Map<string, SkillPackage>();
  private readonly sourcePaths = new Map<string, string>();

  constructor(private readonly options: SkillRegistryOptions = {}) {}

  register(skill: SkillPackage, sourcePath?: string): SkillPackage {
    const record: SkillImportRecord = {
      skill,
      importedAt: new Date().toISOString(),
    };
    this.byId.set(skill.id, record);
    this.bySlashName.set(skill.invocation.slashName, skill);
    if (sourcePath) {
      this.sourcePaths.set(skill.id, sourcePath);
    }
    return skill;
  }

  importFromPath(inputPath: string): SkillPackage {
    const skill = importSkillFromPath(inputPath);
    this.register(skill, inputPath);
    this.save();
    return skill;
  }

  loadPersisted() {
    const filePath = this.options.persistencePath;
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as PersistedRegistryFile;
    for (const entry of parsed.entries ?? []) {
      try {
        const skill = importSkillFromPath(entry.source_path);
        this.register(skill, entry.source_path);
      } catch {
        // Skip stale persisted entries.
      }
    }
  }

  discover(pathsToScan: string[], workspaceRoot: string) {
    const inputs = discoverSkillInputs(pathsToScan, workspaceRoot);
    for (const input of inputs) {
      try {
        const skill = importSkillFromPath(input);
        this.register(skill, input);
      } catch {
        // Ignore bad discovery entries and keep startup resilient.
      }
    }
    this.save();
  }

  list(): SkillPackage[] {
    return [...this.byId.values()]
      .map((item) => item.skill)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getBySlashName(name: string): SkillPackage | undefined {
    return this.bySlashName.get(name);
  }

  getById(id: string): SkillPackage | undefined {
    return this.byId.get(id)?.skill;
  }

  save() {
    const filePath = this.options.persistencePath;
    if (!filePath) {
      return;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: PersistedRegistryFile = {
      version: 1,
      entries: this.list().map((skill) => ({
        source_path: this.sourcePaths.get(skill.id) ?? skill.source.originalPath ?? skill.source.entryFile,
        imported_at: this.byId.get(skill.id)?.importedAt ?? new Date().toISOString(),
      })),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  }
}

