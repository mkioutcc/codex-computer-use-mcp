# Windows 官方 Computer Use → Pi 可行性研究

> **最新狀態：已實作並驗證 Windows 官方接入。** 第 1–8 節保留研究／受阻過程；先前「尚未握手」「blocked」是當時結論，不是目前狀態。成功路徑、驗收與限制見第 9 節。

查證日期：2026-09-08。第 1–6 節為官方文件、此 fork 原始碼與已安裝 Windows Codex app 的初步唯讀研究；第 7 節記錄後續獲准的啟動 PoC。未修改正式程式碼，未做桌面輸入或端到端驗收；後續僅正常啟動官方 app，獨立 runtime 啟動受阻。

## 結論

**有實質移植基礎，值得進入最小驗證；但不是把 macOS 路徑改成 Windows 就能用，也尚不能宣稱 Pi 已可成功調用。**

- 官方已發布 Windows Computer Use；不是只有 Windows Codex app 或瀏覽器自動化。
- 本機官方 Codex app 已包含 Windows Computer Use plugin、`@oai/sky`、官方 Node REPL 與 Windows 執行檔；五個抽查執行檔的 Authenticode 都是 Valid，簽署者為 OpenAI OpCo, LLC。
- 官方 Windows 文件指定 `node_repl` + `import("@oai/sky")`。這符合「沿用 Codex app 官方能力」的研究方向；不需要自行實作 SendInput、UI Automation、Playwright。
- 尚未驗證第三方 Pi 宿主能否建立完整官方 runtime/session、轉送官方確認、零模型回合執行並可靠取消清理。
- 此版本 Windows 官方 API 是 window2，不是 repo 的 macOS 十方法契約。不可偷偷猜測 window 或把 macOS app selector 改寫成 Windows selector。

## 1. Fork 與目前實作

