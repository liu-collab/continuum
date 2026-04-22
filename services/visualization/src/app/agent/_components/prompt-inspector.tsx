"use client";

import React from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";

import { useAgentI18n } from "../_i18n/provider";
import type { MnaPromptInspectorResponse } from "../_lib/openapi-types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((mod) => mod.default), {
  ssr: false
});

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
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-surface shadow-overlay"
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
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="min-h-[22rem] border-r">
            <MonacoEditor
              language="json"
              height="100%"
              theme="vs-light"
              value={JSON.stringify(payload?.messages ?? [], null, 2)}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12
              }}
            />
          </div>
          <div className="min-h-[22rem] overflow-auto px-5 py-4">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t("promptInspector.meta")}
            </div>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t("promptInspector.turn")}</dt>
                <dd className="mt-0.5 text-foreground">{payload?.turn_id ?? t("promptInspector.notLoaded")}</dd>
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
                <dt className="text-xs text-muted-foreground">{t("promptInspector.finalPrompt")}</dt>
                <dd className="mt-1 space-y-2">
                  {promptSegments.map((segment, index) => (
                    <div key={`${segment.kind}-${segment.phase ?? "none"}-${index}`} className="rounded-md border bg-surface-muted/30 px-3 py-2">
                      <div className="text-xs font-medium text-foreground">
                        {segment.kind} · {segment.priority}
                      </div>
                      {segment.phase ? (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">phase: {segment.phase}</div>
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
                <dt className="text-xs text-muted-foreground">budget</dt>
                <dd className="mt-1 space-y-2 text-xs text-foreground">
                  {payload?.budget_plan ? (
                    <>
                      <div>
                        total: {String(payload.budget_plan.budget.total ?? "unbounded")} / reserve: {payload.budget_plan.budget.reserve}
                      </div>
                      <div>
                        fixed {payload.budget_plan.allocation.fixed} · memory {payload.budget_plan.allocation.memory} · tools {payload.budget_plan.allocation.tools}
                      </div>
                      <div>
                        history {payload.budget_plan.allocation.history} · current {payload.budget_plan.allocation.current_turn}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t("promptInspector.notLoaded")}</div>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">dropped</dt>
                <dd className="mt-1 space-y-2">
                  {dropped.map((item, index) => (
                    <div key={`${item.source}-${index}`} className="rounded-md border bg-surface-muted/30 px-3 py-2 text-xs">
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
                    <div key={`${result.phase}-${result.trace_id ?? "none"}-${index}`} className="rounded-md border bg-surface-muted/30 px-3 py-2">
                      <div className="text-xs font-medium text-foreground">
                        {result.phase}
                        {result.degraded ? " · degraded" : ""}
                      </div>
                      {result.trace_id ? (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">trace: {result.trace_id}</div>
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
                <dt className="text-xs text-muted-foreground">plan</dt>
                <dd className="mt-1 space-y-2">
                  {plan ? (
                    <>
                      <div className="rounded-md border bg-surface-muted/30 px-3 py-2 text-xs">
                        {plan.status} · {plan.goal}
                      </div>
                      {plan.steps.map((step) => (
                        <div key={step.id} className="rounded-md border bg-surface-muted/30 px-3 py-2 text-xs">
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
                <dt className="text-xs text-muted-foreground">plan revisions</dt>
                <dd className="mt-1 space-y-2">
                  {planRevisions.map((item) => (
                    <div key={item.id} className="rounded-md border bg-surface-muted/30 px-3 py-2 text-xs">
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
                <dt className="text-xs text-muted-foreground">evaluation</dt>
                <dd className="mt-1 space-y-2">
                  {evaluation.map((item, index) => (
                    <div key={`${item.scope}-${index}`} className="rounded-md border bg-surface-muted/30 px-3 py-2 text-xs">
                      {item.scope} · {item.decision.status} · {item.decision.reason}
                    </div>
                  ))}
                  {payload && evaluation.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t("promptInspector.notLoaded")}</div>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">trace</dt>
                <dd className="mt-1 space-y-2">
                  {traceSpans.map((span) => (
                    <div key={span.id} className="rounded-md border bg-surface-muted/30 px-3 py-2 text-xs">
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
