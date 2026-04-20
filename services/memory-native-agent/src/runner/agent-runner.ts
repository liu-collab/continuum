import { buildSystemPrompt } from "./prompts/default-system.js";
import { Conversation } from "./conversation.js";
import { createSessionId, createTurnId } from "./ids.js";
import { StreamBridge } from "./stream-bridge.js";
import {
  createTaskState,
  findClosestTask,
  touchTask,
  upsertRecentTask,
  type TaskChangeEvent,
  type TaskState,
} from "./task-state.js";
import { detectTriggers, type DetectedTriggers } from "./trigger-detector.js";
import { shouldFinalizeTurn, summarizeToolResults } from "./writeback-decider.js";
import type { AgentConfig } from "../config/index.js";
import type { MemoryClient, PrepareContextResult, SessionStartResult } from "../memory-client/index.js";
import type { ChatMessage, IModelProvider, ToolCall } from "../providers/index.js";
import type { SessionStore } from "../session-store/index.js";
import type { ToolCallEnvelope, ToolDispatcher, ToolResult } from "../tools/index.js";

export interface InjectionBlock {
  phase: string;
  injection_reason: string;
  memory_summary: string;
  memory_records: Array<{
    id: string;
    memory_type: string;
    scope: string;
    summary: string;
    importance: number;
    confidence: number;
  }>;
}

export type Phase = "session_start" | "task_start" | "task_switch" | "before_plan" | "before_response" | "after_response";

export interface RunnerIO {
  emitAssistantDelta(turnId: string, text: string): void;
  emitToolCallStart(turnId: string, call: ToolCall): void;
  emitToolCallResult(callId: string, result: ToolResult): void;
  emitInjectionBanner(turnId: string, injection: InjectionBlock | null, degraded: boolean): void;
  emitPhaseResult(turnId: string, phase: Phase, resp: PrepareContextResult | SessionStartResult | null): void;
  emitTaskChange(turnId: string, change: TaskChangeEvent): void;
  emitTurnEnd(turnId: string, finishReason: string): void;
  emitError(scope: "turn" | "session", err: Error & { code?: string }): void;
  emitStreamMetrics?(turnId: string, metrics: { dropped_after_abort_total: number; flushed_events_total: number }): void;
  requestConfirm(payload: {
    call_id: string;
    tool: string;
    params_preview: string;
    risk_hint?: "write" | "shell" | "mcp";
  }): Promise<"allow" | "deny" | "allow_session">;
}

export interface RunnerDeps {
  memoryClient: MemoryClient;
  provider: IModelProvider;
  tools: ToolDispatcher;
  config: AgentConfig;
  io: RunnerIO;
  artifactsRoot?: string;
  store?: SessionStore;
  sessionId?: string;
  initialMessages?: ChatMessage[];
}

export class AgentRunner {
  private readonly conversation = new Conversation();
  private readonly sessionId: string;
  private currentTask: TaskState | null = null;
  private recentTasks: TaskState[] = [];
  private readonly activeAbortControllers = new Map<string, AbortController>();
  private storeWarningEmitted = false;

  constructor(private readonly deps: RunnerDeps) {
    this.sessionId = deps.sessionId ?? createSessionId();
    if (deps.initialMessages && deps.initialMessages.length > 0) {
      this.conversation.seed(deps.initialMessages);
    }
  }

  async start(): Promise<void> {
    const result = await this.safeSessionStart();
    const injection = result?.injection_block ? toInjectionBlock("session_start", result.injection_block) : null;
    this.deps.io.emitPhaseResult(this.sessionId, "session_start", result);
    this.deps.io.emitInjectionBanner(this.sessionId, injection, Boolean(result?.degraded));
  }

