import { execFile } from "node:child_process";
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
}

export function windowsPowerShell(): string {
	return path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

async function powershell(script: string): Promise<string> {
	const { stdout } = await execFileAsync(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
	return stdout.trim();
}

async function canonical(file: string): Promise<string> {
	const resolved = await realpath(file);
	if (resolved.toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error("Official Windows runtime path must not redirect outside its installed layout");
	return resolved;
}

async function verifySkyDirectory(installed: string, bundled: string): Promise<void> {
	for (const entry of await readdir(installed, { withFileTypes: true })) {
		const local = path.join(installed, entry.name);
		const source = path.join(bundled, entry.name);
		if (entry.isSymbolicLink()) throw new Error("Official Sky runtime must not contain redirected files");
		if (entry.isDirectory()) await verifySkyDirectory(local, source);
		else if (!(await readFile(local)).equals(await readFile(source))) throw new Error("Official Sky runtime differs from the app-bundled component; reopen or update the official app");
	}
}

export async function getWindowsStatus(): Promise<JsonObject> {
	try {
		const runtime = await resolveWindowsRuntime();
		return { platform: "win32", permissionMode: "no-permissions", runtimeVerified: true, pluginVersion: runtime.version, appMustRemainOpen: true, methods: [...WINDOWS_COMPUTER_USE_METHODS] };
	} catch (error) {
		return { platform: "win32", permissionMode: "no-permissions", runtimeVerified: false, error: error instanceof Error ? error.message : String(error), methods: [...WINDOWS_COMPUTER_USE_METHODS] };
	}
}

/** Read only the app-generated deployment configuration; never copy its credentials or arbitrary commands. */
export async function resolveWindowsRuntime(): Promise<WindowsRuntime> {
	if (process.platform !== "win32") throw new Error("Official Windows Computer Use requires Windows");
	const installation = installationSchema.parse(JSON.parse(await powershell(`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $p=Get-AppxPackage OpenAI.Codex; if(-not $p){throw 'Install the official Codex Windows app first'}; @{resources=(Join-Path $p.InstallLocation 'app\\resources');localAppData=[Environment]::GetFolderPath('LocalApplicationData')} | ConvertTo-Json -Compress`)));
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
	const executables = [codex, node, repl, path.join(installation.resources, "..", "ChatGPT.exe"), path.join(sky, "bin", "windows", "codex-computer-use.exe")];
	const quoted = executables.map((file) => `'${file.replaceAll("'", "''")}'`).join(",");
	await powershell(`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $modulePath=Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\Modules'; $env:PSModulePath=$modulePath; if(-not (Test-Path (Join-Path $modulePath 'Microsoft.PowerShell.Security'))){throw 'Windows PowerShell security module is missing'}; Import-Module (Join-Path $modulePath 'Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; foreach($f in @(${quoted})){ $s=Get-AuthenticodeSignature -LiteralPath $f; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'CN="?OpenAI OpCo, LLC"?(,|$)'){throw 'Official Windows runtime signature verification failed'} }`);
	await verifySkyDirectory(sky, path.join(installation.resources, "cua_node", "bin", "node_modules", "@oai", "sky"));
	const { stdout } = await execFileAsync(codex, ["--version"], { timeout: 10_000, windowsHide: true });
	const brokerVersion = stdout.trim();
	if (!/^codex-cli \d+\./.test(brokerVersion)) throw new Error("Could not verify the official Windows app-server version");
	return { codex, node, repl, moduleDir, nativePipe, localAppData: installation.localAppData, version, brokerVersion };
}
