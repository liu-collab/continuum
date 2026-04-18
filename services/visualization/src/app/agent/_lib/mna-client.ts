import type { AgentTokenBootstrapResponse } from "@/lib/contracts";

export async function getMnaBootstrap(): Promise<AgentTokenBootstrapResponse> {
  const response = await fetch("/api/agent/token", {
    method: "GET",
    cache: "no-store"
  });

  return (await response.json()) as AgentTokenBootstrapResponse;
}
