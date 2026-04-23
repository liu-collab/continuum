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
import {
  estimateToolTokens,
  resolveContextMaxTokens,
} from "./token-budget.js";
import { generateExecutionPlan, shouldGeneratePlan } from "../planning/plan-generator.js";
import { advancePlanAfterTool, markPlanRunning } from "../planning/plan-state.js";
import type { ExecutionPlan } from "../planning/types.js";
import { evaluateAssistantOutput, evaluateToolResult, type EvaluationDecision } from "../evaluation/turn-evaluator.js";
import {
  createRetryPolicyState,
  evaluateRetryAllowance,
  registerToolAttempt,
  type RetryPolicyState,
} from "../evaluation/retry-policy.js";
import { RuntimeTracer, type RuntimeSpan } from "../trace/runtime-tracer.js";
import { tierMemoryInjection } from "./memory-tiering.js";
import { toPromptSegmentView, type PromptSegmentView } from "./prompt-segments.js";
import { shouldFinalizeTurn, summarizeToolResults } from "./writeback-decider.js";
import type { AgentConfig } from "../config/index.js";
import type { FinalizeTurnResult, MemoryClient, PrepareContextResult, SessionStartResult } from "../memory-client/index.js";
import type { ChatMessage, IModelProvider, ToolCall } from "../providers/index.js";
import type { SessionStore } from "../session-store/index.js";
import type { MaterializedSkillContext } from "../skills/index.js";
import { hashArgs } from "../tools/index.js";
import type { ToolCallEnvelope, ToolDispatcher, ToolResult } from "../tools/index.js";

export interface InjectionBlock {
  phase: string;
  injection_reason: string;
  memory_summary: string;
  resident?: boolean;
  tier?: "high" | "medium" | "summary";
  kind?: "stable_preference" | "task_state" | "summary";
  tier_counts?: {
    high: number;
    medium: number;
    summary: number;
  };
  high_summary?: string;
  medium_summary?: string;
  summary_only?: string;
  memory_records: Array<{
    id: string;
    memory_type: string;
    scope: string;
    summary: string;
    importance: number;
    confidence: number;
  }>;
}

export interface PromptPhaseResult {
  phase: Phase;
  trace_id: string | null;
  degraded: boolean;
  degraded_skip_reason?: string;
  injection_summary?: string;
}

export interface PlanEvent {
  plan: ExecutionPlan;
}

export interface EvaluationEvent {
  scope: "tool" | "turn";
  decision: EvaluationDecision;
  tool_name?: string;
  call_id?: string;
}

export type Phase = "session_start" | "task_start" | "task_switch" | "before_plan" | "before_response" | "after_response";

export interface RunnerIO {
  emitAssistantDelta(turnId: string, text: string): void;
  emitToolCallStart(turnId: string, call: ToolCall): void;
  emitToolCallResult(callId: string, result: ToolResult): void;
  emitInjectionBanner(turnId: string, injection: InjectionBlock | null, degraded: boolean): void;
  emitPhaseResult(turnId: string, phase: Phase, resp: PrepareContextResult | SessionStartResult | null): void;
  emitTaskChange(turnId: string, change: TaskChangeEvent): void;
  emitPlan?(turnId: string, event: PlanEvent): void;
  emitEvaluation?(turnId: string, event: EvaluationEvent): void;
  emitTrace?(turnId: string, spans: RuntimeSpan[]): void;
  emitTurnEnd(turnId: string, finishReason: string): void;
  emitError(scope: "turn" | "session", err: Error & { code?: string }): void;
  recordPrepareContextLatency?(phase: Phase, latencyMs: number): void;
  recordProviderCall?(providerKey: string): void;
  recordProviderFirstTokenLatency?(providerKey: string, latencyMs: number): void;
  emitStreamMetrics?(turnId: string, metrics: { dropped_after_abort_total: number; flushed_events_total: number }): void;
  requestConfirm(payload: {
    call_id: string;
    tool: string;
    params_preview: string;
    risk_hint?: "write" | "shell" | "mcp";
  }): Promise<"allow" | "deny" | "allow_session">;
  requestPlanConfirm?(payload: {
    turn_id: string;
    plan: ExecutionPlan;
  }): Promise<{ outcome: "approve" | "revise" | "cancel"; feedback?: string }>;
  recordRetry?(toolName: string): void;
  recordContextDrop?(count: number): void;
  recordToolBatch?(size: number, parallelCalls: number): void;
  recordPlanConfirmation?(outcome: "approve" | "revise" | "cancel"): void;
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

export interface SubmitOptions {
  skillContext?: MaterializedSkillContext;
}

interface PlanConfirmDecision {
  outcome: "approve" | "revise" | "cancel";
  feedback?: string;
}

interface PendingResidentRefreshState {
  jobIds: string[];
}

export class AgentRunner {
  private readonly conversation = new Conversation();
  private readonly sessionId: string;
  private currentTask: TaskState | null = null;
  private recentTasks: TaskState[] = [];
  private residentMemory: InjectionBlock | null = null;
  private residentMemoryDirty = false;
  private pendingResidentRefresh: PendingResidentRefreshState | null = null;
  private readonly activeAbortControllers = new Map<string, AbortController>();
  private readonly tracer = new RuntimeTracer();
  private storeWarningEmitted = false;
  private currentPlan: ExecutionPlan | null = null;
  private readonly planRevisionCounter = new Map<string, number>();

