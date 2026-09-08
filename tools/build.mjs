import { rmSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
rmSync("dist", { recursive: true, force: true });
const result = spawnSync(process.execPath, [path.join(path.dirname(require.resolve("typescript/package.json")), "bin/tsc"), "-p", "tsconfig.json"], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
copyFileSync("src/windows-job.ps1", "dist/windows-job.ps1");
