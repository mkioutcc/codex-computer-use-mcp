import { WindowsSessionExecutor } from "./windows-session.ts";
import type { CodeSessionExecutor } from "./code-executor.ts";
import type { JsonObject } from "./tools.ts";

/** Uses the production transport; never returns app titles or window contents. Owns and closes its session. */
export async function probeWindowsConnection(session: CodeSessionExecutor = new WindowsSessionExecutor(), signal?: AbortSignal): Promise<JsonObject> {
	const started = performance.now();
	let result: JsonObject;
	try {
		const response = await session.execute("list_windows", {}, { signal });
		if (response.isError) throw new Error("Official list_windows returned an error");
		if (!Array.isArray(response.structuredContent)) throw new Error("Official list_windows did not return a window array");
		result = { connectionReady: true, windowCount: response.structuredContent.length, probeMs: Math.round(performance.now() - started) };
	} catch (error) {
		result = { connectionReady: false, error: error instanceof Error ? error.message : String(error), probeMs: Math.round(performance.now() - started) };
	}
	try { await session.close(); }
	catch (error) { result.connectionReady = false; result.cleanupError = error instanceof Error ? error.message : String(error); }
	return result;
}
