import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildZeroModelAppServerArgs, type DirectBrokerElicitationRequest } from "./direct-broker.ts";
import type { DirectResponse, DirectServiceDependencies } from "./direct-service.ts";
import type { CodeSessionExecutor, ComputerUseMethod } from "./code-executor.ts";
import type { JsonObject, JsonValue } from "./tools.ts";
import { WINDOWS_COMPUTER_USE_METHODS, WINDOWS_TOOL_SCHEMAS } from "./windows-tools.ts";
import { inspectWindowsRuntime, windowsPowerShell } from "./windows-runtime.ts";
import { appendAudit } from "./audit.ts";
import { PACKAGE_VERSION } from "./version.ts";
import { makePrivateDirectory } from "./private-directory.ts";

class WindowsSessionCancelled extends Error {}

const objectSchema = z.record(z.string(), z.json());
const resultSchema = z.object({ content: z.array(objectSchema), isError: z.boolean().optional() });
const messageSchema = z.object({ id: z.union([z.string(), z.number()]).optional(), method: z.string().optional(), params: z.json().optional(), result: z.json().optional(), error: z.object({ message: z.string() }).passthrough().optional() });
const elicitationSchema = z.object({ mode: z.string().optional(), message: z.string().optional(), requestedSchema: z.json().optional(), url: z.string().optional(), elicitationId: z.string().optional(), _meta: z.json().optional() }).catchall(z.json());

export type WindowsSessionPhase = "runtimeVerification" | "privateDirectory" | "initialize" | "threadStart" | "replSetup" | "firstCall" | "turnEnded" | "processCleanup";

interface WindowsSessionOptions {
	/** Test-only external protocol producer. Pi never supplies this override. */
	testProcess?: { command: string; args: string[] };
	timeoutMs?: number;
	/** Metadata only, emitted by this connection's actual verification (including failure). */
	onRuntimeStatus?: (status: JsonObject) => void;
	/** Durations only: no selectors, arguments, screenshots or pipe identifiers. */
	onTiming?: (phase: WindowsSessionPhase, durationMs: number) => void;
}

