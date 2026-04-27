export const CODEX_FORCED_MEMORY_INSTRUCTIONS = [
  "你会先收到一段平台已经准备好的长期记忆上下文。",
  "回答时优先使用这段已提供的上下文来判断是否存在相关历史信息。",
  "只有当上下文给出可用事实时，才将其中对当前问题直接有用的信息自然融入回答。",
  "当上下文明确无相关历史记忆，或上下文准备失败时，直接按普通问题正常回答。",
  "不要解释长期记忆上下文的来源，不要输出 MCP、tool、memory_search 等排查信息。",
  "最终只保留对用户有用的答案内容。",
];

export const CODEX_MEMORY_INSTRUCTIONS = CODEX_FORCED_MEMORY_INSTRUCTIONS;

export function buildCodexMemoryInstructions() {
  return CODEX_FORCED_MEMORY_INSTRUCTIONS.join("\n");
}

export function buildCodexForcedMemoryRequest(
  userInput,
  preparedMemoryContext,
  extraInstructions = [],
) {
  const memoryContext =
    typeof preparedMemoryContext === "string" && preparedMemoryContext.trim()
      ? preparedMemoryContext.trim()
      : "【长期记忆】无相关历史记忆，请直接回答。";
  const segments = [
    buildCodexMemoryInstructions(),
    ...extraInstructions,
    memoryContext,
    "用户问题：",
    userInput,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());

  return segments.join("\n\n");
}

export function buildCodexMemoryAwareRequest(userInput, extraInstructions = []) {
  return buildCodexForcedMemoryRequest(
    userInput,
    "【长期记忆】无相关历史记忆，请直接回答。",
    extraInstructions,
  );
}
