import "fastify";

import type { MnaRuntimeState } from "./http/state.js";

declare module "fastify" {
  interface FastifyInstance {
    mnaToken: string;
    mnaTokenPath: string;
    runtimeState: MnaRuntimeState;
  }
}
