#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
	type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getDirectStatus } from "./direct-service.ts";
import { forwardOfficialElicitationToMcpClient } from "./mcp-elicitation.ts";
import { DirectSessionExecutor } from "./session-executor.ts";
import {
	COMPUTER_USE_METHODS,
	TOOL_INPUT_SCHEMAS,
	TOOL_METADATA,
	isDirectMethod,
} from "./tools.ts";
import { PACKAGE_VERSION } from "./version.ts";
import { WindowsSessionExecutor } from "./windows-session.ts";
import { WINDOWS_TOOL_DEFINITIONS, isWindowsMethod } from "./windows-tools.ts";
import { getWindowsStatus } from "./windows-runtime.ts";
import { probeWindowsConnection } from "./windows-diagnostics.ts";
import type { CodeSessionExecutor } from "./code-executor.ts";
import { homedir } from "node:os";
import path from "node:path";

const windows = process.platform === "win32";
const status = async (probe = false, signal?: AbortSignal) => {
	const result = windows ? await getWindowsStatus() : getDirectStatus();
	if (probe && windows && result.runtimeVerified === true) Object.assign(result, await probeWindowsConnection(undefined, signal));
	return result;
};

const cliArgs = process.argv.slice(2);
if (cliArgs.length > 0) {
	if (cliArgs.length === 1 && ["--status", "--probe"].includes(cliArgs[0])) {
		const result = await status(cliArgs[0] === "--probe");
		console.log(JSON.stringify(result, null, 2));
		if (cliArgs[0] === "--probe" && result.connectionReady !== true) process.exit(1);
		process.exit(0);
	}
	console.error("Usage: codex-computer-use-mcp [--status|--probe]");
	process.exit(1);
}

const server = new Server(
	{ name: "codex-computer-use-mcp", version: PACKAGE_VERSION },
	{ capabilities: { tools: {} } },
);
const sessionExecutor: CodeSessionExecutor = windows ? new WindowsSessionExecutor() : new DirectSessionExecutor({ idleTimeoutMs: 120_000 });
server.onclose = () => {
	void sessionExecutor.close().catch(() => { process.exitCode = 1; });
};

const toolDefinitions = windows ? WINDOWS_TOOL_DEFINITIONS : COMPUTER_USE_METHODS.map((method) => ({
	name: method,
	description: TOOL_METADATA[method].description,
	inputSchema: TOOL_INPUT_SCHEMAS[method],
	annotations: TOOL_METADATA[method].annotations,
}));
const statusToolDefinition = {
	name: "computer_use_status",
	title: "Computer Use Status",
	description: "Show Computer Use status.",
	inputSchema: { type: "object" as const, properties: { probe: { type: "boolean", description: "Run a live Windows connection probe (no desktop input)." } }, additionalProperties: false },
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({
	tools: [...toolDefinitions, statusToolDefinition],
}));

server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
	if (request.params.name === statusToolDefinition.name) {
		const { probe } = z.object({ probe: z.boolean().optional() }).parse(request.params.arguments ?? {});
		const currentStatus = await status(probe, extra.signal);
		const result: CallToolResult = { content: [{ type: "text", text: JSON.stringify(currentStatus, null, 2) }], structuredContent: currentStatus };
		if (probe) result.isError = currentStatus.connectionReady !== true;
		return result;
	}
	const method = request.params.name;
	const isMethod = windows ? isWindowsMethod : isDirectMethod;
	if (!isMethod(method)) {
		throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
	}

	try {
		const args = z.record(z.string(), z.json()).parse(request.params.arguments ?? {});
		const response = await sessionExecutor.execute(method, args, {
			stateRoot: process.env.CODEX_COMPUTER_USE_HOME || path.join(homedir(), ".direct-computer-use"),
			signal: extra.signal,
			onElicitation: (elicitation) => forwardOfficialElicitationToMcpClient(server, elicitation, extra.signal),
		});
		if (windows && response.structuredContent !== undefined) {
			response.content.unshift({ type: "text", text: JSON.stringify(response.structuredContent, null, 2) });
		}
		const result: CallToolResult = {
			// SAFETY: app-server returns MCP CallToolResult content blocks; the broker already verifies the JSON object envelope.
			content: response.content as CallToolResult["content"],
			isError: response.isError,
		};
		const structuredContent = z.record(z.string(), z.json()).safeParse(response.structuredContent);
		if (structuredContent.success) result.structuredContent = structuredContent.data;
		return result;
	} catch (error) {
		return {
			content: [{ type: "text", text: error instanceof Error ? error.message : "Direct Computer Use failed" }],
			isError: true,
		};
	}
});

await server.connect(new StdioServerTransport());
