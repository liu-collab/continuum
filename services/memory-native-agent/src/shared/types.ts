export const MNA_VERSION = "0.1.0";
export const DEFAULT_MNA_HOST = "127.0.0.1";
export const DEFAULT_MNA_PORT = 4193;

export interface HealthzPayload {
  status: "ok";
  version: string;
  dependencies: {
    retrieval_runtime: "unknown";
  };
}