  constructor(private readonly deps: RunnerDeps) {
    this.sessionId = deps.sessionId ?? createSessionId();
    if (deps.initialMessages && deps.initialMessages.length > 0) {
      this.conversation.seed(deps.initialMessages);
    }
  }

  async start(): Promise<void> {
    const result = await this.safeSessionStart();
    const injection = result?.injection_block ? toInjectionBlock("session_start", result.injection_block) : null;
    this.residentMemory = injection ? toResidentInjectionBlock(injection) : null;
    this.residentMemoryDirty = false;
    this.deps.io.emitPhaseResult(this.sessionId, "session_start", result);
    this.deps.io.emitInjectionBanner(
      this.sessionId,
      this.residentMemory ?? injection,
      Boolean(result?.degraded),
    );
  }

  async submit(userInput: string, turnId = createTurnId(), options: SubmitOptions = {}): Promise<void> {
    const abortController = new AbortController();
    this.activeAbortControllers.set(turnId, abortController);

    if (this.residentMemoryDirty) {
      await this.refreshResidentMemory();
    }

    const triggers = detectTriggers(userInput, this.conversation, this.currentTask);
    const orderedPhases = this.applyTaskStateChanges(turnId, triggers);
    const turn = await this.openTurn(turnId);
    if (turn && this.currentTask?.id) {
      turn.taskId = this.currentTask.id;
    }

    this.persistUserMessage(turnId, userInput);

    const rawInjections: InjectionBlock[] = [];
    const phaseResults: PromptPhaseResult[] = [];
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
        rawInjections.push(toInjectionBlock(phase, response.injection_block));
      }
      phaseResults.push(toPromptPhaseResult(phase, response));
      this.deps.io.emitPhaseResult(turnId, phase, response);
    }

    const injections = buildPromptInjections([
      ...(this.residentMemory ? [this.residentMemory] : []),
      ...rawInjections,
    ]);
    const shouldPlan = shouldGeneratePlan(userInput) || orderedPhases.includes("before_plan");
    let evaluationEvents: EvaluationEvent[] = [];
    let retryState = createRetryPolicyState();

    this.deps.io.emitInjectionBanner(
      turnId,
      injections.length > 0 ? mergeInjections(injections) : null,
      degraded,
    );

    const systemPrompt = buildSystemPrompt({
      workspaceRoot: this.deps.config.memory.cwd,
      platform: process.platform,
      memoryMode: this.deps.config.memory.mode,
      approvalMode: this.deps.config.tools.approvalMode,
      locale: this.deps.config.locale,
      appendedPrompt: [this.deps.config.cli.systemPrompt, options.skillContext?.systemPrompt].filter(Boolean).join("\n\n") || null,
    });
    const tools = this.deps.tools.listTools();
    this.conversation.addMessage({
      role: "user",
      content: userInput,
    });

