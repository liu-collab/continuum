import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FileTree } from "@/app/agent/_components/file-tree";
import { AgentI18nProvider } from "@/app/agent/_i18n/provider";

function renderFileTree(props?: Partial<React.ComponentProps<typeof FileTree>>) {
  const onPickWorkspace = vi.fn(async () => undefined);
  const onOpenDirectory = vi.fn();
  const onOpenFile = vi.fn();

  render(
    <AgentI18nProvider defaultLocale="zh-CN">
      <FileTree
        path="."
        entries={[
          {
            name: "README.md",
            type: "file"
          }
        ]}
        workspaces={[
          {
            workspace_id: "550e8400-e29b-41d4-a716-446655440000",
            short_id: "550e8400",
            cwd: "C:/workspace/repo",
            label: "repo",
            is_current: true
          }
        ]}
        selectedWorkspaceId="550e8400-e29b-41d4-a716-446655440000"
        selectedFilePath={null}
        onPickWorkspace={onPickWorkspace}
        onClearWorkspace={vi.fn()}
        onOpenDirectory={onOpenDirectory}
        onOpenFile={onOpenFile}
        {...props}
      />
    </AgentI18nProvider>
  );

  return {
    onPickWorkspace,
    onOpenDirectory,
    onOpenFile
  };
}

describe("file tree", () => {
  it("does not render the workspace select dropdown", () => {
    renderFileTree();

    expect(screen.queryByTestId("agent-file-tree-workspace-select")).not.toBeInTheDocument();
    expect(screen.getByText("已选文件夹")).toBeInTheDocument();
    expect(screen.getByTestId("selected-workspace-path")).toHaveTextContent("repo");
    expect(screen.getByTestId("selected-workspace-path")).toHaveAttribute("title", "C:/workspace/repo");
    expect(screen.getByTestId("selected-workspace-id")).toHaveTextContent("路径: C:/workspace/repo");
    expect(screen.getByTestId("selected-workspace-id")).toHaveAttribute("title", "调试 ID: 550e8400");
    expect(screen.queryByRole("button", { name: "选择文件夹" })).not.toBeInTheDocument();
  });

  it("triggers native workspace picking when no folder is selected", async () => {
    const user = userEvent.setup();
    const onPickWorkspace = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <FileTree
          path="."
          entries={[]}
          workspaces={[]}
          selectedWorkspaceId={null}
          selectedFilePath={null}
          onPickWorkspace={onPickWorkspace}
          onClearWorkspace={vi.fn()}
          onOpenDirectory={vi.fn()}
          onOpenFile={vi.fn()}
        />
      </AgentI18nProvider>
    );

    await user.click(screen.getByRole("button", { name: "选择文件夹" }));

    expect(onPickWorkspace).toHaveBeenCalledTimes(1);
  });

  it("clears the selected folder and shows the picker again", async () => {
    const user = userEvent.setup();
    const onClearWorkspace = vi.fn();

    renderFileTree({
      onClearWorkspace,
    });

    await user.click(screen.getByRole("button", { name: "移除当前文件夹" }));

    expect(onClearWorkspace).toHaveBeenCalledTimes(1);
  });

  it("shows pending feedback while the native picker is opening", async () => {
    const user = userEvent.setup();
    let resolvePick: ((value: void | PromiseLike<void>) => void) | undefined;
    const onPickWorkspace = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePick = resolve;
        }),
    );

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <FileTree
          path="."
          entries={[]}
          workspaces={[]}
          selectedWorkspaceId={null}
          selectedFilePath={null}
          onPickWorkspace={onPickWorkspace}
          onClearWorkspace={vi.fn()}
          onOpenDirectory={vi.fn()}
          onOpenFile={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "选择文件夹" }));

    expect(screen.getByRole("button", { name: "正在打开..." })).toBeDisabled();
    expect(
      screen.getByText("正在打开系统文件夹选择框，如果没有看到弹窗，请检查是否被其他窗口遮挡。"),
    ).toBeInTheDocument();

    await act(async () => {
      resolvePick?.();
    });
  });

  it("shows pending feedback while opening a directory", async () => {
    const user = userEvent.setup();
    let resolveOpen: ((value: void | PromiseLike<void>) => void) | undefined;
    const onOpenDirectory = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    renderFileTree({
      entries: [
        {
          name: "docs",
          type: "directory",
        },
      ],
      onOpenDirectory,
    });

    await user.click(screen.getByRole("button", { name: "docs" }));

    expect(onOpenDirectory).toHaveBeenCalledWith("docs");
    expect(screen.getByTestId("file-tree-open-pending")).toHaveTextContent("正在读取文件树...");
    expect(screen.getByRole("button", { name: "docs" })).toBeDisabled();

    await act(async () => {
      resolveOpen?.();
    });
  });

  it("shows an inline error when opening a file fails", async () => {
    const user = userEvent.setup();

    renderFileTree({
      onOpenFile: vi.fn(async () => {
        throw new Error("failed");
      }),
    });

    await user.click(screen.getByRole("button", { name: "README.md" }));

    expect(screen.getByTestId("file-tree-open-error")).toHaveTextContent("文件打开失败，请稍后重试。");
  });
});
