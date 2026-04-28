import { describe, expect, it } from "vitest";

import { formatAgentError, translateMessage } from "@/lib/i18n/agent/messages";

const errorCodes = [
  "token_invalid",
  "token_expired",
  "session_not_found",
  "turn_not_found",
  "workspace_mismatch",
  "runtime_unavailable",
  "provider_not_registered",
  "provider_auth_failed",
  "provider_rate_limited",
  "provider_timeout",
  "provider_stream_error",
  "memory_writeback_incomplete",
  "tool_denied_path",
  "tool_denied_pattern",
  "tool_confirm_timeout",
  "mcp_disconnected",
  "abort_ack",
  "session_store_unavailable",
  "api_version_mismatch"
] as const;

const writebackReasons = [
  "runtime_timeout",
  "runtime_unavailable",
  "storage_write_failed",
  "network_error",
  "invalid_request",
  "invalid_response",
  "unknown",
] as const;

describe("agent i18n error resources", () => {
  it.each(errorCodes)("provides zh-CN title and description for %s", (code) => {
    expect(translateMessage("zh-CN", `errors.${code}.title`)).not.toBe(`errors.${code}.title`);
    expect(translateMessage("zh-CN", `errors.${code}.description`)).not.toBe(`errors.${code}.description`);
  });

  it.each(errorCodes)("provides en-US title and description for %s", (code) => {
    expect(translateMessage("en-US", `errors.${code}.title`)).not.toBe(`errors.${code}.title`);
    expect(translateMessage("en-US", `errors.${code}.description`)).not.toBe(`errors.${code}.description`);
  });

  it.each(writebackReasons)("formats zh-CN memory writeback reason %s", (reason) => {
    const content = formatAgentError("zh-CN", "memory_writeback_incomplete", null, reason);

    expect(content.title).toBe("记忆保存未完成");
    expect(content.description).not.toBe(`errors.memory_writeback_incomplete.reasons.${reason}`);
    expect(content.description).toContain("本轮回复不受影响");
  });

  it.each(writebackReasons)("formats en-US memory writeback reason %s", (reason) => {
    const content = formatAgentError("en-US", "memory_writeback_incomplete", null, reason);

    expect(content.title).toBe("Memory was not saved");
    expect(content.description).not.toBe(`errors.memory_writeback_incomplete.reasons.${reason}`);
    expect(content.description).toContain("This reply is unaffected");
  });
});
