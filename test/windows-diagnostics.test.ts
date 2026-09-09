import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifySkyDirectory } from "../src/windows-runtime.ts";
import { probeWindowsConnection } from "../src/windows-diagnostics.ts";

test("Windows connection probe distinguishes reachability and preserves cleanup", async () => {
 let closed = 0;
 const session = { async execute() { return { isError: false, content: [], structuredContent: [{ title: "private" }] }; }, async close() { closed++; } };
 const result = await probeWindowsConnection(session);
 assert.equal(result.connectionReady, true);
 assert.equal(result.windowCount, 1);
 assert.equal(closed, 1);
 assert.doesNotMatch(JSON.stringify(result), /private/);
 const failed = await probeWindowsConnection({ async execute() { throw new Error("pipe offline"); }, async close() { closed++; } });
 assert.equal(failed.connectionReady, false);
 assert.match(String(failed.error), /pipe offline/);
 assert.equal(closed, 2);
 const cleanup = await probeWindowsConnection({ ...session, async close() { throw new Error("cleanup failed"); } });
 assert.equal(cleanup.connectionReady, false);
});

test("Sky comparison keeps full byte verification including nested mismatches", async () => {
 const root = await mkdtemp(path.join(tmpdir(), "sky-verify-test-"));
 const a = path.join(root, "a"), b = path.join(root, "b");
 try {
  for (const dir of [a, b]) { await mkdir(path.join(dir, "nested"), { recursive: true }); for(let i=0;i<20;i++) await writeFile(path.join(dir,"nested",String(i)), "same"); }
  await verifySkyDirectory(a,b);
  await writeFile(path.join(a,"nested","19"), "different");
  await assert.rejects(verifySkyDirectory(a,b), /differs/);
 } finally { await rm(root,{recursive:true,force:true}); }
});
