"use client";

import { useMemo } from "react";

import { MnaClient } from "../_lib/mna-client";

export function useAgentClient() {
  return useMemo(() => new MnaClient(), []);
}
