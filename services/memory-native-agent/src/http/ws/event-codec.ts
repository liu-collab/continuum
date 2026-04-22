import { z } from "zod";

export const clientEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user_input"),
    turn_id: z.string().min(1),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal("abort"),
    turn_id: z.string().min(1),
  }),
  z.object({
    kind: z.literal("tool_confirm"),
    confirm_id: z.string().min(1),
    decision: z.enum(["allow", "deny", "allow_session"]),
  }),
  z.object({
    kind: z.literal("plan_confirm"),
    confirm_id: z.string().min(1),
    decision: z.enum(["approve", "revise", "cancel"]),
    feedback: z.string().trim().max(2_000).optional(),
  }),
  z.object({
    kind: z.literal("ping"),
  }),
  z.object({
    kind: z.literal("skill_input"),
    turn_id: z.string().min(1),
    skill: z.string().min(1),
    arguments: z.string().optional(),
  }),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;

export function encodeServerEvent(id: number, payload: Record<string, unknown>): string {
  return JSON.stringify({
    event_id: id,
    ...payload,
  });
}

export function encodeGapDetectedEvent(lastEventId: number): string {
  return JSON.stringify({
    kind: "replay_gap",
    last_event_id: lastEventId,
  });
}

export function decodeClientEvent(raw: string): ClientEvent {
  return clientEventSchema.parse(JSON.parse(raw));
}
