"use client";

import React from "react";
import { X } from "lucide-react";

import { formatDebugReference } from "@/lib/format";

import { useAgentI18n } from "@/lib/i18n/agent/provider";
import type { MnaPromptInspectorResponse } from "../_lib/openapi-types";

type PromptInspectorProps = {
  open: boolean;
  payload: MnaPromptInspectorResponse | null;
  onClose(): void;
};

export function PromptInspector({ open, payload, onClose }: PromptInspectorProps) {
  const { t } = useAgentI18n();
  const promptSegments = payload?.prompt_segments ?? [];
  const phaseResults = payload?.phase_results ?? [];
  const dropped = payload?.budget_plan?.dropped ?? [];
  const plan = payload?.plan;
  const planRevisions = payload?.plan_revisions ?? [];
  const evaluation = payload?.evaluation ?? [];
  const traceSpans = payload?.trace_spans ?? [];

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4 py-10"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="panel flex max-h-full w-full max-w-5xl flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <div className="text-base font-semibold text-foreground">{t("promptInspector.title")}</div>
            <div className="text-sm text-muted-foreground">{t("promptInspector.description")}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("promptInspector.close")}
            data-testid="prompt-inspector-close"
            className="icon-button !h-11 !w-11"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[0.8fr_1.2fr]">
          <div
            data-testid="prompt-inspector-meta-pane"
            className="min-h-0 overflow-auto border-b px-5 py-4 lg:border-b-0 lg:border-r"
          >
            <div className="section-kicker">
              {t("promptInspector.meta")}
            </div>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.turn")}</dt>
                <dd className="mt-0.5 text-foreground" title={payload?.turn_id}>
                  {payload?.turn_id ? formatDebugReference(payload.turn_id) : t("promptInspector.notLoaded")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.provider")}</dt>
                <dd className="mt-0.5 text-foreground">
                  {payload ? `${payload.provider_id} / ${payload.model}` : t("promptInspector.notLoaded")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.tools")}</dt>
                <dd className="mt-0.5 text-foreground">{payload?.tools.length ?? 0}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.messages")}</dt>
                <dd className="mt-0.5 text-foreground">{payload?.messages.length ?? 0}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.round")}</dt>
                <dd className="mt-0.5 text-foreground">{payload?.round ?? t("promptInspector.notLoaded")}</dd>
              </div>
            </dl>

            <div className="mt-6">
              <div className="section-kicker">{t("promptInspector.budget")}</div>
              <div className="mt-3 grid gap-2 text-sm text-foreground">
                {payload?.budget_plan ? (
                  <>
                    <div className="record-card px-3 py-2">
                      {t("promptInspector.budgetTotal", {
                        total: String(payload.budget_plan.budget.total ?? t("promptInspector.unbounded")),
                        reserve: payload.budget_plan.budget.reserve
                      })}
                    </div>
                    <div className="record-card px-3 py-2">
                      {t("promptInspector.budgetAllocationPrimary", {
                        fixed: payload.budget_plan.allocation.fixed,
                        memory: payload.budget_plan.allocation.memory,
                        tools: payload.budget_plan.allocation.tools
                      })}
                    </div>
                    <div className="record-card px-3 py-2">
                      {t("promptInspector.budgetAllocationSecondary", {
                        history: payload.budget_plan.allocation.history,
                        current: payload.budget_plan.allocation.current_turn
                      })}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">{t("promptInspector.notLoaded")}</div>
                )}
              </div>
            </div>

            <details className="mt-6 rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--canvas)] p-4">
              <summary className="cursor-pointer text-sm font-semibold text-foreground">{t("promptInspector.rawPayload")}</summary>
              <pre
                data-testid="prompt-inspector-raw-payload"
                className="quiet-code mt-3 max-h-[32rem] overflow-auto"
              >
                {JSON.stringify({ messages: payload?.messages ?? [], tools: payload?.tools ?? [] }, null, 2)}
              </pre>
            </details>
          </div>

          <div className="min-h-0 overflow-auto px-5 py-4">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.finalPrompt")}</dt>
                <dd className="mt-1 space-y-2">
                  {promptSegments.map((segment, index) => (
                    <div key={`${segment.kind}-${segment.phase ?? "none"}-${index}`} className="record-card px-3 py-2">
                      <div className="text-xs font-semibold text-foreground">
                        {segment.kind} · {segment.priority}
                      </div>
                      {segment.phase ? (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {t("promptInspector.segmentPhase", { phase: segment.phase })}
                        </div>
                      ) : null}
                      <div className="mt-1 text-xs leading-5 text-foreground">{segment.preview}</div>
                    </div>
                  ))}
                  {payload && promptSegments.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t("promptInspector.noPromptSegments")}</div>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.dropped")}</dt>
                <dd className="mt-1 space-y-2">
                  {dropped.map((item, index) => (
                    <div key={`${item.source}-${index}`} className="record-card px-3 py-2 text-xs">
                      {item.source} · {item.reason}
                      <div className="mt-1 text-muted-foreground">{item.preview}</div>
                    </div>
                  ))}
                  {payload && dropped.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t("promptInspector.notLoaded")}</div>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.phaseHits")}</dt>
                <dd className="mt-1 space-y-2">
                  {phaseResults.map((result, index) => (
                    <div key={`${result.phase}-${result.trace_id ?? "none"}-${index}`} className="record-card px-3 py-2">
                      <div className="text-xs font-semibold text-foreground">
                        {result.phase}
                        {result.degraded ? " · degraded" : ""}
                      </div>
                      {result.trace_id ? (
                        <div className="mt-0.5 text-[11px] text-muted-foreground" title={result.trace_id}>
                          {t("promptInspector.trace")}: {formatDebugReference(result.trace_id)}
                        </div>
                      ) : null}
                      <div className="mt-1 text-xs leading-5 text-foreground">
                        {result.injection_summary?.trim() || t("promptInspector.noInjection")}
                      </div>
                    </div>
                  ))}
                  {payload && phaseResults.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t("promptInspector.noPhaseHits")}</div>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.plan")}</dt>
                <dd className="mt-1 space-y-2">
                  {plan ? (
                    <>
                      <div className="record-card px-3 py-2 text-xs">
                        {plan.status} · {plan.goal}
                      </div>
                      {plan.steps.map((step) => (
                        <div key={step.id} className="record-card px-3 py-2 text-xs">
                          {step.status} · {step.title}
                          {step.notes ? <div className="mt-1 text-muted-foreground">{step.notes}</div> : null}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t("promptInspector.notLoaded")}</div>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.planRevisions")}</dt>
                <dd className="mt-1 space-y-2">
                  {planRevisions.map((item) => (
                    <div key={item.id} className="record-card px-3 py-2 text-xs">
                      r{item.revision} · {item.status} · {item.goal}
                      {item.revision_reason ? (
                        <div className="mt-1 text-muted-foreground">{item.revision_reason}</div>
                      ) : null}
                    </div>
                  ))}
                  {payload && planRevisions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t("promptInspector.notLoaded")}</div>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.evaluation")}</dt>
                <dd className="mt-1 space-y-2">
                  {evaluation.map((item, index) => (
                    <div key={`${item.scope}-${index}`} className="record-card px-3 py-2 text-xs">
                      {item.scope} · {item.decision.status} · {item.decision.reason}
                    </div>
                  ))}
                  {payload && evaluation.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t("promptInspector.notLoaded")}</div>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.trace")}</dt>
                <dd className="mt-1 space-y-2">
                  {traceSpans.map((span) => (
                    <div key={span.id} className="record-card px-3 py-2 text-xs">
                      {span.kind} · {span.name} · {span.status}
                    </div>
                  ))}
                  {payload && traceSpans.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t("promptInspector.notLoaded")}</div>
                  ) : null}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