  async submit(userInput: string, turnId = createTurnId()): Promise<void> {
    const abortController = new AbortController();
    this.activeAbortControllers.set(turnId, abortController);

    const triggers = detectTriggers(userInput, this.conversation, this.currentTask);
    const orderedPhases = this.applyTaskStateChanges(turnId, triggers);
    const turn = await this.openTurn(turnId);
    if (turn && this.currentTask?.id) {
      turn.taskId = this.currentTask.id;
    }

    this.persistUserMessage(turnId, userInput);

    const injections: InjectionBlock[] = [];
    let degraded = false;
    let traceId: string | null = null;

    for (const phase of orderedPhases) {
      const response = await this.safePrepareContext(phase, turnId, userInput);
      if (response?.trace_id) {
        traceId = response.trace_id;
      }
      if (response?.degraded) {
        degraded = true;
      }
      if (response?.injection_block) {
        injections.push(toInjectionBlock(phase, response.injection_block));
      }
      this.deps.io.emitPhaseResult(turnId, phase, response);
    }

    this.deps.io.emitInjectionBanner(
      turnId,
      injections.length > 0 ? mergeInjections(injections) : null,
      degraded,
    );

    const systemPrompt = buildSystemPrompt({
      workspaceRoot: this.deps.config.memory.cwd,
      platform: process.platform,
      memoryMode: this.deps.config.memory.mode,
      locale: this.deps.config.locale,
      appendedPrompt: this.deps.config.cli.systemPrompt,
    });
    const tools = this.deps.tools.listTools();
    this.conversation.addMessage({
      role: "user",
      content: userInput,
    });

    let messages = this.conversation.buildMessages({
      systemPrompt,
      injections,
    });

    const bridge = new StreamBridge(
      turnId,
      {
        emitAssistantDelta: this.deps.io.emitAssistantDelta.bind(this.deps.io),
        emitToolCallStart: this.deps.io.emitToolCallStart.bind(this.deps.io),
        emitToolCallResult: this.deps.io.emitToolCallResult.bind(this.deps.io),
        emitTurnEnd: this.deps.io.emitTurnEnd.bind(this.deps.io),
        emitError: this.deps.io.emitError.bind(this.deps.io),
      },
      {
        flushChars: this.deps.config.streaming.flushChars,
        flushIntervalMs: this.deps.config.streaming.flushIntervalMs,
      },
    );
    const onAbort = () => {
      bridge.abort();
    };
    abortController.signal.addEventListener("abort", onAbort, { once: true });

    const toolResults: ToolResult[] = [];
    const assistantParts: string[] = [];
    let finishReason: string = "stop";
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    let terminalEventEmitted = false;
    let round = 1;

    this.persistDispatchedMessages(turnId, messages, tools, round);

    try {
      while (!abortController.signal.aborted) {
        let encounteredToolCall = false;
        let roundAssistantToolMessage: ChatMessage | null = null;
        const chunks = this.deps.provider.chat({
          messages,
          tools,
          signal: abortController.signal,
        });

        for await (const chunk of chunks) {
          if (abortController.signal.aborted) {
            await bridge.handle(chunk);
            finishReason = "abort";
            break;
          }

          if (chunk.type === "text_delta") {
            assistantParts.push(chunk.text);
            if (roundAssistantToolMessage) {
              roundAssistantToolMessage.content += chunk.text;
            }
            await bridge.handle(chunk);
            continue;
          }

          if (chunk.type === "tool_call") {
            encounteredToolCall = true;
            if (!roundAssistantToolMessage) {
              roundAssistantToolMessage = {
                role: "assistant",
                content: "",
                tool_calls: [chunk.call],
              };
              this.conversation.addMessage(roundAssistantToolMessage);
            } else {
              roundAssistantToolMessage.tool_calls = [
                ...(roundAssistantToolMessage.tool_calls ?? []),
                chunk.call,
              ];
            }
            await bridge.handle(chunk);
            const toolResult = await this.runTool(turnId, chunk.call, abortController.signal);
            toolResults.push(toolResult);
            this.deps.io.emitToolCallResult(chunk.call.id, toolResult);
            const wrappedToolOutput = this.conversation.wrapToolOutput(
              chunk.call.name,
              chunk.call.id,
              toolResult.trust_level,
              toolResult.output,
            );
            this.conversation.addMessage({
              role: "tool",
              content: wrappedToolOutput,
              tool_call_id: chunk.call.id,
            });
            this.safeStore(() =>
              this.deps.store?.appendMessage({
                id: createTurnId(),
                session_id: this.sessionId,
                turn_id: turnId,
                role: "tool",
                content: wrappedToolOutput,
                tool_call_id: chunk.call.id,
              }),
            );
            continue;
          }

          finishReason = chunk.finish_reason;
          usage = chunk.usage;
          await bridge.handle(chunk);
          terminalEventEmitted = true;
        }

        if (abortController.signal.aborted) {
          break;
        }

        if (!encounteredToolCall || finishReason !== "tool_use") {
          break;
        }

        round += 1;
        messages = this.conversation.buildMessages({
          systemPrompt,
          injections,
        });
        this.persistDispatchedMessages(turnId, messages, tools, round);
        terminalEventEmitted = false;
      }

      if (abortController.signal.aborted && !terminalEventEmitted) {
        this.deps.io.emitTurnEnd(turnId, "abort");
        finishReason = "abort";
        terminalEventEmitted = true;
      }
    } catch (error) {
      bridge.flushPending();
      const providerError = error instanceof Error ? error : new Error(String(error));
      this.deps.io.emitError("turn", Object.assign(providerError, {
        code: (providerError as Error & { code?: string }).code ?? "provider_stream_error",
      }));
      finishReason = abortController.signal.aborted ? "abort" : "error";
      this.deps.io.emitTurnEnd(turnId, finishReason);
      terminalEventEmitted = true;
    } finally {
      bridge.flushPending();
      this.deps.io.emitStreamMetrics?.(turnId, bridge.metrics());
      abortController.signal.removeEventListener("abort", onAbort);
      this.activeAbortControllers.delete(turnId);
    }

    const assistantOutput = assistantParts.join("");
    if (assistantOutput.trim().length > 0) {
      this.conversation.addMessage({
        role: "assistant",
        content: assistantOutput,
      });
      this.safeStore(() =>
        this.deps.store?.appendMessage({
          id: createTurnId(),
          session_id: this.sessionId,
          turn_id: turnId,
          role: "assistant",
          content: assistantOutput,
          token_in: usage.prompt_tokens,
          token_out: usage.completion_tokens,
        }),
      );
    }

    this.safeStore(() => this.deps.store?.closeTurn(turnId, finishReason, traceId ?? undefined));

    if (shouldFinalizeTurn(userInput, assistantOutput)) {
      void this.deps.memoryClient.finalizeTurn({
        workspace_id: this.deps.config.memory.workspaceId,
        user_id: this.deps.config.memory.userId,
        task_id: this.currentTask?.id,
        session_id: this.sessionId,
        turn_id: turnId,
        current_input: userInput,
        assistant_output: assistantOutput,
        tool_results_summary: summarizeToolResults(toolResults),
        memory_mode: this.deps.config.memory.mode,
      }).catch((error) => {
        this.deps.io.emitError("session", Object.assign(error instanceof Error ? error : new Error(String(error)), {
          code: (error as Error & { code?: string }).code ?? "memory_unavailable",
        }));
      });
    }
  }

