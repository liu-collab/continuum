export const MNA_VERSION = "0.1.0";

export interface HealthzPayload {
  status: "ok";
  version: string;
  dependencies: {
    retrieval_runtime: "unknown";
  };
}
