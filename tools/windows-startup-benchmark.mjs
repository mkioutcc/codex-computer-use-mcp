import assert from "node:assert/strict";
import { WindowsSessionExecutor } from "../dist/windows-session.js";

// Fresh adapter sessions, not a cold OS disk cache. No desktop input or app contents are recorded.
const samples = [];
for (let sample = 1; sample <= 3; sample++) {
	let runtimeTimingsMs;
	let powerShellTimingsMs;
	let verificationCount = 0;
	const sessionTimingsMs = {};
	const session = new WindowsSessionExecutor({
		onRuntimeStatus(status) { assert.equal(status.runtimeVerified, true, status.error); verificationCount++; runtimeTimingsMs = status.timingsMs; powerShellTimingsMs = status.powerShellTimingsMs; },
		onTiming(phase, durationMs) { sessionTimingsMs[phase] = durationMs; },
	});
	const callsMs = [];
	const started = performance.now();
	try {
		for (let call = 0; call < 3; call++) {
			const t = performance.now();
			const result = await session.execute("list_windows", {}, {});
			assert.equal(result.isError, false);
			assert.ok(Array.isArray(result.structuredContent));
			assert.equal(verificationCount, 1);
			callsMs.push(Math.round(performance.now() - t));
		}
	} finally { await session.close(); }
	samples.push({ sample, callsMs, totalWithCleanupMs: Math.round(performance.now() - started), runtimeTimingsMs, powerShellTimingsMs, sessionTimingsMs });
}
console.log(JSON.stringify(samples, null, 2));
