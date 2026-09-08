import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { windowsPowerShell } from "./windows-runtime.ts";

const execFileAsync = promisify(execFile);

/** Applies only to newly created adapter-owned directories, never official app files or user directories. */
export async function restrictWindowsDirectory(directory: string): Promise<void> {
	if (process.platform !== "win32") return;
	const script = `$ErrorActionPreference='Stop'; $acl=[Security.AccessControl.DirectorySecurity]::new(); $acl.SetAccessRuleProtection($true,$false); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')); Set-Acl -LiteralPath '${directory.replaceAll("'", "''")}' -AclObject $acl`;
	await execFileAsync(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeout: 15_000, windowsHide: true });
}

export async function makePrivateDirectory(prefix: string): Promise<string> {
	const directory = await mkdtemp(prefix);
	try { await restrictWindowsDirectory(directory); }
	catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
	return directory;
}
