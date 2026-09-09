import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import adapter from "../integrations/pi/index.ts";

// Explicit opt-in: registered Pi tool + real official runtime, not a desktop fixture.
test("live Windows Pi: discovery, screenshot, new editor tab and exact text readback", { skip: process.env.COMPUTER_USE_LIVE_UI !== "1" || process.platform !== "win32", timeout: 180_000 }, async () => {
	let tool: any;
	const handlers = new Map<string, any>();
	// SAFETY: only ExtensionAPI registration is captured; executor, worker and official UI are real.
	adapter({ registerTool(value: any) { tool = value; }, registerCommand() {}, on(name: string, handler: any) { handlers.set(name, handler); } } as any);
	let counter = 0;
	const call = async (code: string) => {
		const result = await tool.execute(`live-${++counter}`, { code }, undefined, undefined, { hasUI: false });
		const patch = handlers.get("tool_result")?.({ toolName: "computer_use", ...result, isError: false });
		assert.notEqual(patch?.isError, true, result.details.error);
		assert.equal(result.details.ok, true);
		return result;
	};
	const observe = () => call('const s=await sky.get_window_state({window:store.window,include_text:true,include_screenshot:true}); store.window=s.window; store.tree=s.accessibility?.tree ?? ""; store.focus=s.accessibility?.focused_element ?? ""; emit({title:s.window.title,tree:store.tree,focus:store.focus}); for(const shot of s.screenshots) emitImage(shot.url);');
	const textState = (result: any) => JSON.parse(result.content.find((b: any) => b.type === "text").text);
	try {
		await call('const apps=await sky.list_apps(); const matches=apps.filter(a=>a.displayName==="Notepad++"); if(matches.length!==1 || matches[0].windows.length!==1) throw new Error("Open exactly one Notepad++ window for live acceptance"); store.window=matches[0].windows[0];');
		await observe();
		await setTimeout(300);
		const before = await observe();
		assert.ok(before.content.some((b: any) => b.type === "image" && b.data.length > 0));
		await call(String.raw`if(!store.tree.split('\n').some(l=>/ID: 41001$/.test(l))) { const ids=[...new Set(store.tree.split('\n').filter(l=>/功能表項目 檔案\(F\)|MenuItem File/i.test(l)).map(l=>Number(l.trim().match(/^\d+/)[0])))]; if(ids.length!==1) throw new Error("Unique File menu not observed"); await sky.click({window:store.window,element_index:ids[0]}); }`);
		await observe();
		await setTimeout(300);
		await observe();
		await call(String.raw`const ids=[...new Set(store.tree.split('\n').filter(l=>/ID: 41001$/.test(l)).map(l=>Number(l.trim().match(/^\d+/)[0])))]; if(ids.length!==1) throw new Error("Unique New document menu not observed"); await sky.click({window:store.window,element_index:ids[0]});`);
		let fresh;
		for (let i=0;i<4;i++) {
			fresh = textState(await observe());
			if(fresh.title !== textState(before).title && /^(新文件|new |無標題|Untitled)/i.test(fresh.title) && /長度：0\b|length\s*:\s*0\b/i.test(fresh.tree) && /^\d+ (窗格|pane)\s*$/i.test(fresh.focus)) break;
			await setTimeout(200);
		}
		assert.notEqual(fresh.title, textState(before).title);
		assert.match(fresh.title, /^(新文件|new |無標題|Untitled)/i);
		assert.match(fresh.tree, /長度：0\b|length\s*:\s*0\b/i);
		assert.match(fresh.focus, /^\d+ (窗格|pane)\s*$/i);
		const marker = `Pi CU live acceptance ${randomUUID()}`;
		await call(`await sky.type_text({window:store.window,text:${JSON.stringify(marker)}});`);
		let after;
		for(let i=0;i<4;i++) { after=await observe(); if(textState(after).tree.includes(marker)) break; await setTimeout(200); }
		assert.ok(textState(after).tree.includes(marker), "Exact marker must appear in accessibility, not just a truncated title");
		assert.ok(after.content.some((b: any) => b.type === "image" && b.data.length > 0));
		// Leave the newly-created unsaved test tab for inspection. Never save or close existing documents.
	} finally { await handlers.get("session_shutdown")(); }
});
