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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">{t("promptInspector.title")}</div>
            <div className="text-xs text-slate-500">{t("promptInspector.description")}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("promptInspector.close")}
            data-testid="prompt-inspector-close"
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="min-h-[24rem] border-r">
            <MonacoEditor
              language="json"
              height="100%"
              theme="vs-light"
              value={JSON.stringify(payload?.messages ?? [], null, 2)}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 13
              }}
            />
          </div>
          <div className="min-h-[24rem] overflow-auto px-6 py-5">
            <div className="text-sm font-semibold text-slate-900">{t("promptInspector.meta")}</div>
            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-slate-500">{t("promptInspector.turn")}</dt>
                <dd className="mt-1 text-slate-900">{payload?.turn_id ?? t("promptInspector.notLoaded")}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t("promptInspector.provider")}</dt>
                <dd className="mt-1 text-slate-900">
                  {payload ? `${payload.provider_id} / ${payload.model}` : t("promptInspector.notLoaded")}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t("promptInspector.tools")}</dt>
                <dd className="mt-1 text-slate-900">{payload?.tools.length ?? 0}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
