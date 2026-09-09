import assert from "node:assert/strict";
import { getWindowsStatus } from "../dist/windows-runtime.js";
import { probeWindowsConnection } from "../dist/windows-diagnostics.js";

// The control reproduces the previous status-then-probe flow using the same installed runtime.
// Each probe owns a fresh connection; no UI input or window titles are recorded.
const samples = [];
for (let round = 0; round < 3; round++) {
	for (const mode of round % 2 === 0 ? ["double-verification", "single-verification"] : ["single-verification", "double-verification"]) {
		const started = performance.now();
		if (mode === "double-verification") assert.equal((await getWindowsStatus()).runtimeVerified, true);
		const result = await probeWindowsConnection();
		assert.equal(result.runtimeVerified, true);
		assert.equal(result.connectionReady, true, result.error);
		assert.equal(result.cleanupError, undefined);
		samples.push({ round: round + 1, mode, totalMs: Math.round(performance.now() - started), verificationMs: result.verificationMs });
	}
}
const median = (mode) => samples.filter(s => s.mode === mode).map(s => s.totalMs).sort((a,b) => a-b)[1];
console.log(JSON.stringify({ samples, medianDoubleMs: median("double-verification"), medianSingleMs: median("single-verification") }, null, 2));
