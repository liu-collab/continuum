import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    mnaToken: string;
    mnaTokenPath: string;
  }
}
