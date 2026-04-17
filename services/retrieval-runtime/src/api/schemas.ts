import { z } from "zod";

export const memoryModeSchema = z.enum(["workspace_only", "workspace_plus_global"]);

export const observeRunsQuerySchema = z.object({
  session_id: z.string().optional(),
  turn_id: z.string().optional(),
  trace_id: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(20).optional(),
});
