import { describe, expect, it } from "vitest";

import { matchesContextDependentShortReference, matchesHistoryReference, slugify } from "../src/shared/utils.js";

describe("shared utils", () => {
  describe("slugify", () => {
    it("lowercases text and collapses separators", () => {
      expect(slugify("  Hello, World!  ")).toBe("hello-world");
      expect(slugify("alpha---beta___gamma")).toBe("alpha-beta-gamma");
    });

    it("removes Latin diacritics", () => {
      expect(slugify("Crème Brûlée à la Mode")).toBe("creme-brulee-a-la-mode");
    });

    it("normalizes compatibility characters such as fullwidth letters and digits", () => {
      expect(slugify("ＡＢＣ １２３")).toBe("abc-123");
    });

    it("removes apostrophes inside words", () => {
      expect(slugify("Jack & Jill's Story")).toBe("jack-jills-story");
      expect(slugify("Reader\u2019s Notes")).toBe("readers-notes");
    });

    it("keeps Unicode letters and numbers", () => {
      expect(slugify("记忆 检索 v2")).toBe("记忆-检索-v2");
      expect(slugify("Release 2026.04.24")).toBe("release-2026-04-24");
    });

    it("formats a mixed-language title into a stable slug", () => {
      expect(slugify("Crème Brûlée: 记忆 检索 v2!")).toBe("creme-brulee-记忆-检索-v2");
    });

    it("returns an empty string when no slug characters remain", () => {
      expect(slugify("")).toBe("");
      expect(slugify("   --- !!!   ")).toBe("");
      expect(slugify("🙂✨")).toBe("");
    });
  });

  describe("matchesHistoryReference", () => {
    it("matches Chinese assistant name questions as history references", () => {
      expect(matchesHistoryReference("你还记得我让你叫什么吗？")).toBe(true);
      expect(matchesHistoryReference("我之前怎么称呼你来着")).toBe(true);
    });
  });

  describe("matchesContextDependentShortReference", () => {
    it("keeps terse continuation inputs available for memory recall", () => {
      expect(matchesContextDependentShortReference("继续")).toBe(true);
      expect(matchesContextDependentShortReference("这个继续")).toBe(true);
      expect(matchesContextDependentShortReference("ls")).toBe(false);
    });
  });
});