GitHub API 確認 `mkioutcc/codex-computer-use-mcp` 的 `fork: true`，parent 為 `tmustier/codex-computer-use-mcp`：[來源](https://api.github.com/repos/mkioutcc/codex-computer-use-mcp)。

本地 branch：`main`；HEAD：`e90efa7bf83cd7a2a8b821c568bf20da4c894c12`；package：`0.5.0`。研究開始時 working tree 乾淨。

現有正式呼叫路徑（依本地原始碼）：

```text
Pi computer_use({ code })
  → adapter 的 code worker / session executor
  → ChatGPT.app 內附 codex app-server
  → mcpServer/tool/call
  → SkyComputerUseClient mcp
  → 官方 macOS Computer Use
```

- [README](../../README.md)：明列 macOS、ChatGPT.app、官方安裝的 Computer Use 元件；專案不是 OpenAI 官方整合，依赖 experimental app-server API。
- [package.json](../../package.json)：`os: ["darwin"]`；一般 Windows npm 安裝受平台限制。
- [direct-broker.ts](../../src/direct-broker.ts)：固定 `/Applications/ChatGPT.app/Contents/Resources/codex`；尋找 `.app/Contents/.../SkyComputerUseClient`；以 `codesign` 與 Apple Team ID `2DC432GLL2` 驗證；以 `plutil` 讀取 build。
- 同檔以 `mcpServer/tool/call` 直接指定 method/arguments，不以 `turn/start` 讓第二個模型規劃；保留 ephemeral thread 與官方 session。
- 同檔的環境隔離／清理依賴 POSIX PATH、`pgrep`、`lsof`、負 PID process group、`SIGSTOP`、`SIGKILL`，不能原封不動移植。
- [Pi extension](../../integrations/pi/index.ts)、[code executor](../../src/code-executor.ts)、[session executor](../../src/session-executor.ts) 提供現有整合邊界；這輪未驗證其 Windows 執行相容性。

## 2. 官方公開來源

[官方 changelog](https://developers.openai.com/codex/changelog) 的 2026-05-29 / 26.527 記載：

> Computer Use now works on Windows. Codex can operate Windows desktop apps by seeing, clicking, and typing in the foreground while it works.

這不同於 2026-03-04 / 26.304 的 Windows app 發布。

[官方 Computer Use 文件](https://developers.openai.com/codex/app/computer-use) 說明 Windows 在 active desktop 前景操作；不能承諾 macOS 式背景操作或鎖定桌面執行。研究時頁面已使用 ChatGPT Learn / ChatGPT desktop app / ChatGPT Work and Codex 命名，因此不能只用舊品牌或舊 macOS 文件推論現在平台能力。

[官方 App Server 文件](https://developers.openai.com/codex/app-server) 列有 `mcpServerStatus/list`、`mcpServer/tool/call`。但「通用 RPC 存在」不代表 Windows 官方 plugin 已在任意獨立 app-server 的 thread 中載入。

原始碼交叉來源：[common.rs](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs)、[v2/mcp.rs](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/mcp.rs)。`main` 是移動分支，不保證與本機 app 內附版本相同。

## 3. 本機一手證據

PowerShell `Get-AppxPackage *Codex*`：

```text
Name: OpenAI.Codex
Version: 26.901.6511.0
InstallLocation:
C:\Program Files\WindowsApps\OpenAI.Codex_26.901.6511.0_x64__2p2nqsd0c76g0
```

以下相對路徑以該安裝目錄的 `app/resources/` 為根（只讀，不重新散布官方檔案）：

| 證據檔案 | 查得內容 |
| --- | --- |
| `plugins/openai-bundled/plugins/computer-use/.codex-plugin/plugin.json` | plugin `26.901.51231`；OpenAI 作者；Windows desktop control；`license: Proprietary`；Stop hook 呼叫 `node_repl.turn_ended` |
| `plugins/openai-bundled/plugins/computer-use/skills/computer-use/SKILL.md` | `Control Windows apps from ChatGPT`；入口為官方 `node_repl` 中 `import("@oai/sky")`；明示不要自行 spawn helper 或自建 helper protocol client |
| `plugins/openai-bundled/plugins/computer-use/docs/api.md` | Windows `window2` API，明列 Window、app id、截圖與 accessibility state 型別 |
| `plugins/openai-bundled/plugins/computer-use/docs/guidance.md` | 持久 JS session、輸出、視窗選取、觀察與操作、停止及恢復規則 |
| `cua_node/bin/node_modules/@oai/sky/package.json` | `@oai/sky` 版本 `0.6.26`；export `.` 與 `./service` |
| `cua_node/bin/node_modules/@oai/sky/bin/windows/codex-computer-use.exe` | 官方 Windows helper 存在 |
| `cua_node/bin/node_modules/@oai/sky/bin/windows/swift/x64/codex-computer-use-swift.exe` | 另一官方 Windows 元件存在 |
| `cua_node/bin/node_repl.exe` | 官方 REPL runtime 存在 |
| `plugins/openai-bundled/plugins/unified-computer-use/.mcp.json` | `cua_repl` MCP 定義，`js` / `js_reset`，檔案預設 `enabled: false`；不能視為目前 session 已啟用 |
| `plugins/openai-bundled/plugins/unified-computer-use/scripts/launch.mjs` | 官方 launcher 要求 `CUA_REPL_NODE_REPL_PATH`，注入 `NODE_REPL_TRUSTED_SERVICES`，computer 對應 `@oai/sky/service` |

### 簽章檢查

以 `Get-AuthenticodeSignature` 抽查下列檔案，全部 `Status: Valid`，Signer 為 `CN="OpenAI OpCo, LLC", O="OpenAI OpCo, LLC", L=San Francisco, S=California, C=US`：

1. `codex.exe`
2. `cua_node/bin/node.exe`
3. `cua_node/bin/node_repl.exe`
4. `cua_node/bin/node_modules/@oai/sky/bin/windows/codex-computer-use.exe`
5. `cua_node/bin/node_modules/@oai/sky/bin/windows/swift/x64/codex-computer-use-swift.exe`

此抽查不是整個 MSIX／所有 JS 資源完整性驗證，也不是第三方使用授權。Windows 必須建立自己的官方套件／發行者驗證；Apple Team ID 僅能保留在 macOS 分支，不能在 Windows 假裝通過。

### Runtime 邊界

唯讀檢查 `@oai/sky/dist/project/cua/sky_js/src/sky.js`：

- 官方 JS 包含 trusted `nodeRepl.rpc("sky", ...)` 路徑。
- 也含沒有 `globalThis.nodeRepl` 時建立 platform client 的路徑；這只是程式存在，不代表獨立 Node 使用已通過官方權限與端到端驗收。

`targets/windows/internal/computer_use_client.js` 的 native pipe 路徑需要官方 runtime 提供 nativePipe、config、環境及 elicitation。可能拋出 `Computer Use app approval UI is unavailable outside trusted node_repl`。這是特定分支條件，不代表每一種呼叫一律被拒絕。

所以首選調查官方 runtime 及 launcher，不偽造 trusted runtime、不移除官方確認、不自行直接呼叫 helper。

## 4. Windows API 不能直接套用 macOS 十方法

本機官方 `docs/api.md` 列出的 Windows API：

```text
list_windows, get_window, list_apps, launch_app,
get_window_state, click, press_key, type_text,
scroll, set_value, drag, perform_secondary_action,
activate_window
```

例：Windows 是 `get_window_state({ window, include_screenshot, include_text })`，輸入方法帶官方回傳的 `Window`，`element_index` 是 number。repo 現有 macOS 範例則是 `get_app_state({ app })`、`click({ app, element_index: "7" })`。

正確方向是保留 macOS 現有十方法，Windows 原樣暴露它的官方 schema，不以隱性 app/window 改寫來假裝 API 相同。這會超過目前 AGENTS.md「all ten official methods」的字面平台範圍，正式實作前需先明確同意 Windows 官方 API 的擴充範圍；本研究未更改該文件。

官方底層自己使用 SendInput / UI Automation / Windows.Graphics.Capture 並不違反需求；違反的是 adapter 改為自行實作或另接第三方這些引擎。

## 5. 建議接入方式與決策門檻

候選架構（尚未驗證）：

```text
Pi computer_use({ code })
  → Windows adapter（純傳輸、輸出、session、取消）
  → Codex app 內附官方 Node REPL / CUA runtime
  → 官方 @oai/sky service
  → 官方 Windows Computer Use
```

如 app 內附 app-server 能正確託管此官方 runtime，則延續 `mcpServer/tool/call`，調用其真正暴露的 `js` 工具；否則再評估官方 MCP launcher 的直接傳輸。兩者都不能預先承諾可行，也不應為保留舊 transport 而改寫官方行為。

**下一步應先做有界 PoC，不先大改 repo。成功門檻：**

1. 從官方安裝位置解析 runtime，驗證官方來源與實際 tool inventory/schema。
2. 不啟動模型 turn，經官方 JS 入口取得 `sky.list_apps()` 結果。
3. 在使用者同意的空白記事本測試：取得官方 Window、讀取 state、輸入測試文字、重新讀取以驗證；不觸碰現有文件。
4. 保留並轉送官方 app 授權／elicitation；若官方 runtime 不允許外部宿主，明確停止，不以偽造上下文繞過。
5. 驗證 Pi 可取得文字／圖像、中途失敗保留先前觀察與已完成呼叫歷史、取消後沒有輸入繼續執行及自有子程序殘留。
6. 驗證官方 `turn_ended` 等生命週期要求如何對應零模型回合呼叫；不能直接沿用舊 broker 禁用 hooks 後假定沒有差別。

通過後才做：Windows package/build 支援、runtime discovery、Authenticode／套件完整性、Windows 環境隔離、程序生命週期（例如評估 Job Object）、官方 Windows schema、Pi 輸出與 session 轉接及平台測試。沿用既有 macOS 安全保證；不另加 wrapper app allowlist、動作分類器或自製 planner。

若官方只在 app 持有的會話中提供必要服務，且沒有可用的官方連接方式，則此版本仍可能無法滿足獨立 Pi 接入；不能改以第三方 desktop engine 冒充成功。

## 6. 驗證範圍與限制

- 已完成：fork metadata、repo 主要 transport 路徑、公開官方支援記載、本機套件/API/runtime 靜態檢查、五個執行檔簽章。
- 未完成也不宣稱：官方 runtime 握手、工具呼叫、截圖／輸入、Pi 端到端、取消／cleanup 驗收、帳號與官方 app 權限可用性。
- 初步唯讀研究未執行 npm ci/check/test/build；後續實作嘗試已執行，全部受阻，詳見第 7 節。沒有跳過平台限制後宣稱測試通過。
- 專案 adapter 為 MIT 不等於官方 plugin 可以重新散布；本機 metadata 為 Proprietary。候選方案應調用使用者已安裝元件，不打包复制官方二進位。正式散布前仍需檢查適用條款。
- 網頁研究部分搜尋遇到 provider 限流，關鍵支援／RPC 結論採直接取得的官方文件與原始碼，不用二手 Windows MCP 文章替代。

**研究判斷：官方 Windows 能力與本機元件已證實；Windows 官方-only Pi adapter 仍需 runtime PoC，不能宣稱「已可直接使用」。後續實作嘗試的具體阻礙如下。**

## 7. 實作嘗試：PoC 啟動受阻（2026-09-08）

使用者批准先做官方 runtime PoC，成功才擴充正式 Windows/Pi 整合；批准保留 macOS 十方法並新增 Windows 官方 window2 API、官方 session 與 Pi 行為的 TDD 邊界，以及新開空白記事本驗收。本輪在 **runtime 啟動** 就受阻，因此沒有修改正式程式、package 平台限制或 AGENTS.md，也沒有新增假裝可用的 transport。

### 7.1 直接啟動結果

重新用 `Get-AppxPackage *Codex*` 解析安裝位置，版本仍為 `26.901.6511.0`。執行前重新檢查 `codex.exe`、`cua_node/bin/node.exe`、`cua_node/bin/node_repl.exe`、`@oai/sky` 的 Windows helper，四者簽章均 `Valid`，Signer 包含 `OpenAI OpCo, LLC`。

- PowerShell 執行官方 `node_repl.exe --help`：`NativeCommandFailed / ApplicationFailedException`，訊息為「存取被拒」。
- Node.js `v26.2.0` 的 `spawnSync` 對 `codex.exe`、官方 `node.exe`、`node_repl.exe` 分別執行 `--version`：全部 `error.code: EPERM`、`status: null`，沒有工具握手。
- 當時格式化 ACL 顯示 `BUILTIN\\Users Allow ReadAndExecute, Synchronize`，但未顯示該 ACE 的條件；不能據此判定一般使用者具有無條件執行權限。後續原始 SDDL 與有效存取對比已定位此遺漏，見第 8 節。

### 7.2 正常套件入口也已釐清

為避免把獨立 EXE 的 EPERM 誤當所有官方入口皆不可用，另經主管同意檢查 AppxManifest 並使用 Windows 正常套件啟動方式：

- Application：`Id="App"`、`Executable="app/ChatGPT.exe"`、`EntryPoint="Windows.FullTrustApplication"`。
- 開始功能表名稱：`ChatGPT`；AUMID：`OpenAI.Codex_2p2nqsd0c76g0!App`。
- Manifest 有 `codex:` URL protocol，沒有 AppExecutionAlias；不能把 protocol 當成已提供官方 Computer Use 外部呼叫協定。
- 用 `explorer.exe shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App` 成功啟動一般 app，觀察到該安裝位置的 `ChatGPT.exe` 程序。
- app 啟動後再次測試三個官方 runtime 的 `--version`，依然都是 `EPERM`、`status: null`。

沒有自動操作 Codex／ChatGPT 自身 UI，沒有登入、點選授權或開啟記事本；沒有讀取憑證、複製安裝檔、變更 ACL、提權或偽造 trusted session。正常啟動的 app 留給使用者，不強制關閉。這只證明本次獨立程序路徑不能啟動，**不證明官方 app 內的 Computer Use 不可用，也不證明所有外部連接方式永遠不可行**。

### 7.3 最小重現命令

先用 PowerShell 唯讀解析與驗簽：

```powershell
$p = Get-AppxPackage OpenAI.Codex
$r = Join-Path $p.InstallLocation 'app\resources'
$p | Select-Object Name, Version, InstallLocation
(Get-AppxPackageManifest $p).Package.Applications.OuterXml
Get-StartApps | Where-Object AppID -eq ($p.PackageFamilyName + '!App')
$files = @('codex.exe', 'cua_node\bin\node.exe', 'cua_node\bin\node_repl.exe')
foreach ($file in $files) {
    $signature = Get-AuthenticodeSignature (Join-Path $r $file)
    if ($signature.Status -ne 'Valid' -or
        $signature.SignerCertificate.Subject -notmatch 'OpenAI OpCo, LLC') {
        throw "Official signature verification failed: $file"
    }
    $signature | Select-Object Path, Status, SignerCertificate
}
```

需要重現正常 app 啟動時，另行執行（會開啟 app；不是唯讀命令）：

```powershell
Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\' + $p.PackageFamilyName + '!App')
```

驗簽後，將解析到的 resources 絕對路徑傳給下列 Node.js 診斷片段（例如儲存於臨時 `.mjs` 後 `node probe.mjs <resources-path>`）；每個程序最多等待五秒，不呼叫 helper、不操作桌面：

```js
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const resources = process.argv[2];
for (const file of ['codex.exe', 'cua_node/bin/node.exe', 'cua_node/bin/node_repl.exe']) {
  const result = spawnSync(path.join(resources, file), ['--version'], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  console.log(JSON.stringify({
    file, error: result.error?.code, status: result.status,
    stdout: result.stdout, stderr: result.stderr,
  }));
}
```

本機在正常 app 啟動前後均回傳：

```text
codex.exe                     EPERM status=null
cua_node/bin/node.exe         EPERM status=null
cua_node/bin/node_repl.exe    EPERM status=null
```

### 7.4 必要檢查的實際結果

| 命令 | 結果 |
| --- | --- |
| `npm ci` | 失敗，`EBADPLATFORM`：package 要求 darwin，目前 win32 |
| `npm run check` | 失敗，`oxlint` 不存在；依賴未能安裝 |
| `npm run check:pi` | build 階段失敗，`TS2688: Cannot find type definition file for 'node'`，未進入 Pi typecheck |
| `npm test` | pretest build 同樣 TS2688；完整測試套件沒有開始執行 |
| `npm run build` | 失敗，同樣 TS2688 |

沒有使用 `--force`、跳過平台限制或把未開始的測試報成通過；沒有新增／更改測試。TDD 尚未進入實作階段，因為使用者批准的先決 PoC 未通過。本次只保留這份研究與重現紀錄，不建立額外診斷框架。

**交付狀態：blocked，不是 Windows 整合完成。** 下一步需先確認此套件在一般官方 app 內的 Computer Use 能否正常使用，以及有無可供外部 Pi 使用的官方 runtime 啟動契約；如需登入或授權，必須由使用者操作。不能在這些證據不足時先改正式 API 或移除平台／官方安全限制。

## 8. EPERM 因果診斷：條件式檔案執行權限（2026-09-08）

本輪約 13:39–13:46 UTC 完成主要探測；重新解析到同一官方套件 `26.901.6511.0`。**已定位目前未封裝宿主直接啟動 bundled EXE 的檔案執行權限障礙；不是已證明所有 Windows 接入不可能。** 沒有修改正式 adapter，也沒有完成 runtime 握手。

### 8.1 實際程序建立 red repro 與一次一變數對比

先建立臨時 PowerShell `System.Diagnostics.Process.Start()` repro：三個官方 runtime 各執行 `--version`，逐檔驗證 OpenAI Valid 簽章，每個程序最多等五秒，非零退出／建立失敗／超時均使腳本 exit 1。13:40:05 UTC 起重複 baseline 均為：

```text
codex.exe        started=false  exitCode=null  Win32Exception.NativeErrorCode=5
cua node.exe     started=false  exitCode=null  Win32Exception.NativeErrorCode=5
node_repl.exe    started=false  exitCode=null  Win32Exception.NativeErrorCode=5
內層 Win32Exception.HResult=0x80004005，訊息 Access is denied
外層 PowerShell MethodInvocationException.HResult=0x80131501
```

這是 Windows 原生錯誤碼 **5 / ERROR_ACCESS_DENIED**；不能僅從 Node 的 `EPERM` 推論某一安全政策。HResult 是實際 .NET 例外值，不自行替換成 `0x80070005`。

在測試前已向主管提出五個可反證假說：cwd/env/stdio 相容性、Node/libuv 建立方式、套件 bundled image 邊界、CodeIntegrity/AppLocker 拒絕事件、官方 package/session 啟動契約。結果：

| 對比（其餘維持 baseline） | 實際結果／可排除範圍 |
| --- | --- |
| repo cwd → TEMP；另一次 → image 目錄 | 三者仍原生錯誤 5；這兩個 cwd 修正無效 |
| 繼承 env → 僅保留 Windows 基本路徑／使用者目錄變數 | 三者仍 5；移除其他 env 無效，未輸出環境值 |
| stdout/stderr 重導 → 繼承 | 三者仍 5；不是此重導設定造成 |
| 在繼承 stdio 基準上只改 `UseShellExecute=false` → `true` | 三者仍 5；不是只靠 ShellExecute 即可修正 |
| 相同 .NET 建立路徑改啟動系統 `whoami.exe /user`、`cmd.exe /d /c ver`、公開安裝 Node `--version` | 都成功、exit 0；未保留 whoami 身份輸出，Node 為 `v26.2.0`，只作控制組 |
| 同套件非 CUA 工具 `app/resources/rg.exe --version` | 同樣 5；拒絕不只發生於 CUA runtime |

基礎 PE 唯讀檢查：上述 bundled EXE 與公開 Node 均為 `MZ`、`PE`、machine `0x8664`、PE32+ `0x020B`；不是把非 Windows／不同架構檔案當成這些 EXE。此檢查不是完整 PE／DLL 完整性驗證。

### 8.2 決定性新增證據：原始 SDDL 與有效執行存取

套件根目錄及 `ChatGPT.exe`、`codex.exe`、CUA `node.exe`、`node_repl.exe`、`rg.exe` 的 DACL 中，Users 的執行許可是 **條件式 ACE**。以 runtime 檔案的原始 SDDL 片段為例：

```text
(XA;ID;0x1200a9;;;BU;(WIN://SYSAPPID Contains "OpenAI.Codex_2p2nqsd0c76g0"))
(A;ID;FR;;;BU)
```

`BU` 為 Builtin Users；`0x1200a9` 包含讀取與執行，卻附有 `WIN://SYSAPPID` 套件身份條件；另一個無條件 Users ACE 只有 `FR`，不含 `FILE_EXECUTE`。**第 7.1 節原先的格式化 ACL 呈現遺失了條件，並非無條件可執行的證據。** 其他 ACE 存在，因此另外驗證目前呼叫端的有效存取，而不是只靠解讀其中一個 ACE。

唯讀 `CreateFileW` 對相同檔案、相同 share/open 參數，只變更要求的存取位元；不建立映像、不執行檔案、不寫內容：

| 呼叫端要求 | 四個 bundled EXE：codex／CUA Node／node_repl／rg | 公開安裝 Node |
| --- | --- | --- |
| `FILE_READ_DATA` (`0x1`) | 全部成功 | 成功 |
| `FILE_EXECUTE` (`0x20`) | 全部失敗，`GetLastError()=5` | 成功 |

再以唯讀 package API 查詢：

- 診斷 PowerShell 的 `GetCurrentPackageFullName()`：`15700 / APPMODEL_ERROR_NO_PACKAGE`。
- 既有官方 `ChatGPT.exe` 程序：以 `PROCESS_QUERY_LIMITED_INFORMATION` + `GetPackageFullName()` 取得 `OpenAI.Codex_26.901.6511.0_x64__2p2nqsd0c76g0`，回傳 0。沒有開啟或複製程序 token、注入、debugger 或設定任何身份。

這些對比直接確認目前 caller **可讀但不能取得檔案執行存取**，與套件身份條件式 DACL 一致，已足以阻斷直接建立程序。這不是 app 帳號登入失敗的證據，也不宣稱排除了所有可能重疊的系統政策。

### 8.3 事件與正常入口的邊界

13:41:53 UTC 查詢前八分鐘，對每個日誌最多 300 筆，僅輸出符合上述確切 package/image 路徑的事件欄位，不輸出其他事件內容：

- `CodeIntegrity/Operational`：8 筆，符合 image 者 0。
- `AppModel-Runtime/Admin`：1 筆，符合者 0。
- `Security-Mitigations/KernelMode`：1 筆，符合者 0。
- AppLocker 的 `EXE and DLL`、`MSI and Script`、`Packaged app-Execution`，以及 `TWinUI/Operational`、`Security-Mitigations/UserMode`：時間窗內查無事件。
- 沒有碰到 300 筆上限，也沒有提權／開啟日誌。**無相符事件不等於證明不存在 App Control；本次正向證據來自檔案存取與 SDDL。**

重新讀取 manifest，正常公開啟動入口仍是 `OpenAI.Codex_2p2nqsd0c76g0!App` → `app/ChatGPT.exe`；沒有宣告 runtime 的 AppExecutionAlias／獨立 Application。先前經正常 AUMID 啟動、現在仍存在的 app 確實帶 package identity；這與未封裝宿主直接執行 EXE 是不同入口。

官方 `unified-computer-use/scripts/launch.mjs` 只從 `CUA_REPL_NODE_REPL_PATH` 取得絕對路徑，再 `spawn(executable, [], { env: ..., stdio: "inherit" })`。對 `app.asar` 中指定主程式 `.vite/build/main-DpnWwRdP.js` 的有界唯讀檢查，也看到 app 配置該 launcher 與官方 Node 路徑；沒有執行／解包官方程式碼、探測 IPC 或把這些內部設定當成公開外部授權契約。這些已查入口尚不能讓 Pi 直接取得官方 session；**未找到外部契約不等於第三方整合被禁止。**

### 8.4 最小重現與下一步

本輪臨時腳本與去除敏感輸出的結果保留在本機明確診斷目錄，不納入正式 repo：

```powershell
$d = Join-Path $env:TEMP 'codex-eperm-20260908'
powershell.exe -NoProfile -File "$d\probe.ps1" -Mode baseline
# 預期目前 exit 1；三個 runtime started=false，內層 NativeErrorCode=5。
powershell.exe -NoProfile -File "$d\probe.ps1" -Mode controls
# 預期 exit 0；只驗證程序建立，不用公開 Node 替代官方 runtime。
powershell.exe -NoProfile -File "$d\access-probe.ps1"
# 唯讀存取與 package identity 對比；詳見 8.2。

$p = Get-AppxPackage OpenAI.Codex
$f = Join-Path $p.InstallLocation 'app\resources\cua_node\bin\node_repl.exe'
(Get-Acl -LiteralPath $f).Sddl  # 必須讀原始條件，不只看 Access 表格
```

完整 repro 腳本、命令與證據索引另交本次診斷 artifact；上述 temp 路徑只適用本次機器，不是套件新增診斷功能。未新增正式測試；未重跑 npm 安裝／build／suite，因本輪只診斷安裝元件與更新研究，不更動產品程式。

**此階段交付：blocked（WindowsApps direct activation）。** 後續成功路徑見下一節；WindowsApps 執行限制本身未被修改。

## 9. 成功接入與實作驗收（同日後續）

使用者修正官方 app 的預設專案路徑並開啟新對話後，主代理獨立重試。WindowsApps 三個 EXE 仍錯誤 5，但官方 app 的實際執行中程序出現在另一個、由 app 自行部署的目錄：

```text
%LOCALAPPDATA%/OpenAI/Codex/bin/8e5b6932251c2c1c/codex.exe
%LOCALAPPDATA%/OpenAI/Codex/runtimes/cua_node/b474a88d5d105afa/bin/node.exe
%LOCALAPPDATA%/OpenAI/Codex/runtimes/cua_node/b474a88d5d105afa/bin/node_repl.exe
```

這些已部署執行檔的 Authenticode 為 Valid/OpenAI；`codex --version` 為 `codex-cli 0.153.4`，官方 Node 為 `v24.19.0`，REPL 的 `--help` 可正常執行。轉接器沒有自行複製 runtime，也沒有修改官方安裝檔、ACL 或套件身分。

官方 app 生成的 `.codex/plugins/cache/openai-bundled/unified-computer-use/26.901.51231/.mcp.json` 同時提供實際 runtime 路徑及 `SKY_CUA_NATIVE_PIPE_DIRECTORY`。由官方 `@oai/sky` 連接這個 app 提供的端點，才是此版本可工作的 Windows 路徑；自行讓 REPL spawn helper 並非必要，也不是本次實作。

### 9.1 正式路徑

```text
Pi computer_use 的既有可取消 code worker（或 MCP typed tools）
  → WindowsSessionExecutor：序列化、保留官方 session
  → app 自行部署且已驗簽的 codex app-server
  → mcpServer/tool/call → 官方 node_repl / @oai/sky service
  → 官方 app 生成的 native pipe → 官方 Windows Computer Use
```

- `windows-runtime.ts` 解析 app 生成的設定、限制在官方部署佈局、驗證 OpenAI Authenticode，並逐檔比對部署的 Sky package 與 app-bundled 原件。
- `windows-session.ts` 只產生 method dispatch 所需的 JS，模型程式仍在既有獨立 worker 執行。不呼叫 `turn/start`；provider 停用，觀測到 model-turn 通知即拒絕。
- `windows-job.ps1` 以 suspended creation → Job Object assignment → resume，清理 adapter 自有的程序樹；Pi 程序退出也會觸發清理。不終止使用者的官方 app。
- 保留官方 Windows 13 個 window2 方法及 selector；macOS 原有十方法、簽章 Team ID 與操作契約保留。Pi 與 MCP 依平台選用 API。
- 官方 elicitation 轉送給使用者；沒有 UI 時取消，不自動核准。沒有新增 app allowlist、動作風險分類器或替代引擎。
- 截圖在 Pi 主程序保留，code worker 只收到 opaque handles 與官方 metadata。Windows 取消時保留已收到的輸出與方法歷史。
- 新建的 adapter 私有目錄使用 Windows user-only DACL；這只保護 adapter 自己的新檔案，不修改官方 app 或既有使用者目錄的權限。

### 9.2 真實驗收

1. 官方 app-server 握手及 ephemeral thread 成功；官方 `sky` 回報 target `windows`。
2. `sky.list_apps()` 成功返回 40 個 app；`sky.list_windows()` 可取得官方 Window。
3. 官方 `launch_app` 以 `Microsoft.WindowsNotepad_8wekyb3d8bbwe!App` 開啟新未命名記事本；System32 路徑嘗試失敗，未以非官方控制引擎替代。
4. 使用者確認空白文件及游標後，官方 `type_text` 輸入 `Pi official Windows Computer Use test`；官方 state/list_windows 回報標題 `*Pi official Windows Computer Use te - 記事本`。標題有截斷，**不是全文文字比對通過**；文件未儲存，未修改其他文件。
5. 透過正式 Pi extension 的已註冊 `execute` 入口（測試外層提供 ExtensionAPI，內層使用真實 runtime），`list_windows` → `get_window_state` → `emitImage` 成功返回上述標題、1 張 JPEG（該次 base64 長度 34604），並執行 `agent_settled`／`session_shutdown` 清理。此驗收不需要啟動 Pi 的模型回合。
6. 該記事本的官方 accessibility 回應為 null；圖片工具仍回報目前模型不支援圖片，因此不聲稱主代理已視覺檢查截圖全文。使用者另確認測試已有 Computer Use 能力。

PoC 曾將一張官方截圖暫存於 repo 外供圖片工具嘗試驗收，已刪除；正式 Pi/MCP 路徑不將圖片寫入磁碟。早期誤跑 macOS 程序群測試留下的三個、經命令列與 PID 確認屬本次測試的子程序亦已清理。

### 9.3 檢查與限制

- `npm ci`、`npm run check`、`npm run check:pi`、`npm test`、`npm run build` 全部成功。
- Windows 完整 suite：51 個 tests 通過、0 失敗、2 個 platform-only tests 略過；另 macOS process-group lifecycle suite 略過。macOS 真實桌面／程序群驗收仍需 macOS，沒有把略過項目當成通過。
- 測試涵蓋原樣 selectors/additional arguments、結構化資料、圖片 handles、取消與先前輸出、並行請求保留同一 session、官方確認／headless 取消、model-turn 拒絕、無憑證 home、Job Object 子孫與 parent-exit 清理、打包後 consumer 安裝啟動，以及私有 text-spill DACL。
- 這仍依賴 app 內附／實驗性 transport，不是 OpenAI 對第三方 SDK 穩定性的承諾。官方 app 必須保持運行；更新後可能需要開啟新對話以重新部署 runtime／端點。
- `/computer-use-status` 的 runtimeVerified 表示檔案及設定驗證成功，不保證當下 native pipe 可連接。
- 使用者要求後續不使用子代理；Standards／Spec 審查由主代理自行完成，核對正式 dispatch、平台分流、簽章與程序清理、權限轉送，以及上述驗收限制，未發現阻擋交付的可達回歸。不宣稱獨立雙代理審查；macOS live 驗證仍待該平台執行。
