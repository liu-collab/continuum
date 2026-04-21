import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_MEMORY_TIERING_SCENARIO,
  evaluateTurnExpectations,
  type MemoryTieringScenario,
  type PromptSegmentView,
} from "./memory-tiering-tool.js";

type SessionPayload = {
  session_id: string;
  ws_url: string;
  memory_mode: string;
  workspace_id?: string;
};

type PromptInspectorPayload = {
  turn_id: string;
  provider_id: string;
  model: string;
  round: number;
  prompt_segments: PromptSegmentView[];
  messages: Array<{ role: string; content: string }>;
};

type TurnRunResult = {
  turnId: string;
  finishReason: string | null;
  events: Array<Record<string, unknown>>;
};

type CliOptions = {
  baseUrl: string;
  token: string;
  scenario: MemoryTieringScenario;
  workspaceId?: string;
  locale: string;
  settleMs: number;
  turnTimeoutMs: number;
  reportFile?: string;
};

const DEFAULT_BASE_URL = process.env.MNA_BASE_URL ?? process.env.NEXT_PUBLIC_MNA_BASE_URL ?? "http://127.0.0.1:4193";
const DEFAULT_LOCALE = "zh-CN";
const DEFAULT_SETTLE_MS = 250;
const DEFAULT_TURN_TIMEOUT_MS = 20_000;

async function main() {
  const options = await loadCliOptions();
  const session = await createSession(options);
  const report = [];

  console.log(`scenario: ${options.scenario.label}`);
  console.log(`session: ${session.session_id}`);
  console.log(`baseUrl: ${options.baseUrl}`);

  for (let index = 0; index < options.scenario.turns.length; index += 1) {
    const turn = options.scenario.turns[index];
    if (!turn) {
      continue;
    }
    const turnId = `memory-tiering-${index + 1}-${turn.id}`;
    console.log(`\n[turn ${index + 1}] ${turn.label}`);
    console.log(`prompt: ${turn.text}`);

    let turnResult: TurnRunResult | null = null;
    let inspector: PromptInspectorPayload | null = null;
    let executionError: string | null = null;

    try {
      turnResult = await runTurn(session.ws_url, {
        turnId,
        text: turn.text,
        settleMs: options.settleMs,
        timeoutMs: options.turnTimeoutMs,
      });
      inspector = await fetchPromptInspector(options, turnId);
    } catch (error) {
      executionError = error instanceof Error ? error.message : String(error);
    }

    const analysis = evaluateTurnExpectations(inspector?.prompt_segments ?? [], turn.expectation);
    if (executionError) {
      analysis.passed = false;
      analysis.failures.unshift(`执行失败: ${executionError}`);
    }
    const summary = {
      turn_id: turnId,
      label: turn.label,
      text: turn.text,
      finish_reason: turnResult?.finishReason ?? null,
      provider_id: inspector?.provider_id ?? null,
      model: inspector?.model ?? null,
      round: inspector?.round ?? null,
      prompt_segment_kinds: (inspector?.prompt_segments ?? []).map((segment) => segment.kind),
      phases: analysis.aggregation.phases,
      high_segment_count: analysis.aggregation.highSegmentCount,
      summary_segment_count: analysis.aggregation.summarySegmentCount,
      high_record_count: analysis.aggregation.highRecordCount,
      summary_record_count: analysis.aggregation.summaryRecordCount,
      passed: analysis.passed,
      failures: analysis.failures,
      prompt_segments: inspector?.prompt_segments ?? [],
      execution_error: executionError,
    };
    report.push(summary);

    console.log(`segments: ${summary.prompt_segment_kinds.join(", ") || "(none)"}`);
    console.log(`phases: ${summary.phases.join(", ") || "(none)"}`);
    console.log(`memory_high records: ${summary.high_record_count}`);
    console.log(`memory_summary segments: ${summary.summary_segment_count}`);
    console.log(`expectation: ${analysis.passed ? "PASS" : "FAIL"}`);
    if (!analysis.passed) {
      for (const failure of analysis.failures) {
        console.log(`  - ${failure}`);
      }
    }
  }

  const output = {
    scenario: options.scenario,
    session_id: session.session_id,
    base_url: options.baseUrl,
    generated_at: new Date().toISOString(),
    passed: report.every((item) => item.passed),
    turns: report,
  };

  if (options.reportFile) {
    await fs.mkdir(path.dirname(options.reportFile), { recursive: true });
    await fs.writeFile(options.reportFile, JSON.stringify(output, null, 2), "utf8");
    console.log(`\nreport saved: ${options.reportFile}`);
  }

  if (!output.passed) {
    process.exitCode = 1;
  }
}

