import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifySkyDirectory } from "../src/windows-runtime.ts";
import { probeWindowsConnection } from "../src/windows-diagnostics.ts";
import { WindowsSessionExecutor } from "../src/windows-session.ts";
import type { JsonObject } from "../src/tools.ts";

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

test("Production connection reports verification failure without caching it or starting a broker", { skip: process.platform !== "win32" }, async () => {
 const root = await mkdtemp(path.join(tmpdir(), "missing-windows-root-"));
 const original = process.env.SystemRoot;
 const statuses: JsonObject[] = [];
 const session = new WindowsSessionExecutor({ onRuntimeStatus: status => statuses.push(status) });
 try {
  process.env.SystemRoot = root;
  for (let i=0;i<2;i++) await assert.rejects(session.execute("list_windows", {}, {}), /Windows runtime PowerShell/);
  assert.equal(statuses.length, 2);
  for(const status of statuses) {
   assert.equal(status.runtimeVerified, false);
   assert.equal(status.connectionReady, null);
   assert.match(String(status.runtimeImplementation), /^[a-f0-9]{16}$/);
   assert.doesNotMatch(JSON.stringify(status), /EncodedCommand|nativePipe/);
  }
  const probe = await probeWindowsConnection();
  assert.equal(probe.runtimeVerified, false);
  assert.equal(probe.connectionReady, false);
  assert.ok(Number.isFinite(probe.verificationMs));
 } finally {
  if(original === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = original;
  await session.close();
  await rm(root, { recursive: true, force: true });
 }
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
