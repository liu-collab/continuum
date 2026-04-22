export interface PlanStep {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  notes?: string;
}

export interface ExecutionPlan {
  id: string;
  session_id: string;
  turn_id: string;
  goal: string;
  status: "draft" | "approved" | "running" | "completed" | "revised" | "abandoned";
  steps: PlanStep[];
  created_at: string;
  updated_at: string;
  revision_reason?: string;
}
