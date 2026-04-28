"use client";

import React from "react";
import dynamic from "next/dynamic";

import { useAgentI18n } from "@/lib/i18n/agent/provider";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((mod) => mod.default), {
  ssr: false
});

type FilePreviewProps = {
  path: string;
  content: string;
};

export function FilePreview({ path, content }: FilePreviewProps) {
  const { t } = useAgentI18n();

  return (
    <section data-testid="file-preview" className="panel">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-medium text-foreground">{t("filePreview.title")}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{path}</div>
      </div>
      <div className="h-72">
        <MonacoEditor
          language={guessLanguage(path)}
          theme="vs-light"
          height="100%"
          value={content}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12
          }}
        />
      </div>
    </section>
  );
}

function guessLanguage(path: string) {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".css")) return "css";
  return "plaintext";
}