  abort(turnId: string): void {
    const controller = this.activeAbortControllers.get(turnId);
    controller?.abort();
  }

  async stop(): Promise<void> {
    for (const controller of this.activeAbortControllers.values()) {
      controller.abort();
    }
    this.activeAbortControllers.clear();
  }

  private applyTaskStateChanges(turnId: string, triggers: DetectedTriggers): Phase[] {
    const phases: Phase[] = [];
    let resumedExistingTask = false;

    if (triggers.taskSwitch && this.currentTask) {
      const resumed = findClosestTask(this.recentTasks, triggers.taskSwitch.newLabel ?? this.currentTask.label);
      const previousTaskId = this.currentTask.id;
      if (resumed) {
        this.currentTask = touchTask(resumed);
        this.recentTasks = upsertRecentTask(this.recentTasks, this.currentTask);
        resumedExistingTask = true;
        this.deps.io.emitTaskChange(turnId, {
          change: "resume",
          task_id: this.currentTask.id,
          label: this.currentTask.label,
          previous_task_id: previousTaskId,
        });
      } else {
        this.currentTask = null;
        this.deps.io.emitTaskChange(turnId, {
          change: "switch",
          task_id: previousTaskId,
          label: triggers.taskSwitch.newLabel ?? "switch",
          previous_task_id: previousTaskId,
        });
      }
      phases.push("task_switch");
    }

    if (triggers.taskStart && !resumedExistingTask) {
      const previousTaskId = this.currentTask?.id;
      this.currentTask = createTaskState(triggers.taskStart.label);
      this.recentTasks = upsertRecentTask(this.recentTasks, this.currentTask);
      this.deps.io.emitTaskChange(turnId, {
        change: previousTaskId ? "switch" : "start",
        task_id: this.currentTask.id,
        label: this.currentTask.label,
        previous_task_id: previousTaskId,
      });
      phases.push("task_start");
    }

    if (triggers.beforePlan) {
      phases.push("before_plan");
    }

    phases.push("before_response");
    return phases;
  }

  private async safeSessionStart(): Promise<SessionStartResult | null> {
    try {
      const response = await this.deps.memoryClient.sessionStartContext({
        session_id: this.sessionId,
        cwd: this.deps.config.memory.cwd,
        source: "mna",
        user_id: this.deps.config.memory.userId,
        workspace_id: this.deps.config.memory.workspaceId,
        memory_mode: this.deps.config.memory.mode,
      });
      return response;
    } catch (error) {
      this.deps.io.emitError("session", Object.assign(error instanceof Error ? error : new Error(String(error)), {
        code: (error as Error & { code?: string }).code ?? "memory_unavailable",
      }));
      return null;
    }
  }

