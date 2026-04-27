#!/usr/bin/env node

/**
 * 真实宿主对话注入验收 — 共享辅助模块
 *
 * 包含：
 * - 测试记忆样本（将预先种入 runtime，用来验证注入）
 * - 期望命中词断言规则
 * - 宿主原始输出解析（Claude stream-json / Codex JSONL）
 * - runtime 观测接口读取与轨迹断言
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

// ---------------------------------------------------------------------------
// 测试记忆样本
// 这组记忆会通过 runtime seed API 预先种入，然后验证宿主最终回答是否体现了这些内容
// ---------------------------------------------------------------------------

export const TEST_MEMORY_SEEDS = [
  {
    id: "e2e-mem-001",
    memory_type: "fact_preference",
    scope: "user",
    summary:
      "用户偏好使用 TypeScript 而非 JavaScript，要求所有代码示例都带类型注释",
    importance: 0.9,
    confidence: 0.95,
    status: "active",
  },
  {
    id: "e2e-mem-002",
    memory_type: "task_state",
    scope: "workspace",
    summary:
      "当前项目正在迁移到 ESM 模块系统，所有新文件必须使用 .mjs 或 type:module",
    importance: 0.85,
    confidence: 0.9,
    status: "active",
  },
  {
    id: "e2e-mem-003",
    memory_type: "fact_preference",
    scope: "user",
    summary: "用户喜欢简洁的代码风格，反对过度注释，倾向于自说明变量名",
    importance: 0.8,
    confidence: 0.88,
    status: "active",
  },
];

// 用于判断宿主最终回答是否体现了注入记忆的关键词
export const INJECTION_SIGNAL_KEYWORDS = [
  "TypeScript",
  "类型注释",
  "ESM",
  "type:module",
  ".mjs",
  "简洁",
  "偏好",
  "preference",
];

// 触发记忆检索的测试 prompt
export const TEST_PROMPT_CN =
  "帮我写一个简单的工具函数，要符合我的代码风格和项目要求。";

export const TEST_PROMPT_EN =
  "Write me a simple utility function that fits my coding style and project requirements.";

// ---------------------------------------------------------------------------
// runtime HTTP 工具
// ---------------------------------------------------------------------------

/**
 * 通用 HTTP GET/POST
 */
export function runtimeRequest(baseUrl, path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(path, baseUrl);
    const isHttps = fullUrl.protocol === "https:";
    const lib = isHttps ? https : http;
    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      timeout: 10_000,
    };
    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      options.headers["content-length"] = Buffer.byteLength(payload);
    }

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`request timeout: ${method} ${path}`));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * 检查 runtime 是否可用
 */
