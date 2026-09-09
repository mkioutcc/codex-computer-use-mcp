import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveWindowsRuntime, windowsPowerShell } from "../dist/windows-runtime.js";
import { windowsDiscoveryAndVerificationScript } from "../dist/windows-verification.js";
const exec = promisify(execFile);
const runtime = await resolveWindowsRuntime();
const files = [runtime.codex, runtime.node, runtime.repl, path.join(runtime.moduleDir, "@oai", "sky", "bin", "windows", "codex-computer-use.exe")];
async function run(script) {
	const wrapped = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); try { ${script} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
	const result = await exec(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(wrapped, "utf16le").toString("base64")], { timeout: 30_000, windowsHide: true, maxBuffer: 1024*1024 });
	return result.stdout.trim();
}
const combined = windowsDiscoveryAndVerificationScript(files);
// Preserve identical verification statements while splitting their execution across two processes.
const splitPoint = "$clock.Restart();";
const [discovery, signatures] = combined.split(splitPoint);
assert.ok(discovery && signatures);
const samples = [];
for(let round=0;round<3;round++) {
	for(const mode of round%2===0 ? ["two-processes","one-process"] : ["one-process","two-processes"]) {
		const t=performance.now();
		if(mode === "two-processes") {
			const installation=JSON.parse(await run(discovery + "@{InstallLocation=$p.InstallLocation;resources=$resources;localAppData=$localAppData;discoveryMs=$discoveryMs} | ConvertTo-Json -Compress"));
			const quoted=JSON.stringify(installation).replaceAll("'", "''");
			await run(`$ErrorActionPreference='Stop'; $p='${quoted}' | ConvertFrom-Json; $resources=$p.resources; $localAppData=$p.localAppData; $discoveryMs=$p.discoveryMs; $clock=[Diagnostics.Stopwatch]::StartNew(); ${signatures}`);
		} else await run(combined);
		samples.push({round:round+1,mode,ms:Math.round(performance.now()-t)});
	}
}
const median=mode=>samples.filter(s=>s.mode===mode).map(s=>s.ms).sort((a,b)=>a-b)[1];
console.log(JSON.stringify({samples,medianTwoMs:median("two-processes"),medianOneMs:median("one-process")},null,2));
