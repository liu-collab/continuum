import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function pickWorkspaceDirectory(): Promise<string | null> {
  switch (process.platform) {
    case "win32":
      return pickWorkspaceDirectoryOnWindows();
    case "darwin":
      return pickWorkspaceDirectoryOnMac();
    case "linux":
      return pickWorkspaceDirectoryOnLinux();
    default:
      throw unsupportedWorkspacePicker();
  }
}

async function pickWorkspaceDirectoryOnWindows(): Promise<string | null> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "[System.Windows.Forms.Application]::EnableVisualStyles()",
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.Text = 'Continuum'",
    "$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
    "$owner.Size = New-Object System.Drawing.Size(1, 1)",
    "$owner.ShowInTaskbar = $false",
    "$owner.TopMost = $true",
    "$owner.Opacity = 0",
    "$null = $owner.Show()",
    "$owner.Activate()",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择工作区文件夹'",
    "$dialog.ShowNewFolderButton = $false",
    "$result = $dialog.ShowDialog($owner)",
    "$owner.Close()",
    "$owner.Dispose()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  [Console]::Out.Write($dialog.SelectedPath)",
    "}",
  ].join("; ");

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-STA", "-Command", script],
    {
      windowsHide: false,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    },
  );

  const selectedPath = stdout.trim();
  return selectedPath.length > 0 ? selectedPath : null;
}

async function pickWorkspaceDirectoryOnMac(): Promise<string | null> {
  const script = [
    "try",
    'set selectedFolder to choose folder with prompt "选择工作区文件夹"',
    "POSIX path of selectedFolder",
    "on error number -128",
    'return ""',
    "end try",
  ];

  const { stdout } = await execFileAsync("osascript", script.flatMap((line) => ["-e", line]), {
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });

  const selectedPath = stdout.trim();
  return selectedPath.length > 0 ? selectedPath : null;
}

async function pickWorkspaceDirectoryOnLinux(): Promise<string | null> {
  const candidates: Array<{ command: string; args: string[] }> = [
    {
      command: "zenity",
      args: ["--file-selection", "--directory", "--title=选择工作区文件夹"],
    },
    {
      command: "kdialog",
      args: ["--getexistingdirectory", ".", "--title", "选择工作区文件夹"],
    },
  ];

  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate.command, candidate.args, {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      });
      const selectedPath = stdout.trim();
      return selectedPath.length > 0 ? selectedPath : null;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: string | number }).code)
          : "";
      const signal =
        typeof error === "object" && error !== null && "signal" in error
          ? String((error as { signal?: string | number }).signal)
          : "";

      if (code === "ENOENT") {
        continue;
      }

      if (code === "1" || code === "255" || signal === "SIGTERM") {
        return null;
      }

      throw error;
    }
  }

  throw unsupportedWorkspacePicker();
}

function unsupportedWorkspacePicker() {
  return Object.assign(
    new Error("当前系统没有可用的文件夹选择器，请改用手动输入路径。"),
    {
      code: "workspace_picker_unsupported",
    },
  );
}