    if (shouldPlan) {
      this.publishPlan(turnId, generateExecutionPlan({
        sessionId: this.sessionId,
        turnId,
        goal: userInput,
        existingPlan: this.currentPlan,
      }));
      const planDecision = await this.resolvePlanBeforeExecution(turnId, userInput);
      if (planDecision === "cancel") {
        this.safeStore(() => this.deps.store?.closeTurn(turnId, "cancelled"));
        this.deps.io.emitTurnEnd(turnId, "cancelled");
        this.activeAbortControllers.delete(turnId);
        return;
      }
    }

    const contextMaxTokens = this.deps.config.context.maxTokens ?? resolveContextMaxTokens(this.deps.config.provider);
    const toolTokenEstimate = estimateToolTokens(tools);
    const requestMaxTokens = Math.max(
      contextMaxTokens - Math.min(this.deps.config.context.reserveTokens, Math.floor(contextMaxTokens / 2)),
      1_024,
    );
    const effectiveRequestMaxTokens = this.deps.config.provider.maxTokens
      ? Math.min(requestMaxTokens, this.deps.config.provider.maxTokens)
      : requestMaxTokens;

    const budgetInput = {
      systemPrompt,
      tools,
      tokenBudget: {
        maxTokens: contextMaxTokens,
        reserveTokens: this.deps.config.context.reserveTokens,
        compactionStrategy: this.deps.config.context.compactionStrategy,
        toolTokenEstimate,
      },
      injections,
    } as const;
    let budgetPlan = this.conversation.buildBudgetPlan(budgetInput);
    this.applyBudgetMetrics(budgetPlan);
    let promptSegments = budgetPlan.keptSegments;
    let messages = budgetPlan.keptMessages;

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

    this.persistDispatchedMessages(
      turnId,
      messages,
      promptSegments.map(toPromptSegmentView),
      phaseResults,
      tools,
      round,
      budgetPlan,
      this.currentPlan,
      [],
      evaluationEvents,
    );

