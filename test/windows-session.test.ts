import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { WindowsSessionExecutor } from "../src/windows-session.ts";

async function fixture(mode = "ok") {
	const root = await mkdtemp(path.join(os.tmpdir(), "windows-session-test-"));
	const script = path.join(root, "official-protocol-fixture.mjs");
	await writeFile(script, `
import readline from 'node:readline';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
const mode=process.argv[2];
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
let called=0, waiting;
const child=mode==='child'?spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}):null;
const sky={list_apps:async()=>mode==='env'?{hasApiKey:Boolean(process.env.OPENAI_API_KEY),home:process.env.CODEX_HOME}:[{id:'notepad',windows:[{app:'notepad',id:123}]}],get_window:async(args)=>({...args,seen:++called,...(child?{childPid:child.pid}:{})})};
readline.createInterface({input:process.stdin}).on('line',async line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize')return send({id:m.id,result:{}});
 if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'fixture-thread'}}});
 if(m.method==='turn/start')throw Error('Unexpected model turn');
 if(m.id==='approval')return send({id:waiting,result:{content:[{type:'text',text:JSON.stringify(m.result)}],isError:true}});
 if(m.method==='mcpServer/tool/call'){
  const content=[];
  if(m.params.tool==='js'){
   const code=m.params.arguments.code;
   if(!code.includes('import(')) {
    if(mode==='elicit'){waiting=m.id;return send({id:'approval',method:'mcpServer/elicitation/request',params:{mode:'form',message:'Official approval',requestedSchema:{type:'object'},_meta:{source:'official'}}});}
    if(mode==='hang')return;
    await vm.runInNewContext('(async()=>{'+code+'})()',{sky,nodeRepl:{write:text=>content.push({type:'text',text})}});
   }
  }
  send({id:m.id,result:{content,isError:false}});
  if(mode==='model'&&content.length)send({method:'turn/started',params:{}});
 }
});
`);
	const session = new WindowsSessionExecutor({ testProcess: { command: process.execPath, args: [script, mode] }, timeoutMs: 1000 });
	return { session, root, script, async cleanup() { await session.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

test("Windows official session executes methods without a model turn and retains state", async () => {
	const f = await fixture();
	try {
		const apps = await f.session.execute("list_apps", { compatibilityField: "must-not-be-logged" }, { stateRoot: f.root });
		assert.deepEqual(apps.structuredContent, [{ id: "notepad", windows: [{ app: "notepad", id: 123 }] }]);
		assert.deepEqual((await f.session.execute("get_window", { app: "notepad", id: 123, futureArg: "unchanged" }, {})).structuredContent, { app: "notepad", id: 123, futureArg: "unchanged", seen: 1 });
		assert.deepEqual((await f.session.execute("get_window", { app: "notepad", id: 123 }, {})).structuredContent, { app: "notepad", id: 123, seen: 2 });
		await assert.rejects(f.session.execute("get_window", { id: "wrong" }, {}), /number/);
		const audit = await readFile(path.join(f.root, "audit", "direct-computer-use.jsonl"), "utf8");
		assert.doesNotMatch(audit, /must-not-be-logged|fixture-thread|notepad/);
		assert.equal(JSON.parse(audit.trim()).modelTurnsStarted, 0);
	} finally { await f.cleanup(); }
});

test("Windows official transport uses an isolated credential-free home", async () => {
	const old = process.env.OPENAI_API_KEY;
	process.env.OPENAI_API_KEY = "not-for-the-official-broker";
	const f = await fixture("env");
	try {
		const result = await f.session.execute("list_apps", {}, {});
		const value = z.object({ hasApiKey: z.boolean(), home: z.string() }).parse(result.structuredContent);
		assert.equal(value.hasApiKey, false);
		assert.match(value.home, /pi-windows-cu-/);
		assert.notEqual(value.home, path.join(os.homedir(), ".codex"));
	} finally {
		if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old;
		await f.cleanup();
	}
});

test("concurrent Windows callers share one retained official session", async () => {
	const f = await fixture();
	try {
		const results = await Promise.all([f.session.execute("get_window", { id: 123 }, {}), f.session.execute("get_window", { id: 123 }, {})]);
		assert.deepEqual(results.map((result) => z.object({ seen: z.number() }).parse(result.structuredContent).seen), [1, 2]);
	} finally { await f.cleanup(); }
});

test("Windows forwards official confirmation and cancels rather than auto-approving headless calls", async () => {
	const f = await fixture("elicit");
	try {
		const response = await f.session.execute("list_apps", {}, { onElicitation: async (request) => {
			assert.equal(request.message, "Official approval");
			return { action: "decline" };
		} });
		assert.equal(response.isError, true);
		assert.equal(response.content[0].text, '{"action":"decline"}');
		const headless = await f.session.execute("list_apps", {}, {});
		assert.equal(headless.content[0].text, '{"action":"cancel"}');
	} finally { await f.cleanup(); }
});

test("Windows request timeout terminates the official session", async () => {
	const f = await fixture("hang");
	try { await assert.rejects(f.session.execute("list_apps", {}, {}), /timed out/); }
	finally { await f.cleanup(); }
});

test("Windows job closes detached descendants as well as its root", { skip: process.platform !== "win32" }, async () => {
	const f = await fixture("child");
	try {
		const response = await f.session.execute("get_window", { id: 123 }, {});
		const value = z.object({ childPid: z.number().int().positive() }).parse(response.structuredContent);
		const pid = value.childPid;
		assert.ok(pid > 0);
		process.kill(pid, 0);
		await f.session.close();
		assert.throws(() => process.kill(pid, 0));
	} finally { await f.cleanup(); }
});

test("Windows job also closes when the calling Pi process exits without cleanup", { skip: process.platform !== "win32" }, async () => {
	const f = await fixture("child");
	try {
		const parent = path.join(f.root, "exiting-parent.mjs");
		await writeFile(parent, `import {WindowsSessionExecutor} from ${JSON.stringify(new URL("../src/windows-session.ts", import.meta.url).href)}; const s=new WindowsSessionExecutor({testProcess:{command:process.execPath,args:[${JSON.stringify(f.script)},"child"]}}); const r=await s.execute("get_window",{id:123},{}); console.log(JSON.stringify(r.structuredContent)); process.exit(0);`);
		const { stdout } = await promisify(execFile)(process.execPath, [parent], { timeout: 15_000 });
		const { childPid } = z.object({ childPid: z.number().int().positive() }).parse(JSON.parse(stdout));
		let alive = true;
		for (let attempt=0; attempt<40 && alive; attempt++) {
			try { process.kill(childPid, 0); await new Promise((resolve) => setTimeout(resolve, 25)); }
			catch { alive = false; }
		}
		assert.equal(alive, false);
	} finally { await f.cleanup(); }
});

test("Windows official late model activity is rejected, not reported as a successful tool", async () => {
	const f = await fixture("model");
	try { await assert.rejects(async () => { await f.session.execute("list_apps", {}, {}); await f.session.close(); }, /model-turn/); }
	finally { await f.cleanup(); }
});
