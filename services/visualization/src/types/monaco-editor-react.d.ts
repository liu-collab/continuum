declare module "@monaco-editor/react" {
  import type { ComponentType } from "react";

  type MonacoEditorProps = {
    language?: string;
    theme?: string;
    height?: string | number;
    value?: string;
    options?: Record<string, unknown>;
  };

  const MonacoEditor: ComponentType<MonacoEditorProps>;

  export default MonacoEditor;
}