  private async safePrepareContext(phase: Phase, turnId: string, userInput: string): Promise<PrepareContextResult | null> {
    try {
      return await this.deps.memoryClient.prepareContext({
        workspace_id: this.deps.config.memory.workspaceId,
        user_id: this.deps.config.memory.userId,
        task_id: this.currentTask?.id,
        session_id: this.sessionId,
        turn_id: turnId,
        phase,
        current_input: userInput,
        recent_context_summary: this.conversation.shortSummary(),
        cwd: this.deps.config.memory.cwd,
        source: "mna",
        memory_mode: this.deps.config.memory.mode,
      });
    } catch (error) {
      const fallback: PrepareContextResult = {
        trace_id: "dependency_unavailable",
        trigger: false,
        trigger_reason: "dependency_unavailable",
        memory_packet: null,
        injection_block: null,
        degraded: true,
        dependency_status: {
          read_model: {
            name: "read_model",
            status: "unknown",
            detail: error instanceof Error ? error.message : "memory unavailable",
            last_checked_at: new Date().toISOString(),
          },
          embeddings: {
            name: "embeddings",
            status: "unknown",
            detail: error instanceof Error ? error.message : "memory unavailable",
            last_checked_at: new Date().toISOString(),
          },
          storage_writeback: {
            name: "storage_writeback",
            status: "unknown",
            detail: error instanceof Error ? error.message : "memory unavailable",
            last_checked_at: new Date().toISOString(),
          },
        },
        budget_used: 0,
        memory_packet_ids: [],
      };
      this.deps.io.emitError("session", Object.assign(error instanceof Error ? error : new Error(String(error)), {
        code: (error as Error & { code?: string }).code ?? "memory_unavailable",
      }));
      return fallback;
    }
  }

  private async runTool(turnId: string, call: ToolCall, abortSignal: AbortSignal): Promise<ToolResult> {
    return await this.deps.tools.invoke(
      call as ToolCallEnvelope,
      {
        callId: call.id,
        sessionId: this.sessionId,
        turnId,
        cwd: this.deps.config.memory.cwd,
        workspaceRoot: this.deps.config.memory.cwd,
        artifactsRoot: requireArtifactsRoot(this.deps),
        abort: abortSignal,
        confirm: this.deps.io.requestConfirm.bind(this.deps.io),
      },
    );
  }

  private persistUserMessage(turnId: string, userInput: string) {
    this.safeStore(() =>
      this.deps.store?.appendMessage({
        id: createTurnId(),
        session_id: this.sessionId,
        turn_id: turnId,
        role: "user",
        content: userInput,
      }),
    );
  }

  private async openTurn(turnId: string) {
    this.safeStore(() =>
      this.deps.store?.openTurn({
        id: turnId,
        session_id: this.sessionId,
        task_id: this.currentTask?.id,
      }),
    );

    return {
      turnId,
      taskId: this.currentTask?.id,
    };
  }

  private safeStore(operation: () => void) {
    try {
      operation();
    } catch (error) {
      if (!this.storeWarningEmitted) {
        this.storeWarningEmitted = true;
        this.deps.io.emitError("session", Object.assign(error instanceof Error ? error : new Error(String(error)), {
          code: "session_store_unavailable",
        }));
      }
    }
  }

  private persistDispatchedMessages(
    turnId: string,
    messages: ChatMessage[],
    tools: ReturnType<ToolDispatcher["listTools"]>,
    round: number,
  ) {
    this.safeStore(() =>
      this.deps.store?.saveDispatchedMessages(turnId, {
        messages_json: JSON.stringify(messages),
        tools_json: JSON.stringify(tools),
        provider_id: this.deps.provider.id(),
        model: this.deps.provider.model(),
        round,
      }),
    );
  }
}

function toInjectionBlock(
  phase: string,
  block: NonNullable<PrepareContextResult["injection_block"] | SessionStartResult["injection_block"]>,
): InjectionBlock {
  return {
    phase,
    injection_reason: block.injection_reason,
    memory_summary: block.memory_summary,
    memory_records: block.memory_records.map((record) => ({
      id: record.id,
      memory_type: record.memory_type,
      scope: record.scope,
      summary: record.summary,
      importance: record.importance,
      confidence: record.confidence,
    })),
  };
}

function mergeInjections(injections: InjectionBlock[]): InjectionBlock {
  if (injections.length === 1) {
    const single = injections[0];
    if (!single) {
      throw new Error("Expected at least one injection.");
    }
    return single;
  }

  return {
    phase: injections.map((item) => item.phase).join(","),
    injection_reason: injections.map((item) => `[${item.phase}] ${item.injection_reason}`).join("\n"),
    memory_summary: injections.map((item) => `[${item.phase}] ${item.memory_summary}`).join("\n"),
    memory_records: injections.flatMap((item) => item.memory_records),
  };
}

function requireArtifactsRoot(deps: RunnerDeps): string {
  if (deps.artifactsRoot) {
    return deps.artifactsRoot;
  }
  const sharedRoot = deps.tools.getArtifactsRoot?.();
  if (sharedRoot) {
    return sharedRoot;
  }
  return `${deps.config.memory.cwd}/.mna-artifacts`;
}
