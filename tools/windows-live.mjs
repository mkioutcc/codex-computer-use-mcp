import { spawnSync } from "node:child_process";
if (process.platform !== "win32") throw new Error("Windows live acceptance requires Windows");
if (process.argv[2] !== "--ui") throw new Error("Pass --ui to create an unsaved test tab in the single open Notepad++ window. Existing documents are not edited.");
const result = spawnSync(process.execPath, ["--test", "test/windows-live.test.ts"], { stdio: "inherit", env: { ...process.env, COMPUTER_USE_LIVE_UI: "1", COMPUTER_USE_LIVE_DIALOG: process.argv.includes("--dialog") ? "1" : "0" } });
if(result.error) throw result.error;
process.exitCode = result.status ?? 1;
