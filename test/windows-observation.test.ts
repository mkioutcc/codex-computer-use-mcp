import assert from "node:assert/strict";
import test from "node:test";
import { uniqueElementIndex, onlyWindow, waitForObservation } from "./helpers/windows-observation.ts";

test("duplicate accessibility lines with the same index remain one observed element", () => {
 const tree = "\t2 MenuItem New ID: 41001\n\t3 MenuItem Open ID: 41002\n\t2 MenuItem New ID: 41001";
 assert.equal(uniqueElementIndex(tree, /ID: 41001$/), 2);
 assert.throws(() => uniqueElementIndex(tree + "\n4 MenuItem New ID: 41001", /ID: 41001$/), /unique/);
 assert.throws(() => uniqueElementIndex(tree, /ID: missing$/), /unique/);
});

test("window selection preserves the returned selector and never chooses among ambiguous windows", () => {
 const modal = { app: "official-id", id: 41, title: "Find" };
 assert.equal(onlyWindow([modal]), modal);
 assert.throws(() => onlyWindow([]), /one/);
 assert.throws(() => onlyWindow([modal, { ...modal, id: 42 }]), /one/);
});

test("observation waits for document and focus, not a title-only stale snapshot", async () => {
 let captures = 0;
 const states = [
  { title: "new 1", text: "old document", focus: "menu" },
  { title: "new 1", text: "", focus: "editor" },
 ];
 const result = await waitForObservation(async () => states[captures++], s => s.text === "" && s.focus === "editor", { intervalMs: 0 });
 assert.equal(result, states[1]);
 assert.equal(captures, 2);
});

test("state-derived indexes settle across two ready observations before selection", async () => {
 let captures = 0;
 const states = [{ index: 307 }, { index: 22 }, { index: 22 }];
 const result = await waitForObservation(async () => states[captures++], () => true, { intervalMs: 0, stableKey: s => String(s.index) });
 assert.equal(result, states[2]);
 assert.equal(captures, 3);
});

test("observation retries only snapshots, bounds stale states and propagates official stops immediately", async () => {
 let calls = 0;
 await assert.rejects(waitForObservation(async () => { calls++; return false; }, Boolean, { attempts: 3, intervalMs: 0 }), /not become ready/);
 assert.equal(calls, 3);
 calls = 0;
 await assert.rejects(waitForObservation(async () => { calls++; throw new Error("user stopped Computer Use"); }, Boolean, { intervalMs: 0 }), /user stopped/);
 assert.equal(calls, 1);
 const controller = new AbortController(); controller.abort();
 await assert.rejects(waitForObservation(async () => { calls++; return true; }, Boolean, { signal: controller.signal }), /abort/i);
 assert.equal(calls, 1);
});
