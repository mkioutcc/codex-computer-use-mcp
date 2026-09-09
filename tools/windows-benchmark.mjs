import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { resolveWindowsRuntime, verifySkyDirectory } from "../dist/windows-runtime.js";
const bundled = process.argv[2];
if(!bundled) throw new Error("Usage: node tools/windows-benchmark.mjs <app-bundled @oai/sky directory>");
const runtime = await resolveWindowsRuntime();
const installed = path.join(runtime.moduleDir, "@oai", "sky");
// Original serial comparison retained only as a measurement control, not a production fallback.
async function serial(a,b) {
 for(const e of await readdir(a,{withFileTypes:true})) {
  if(e.isSymbolicLink()) throw new Error("redirected file");
  if(e.isDirectory()) await serial(path.join(a,e.name),path.join(b,e.name));
  else if(!(await readFile(path.join(a,e.name))).equals(await readFile(path.join(b,e.name)))) throw new Error("file mismatch");
 }
}
const samples=[];
for(let i=0;i<4;i++) {
 for(const [name,fn] of i%2===0 ? [["serial",serial],["bounded",verifySkyDirectory]] : [["bounded",verifySkyDirectory],["serial",serial]]) {
  const t=performance.now(); await fn(installed,bundled); samples.push({name,ms:Math.round(performance.now()-t)});
 }
}
console.log(JSON.stringify({runtimePhasesMs:runtime.timingsMs,samples}));
