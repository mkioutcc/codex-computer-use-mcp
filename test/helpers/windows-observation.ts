import { setTimeout } from "node:timers/promises";

// Acceptance helpers only. They do not rewrite the production API or retry desktop inputs.
export function uniqueElementIndex(tree: string, pattern: RegExp): number {
	const indexes = new Set<number>();
	for (const line of tree.split("\n")) {
		if (!pattern.test(line)) continue;
		const index = line.match(/^\s*(\d+)\s/);
		if (index) indexes.add(Number(index[1]));
	}
	if (indexes.size !== 1) throw new Error("Expected a unique observed element index");
	return [...indexes][0];
}

export function onlyWindow<T extends { app: string; id: number }>(windows: readonly T[]): T {
	if (windows.length !== 1) throw new Error("Expected exactly one returned target window");
	return windows[0];
}

export async function waitForObservation<T>(observe: () => Promise<T>, ready: (value: T) => boolean, { attempts = 6, intervalMs = 150, signal, stableKey }: { attempts?: number; intervalMs?: number; signal?: AbortSignal; stableKey?: (value: T) => string } = {}): Promise<T> {
	let previousKey: string | undefined;
	for (let attempt = 0; attempt < attempts; attempt++) {
		signal?.throwIfAborted();
		const value = await observe();
		signal?.throwIfAborted();
		if (ready(value)) {
			if (!stableKey) return value;
			const key = stableKey(value);
			if (key === previousKey) return value;
			previousKey = key;
		} else previousKey = undefined;
		if (attempt + 1 < attempts) await setTimeout(intervalMs, undefined, { signal });
	}
	throw new Error("Observed state did not become ready; do not replay the input");
}
