import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createTranslator, DEFAULT_APP_LOCALE, type AppLocale } from "@/lib/i18n/messages";

const execFileAsync = promisify(execFile);

export async function pickWorkspaceDirectory(
  options: { locale?: AppLocale } = {}
): Promise<string | null> {
  const locale = options.locale ?? DEFAULT_APP_LOCALE;

  switch (process.platform) {
    case "win32":
      return pickWorkspaceDirectoryOnWindows(locale);
    case "darwin":
      return pickWorkspaceDirectoryOnMac(locale);
    case "linux":
      return pickWorkspaceDirectoryOnLinux(locale);
    default:
      throw unsupportedWorkspacePicker(locale);
  }
}

async function pickWorkspaceDirectoryOnWindows(locale: AppLocale): Promise<string | null> {
  const t = createTranslator(locale);
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
    `$dialog.Description = '${t("service.workspacePicker.title")}'`,
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

async function pickWorkspaceDirectoryOnMac(locale: AppLocale): Promise<string | null> {
  const t = createTranslator(locale);
  const script = [
    "try",
    `set selectedFolder to choose folder with prompt "${t("service.workspacePicker.title")}"`,
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

async function pickWorkspaceDirectoryOnLinux(locale: AppLocale): Promise<string | null> {
  const t = createTranslator(locale);
  const title = t("service.workspacePicker.title");
  const candidates: Array<{ command: string; args: string[] }> = [
    {
      command: "zenity",
      args: ["--file-selection", "--directory", `--title=${title}`],
    },
    {
      command: "kdialog",
      args: ["--getexistingdirectory", ".", "--title", title],
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

  throw unsupportedWorkspacePicker(locale);
}

function unsupportedWorkspacePicker(locale: AppLocale = DEFAULT_APP_LOCALE) {
  return Object.assign(
    new Error(createTranslator(locale)("service.workspacePicker.unsupported")),
    {
      code: "workspace_picker_unsupported",
    },
  );
}
