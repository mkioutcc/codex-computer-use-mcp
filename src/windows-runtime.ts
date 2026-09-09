import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { PACKAGE_VERSION } from "./version.ts";
import { readFile, readdir, realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { WINDOWS_COMPUTER_USE_METHODS } from "./windows-tools.ts";
import type { JsonObject } from "./tools.ts";

const execFileAsync = promisify(execFile);
const installationSchema = z.object({ resources: z.string(), localAppData: z.string() });
const configSchema = z.object({ mcpServers: z.object({ cua_repl: z.object({ env: z.record(z.string(), z.string()) }) }) });

export interface WindowsRuntime {
	codex: string;
	node: string;
	repl: string;
	moduleDir: string;
	nativePipe: string;
	localAppData: string;
	version: string;
	brokerVersion: string;
	timingsMs: Record<string, number>;
}

export function windowsPowerShell(): string {
	return path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

async function powershell(script: string): Promise<string> {
	const wrapped = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); try { ${script} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
	try {
		const { stdout } = await execFileAsync(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(wrapped, "utf16le").toString("base64")], { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
		return stdout.trim();
	} catch (error) {
		const result = z.object({ stderr: z.string().optional(), killed: z.boolean().optional() }).safeParse(error);
		throw new Error(`Windows runtime PowerShell: ${result.success ? (result.data.stderr?.trim().slice(0, 2000) || (result.data.killed ? "timed out" : "process failed")) : "could not start"}`);
	}
}

async function canonical(file: string): Promise<string> {
	const resolved = await realpath(file);
	if (resolved.toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error("Official Windows runtime path must not redirect outside its installed layout");
	return resolved;
}

export async function verifySkyDirectory(installed: string, bundled: string): Promise<void> {
	const files: Array<[string, string]> = [];
	async function collect(localDir: string, sourceDir: string): Promise<void> {
		for (const entry of await readdir(localDir, { withFileTypes: true })) {
			const local = path.join(localDir, entry.name), source = path.join(sourceDir, entry.name);
			if (entry.isSymbolicLink()) throw new Error("Official Sky runtime must not contain redirected files");
			if (entry.isDirectory()) await collect(local, source);
			else files.push([local, source]);
		}
	}
	await collect(installed, bundled);
	// Eight bounded readers, no cached trust: every deployed file is still compared byte-for-byte.
	let next = 0;
	const readers = await Promise.allSettled(Array.from({ length: Math.min(8, files.length) }, async () => {
		while (next < files.length) {
			const [local, source] = files[next++];
			const [localBytes, sourceBytes] = await Promise.all([readFile(local), readFile(source)]);
			if (!localBytes.equals(sourceBytes)) throw new Error("Official Sky runtime differs from the app-bundled component; reopen or update the official app");
		}
	}));
	for (const reader of readers) if (reader.status === "rejected") throw reader.reason;
}

export async function getWindowsStatus(): Promise<JsonObject> {
	return (await inspectWindowsRuntime()).status;
}

/** Resolve and report the same verification; no reusable trust cache or runtime override. */
export async function inspectWindowsRuntime(): Promise<{ runtime?: WindowsRuntime; status: JsonObject }> {
	const started = performance.now();
	const identity = { adapterVersion: PACKAGE_VERSION, runtimeSource: import.meta.url, runtimeImplementation: createHash("sha256").update(resolveWindowsRuntime.toString() + powershell.toString() + verifySkyDirectory.toString()).digest("hex").slice(0, 16), connectionReady: null };
	try {
		const runtime = await resolveWindowsRuntime();
		return { runtime, status: { ...identity, verificationMs: Math.round(performance.now() - started), platform: "win32", permissionMode: "no-permissions", runtimeVerified: true, brokerVersion: runtime.brokerVersion, timingsMs: runtime.timingsMs, pluginVersion: runtime.version, appMustRemainOpen: true, methods: [...WINDOWS_COMPUTER_USE_METHODS] } };
	} catch (error) {
		return { status: { ...identity, verificationMs: Math.round(performance.now() - started), platform: "win32", permissionMode: "no-permissions", runtimeVerified: false, error: error instanceof Error ? error.message : String(error), methods: [...WINDOWS_COMPUTER_USE_METHODS] } };
	}
}

/** Read only the app-generated deployment configuration; never copy its credentials or arbitrary commands. */
export async function resolveWindowsRuntime(): Promise<WindowsRuntime> {
	const timingsMs: Record<string, number> = {};
	let phaseStarted = performance.now();
	const mark = (phase: string): void => { const now = performance.now(); timingsMs[phase] = Math.round(now - phaseStarted); phaseStarted = now; };
	if (process.platform !== "win32") throw new Error("Official Windows Computer Use requires Windows");
	const installation = installationSchema.parse(JSON.parse(await powershell(`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $p=Get-AppxPackage OpenAI.Codex; if(-not $p){throw 'Install the official Codex Windows app first'}; @{resources=(Join-Path $p.InstallLocation 'app\\resources');localAppData=[Environment]::GetFolderPath('LocalApplicationData')} | ConvertTo-Json -Compress`)));
	mark("appDiscovery");
	const cache = path.join(userInfo().homedir, ".codex", "plugins", "cache", "openai-bundled", "unified-computer-use");
	let versions: string[];
	try { versions = (await readdir(cache)).filter((name) => /^\d+(?:\.\d+)+$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); }
	catch { throw new Error("Open the official Codex app and start a working conversation to deploy its Computer Use runtime"); }
	const version = versions[0];
	if (!version) throw new Error("The official app has not deployed a Computer Use configuration");
	const configFile = await canonical(path.join(cache, version, ".mcp.json"));
	const env = configSchema.parse(JSON.parse(await readFile(configFile, "utf8"))).mcpServers.cua_repl.env;
	const deployedRoot = path.join(installation.localAppData, "OpenAI", "Codex");
	const codex = await canonical(env.CODEX_CLI_PATH || "");
	const node = await canonical(env.NODE_REPL_NODE_PATH || "");
	const repl = await canonical(env.CUA_REPL_NODE_REPL_PATH || "");
	const relativeCodex = path.relative(deployedRoot, codex);
	const relativeNode = path.relative(deployedRoot, node);
	if (!/^bin[\\/]\w+[\\/]codex\.exe$/i.test(relativeCodex) || !/^runtimes[\\/]cua_node[\\/]\w+[\\/]bin[\\/]node\.exe$/i.test(relativeNode) || repl.toLowerCase() !== path.join(path.dirname(node), "node_repl.exe").toLowerCase()) {
		throw new Error("Official Windows runtime was not found in the app-managed deployment layout");
	}
	const nativePipe = env.SKY_CUA_NATIVE_PIPE_DIRECTORY;
	if (env.SKY_CUA_NATIVE_PIPE !== "1" || !/^\\\\\.\\pipe\\codex-computer-use-[0-9a-f-]{36}$/i.test(nativePipe || "")) throw new Error("The official app has not provided its Computer Use native pipe; reopen a conversation in the app");
	const moduleDir = await canonical(path.join(path.dirname(node), "node_modules"));
	const sky = path.join(moduleDir, "@oai", "sky");
	mark("deploymentConfig");
	const executables = [codex, node, repl, path.join(installation.resources, "..", "ChatGPT.exe"), path.join(sky, "bin", "windows", "codex-computer-use.exe")];
	const quoted = executables.map((file) => `'${file.replaceAll("'", "''")}'`).join(",");
	await powershell(`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $modulePath=Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\Modules'; $env:PSModulePath=$modulePath; if(-not (Test-Path (Join-Path $modulePath 'Microsoft.PowerShell.Security'))){throw 'Windows PowerShell security module is missing'}; Import-Module (Join-Path $modulePath 'Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; foreach($f in @(${quoted})){ $s=Get-AuthenticodeSignature -LiteralPath $f; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'CN="?OpenAI OpCo, LLC"?(,|$)'){throw 'Official Windows runtime signature verification failed'} }`);
	mark("authenticode");
	await verifySkyDirectory(sky, path.join(installation.resources, "cua_node", "bin", "node_modules", "@oai", "sky"));
	mark("skyComparison");
	const { stdout } = await execFileAsync(codex, ["--version"], { timeout: 10_000, windowsHide: true });
	const brokerVersion = stdout.trim();
	if (!/^codex-cli \d+\./.test(brokerVersion)) throw new Error("Could not verify the official Windows app-server version");
	mark("brokerVersion");
	return { codex, node, repl, moduleDir, nativePipe, localAppData: installation.localAppData, version, brokerVersion, timingsMs };
}
