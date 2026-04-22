export interface WorkspaceFileSnapshot {
  path: string;
  content: string | null;
}

export interface WorkspaceSnapshot {
  files: WorkspaceFileSnapshot[];
}

export interface CommandExecutionInput {
  command: string;
  cwd: string;
  workspaceRoot?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  abort: AbortSignal;
  networkEnabled?: boolean;
  resourceLimits?: {
    timeoutMs?: number;
    maxMemoryMb?: number;
    maxCpuPercent?: number;
  };
  audit?: {
    sessionId: string;
    turnId: string;
    callId: string;
    toolName: string;
  };
  rollbackOnError?: boolean;
  snapshotBeforeRun?: boolean;
}

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  snapshot?: WorkspaceSnapshot;
  changedFiles?: string[];
  rolledBack?: boolean;
}

export interface CommandExecutor {
  run(input: CommandExecutionInput): Promise<CommandExecutionResult>;
}
