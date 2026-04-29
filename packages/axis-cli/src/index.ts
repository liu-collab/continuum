import process from "node:process";

import { runCli } from "./axis-cli.js";

const exitCode = await runCli(process.argv.slice(2), import.meta.url);
if (typeof exitCode === "number") {
  process.exitCode = exitCode;
}
