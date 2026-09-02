#!/usr/bin/env node
import { isAgentPassError } from "@agentpass/core";

import { run } from "./index.js";

try {
  process.stdout.write(`${await run(process.argv.slice(2))}\n`);
} catch (error) {
  const message = isAgentPassError(error) ? `${error.code}: ${error.message}` : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
