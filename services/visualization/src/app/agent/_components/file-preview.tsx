"use client";

import dynamic from "next/dynamic";

import { useAgentI18n } from "../_i18n/provider";

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
    <section className="rounded-3xl border bg-white/88 shadow-soft">
      <div className="border-b px-5 py-4">
        <div className="text-sm font-semibold text-slate-900">{t("filePreview.title")}</div>
        <div className="mt-1 truncate text-xs text-slate-500">{path}</div>
      </div>
      <div className="h-80">
        <MonacoEditor
          language={guessLanguage(path)}
          theme="vs-light"
          height="100%"
          value={content}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13
          }}
        />
      </div>
    </section>
  );
}

function guessLanguage(path: string) {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) {
    return "typescript";
  }
  if (path.endsWith(".js") || path.endsWith(".mjs")) {
    return "javascript";
  }
  if (path.endsWith(".json")) {
    return "json";
  }
  if (path.endsWith(".md")) {
    return "markdown";
  }
  if (path.endsWith(".css")) {
    return "css";
  }

  return "plaintext";
}
