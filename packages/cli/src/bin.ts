#!/usr/bin/env node
import { loadCliEnv } from "./env.js";
import { run } from "./index.js";
import { PROCESS_IO } from "./io.js";

const env = await loadCliEnv(process.cwd());
process.exitCode = await run(process.argv.slice(2), PROCESS_IO, env);
