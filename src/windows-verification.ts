/** One PowerShell process discovers the installed app and checks the same five executable signatures. */
export function windowsDiscoveryAndVerificationScript(executables: readonly string[]): string {
	const quoted = executables.map(file => `'${file.replaceAll("'", "''")}'`).join(",");
	return `$ErrorActionPreference='Stop';
$clock=[Diagnostics.Stopwatch]::StartNew();
$p=Get-AppxPackage OpenAI.Codex;
if(-not $p){throw 'Install the official Codex Windows app first'};
$resources=Join-Path $p.InstallLocation 'app\\resources';
$localAppData=[Environment]::GetFolderPath('LocalApplicationData');
$discoveryMs=$clock.ElapsedMilliseconds;
$clock.Restart();
$modulePath=Join-Path $PSHOME 'Modules';
$env:PSModulePath=$modulePath;
Import-Module (Join-Path $modulePath 'Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop;
$files=@(${quoted});
$files += (Join-Path $p.InstallLocation 'app\\ChatGPT.exe');
foreach($f in $files){
 $s=Get-AuthenticodeSignature -LiteralPath $f;
 if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'CN="?OpenAI OpCo, LLC"?(,|$)'){throw 'Official Windows runtime signature verification failed'}
};
@{resources=$resources;localAppData=$localAppData;discoveryMs=$discoveryMs;authenticodeMs=$clock.ElapsedMilliseconds} | ConvertTo-Json -Compress`;
}