    try {
      while (!abortController.signal.aborted) {
        let encounteredToolCall = false;
        let roundAssistantToolMessage: ChatMessage | null = null;
        const pendingToolCalls: ToolCall[] = [];
        let sawFirstProviderToken = false;
        const providerStartedAt = Date.now();
        const llmSpan = this.tracer.startSpan({
          traceId,
          name: `llm_round_${round}`,
          kind: "llm",
          attributes: {
            round,
          },
        });
        this.deps.io.recordProviderCall?.(this.deps.provider.id());
        const chunks = this.deps.provider.chat({
          messages,
          tools,
          max_tokens: effectiveRequestMaxTokens,
          model: options.skillContext?.modelOverride,
          effort: options.skillContext?.effort ?? this.deps.config.provider.effort ?? undefined,
          signal: abortController.signal,
        });

        for await (const chunk of chunks) {
          if (abortController.signal.aborted) {
            await bridge.handle(chunk);
            finishReason = "abort";
            break;
          }

          if (!sawFirstProviderToken && (chunk.type === "text_delta" || chunk.type === "tool_call" || chunk.type === "end")) {
            sawFirstProviderToken = true;
            this.deps.io.recordProviderFirstTokenLatency?.(
              this.deps.provider.id(),
              Date.now() - providerStartedAt,
            );
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
            pendingToolCalls.push(chunk.call);
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
            continue;
          }

          finishReason = chunk.finish_reason;
          usage = chunk.usage;
          await bridge.handle(chunk);
          terminalEventEmitted = true;
        }
        llmSpan.finish(abortController.signal.aborted ? "cancelled" : "ok", {
          finish_reason: finishReason,
        });

        if (abortController.signal.aborted) {
          break;
        }

        if (pendingToolCalls.length > 0) {
          const toolBatchSpan = this.tracer.startSpan({
            traceId,
            name: `tool_batch_${round}`,
            kind: "tool",
            attributes: {
              size: pendingToolCalls.length,
            },
          });
          const batchResults = await this.runToolBatch(turnId, pendingToolCalls, abortController.signal, options.skillContext);
          this.deps.io.recordToolBatch?.(
            pendingToolCalls.length,
            pendingToolCalls.filter((call) =>
              this.deps.tools.listTools().some((tool) => tool.name === call.name && tool.parallelism === "safe")
            ).length,
          );
          let replanReason: string | undefined;
          for (const batchResult of batchResults) {
            const finalBatchResult = await this.maybeRetryToolCall(
              turnId,
              batchResult.call,
              batchResult.result,
              retryState,
              abortController.signal,
              options.skillContext,
            );
            const result = finalBatchResult.result;
            replanReason = replanReason ?? finalBatchResult.replanReason;
            toolResults.push(result);
            this.deps.io.emitToolCallResult(batchResult.call.id, result);
            const wrappedToolOutput = this.conversation.wrapToolOutput(
              batchResult.call.name,
              batchResult.call.id,
              result.trust_level,
              result.output,
            );
            this.conversation.addMessage({
              role: "tool",
              content: wrappedToolOutput,
              tool_call_id: batchResult.call.id,
            });
            this.safeStore(() =>
              this.deps.store?.appendMessage({
                id: createTurnId(),
                session_id: this.sessionId,
                turn_id: turnId,
                role: "tool",
                content: wrappedToolOutput,
                tool_call_id: batchResult.call.id,
              }),
            );

            const retryKey = `${batchResult.call.name}:${hashArgs(batchResult.call.args)}`;
            const attempts = retryState.toolAttempts.get(retryKey) ?? 1;
            const toolDecision = evaluateToolResult({
              toolName: batchResult.call.name,
              toolResult: result,
              repeatedFailure: attempts > 1 && !result.ok,
            });
            evaluationEvents = [
              ...evaluationEvents,
              {
                scope: "tool",
                tool_name: batchResult.call.name,
                call_id: batchResult.call.id,
                decision: toolDecision,
              },
            ];
            this.deps.io.emitEvaluation?.(turnId, evaluationEvents.at(-1)!);
            if (this.currentPlan) {
              this.currentPlan = advancePlanAfterTool(this.currentPlan, result.ok, toolDecision.reason);
            }
          }
          if (replanReason && this.currentPlan) {
            this.publishPlan(turnId, generateExecutionPlan({
              sessionId: this.sessionId,
              turnId,
              goal: userInput,
              existingPlan: this.currentPlan,
              revisionReason: replanReason,
            }));
          }
          toolBatchSpan.finish("ok");
        }

        if (!encounteredToolCall || finishReason !== "tool_use") {
          break;
        }

        round += 1;
        budgetPlan = this.conversation.buildBudgetPlan(budgetInput);
        this.applyBudgetMetrics(budgetPlan);
        promptSegments = budgetPlan.keptSegments;
        messages = budgetPlan.keptMessages;
        this.persistDispatchedMessages(
          turnId,
          messages,
          promptSegments.map(toPromptSegmentView),
          phaseResults,
          tools,
          round,
          budgetPlan,
          this.currentPlan,
          this.tracer.listSpans(traceId),
          evaluationEvents,
        );
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
    const turnDecision = evaluateAssistantOutput(assistantOutput, toolResults);
    evaluationEvents = [
      ...evaluationEvents,
      {
        scope: "turn",
        decision: turnDecision,
      },
    ];
    this.deps.io.emitEvaluation?.(turnId, evaluationEvents.at(-1)!);
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
    this.deps.io.emitTrace?.(turnId, this.tracer.listSpans(traceId));
    if (this.currentPlan) {
      this.publishPlan(turnId, this.currentPlan);
    }
    this.persistDispatchedMessages(
      turnId,
      messages,
      promptSegments.map(toPromptSegmentView),
      phaseResults,
      tools,
      round,
      this.conversation.getLastBudgetPlan(),
      this.currentPlan,
      this.tracer.listSpans(traceId),
      evaluationEvents,
    );

    if (shouldFinalizeTurn(userInput, assistantOutput)) {
      const finalizeSpan = this.tracer.startSpan({
        traceId,
        name: "finalize_turn",
        kind: "writeback",
      });
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
        finalizeSpan.finish("error");
        this.deps.io.emitError("session", Object.assign(error instanceof Error ? error : new Error(String(error)), {
          code: (error as Error & { code?: string }).code ?? "memory_unavailable",
        }));
      }).then((response) => {
        if (!response) {
          return;
        }
        const residentJobs = response?.submitted_jobs
          ?.filter((job, index) => {
            const candidate = response.write_back_candidates[index];
            return Boolean(
              job.job_id &&
              candidate &&
              (candidate.candidate_type === "fact_preference" || candidate.candidate_type === "task_state"),
            );
          })
          .map((job) => job.job_id!)
          ?? [];

        if (residentJobs.length > 0) {
          this.residentMemoryDirty = true;
          this.pendingResidentRefresh = { jobIds: residentJobs };
        }
        const pendingConfirmationSummary = buildPendingConfirmationSummary(response);
        if (pendingConfirmationSummary) {
          this.deps.io.emitPhaseResult(turnId, "after_response", {
            trace_id: response.trace_id,
            trigger: false,
            trigger_reason: "pending_confirmation_notice",
            memory_packet: null,
            injection_block: {
              injection_reason: "pending_confirmation_notice",
              memory_summary: pendingConfirmationSummary,
              memory_records: [],
              token_estimate: 0,
              memory_mode: response.memory_mode,
              requested_scopes: [],
              selected_scopes: [],
              trimmed_record_ids: [],
              trim_reasons: [],
            },
            degraded: response.degraded,
            dependency_status: response.dependency_status,
            budget_used: 0,
            memory_packet_ids: [],
          });
        }
        finalizeSpan.finish("ok");
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

  private publishPlan(turnId: string, plan: ExecutionPlan) {
    this.currentPlan = plan;
    this.deps.io.emitPlan?.(turnId, { plan });
    const revision = (this.planRevisionCounter.get(turnId) ?? 0) + 1;
    this.planRevisionCounter.set(turnId, revision);
    this.safeStore(() =>
      this.deps.store?.savePlanRevision({
        id: createTurnId(),
        session_id: this.sessionId,
        turn_id: turnId,
        plan_id: plan.id,
        revision,
        status: plan.status,
        goal: plan.goal,
        revision_reason: plan.revision_reason ?? null,
        plan_json: JSON.stringify(plan),
      }),
    );
  }

  private async resolvePlanBeforeExecution(turnId: string, userInput: string): Promise<"continue" | "cancel"> {
    if (!this.currentPlan) {
      return "continue";
    }

    if (this.deps.config.planning.planMode !== "confirm" || !this.deps.io.requestPlanConfirm) {
      this.currentPlan = markPlanRunning(this.currentPlan);
      this.publishPlan(turnId, this.currentPlan);
      return "continue";
    }

    let decision = await this.deps.io.requestPlanConfirm({
      turn_id: turnId,
      plan: this.currentPlan,
    });
    this.deps.io.recordPlanConfirmation?.(decision.outcome);

    while (decision.outcome === "revise") {
      this.currentPlan = generateExecutionPlan({
        sessionId: this.sessionId,
        turnId,
        goal: userInput,
        existingPlan: this.currentPlan,
        revisionReason: decision.feedback?.trim() || "user_requested_revision",
      });
      this.publishPlan(turnId, this.currentPlan);
      decision = await this.deps.io.requestPlanConfirm({
        turn_id: turnId,
        plan: this.currentPlan,
      });
      this.deps.io.recordPlanConfirmation?.(decision.outcome);
    }

    if (decision.outcome === "cancel") {
      return "cancel";
    }

    this.currentPlan = markPlanRunning(this.currentPlan);
    this.publishPlan(turnId, this.currentPlan);
    return "continue";
  }

  private applyBudgetMetrics(budgetPlan: ReturnType<Conversation["buildBudgetPlan"]>) {
    this.deps.io.recordContextDrop?.(budgetPlan.dropped.length);
  }

  private async maybeRetryToolCall(
    turnId: string,
    call: ToolCall,
    result: ToolResult,
    retryState: RetryPolicyState,
    abortSignal: AbortSignal,
    skillContext?: MaterializedSkillContext,
  ): Promise<{ result: ToolResult; replanReason?: string }> {
    if (result.ok) {
      return { result };
    }

    const retryKey = `${call.name}:${hashArgs(call.args)}`;
    const attempts = registerToolAttempt(retryState, retryKey);
    const toolDecision = evaluateToolResult({
      toolName: call.name,
      toolResult: result,
      repeatedFailure: attempts > 1 && !result.ok,
    });

    if (toolDecision.status !== "retry") {
      if (toolDecision.status === "revise") {
        return {
          result,
          replanReason: toolDecision.reason,
        };
      }
      return { result };
    }

    const retryDecision = evaluateRetryAllowance(retryState, retryKey, result);
    if (!retryDecision.allowed) {
      return {
        result,
        replanReason: retryDecision.strategy === "replan" ? retryDecision.reason : undefined,
      };
    }

    retryState.turnRetryCount += 1;
    this.deps.io.recordRetry?.(call.name);
    const retryResult = await this.runTool(turnId, call, abortSignal, skillContext);
    return {
      result: retryResult,
      replanReason: !retryResult.ok && retryDecision.strategy === "replan" ? retryDecision.reason : undefined,
    };
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

  private async refreshResidentMemory(): Promise<void> {
    const projectionReady = await this.isResidentMemoryProjectionReady();
    if (!projectionReady) {
      return;
    }

    const result = await this.safeSessionStart();
    if (!result) {
      this.residentMemoryDirty = true;
      return;
    }
    const injection = result?.injection_block ? toInjectionBlock("session_start", result.injection_block) : null;
    this.residentMemory = injection ? toResidentInjectionBlock(injection) : null;
    this.residentMemoryDirty = false;
    this.pendingResidentRefresh = null;
  }

  private async isResidentMemoryProjectionReady(): Promise<boolean> {
    if (!this.pendingResidentRefresh || this.pendingResidentRefresh.jobIds.length === 0) {
      return true;
    }

    try {
      const response = await this.deps.memoryClient.getWriteProjectionStatuses({
        job_ids: this.pendingResidentRefresh.jobIds,
      });

      if (response.items.length < this.pendingResidentRefresh.jobIds.length) {
        return false;
      }

      return response.items.every((item) => item.projection_ready);
    } catch (error) {
      this.deps.io.emitError("session", Object.assign(error instanceof Error ? error : new Error(String(error)), {
        code: (error as Error & { code?: string }).code ?? "memory_unavailable",
      }));
      return false;
    }
  }

  private async safePrepareContext(phase: Phase, turnId: string, userInput: string): Promise<PrepareContextResult | null> {
    const startedAt = Date.now();
    const span = this.tracer.startSpan({
      name: `prepare_context_${phase}`,
      kind: "memory",
      attributes: {
        phase,
        turn_id: turnId,
      },
    });
    try {
      const response = await this.deps.memoryClient.prepareContext({
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
      this.deps.io.recordPrepareContextLatency?.(phase, Date.now() - startedAt);
      span.finish("ok", {
        degraded: Boolean(response.degraded),
      });
      return response;
    } catch (error) {
      this.deps.io.recordPrepareContextLatency?.(phase, Date.now() - startedAt);
      span.finish("error");
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
          memory_llm: {
            name: "memory_llm",
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

  private async runTool(
    turnId: string,
    call: ToolCall,
    abortSignal: AbortSignal,
    skillContext?: MaterializedSkillContext,
  ): Promise<ToolResult> {
    const span = this.tracer.startSpan({
      name: `tool_${call.name}`,
      kind: "tool",
      attributes: {
        turn_id: turnId,
        tool: call.name,
      },
    });
    return await this.deps.tools.invoke(
      call as ToolCallEnvelope,
      {
        callId: call.id,
        sessionId: this.sessionId,
        turnId,
        cwd: this.deps.config.memory.cwd,
        workspaceRoot: this.deps.config.memory.cwd,
        artifactsRoot: requireArtifactsRoot(this.deps),
        preapprovedTools: skillContext?.preapprovedTools,
        abort: abortSignal,
        confirm: this.deps.io.requestConfirm.bind(this.deps.io),
      },
    ).then((result) => {
      span.finish(result.ok ? "ok" : "error", {
        ok: result.ok,
      });
      return result;
    }).catch((error) => {
      span.finish("error");
      throw error;
    });
  }

  private async runToolBatch(
    turnId: string,
    calls: ToolCall[],
    abortSignal: AbortSignal,
    skillContext?: MaterializedSkillContext,
  ): Promise<Array<{ call: ToolCall; result: ToolResult }>> {
    const safeNames = new Set(
      this.deps.tools.listTools()
        .filter((tool) => tool.parallelism === "safe")
        .map((tool) => tool.name),
    );

    const parallelCalls = calls.filter((call) => safeNames.has(call.name));
    const serialCalls = calls.filter((call) => !safeNames.has(call.name));

    const parallelResults = await Promise.all(
      parallelCalls.map(async (call) => ({
        call,
        result: await this.runTool(turnId, call, abortSignal, skillContext),
      })),
    );

    const serialResults: Array<{ call: ToolCall; result: ToolResult }> = [];
    for (const call of serialCalls) {
      serialResults.push({
        call,
        result: await this.runTool(turnId, call, abortSignal, skillContext),
      });
    }

    const resultMap = new Map<string, ToolResult>();
    for (const item of [...parallelResults, ...serialResults]) {
      resultMap.set(item.call.id, item.result);
    }

    return calls.map((call) => ({
      call,
      result: resultMap.get(call.id)!,
    }));
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
    promptSegments: PromptSegmentView[],
    phaseResults: PromptPhaseResult[],
    tools: ReturnType<ToolDispatcher["listTools"]>,
    round: number,
    budgetPlan?: unknown | null,
    plan?: ExecutionPlan | null,
    traceSpans?: RuntimeSpan[] | null,
    evaluationEvents?: EvaluationEvent[] | null,
  ) {
    this.safeStore(() =>
      this.deps.store?.saveDispatchedMessages(turnId, {
        messages_json: JSON.stringify(messages),
        tools_json: JSON.stringify(tools),
        prompt_segments_json: JSON.stringify(promptSegments),
        phase_results_json: JSON.stringify(phaseResults),
        budget_plan_json: budgetPlan ? JSON.stringify(budgetPlan) : null,
        plan_json: plan ? JSON.stringify(plan) : null,
        trace_spans_json: traceSpans ? JSON.stringify(traceSpans) : null,
        evaluation_json: evaluationEvents ? JSON.stringify(evaluationEvents) : null,
        provider_id: this.deps.provider.id(),
        model: this.deps.provider.model(),
        round,
      }),
    );
  }
}

function toPromptPhaseResult(
  phase: Phase,
  response: PrepareContextResult | SessionStartResult | null,
): PromptPhaseResult {
  return {
    phase,
    trace_id: response?.trace_id ?? null,
    degraded: Boolean(response?.degraded),
    degraded_skip_reason:
      response && "degraded_skip_reason" in response && typeof response.degraded_skip_reason === "string"
        ? response.degraded_skip_reason
        : undefined,
    injection_summary: response?.injection_block?.memory_summary,
  };
}

function buildPendingConfirmationSummary(
  response: FinalizeTurnResult | null | undefined,
): string | undefined {
  const pendingCandidates = response?.write_back_candidates.filter(
    (candidate: FinalizeTurnResult["write_back_candidates"][number]) =>
      candidate.suggested_status === "pending_confirmation",
  ) ?? [];

  if (pendingCandidates.length === 0) {
    return undefined;
  }

  const firstSummary = pendingCandidates[0]?.summary?.trim();
  if (pendingCandidates.length === 1 && firstSummary) {
    return `检测到 1 条待确认记忆，已暂存：${firstSummary}`;
  }

  return `检测到 ${pendingCandidates.length} 条待确认记忆，已暂存，等待确认后再生效。`;
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

function toResidentInjectionBlock(block: InjectionBlock): InjectionBlock {
  const residentRecords = block.memory_records.filter((record) => {
    return record.memory_type === "fact_preference" || record.memory_type === "task_state";
  });

  return {
    ...block,
    phase: "session_start",
    resident: true,
    memory_records: residentRecords,
  };
}

function toTieredInjectionBlocks(
  phase: string,
  block: NonNullable<PrepareContextResult["injection_block"] | SessionStartResult["injection_block"]>,
): InjectionBlock[] {
  const normalized = toInjectionBlock(phase, block);
  return toTieredInjectionBlocksFromNormalized(normalized);
}

function toTieredInjectionBlocksFromNormalized(normalized: InjectionBlock): InjectionBlock[] {
  const tiered = tierMemoryInjection(normalized);
  const injections: InjectionBlock[] = [];

  if (tiered.high.length > 0) {
    injections.push({
      phase: normalized.phase,
      injection_reason: normalized.injection_reason,
      memory_summary: normalized.memory_summary,
      memory_records: tiered.high,
      tier: "high",
      kind: "stable_preference",
    });
  }

  if (tiered.medium.length > 0) {
    injections.push({
      phase: normalized.phase,
      injection_reason: normalized.injection_reason,
      memory_summary: normalized.memory_summary,
      memory_records: tiered.medium,
      tier: "medium",
      kind: "task_state",
    });
  }

  if (tiered.summary) {
    injections.push({
      phase: normalized.phase,
      injection_reason: normalized.injection_reason,
      memory_summary: tiered.summary,
      memory_records: tiered.summary_records,
      tier: "summary",
      kind: "summary",
    });
  }

  return injections;
}

function buildPromptInjections(injections: InjectionBlock[]): InjectionBlock[] {
  if (injections.length === 0) {
    return [];
  }

  const merged = mergePromptInjectionSources(injections);
  return toTieredInjectionBlocksFromNormalized(merged);
}

function mergePromptInjectionSources(injections: InjectionBlock[]): InjectionBlock {
  const phases = dedupeStrings(injections.map((item) => item.phase));
  const reasons = dedupeStrings(injections.map((item) => item.injection_reason));
  const summaries = dedupeStrings(injections.map((item) => item.memory_summary));
  const recordMap = new Map<string, InjectionBlock["memory_records"][number]>();

  for (const injection of injections) {
    for (const record of injection.memory_records) {
      if (!recordMap.has(record.id)) {
        recordMap.set(record.id, record);
      }
    }
  }

  return {
    phase: phases.join(","),
    injection_reason: reasons.join("\n"),
    memory_summary: summaries.join("\n"),
    memory_records: [...recordMap.values()],
  };
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function mergeInjections(injections: InjectionBlock[]): InjectionBlock {
  if (injections.length === 1) {
    const single = injections[0];
    if (!single) {
      throw new Error("Expected at least one injection.");
    }
    return {
      ...single,
      tier_counts: {
        high: single.tier === "high" ? single.memory_records.length : 0,
        medium: single.tier === "medium" ? single.memory_records.length : 0,
        summary: single.tier === "summary" ? single.memory_records.length : 0,
      },
      high_summary: single.tier === "high" ? single.memory_summary : undefined,
      medium_summary: single.tier === "medium" ? single.memory_summary : undefined,
      summary_only: single.tier === "summary" ? single.memory_summary : undefined,
    };
  }

  return {
    phase: injections.map((item) => item.phase).join(","),
    injection_reason: injections.map((item) => `[${item.phase}] ${item.injection_reason}`).join("\n"),
    memory_summary: injections.map((item) => `[${item.phase}] ${item.memory_summary}`).join("\n"),
    tier_counts: {
      high: injections
        .filter((item) => item.tier === "high")
        .reduce((sum, item) => sum + item.memory_records.length, 0),
      medium: injections
        .filter((item) => item.tier === "medium")
        .reduce((sum, item) => sum + item.memory_records.length, 0),
      summary: injections
        .filter((item) => item.tier === "summary")
        .reduce((sum, item) => sum + item.memory_records.length, 0),
    },
    high_summary: injections.filter((item) => item.tier === "high").map((item) => item.memory_summary).join("\n") || undefined,
    medium_summary: injections.filter((item) => item.tier === "medium").map((item) => item.memory_summary).join("\n") || undefined,
    summary_only: injections.filter((item) => item.tier === "summary").map((item) => item.memory_summary).join("\n") || undefined,
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
