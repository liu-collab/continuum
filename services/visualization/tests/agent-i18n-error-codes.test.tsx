import { describe, expect, it } from "vitest";

import { translateMessage } from "@/app/agent/_i18n/messages";

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
  "tool_denied_path",
  "tool_denied_pattern",
  "tool_confirm_timeout",
  "mcp_disconnected",
  "abort_ack",
  "session_store_unavailable",
  "api_version_mismatch"
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
});
