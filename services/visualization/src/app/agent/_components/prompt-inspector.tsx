"use client";

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
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
