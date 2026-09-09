import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { windowsPowerShell } from "../src/windows-runtime.ts";
import { windowsDiscoveryAndVerificationScript } from "../src/windows-verification.ts";

const exec = promisify(execFile);
const files = ["C:\\official\\codex.exe", "C:\\official\\node.exe", "C:\\official\\node_repl.exe", "C:\\official\\O'Brien\\codex-computer-use.exe"];
async function run(status = "Valid", signer = 'CN="OpenAI OpCo, LLC", O="OpenAI OpCo, LLC"', installed = true) {
 const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop';
 $seen=[Collections.Generic.List[string]]::new();
 function Get-AppxPackage { ${installed ? "@{InstallLocation='C:\\official-app'}" : "$null"} }
 function Get-AuthenticodeSignature { param($LiteralPath); $seen.Add($LiteralPath); @{Status='${status}';SignerCertificate=@{Subject='${signer}'}} }
 try { $installation=(& { ${windowsDiscoveryAndVerificationScript(files)} } | ConvertFrom-Json); @{installation=$installation;seen=@($seen.ToArray())} | ConvertTo-Json -Depth 5 -Compress } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
 return exec(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script,"utf16le").toString("base64")], { timeout: 15_000, windowsHide: true });
}

test("one discovery/signature script checks every deployed executable and the app", { skip: process.platform !== "win32" }, async () => {
 const { stdout } = await run();
 const result = JSON.parse(stdout);
 assert.deepEqual(result.seen, [...files, "C:\\official-app\\app\\ChatGPT.exe"]);
 assert.equal(result.installation.resources, "C:\\official-app\\app\\resources");
 assert.ok(Number.isFinite(result.installation.discoveryMs));
 assert.ok(Number.isFinite(result.installation.authenticodeMs));
});

test("combined script rejects a real unsigned executable using Windows Authenticode", { skip: process.platform !== "win32" }, async () => {
 const root = await mkdtemp(path.join(tmpdir(), "unsigned-cu-test-"));
 try {
  const file = path.join(root, "unsigned.exe");
  await writeFile(file, "not a signed executable");
  const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); function Get-AppxPackage { @{InstallLocation='C:\\unused'} }; try { ${windowsDiscoveryAndVerificationScript([file])} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  await assert.rejects(exec(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script,"utf16le").toString("base64")], { timeout: 15_000, windowsHide: true }), /signature verification failed/);
 } finally { await rm(root, { recursive: true, force: true }); }
});

test("combined discovery fails closed for invalid signature, wrong signer, or missing app", { skip: process.platform !== "win32" }, async () => {
 await assert.rejects(run("NotSigned"), /signature verification failed/);
 await assert.rejects(run("Valid", "CN=Someone Else"), /signature verification failed/);
 await assert.rejects(run("Valid", "CN=OpenAI OpCo, LLC", false), /Install the official/);
});
