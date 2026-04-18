import { randomUUID } from "node:crypto";

export function createSessionId(): string {
  return randomUUID();
}

export function createTurnId(): string {
  return randomUUID();
}

export function createTaskId(): string {
  return randomUUID();
}