export async function checkRuntimeReachable(baseUrl) {
  try {
    const res = await runtimeRequest(baseUrl, "/healthz");
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * 从 runtime observe/runs 接口读取轨迹，按 session_id 过滤
 */
export async function fetchRuntimeRuns(baseUrl, sessionId) {
  const path = `/v1/runtime/observe/runs?session_id=${encodeURIComponent(sessionId)}&page_size=50`;
  const res = await runtimeRequest(baseUrl, path);
  if (res.status !== 200) {
    throw new Error(
      `observe/runs returned ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body;
}

/**
 * 断言 runtime 观测轨迹包含注入事件
 * 返回 { pass, reason, detail }
 */
export function assertRuntimeInjectionTrace(runs, sessionId) {
  if (!runs || !Array.isArray(runs.turns) || runs.turns.length === 0) {
    return {
      pass: false,
      reason: "runtime 观测不到任何 turn 记录",
      detail: runs,
    };
  }

  const matchingTurns = runs.turns.filter(
    (turn) => !sessionId || turn.session_id === sessionId,
  );

  if (matchingTurns.length === 0) {
    return {
      pass: false,
      reason: `runtime 观测不到 session_id=${sessionId} 的 turn`,
      detail: { total_turns: runs.turns.length },
    };
  }

  const hasInjection =
    Array.isArray(runs.injection_runs) && runs.injection_runs.length > 0;
  const hasTrigger =
    Array.isArray(runs.trigger_runs) && runs.trigger_runs.length > 0;
  const hasRecall =
    Array.isArray(runs.recall_runs) && runs.recall_runs.length > 0;

  return {
    pass: hasTrigger || hasRecall || hasInjection,
    reason:
      hasTrigger || hasRecall || hasInjection
        ? "runtime 观测到检索/注入轨迹"
        : "runtime 有 turn 记录，但未观测到检索或注入轨迹",
    detail: {
      turns: matchingTurns.length,
      trigger_runs: runs.trigger_runs?.length ?? 0,
      recall_runs: runs.recall_runs?.length ?? 0,
      injection_runs: runs.injection_runs?.length ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// 宿主输出解析
// ---------------------------------------------------------------------------

/**
 * 从 Claude stream-json 输出中提取最终文字回答
 * Claude --output-format stream-json 每行是一个 JSON 事件
 */
export function parseClaudeStreamOutput(rawStdout) {
  const lines = rawStdout.split(/\r?\n/).filter((line) => line.trim());
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      /* 非 JSON 行跳过 */
    }
  }

  const texts = [];
  for (const event of events) {
    // stream-json 格式：content_block_delta / message / result
    const content =
      event?.message?.content ??
      event?.content ??
      event?.delta?.text ??
      event?.result;
    if (typeof content === "string" && content.trim()) {
      texts.push(content);
    }
    if (Array.isArray(event?.message?.content)) {
      for (const block of event.message.content) {
        if (typeof block?.text === "string" && block.text.trim()) {
          texts.push(block.text);
        }
      }
    }
    if (Array.isArray(event?.content)) {
      for (const block of event.content) {
        if (typeof block?.text === "string" && block.text.trim()) {
          texts.push(block.text);
        }
      }
    }
    // claude -p --output-format json 的顶层 result
    if (event?.type === "result" && typeof event?.result === "string") {
      texts.push(event.result);
    }
  }

  return { events, texts, combined: texts.join("\n") };
}

/**
 * 从 Codex --json 输出中提取最终文字回答
 * Codex 每行是一个 JSON 事件，type: agent_message / item 等
 */
export function parseCodexJsonOutput(rawStdout) {
  const lines = rawStdout.split(/\r?\n/).filter((line) => line.trim());
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      /* 非 JSON 行跳过 */
    }
  }

  const texts = [];
  for (const event of events) {
    // Codex agent_message
    if (
      event?.item?.type === "agent_message" &&
      typeof event.item.text === "string"
    ) {
      texts.push(event.item.text);
    }
    // 其他可能的字段
    if (typeof event?.message?.content === "string") {
      texts.push(event.message.content);
    }
    if (typeof event?.text === "string") {
      texts.push(event.text);
    }
  }

  const cleanedTexts = texts
    .map(stripCodexMemoryInstructionLeak)
    .filter((text) => typeof text === "string" && text.trim().length > 0);

  const mcpCalls = events.filter((e) => isCodexMcpCallEvent(e));

  const developerMessages = events.filter(
    (e) =>
      e?.item?.role === "developer" ||
      (Array.isArray(e?.item?.content) &&
        e.item.content.some((c) => c?.role === "developer")),
  );

  return {
    events,
    texts: cleanedTexts,
    combined: cleanedTexts.join("\n"),
    mcpCalls,
    developerMessages,
  };
}

function isCodexMcpCallEvent(event) {
  if (!event || typeof event !== "object") {
    return false;
  }

  const itemType = event?.item?.type;
  const eventType = event?.type;
  const title =
    typeof event?.title === "string" ? event.title.toLowerCase() : "";
  const subtype =
    typeof event?.subtype === "string" ? event.subtype.toLowerCase() : "";
  const toolNameCandidates = [
    event?.tool_name,
    event?.toolName,
    event?.name,
    event?.item?.tool_name,
    event?.item?.toolName,
    event?.item?.name,
  ]
    .filter((value) => typeof value === "string")
    .map((value) => value.toLowerCase());

  if (itemType === "mcp_tool_call" || eventType === "mcp_tool_call") {
    return true;
  }

  if (eventType === "item.completed" && itemType === "mcp_tool_call") {
    return true;
  }

  if (
    itemType === "tool_call" ||
    eventType === "tool_call" ||
    eventType === "exec_command"
  ) {
    return toolNameCandidates.some((name) => name.includes("memory_search"));
  }

  if (title.includes("memory_search") || subtype.includes("memory_search")) {
    return true;
  }

  return false;
}

function stripCodexMemoryInstructionLeak(text) {
  if (typeof text !== "string" || !text.trim()) {
    return "";
  }

  const lines = text.split(/\r?\n/);
  const leakPrefixes = [
    // 旧版选择性调用文案
    "只有在当前问题明显依赖历史偏好",
    "如果当前问题是独立的新问题",
    // 新版与旧版共享的工具约束文案
    "调用 memory_search 后",
    "当工具返回 trigger=false",
    "不要因为存在记忆工具就主动编造上下文",
    // 旧版 always-call 文案
    "你有一个 memory_search 工具，用于检索用户的长期记忆",
    "调用后，只有当工具返回 trigger=true",
    "当工具返回 trigger=false 或 memory_packet 为 null",
    // 新版 pre-fetch 文案（当前 AGENTS.md — buildCodexMemoryInstructions）
    "你会先收到一段已经准备好的长期记忆上下文",
    "你会先收到一段平台已经准备好的长期记忆上下文",
    "回答时优先使用这段已提供的上下文来判断",
    "只有当上下文里明确给出 trigger=true",
    "当上下文里明确写着 trigger=false",
    "只有当上下文给出可用事实时",
    "当上下文明确无相关历史记忆",
    "不要复述整段记忆上下文",
    // stdin 块头（旧版 prepare-context 结果注入，JSON 格式）
    "长期记忆上下文：",
    "- trigger=",
    "- trigger_reason=",
    "- trace_id=",
    "- memory_packet=",
    "- memory_packet:",
    "- injection_block:",
    "- 无可用长期记忆，按普通问题直接回答。",
    "- 记忆上下文准备失败，按普通问题直接回答。",
    "用户问题：",
    // 新版格式化记忆块头（buildCodexPreparedMemoryBlock v3）
    "【长期记忆】",
    "命中原因：",
    "可直接采用的上下文：",
    "可用事实：",
    "使用要求：",
    "- 记忆[",
    "- 记忆：",
    // 通用共享
    "不要解释工具调用过程",
    "最终只保留对用户有用的答案内容",
  ];

  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return true;
    }
    return !leakPrefixes.some((prefix) => trimmed.startsWith(prefix));
  });

  return filtered.join("\n").trim();
}

// ---------------------------------------------------------------------------
// 注入命中断言
// ---------------------------------------------------------------------------

/**
 * 检查宿主最终回答是否包含注入记忆的关键词
 * @param {string} answer 宿主原始回答文本
 * @param {string[]} keywords 期望命中的关键词列表
 * @returns {{ pass: boolean, matched: string[], missing: string[] }}
 */
export function assertAnswerContainsInjectionSignals(
  answer,
  keywords = INJECTION_SIGNAL_KEYWORDS,
) {
  const lower = answer.toLowerCase();
  const matched = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  const missing = keywords.filter((kw) => !lower.includes(kw.toLowerCase()));
  // 命中 2 个以上关键词视为通过（允许模型以不同方式表达）
  return {
    pass: matched.length >= 2,
    matched,
    missing,
    matchRatio: `${matched.length}/${keywords.length}`,
  };
}

// ---------------------------------------------------------------------------
// 格式化工具
// ---------------------------------------------------------------------------

export function printSection(title) {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(50)}`);
}

export function printPass(msg) {
  console.log(`✓ ${msg}`);
}

export function printWarn(msg) {
  console.log(`⚠ ${msg}`);
}

export function printFail(msg) {
  console.error(`✗ ${msg}`);
}

export function printDetail(label, value) {
  const str =
    typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  const lines = str.split("\n");
  console.log(`  ${label}:`);
  for (const line of lines.slice(0, 20)) {
    console.log(`    ${line}`);
  }
  if (lines.length > 20) {
    console.log(`    ... (共 ${lines.length} 行)`);
  }
}