async function loadCliOptions(): Promise<CliOptions> {
  const parsed = parseArgs({
    allowPositionals: false,
    options: {
      "base-url": { type: "string" },
      token: { type: "string" },
      "token-path": { type: "string" },
      "scenario-file": { type: "string" },
      "workspace-id": { type: "string" },
      locale: { type: "string" },
      "settle-ms": { type: "string" },
      "turn-timeout-ms": { type: "string" },
      "report-file": { type: "string" },
    },
  });

  const baseUrl = parsed.values["base-url"] ?? DEFAULT_BASE_URL;
  const token = parsed.values.token ?? await readToken(parsed.values["token-path"]);
  const scenario = parsed.values["scenario-file"]
    ? await loadScenarioFile(parsed.values["scenario-file"])
    : DEFAULT_MEMORY_TIERING_SCENARIO;
  const locale = parsed.values.locale ?? DEFAULT_LOCALE;
  const settleMs = parsed.values["settle-ms"] ? Number(parsed.values["settle-ms"]) : DEFAULT_SETTLE_MS;
  const turnTimeoutMs = parsed.values["turn-timeout-ms"] ? Number(parsed.values["turn-timeout-ms"]) : DEFAULT_TURN_TIMEOUT_MS;

  if (!Number.isFinite(settleMs) || settleMs < 0) {
    throw new Error("settle-ms 必须是非负整数。");
  }
  if (!Number.isFinite(turnTimeoutMs) || turnTimeoutMs <= 0) {
    throw new Error("turn-timeout-ms 必须是正整数。");
  }

  return {
    baseUrl,
    token,
    scenario,
    workspaceId: parsed.values["workspace-id"],
    locale,
    settleMs,
    turnTimeoutMs,
    reportFile: parsed.values["report-file"],
  };
}

async function loadScenarioFile(filePath: string): Promise<MemoryTieringScenario> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as MemoryTieringScenario;
  if (!parsed.id || !parsed.label || !Array.isArray(parsed.turns) || parsed.turns.length === 0) {
    throw new Error("scenario-file 格式不合法，至少需要 id / label / turns。");
  }
  return parsed;
}

async function readToken(explicitPath?: string): Promise<string> {
  const candidates = [
    explicitPath,
    process.env.MNA_TOKEN_PATH,
    path.join(os.homedir(), ".continuum", "managed", "mna", "token.txt"),
    path.join(os.homedir(), ".mna", "token.txt"),
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const candidate of candidates) {
    try {
      const token = (await fs.readFile(candidate, "utf8")).trim();
      if (token.length > 0) {
        return token;
      }
    } catch {
      // keep trying
    }
  }

  throw new Error("未找到可用 token，请通过 --token 或 --token-path 显式传入。");
}

async function createSession(options: CliOptions): Promise<SessionPayload> {
  const response = await fetch(`${options.baseUrl.replace(/\/+$/, "")}/v1/agent/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...(options.workspaceId ? { workspace_id: options.workspaceId } : {}),
      locale: options.locale,
    }),
  });

  if (!response.ok) {
    throw new Error(`create session failed: HTTP ${response.status}`);
  }

  return response.json() as Promise<SessionPayload>;
}

async function runTurn(wsUrl: string, input: {
  turnId: string;
  text: string;
  settleMs: number;
  timeoutMs: number;
}): Promise<TurnRunResult> {
  const events: Array<Record<string, unknown>> = [];
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
  });

  const completion = new Promise<TurnRunResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for turn_end: ${input.turnId}`));
    }, input.timeoutMs);

    ws.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      events.push(payload);
      if (payload.kind === "turn_end" && payload.turn_id === input.turnId) {
        clearTimeout(timer);
        setTimeout(() => {
          resolve({
            turnId: input.turnId,
            finishReason: typeof payload.finish_reason === "string" ? payload.finish_reason : null,
            events,
          });
        }, input.settleMs);
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`websocket message failed: ${input.turnId}`));
    });
  });

  ws.send(JSON.stringify({
    kind: "user_input",
    turn_id: input.turnId,
    text: input.text,
  }));

  const result = await completion.finally(() => {
    ws.close();
  });
  return result;
}

async function fetchPromptInspector(options: CliOptions, turnId: string): Promise<PromptInspectorPayload> {
  const response = await fetch(`${options.baseUrl.replace(/\/+$/, "")}/v1/agent/turns/${turnId}/dispatched-messages`, {
    headers: {
      authorization: `Bearer ${options.token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`prompt inspector failed: turn=${turnId}, HTTP ${response.status}`);
  }

  return response.json() as Promise<PromptInspectorPayload>;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