function tomlTable(values: Record<string, string>): string {
	return `{ ${Object.entries(values).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`).join(", ")} }`;
}

interface Connection {
	process: ChildProcessWithoutNullStreams;
	closed: Promise<void>;
	root: string;
	threadId: string;
	brokerVersion: string;
	clientBuild: string;
	modelTurnsStarted: number;
	elicitationRequests: number;
	request(method: string, params: JsonValue, timeoutMs?: number): Promise<JsonValue>;
	stop(error: Error): void;
	assertHealthy(): void;
	close(): Promise<void>;
	setElicitation(handler: DirectServiceDependencies["onElicitation"]): void;
}

async function connect(options: WindowsSessionOptions, dependencies: DirectServiceDependencies): Promise<Connection> {
	let phaseStarted = performance.now();
	const mark = (phase: WindowsSessionPhase): void => { const now = performance.now(); options.onTiming?.(phase, Math.round(now - phaseStarted)); phaseStarted = now; };
	dependencies.signal?.throwIfAborted();
	const inspection = options.testProcess ? undefined : await inspectWindowsRuntime();
	mark("runtimeVerification");
	if (inspection) options.onRuntimeStatus?.(inspection.status);
	const runtime = inspection?.runtime;
	if (inspection && !runtime) throw new Error(String(inspection.status.error));
	dependencies.signal?.throwIfAborted();
	const stateParent = runtime ? path.join(runtime.localAppData, "codex-computer-use-mcp", "sessions") : tmpdir();
	await mkdir(stateParent, { recursive: true });
	const root = await makePrivateDirectory(path.join(stateParent, "pi-windows-cu-"));
	mark("privateDirectory");
	const env: NodeJS.ProcessEnv = {};
	for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE"]) {
		if (process.env[key]) env[key] = process.env[key];
	}
	Object.assign(env, { CODEX_HOME: root, HOME: root, NO_COLOR: "1" });
	let command: string;
	let args: string[];
	if (options.testProcess) {
		command = options.testProcess.command;
		args = options.testProcess.args;
	} else {
		if (!runtime) throw new Error("Official Windows runtime was not verified");
		env.PATH = [path.dirname(runtime.codex), path.dirname(runtime.node), path.join(process.env.SystemRoot || "C:\\Windows", "System32")].join(path.delimiter);
		const replEnv = {
			CODEX_HOME: root, CODEX_CLI_PATH: runtime.codex,
			NODE_REPL_NODE_PATH: runtime.node, NODE_REPL_NODE_MODULE_DIRS: runtime.moduleDir,
			NODE_REPL_TRUSTED_CODE_PATHS: runtime.moduleDir,
			NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ sky: "@oai/sky/service" }),
			NODE_REPL_DISABLE_ANALYTICS: "1",
			SKY_CUA_NATIVE_PIPE: "1", SKY_CUA_NATIVE_PIPE_DIRECTORY: runtime.nativePipe,
		};
		command = runtime.codex;
		args = buildZeroModelAppServerArgs(`{ node_repl = { command = ${JSON.stringify(runtime.repl)}, args = [], cwd = ${JSON.stringify(root)}, env = ${tomlTable(replEnv)}, startup_timeout_sec = 30, tool_timeout_sec = 120 } }`);
	}
	let child: ChildProcessWithoutNullStreams;
	try {
		dependencies.signal?.throwIfAborted();
		child = process.platform === "win32"
			? spawn(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL("./windows-job.ps1", import.meta.url)), "-CommandPath", command, "-ArgumentsJson", JSON.stringify(args), "-WorkingDirectory", root, "-ParentPid", String(process.pid)], { cwd: root, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
			: spawn(command, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}
	let nextId = 1;
	let fatal: Error | undefined;
	let closing: Promise<void> | undefined;
	let elicitation = dependencies.onElicitation;
	let stderr = "";
	const pending = new Map<string, { resolve(value: JsonValue): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
	const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
	const send = (message: JsonValue): void => { child.stdin.write(`${JSON.stringify(message)}\n`); };
	const stop = (error: Error): void => {
		fatal ??= error;
		for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(fatal); }
		pending.clear();
		child.kill(); // Closing the launcher process closes its kill-on-close Windows Job Object.
	};
	const request = (method: string, params: JsonValue, timeoutMs = options.timeoutMs ?? 120_000): Promise<JsonValue> => {
		if (fatal) return Promise.reject(fatal);
		return new Promise((resolve, reject) => {
			const id = String(nextId++);
			const timer = setTimeout(() => stop(new Error(`Official Windows request timed out: ${method}`)), timeoutMs);
			pending.set(id, { resolve, reject, timer });
			send({ id, method, params });
		});
	};
	child.stdin.on("error", (error) => stop(error));
	child.on("error", (error) => stop(error));
	child.once("exit", () => { if (!closing) stop(new Error(`Official Windows app-server exited${stderr ? ": " + stderr.slice(-1000) : ""}`)); });
	child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 4000) stderr += chunk.toString().slice(0, 4000 - stderr.length); });
	createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
		try {
			const message = messageSchema.parse(JSON.parse(line));
			if (message.method?.startsWith("turn/") || message.method?.startsWith("item/")) {
				connection.modelTurnsStarted += 1;
				stop(new Error("Official app-server emitted forbidden model-turn activity"));
				return;
			}
			if (message.id !== undefined && (message.result !== undefined || message.error)) {
				const waiter = pending.get(String(message.id));
				if (!waiter) return;
				pending.delete(String(message.id)); clearTimeout(waiter.timer);
				if (message.error) waiter.reject(new Error(message.error.message));
				else waiter.resolve(message.result ?? null);
			} else if (message.id !== undefined && message.method) {
				if (message.method !== "mcpServer/elicitation/request") {
					send({ id: message.id, error: { code: -32601, message: "Unsupported server request" } });
					return;
				}
				connection.elicitationRequests += 1;
				const params: DirectBrokerElicitationRequest = elicitationSchema.parse(message.params);
				void Promise.resolve().then(() => elicitation?.(params) ?? { action: "cancel" }).catch(() => ({ action: "cancel" })).then((result) => {
					if (!fatal && !closing) send({ id: message.id ?? null, result: { ...result } });
				});
			}
		} catch (error) { stop(error instanceof Error ? error : new Error(String(error))); }
	});
	const connection: Connection = {
		process: child, closed, root, threadId: "", request, stop,
		brokerVersion: runtime?.brokerVersion ?? "test-producer", clientBuild: runtime?.version ?? "test-producer", modelTurnsStarted: 0, elicitationRequests: 0,
		assertHealthy() { if (fatal) throw fatal; },
		setElicitation(handler) { elicitation = handler; },
		close() {
			closing ??= (async () => {
				const endingStarted = performance.now();
				if (!fatal && connection.threadId) {
					try {
						await request("mcpServer/tool/call", { threadId: connection.threadId, server: "node_repl", tool: "turn_ended", arguments: { hook_event_name: "Stop", session_id: connection.threadId, turn_id: connection.threadId } }, 2000);
					} catch { /* A stopped runtime is still terminated through its job. */ }
				}
				const cleanupStarted = performance.now();
				options.onTiming?.("turnEnded", Math.round(cleanupStarted - endingStarted));
				const failure = fatal;
				stop(new Error("Official Windows session closed"));
				let timer: NodeJS.Timeout | undefined;
				try {
					await Promise.race([closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Official Windows job did not close")), 10_000); })]);
				} finally { clearTimeout(timer); }
				await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
				options.onTiming?.("processCleanup", Math.round(performance.now() - cleanupStarted));
				if (failure && !(failure instanceof WindowsSessionCancelled)) throw failure;
			})();
			return closing;
		},
	};
	const abort = (): void => stop(new WindowsSessionCancelled("Official Windows session cancelled"));
	dependencies.signal?.addEventListener("abort", abort, { once: true });
	try {
		dependencies.signal?.throwIfAborted();
		await request("initialize", { clientInfo: { name: "pi_windows_computer_use", version: PACKAGE_VERSION }, capabilities: { mcpServerOpenaiFormElicitation: dependencies.supportsOpenAiFormElicitation === true } }, 30_000);
		mark("initialize");
		send({ method: "initialized" });
		const started = z.object({ thread: z.object({ id: z.string() }) }).parse(await request("thread/start", { cwd: root, approvalPolicy: "never", sandbox: "danger-full-access", ephemeral: true }, 30_000));
		mark("threadStart");
		connection.threadId = started.thread.id;
		const boot = resultSchema.parse(await request("mcpServer/tool/call", { threadId: connection.threadId, server: "node_repl", tool: "js", arguments: { code: 'var sky = (await import("@oai/sky")).sky;' } }));
		mark("replSetup");
		if (boot.isError) throw new Error(boot.content.map((block) => String(block.text ?? "")).join("\n"));
		return connection;
	} catch (error) {
		await connection.close();
		throw error;
	} finally { dependencies.signal?.removeEventListener("abort", abort); }
}

/** Keeps the official REPL/session; model-authored code remains in our existing cancellable code worker. */
export class WindowsSessionExecutor implements CodeSessionExecutor {
	private connection?: Connection;
	private opening?: Promise<Connection>;
	private queue = Promise.resolve();
	private epoch = 0;
	private readonly options: WindowsSessionOptions;
	constructor(options: WindowsSessionOptions = {}) { this.options = options; }

	execute(method: ComputerUseMethod, args: JsonObject, dependencies: DirectServiceDependencies): Promise<DirectResponse> {
		const epoch = this.epoch;
		const result = this.queue.then(() => {
			if (epoch !== this.epoch) throw new Error("Official Windows session closed before queued call");
			return this.dispatch(method, args, dependencies);
		});
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}

	private async dispatch(method: ComputerUseMethod, args: JsonObject, dependencies: DirectServiceDependencies): Promise<DirectResponse> {
		const epoch = this.epoch;
		const officialMethod = z.enum(WINDOWS_COMPUTER_USE_METHODS).parse(method);
		const validatedArgs = WINDOWS_TOOL_SCHEMAS[officialMethod].parse(args);
		dependencies.signal?.throwIfAborted();
		const firstCall = !this.connection;
		if (!this.connection) {
			this.opening = connect(this.options, dependencies);
			try { this.connection = await this.opening; }
			finally { this.opening = undefined; }
		}
		const connection = this.connection;
		if (epoch !== this.epoch) { await this.close(); throw new Error("Official Windows session closed during startup"); }
		const started = Date.now();
		let outcome = "broker_failed";
		let response: DirectResponse | undefined;
		connection.elicitationRequests = 0;
		connection.setElicitation(dependencies.onElicitation);
		const abort = (): void => connection.stop(new WindowsSessionCancelled("Official Windows session cancelled"));
		dependencies.signal?.addEventListener("abort", abort, { once: true });
		try {
			dependencies.signal?.throwIfAborted();
			const marker = `pi-result-${randomUUID()}:`;
			const code = `{ const value = await sky[${JSON.stringify(officialMethod)}](${JSON.stringify(validatedArgs)}); ${officialMethod === "get_window_state" ? 'for (const shot of value.screenshots) delete shot.url;' : ""} nodeRepl.write(${JSON.stringify(marker)} + JSON.stringify(value ?? null)); }`;
			const callStarted = performance.now();
			const raw = resultSchema.parse(await connection.request("mcpServer/tool/call", { threadId: connection.threadId, server: "node_repl", tool: "js", arguments: { code } }));
			if (firstCall) this.options.onTiming?.("firstCall", Math.round(performance.now() - callStarted));
			await new Promise<void>((resolve) => setImmediate(resolve));
			connection.assertHealthy();
			if (raw.isError) {
				await this.close();
				outcome = "official_error";
				response = { isError: true, content: raw.content };
				return response;
			}
			const encoded = raw.content.find((block) => block.type === "text" && z.string().safeParse(block.text).success && String(block.text).startsWith(marker));
			if (!encoded) throw new Error("Official Windows method did not return its result");
			const value = z.json().parse(JSON.parse(String(encoded.text).slice(marker.length)));
			outcome = "ok";
			response = { isError: false, content: raw.content.filter((block) => block !== encoded), structuredContent: value };
			return response;
		} catch (error) {
			await this.close();
			throw error;
		} finally {
			dependencies.signal?.removeEventListener("abort", abort);
			if (dependencies.stateRoot) await appendAudit(dependencies.stateRoot, {
				timestamp: new Date().toISOString(), runId: randomUUID(), method: officialMethod, app: null,
				inputBytes: Buffer.byteLength(JSON.stringify(validatedArgs)), outcome: dependencies.signal?.aborted ? "cancelled" : outcome,
				durationMs: Date.now() - started, brokerVersion: connection.brokerVersion, clientBuild: connection.clientBuild,
				directCalls: response ? 1 : 0, modelTurnsStarted: connection.modelTurnsStarted, ephemeralThread: true,
				elicitationRequests: connection.elicitationRequests, brokerCleanupVerified: false,
				resultContentTypes: [...new Set(response?.content.map((block) => String(block.type)) ?? [])],
				resultBytes: response ? Buffer.byteLength(JSON.stringify(response)) : 0,
			});
		}
	}

	async close(): Promise<void> {
		this.epoch += 1;
		const connection = this.connection;
		this.connection = undefined;
		if (connection) await connection.close();
		else if (this.opening) {
			let opened: Connection;
			try { opened = await this.opening; }
			catch { return; } // Failed initialization performs its own cleanup.
			if (this.connection === opened) this.connection = undefined;
			await opened.close();
		}
	}
}
