import type { FastifyInstance } from "fastify";

import type { MnaRuntimeState } from "./state.js";

export type RuntimeFastifyInstance = FastifyInstance & {
  mnaToken: string;
  mnaTokenPath: string;
  runtimeState: MnaRuntimeState;
};
