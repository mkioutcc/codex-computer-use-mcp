# Codex Windows Computer Use 能力對接審查

查證日期：2026-09-09。範圍：此工作目錄目前版本、這台電腦已安裝的官方 Windows 元件與當前 Pi 工具；不是所有 Codex 歷史／未來版本，也不是 macOS live 驗收。本次只新增研究文件，不修改產品程式。

## 結論

**目前官方 Windows window2 文件的 13 個方法已全部轉接；但不能宣稱 Codex App Computer Use 整體能力、操作體驗及所有情境 100% 等價。**

應分四層看：

1. 方法清單：13/13，機械比對 missing=[]、extra=[]。
2. 執行引擎：沿用官方 app 部署的 runtime、官方 Node REPL、@oai/sky/service 與 app native pipe，不是另寫滑鼠鍵盤引擎。
3. 宿主語義：Pi 使用獨立 worker、store、emit/emitImage；不等同官方 node_repl 的一般 JavaScript 環境、globalThis 持久性與自動展示截圖。
4. 實際可靠性：核心動作已在 Notepad++ 實測成功；完整方法、不同 DPI／多螢幕／彈窗、真人停止及官方版本更新仍未完成完整 live 矩陣。

不要把「方法齊全」「單元／協定測試通過」「目前 Pi 真實能操作」「官方產品全面等價」混為一談。

## 一手來源與版本

- [O1：官方 Computer Use 公開文件](https://developers.openai.com/codex/app/computer-use)，本次重新取得全文。確認 Windows foreground、active desktop、官方 app 存取權限，以及不能自動操作終端／ChatGPT 本身或批准系統安全隱私提示等產品邊界。
- [O2：官方 App Server 文件](https://developers.openai.com/codex/app-server)，本次重新取得並定位 `mcpServer/tool/call` 與 experimental 說明。通用 RPC 文件存在，不等於私有部署佈局／native pipe 對第三方有穩定 SDK 承諾。
- O3：本機 app 根目錄 `C:/Program Files/WindowsApps/OpenAI.Codex_26.901.6511.0_x64__2p2nqsd0c76g0/app/resources/`。
- O3 下 `plugins/openai-bundled/plugins/computer-use/docs/api.md`：本次完整閱讀，官方 window2 13 方法、Window/AccessibilityState/Screenshot 型別。
- O3 下同目錄 `guidance.md`、`confirmations.md` 與 `../skills/computer-use/SKILL.md`：本次完整閱讀。包含狀態觀察、輸入、截圖展示、停止及官方模型操作指引。
- O3 下 `cua_node/bin/node_modules/@oai/sky/package.json`：本次讀取，版本 **0.6.26**。
- 先前真實 status：plugin **26.901.51231**。既有背景研究見 [Windows 接入研究](windows-official-computer-use-feasibility.md)；它包含歷史阻塞，不能把早期結論當現況。

公開網頁會更新，本機文件也會隨 App 更新；本結論以此次取得的版本為準。未重新散布官方程式或完整專有文件。

## 正式執行路徑

```text
Pi computer_use({code})
  → ComputerUseCodeExecutor → 可取消的 code-worker
  → WindowsSessionExecutor（逐方法驗證與序列化）
  → app 部署且驗簽的 codex app-server
  → mcpServer/tool/call → node_repl.js
  → 官方 @oai/sky/service → app 提供的 native pipe
  → 官方 Windows Computer Use
```

MCP 入口略過模型 code worker，直接由平台 typed tools 進入同一 WindowsSessionExecutor。

來源：[Pi 註冊與生命週期](../../integrations/pi/index.ts#L187)、[worker bridge](../../src/code-worker.ts#L71)、[執行器](../../src/code-executor.ts#L86)、[Windows connect](../../src/windows-session.ts#L52)、[MCP](../../src/mcp-server.ts#L44)、[runtime](../../src/windows-runtime.ts#L60)。

保留的重要設計：官方 selector 原樣傳遞、額外 JSON arguments catchall、拒絕模型回合通知、自有 Job Object 程序清理、官方 elicitation 轉送、取消時保留觀察與呼叫歷史。這些不是待移除的額外負擔。

## 能力對照

下表「已接」指公開方法／參數及 dispatch 存在；不代表每一項都完成真人桌面驗收。

| 官方能力 | 方法 | 接入情況 |
| --- | --- | --- |
| 應用程式清單 | list_apps | 已接；当前 Pi 真實成功 |
| 開啟視窗清單 | list_windows | 已接；本輪唯讀探測成功 |
| 恢復視窗識別 | get_window | 已接；有協定 fixture 測試 |
| 啟動應用程式 | launch_app | 已接；既有研究記錄記事本驗收，不算本轮新驗收 |
| 視窗／accessibility／截圖 | get_window_state | 已接；Notepad++ 真實取得文字與截圖 metadata |
| 前景啟用 | activate_window | 已接；Notepad++ 真實成功 |
| 點擊元素／座標／多次／按鈕 | click | 已接；Notepad++ 元素點擊切換分頁成功 |
| 次要 accessibility 動作 | perform_secondary_action | 已接；本輪未做 live 驗收 |
| 設定 editable 值 | set_value | 已接；本輪未做 live 驗收 |
| 捲動 | scroll | 已接；本輪未做 live 驗收 |
| 拖曳 | drag | 已接；本輪未做 live 驗收 |
| 按鍵／組合鍵 | press_key | 已接；本輪未做 live 驗收 |
| 輸入文字 | type_text | 已接；本輪不修改使用者文件 |

依 O3/api.md 與 [windows-tools.ts](../../src/windows-tools.ts#L4) 逐項核對：可選／必填欄位、mouse button 枚舉、window、screenshotId、scrollX/Y 等均有對應。adapter 對 ID/index/click_count 使用 int，比官方文件的 number 更明確；沒有證據顯示官方 producer 會返回小數 ID，不把這列為實際缺陷。

### 明確不是完全同一個 JS 介面

- 官方介面有 `target: "windows"`；Pi worker 的 `sky` 僅建立方法函式。本輪 `sky.target ?? null` 回傳 null。這是小型表面差異，不是缺少桌面操作方法。
- 官方 node_repl 的 globalThis 可跨 cell；Pi 每個 code batch 建立新 worker，跨呼叫需用 JSON `store`，不能保存任意 class/function 或原生物件。
- 官方指引中截圖自動展示；Pi 則使用 `emitImage(state.screenshots[i].url)` 明確輸出。該 url 已轉成 opaque handle，不再是原始 data URL。
- Pi 輸出／程式大小有界：code 20,000 bytes、50 次方法呼叫、最多 10 張／20 MiB 圖像輸出、worker bridge 1 MB 與 100 次 emits；計算片段有 5 秒限制。不是每個官方 RPC 只有 5 秒，RPC 等待期間會停用片段 timer。
- official 返回 void 在 bridge 上可序列化為 null。直接複製官方 node_repl 範例須調整輸出與持久狀態。

來源：[code-executor.ts](../../src/code-executor.ts#L13)、[code-worker.ts](../../src/code-worker.ts#L15)、[Pi Windows description](../../integrations/pi/index.ts#L64)。這些多為刻意的宿主相容性與可取消執行設計，不應為追求字面等價而拿掉。

## 實測證據與發現

### 1. 真實工具已能工作，不只是 fixture

本對話重啟 Pi 後，正式 `extensions.computer_use` 成功：list_apps → activate_window → get_window_state → click → get_window_state。Notepad++ 最後官方 window.title 為 `*新文件 2 - Notepad++`；未輸入或儲存文件。

本輪研究追加唯讀 list_windows，成功取得 9 個視窗。只保存數量與延遲，不把視窗清單／文件內容寫進本研究。

### 2. text-only observation 的幾何問題

剛才 Notepad++ 流程，`include_screenshot:false, include_text:true` 後以觀察到的 element_index 點擊，官方返回 `coordinate input geometry is unavailable`。重新取得包含截圖的最新 state 後，同一目標分頁點擊成功。

O3/guidance.md 確實示範 text-only 觀察後 element click，故此觀察與文件示例存在落差。**尚未建立官方 App 內完全相同操作的 A/B 重現，不能武斷歸因 adapter 或官方 bug。** 優先補版本相關操作說明與具體回歸實驗；不要偷偷改所有 include_screenshot 參數，也不要失敗後盲目重播輸入。

另一次 refresh 的 `window.title` 已更新而 accessibility.tree 首行仍有舊標題；因此驗收不應只比較 accessibility 首行，也不應把單一 title 當成全文輸入正確的證據。

### 3. 啟動成本顯著

本輪同一 Pi 研究回合，在 worker 內對 `await sky.list_windows()` 計時：首次 **23,795 ms**，下一次 **49 ms**，均回傳 9 個視窗。

這只是兩個樣本，不是 p50/p95 benchmark，也不能把 23.8 秒全算在 PowerShell。正式首次路徑包含 runtime discovery、簽章、Sky 檔案逐一比對、私有 ACL、Job 啟動、app-server/thread/REPL 初始化及官方呼叫；暖呼叫共用連線。

來源：[runtime verify](../../src/windows-runtime.ts#L40)、[Windows connect](../../src/windows-session.ts#L52)、[Pi agent_settled cleanup](../../integrations/pi/index.ts#L242)。

### 4. runtimeVerified 不是 connectionReady

[getWindowsStatus](../../src/windows-runtime.ts#L50) 只等待 resolveWindowsRuntime。它不初始化正式 session，不執行 list_windows，因此只證明設定／檔案驗證成功，不能证明 native pipe 當下可連接。

之前 reload 後仍執行舊驗簽 script，而新程序驗簽與 list_apps 成功；完整重啟後工具成功。證據支持當時已載入版本不同，**未追查 Pi loader 內部，不能斷定具體 cache 實作**。

### 5. 失敗的機器可讀性不足

[Pi execute](../../integrations/pi/index.ts#L226) 把 result.error 放在 details.error，仍正常 return content/details。先前真實錯誤被外層工具包裝成 isError:false，文字卻是 `Computer Use code stopped`。MCP 入口則有明確 [isError](../../src/mcp-server.ts#L90)。

這會讓只看外層成功欄位的呼叫者誤判。應按照實際 Pi 宿主錯誤契約改善標示，同時保留中途已完成觀察；不能用單純 throw 導致部分成果遺失。研究尚未驗證最終應使用哪個 Pi API 方案。

## 最值得優化的方向（優先順序）

### P1：可觀測性與真實驗收，而非再加桌面方法

1. 狀態清楚區分檔案驗證與連線探測；probe 使用正式 list_windows 入口、不輸出視窗內容。
2. 狀態附帶 adapter 載入來源／build fingerprint、App/plugin/Sky/broker 版本，讓 reload 舊碼、官方升級、pipe 過期可區分；不要顯示 token、完整敏感設定或 native pipe 內容。
3. PowerShell 失敗解碼 CLIXML 與實際 stderr，顯示失敗階段和精簡原因，而不是整段 Base64 指令。保留原始診斷於可控本機位置時也需避免參數／文件內容洩漏。
4. 正確暴露 batch 失敗狀態且保留觀察／history。
5. 增加 opt-in Windows live acceptance：正式 Pi 入口、空白測試編輯器、切頁、截圖、輸入後讀回、取消與 cleanup；模擬器結果另列，不混算。

驗收門檻：錯誤不能被判為成功、已載入版本能辨識、runtimeReady 與 connectionReady 可獨立失敗、真實 UI 流程通過且不改現有文件。

### P2：官方版本相容性與操作指引

1. 以當前官方 api.md／型別建立方法＋參數契約 fixture，比對新增方法或 schema drift；更新时人工确认，不把任意 runtime member 自動暴露。
2. 補 `sky.target`（若確有通用 caller 需要），並明示 store／emit／opaque image 與官方範例的差異。
3. 文件提供實測的 observe → one state-derived action → refresh 範例，遇到幾何問題先更新 screenshot-backed state，不盲重試輸入。
4. 多視窗、modal、多張 screenshot、origin/zIndex/DPI 與多螢幕做獨立 live case。現在 screenshot metadata 與 image blocks 按索引對應，應驗證多圖實際順序，不在無證據時宣稱已錯配。
5. 官方停止、app approval 與真人接管維持原樣；模型操作指引與 runtime 權限不是同一層。

### P3：先 profile 再降低冷啟動

1. 量測各階段時長，不記錄畫面與輸入內容；至少冷／暖各多個樣本，再訂效能目標。
2. 合併可獨立且相容的 PowerShell 初始化工作，降低 spawn 次數；用有界併發／串流比較降低 Sky 檔案驗證成本，保持驗證範圍不變。
3. 若 cache 驗證結果，必須綁定版本與檔案變更失效；不能「曾經驗簽」就永久信任。
4. 若評估更長 retained session，需同時驗證官方 turn_ended、使用者停止與 parent-exit cleanup，不能為了快就移除 agent_settled 清理。
5. Pi 多方法 batch 可省模型回合；WindowsSessionExecutor 仍逐方法 RPC。先量測 RPC 比重，不直接把任意模型 JS 放进官方 REPL，否則破壞目前可取消 worker 邊界。

## 不應算作缺漏或優化目標

- Windows 背景／鎖定桌面操作：官方產品本身不支援目前 Windows 這種模式，不能由 adapter 承諾。
- Browser Use、官方模型規劃、手機遠端控制、聊天歷史與 App UI：不是這 13 個 window2 方法的範圍；不應為「完整」加入另一個模型 planner。
- 指引和確認策略：官方 App 中還有給模型的 guidance／confirmations；沿用 runtime 只保證沿用 runtime 那一層，並不證明 Pi 任意模型行為等價。應明示官方邊界，不另造 adapter 風險分類器、app allowlist 或權限繞過。
- Windows `no-permissions` 文案不能理解成不受官方權限限制；它不是管理員、不會關閉官方 app approvals。
- 不自行重寫 app/window selector、控制引擎或終止使用者 Codex App。

## 測試證據邊界

前面修復回合記錄 `npm run check`、build、npm test 成功，53 tests／51 passed／0 failed／2 skipped；本輪研究沒有重新跑完整 suite，不把先前結果說成本輪新驗證。

[windows-session.test.ts](../../test/windows-session.test.ts#L11) 使用 `official-protocol-fixture.mjs` 與 testProcess，跳過真實 resolveWindowsRuntime；它驗證協定、序列化、模擬 elicitation、Job 清理，但**不是所有官方桌面方法已通過**。[windows-code.test.ts](../../test/windows-code.test.ts#L6) 也使用 stub executor。

本輪新驗證只有：官方文件與版本來源、機械 13-method 比對、當前 Pi 表面 target/methods、兩次真實唯讀 list_windows。之前 Notepad++ 操作為同一對話的明確 live 證據，但未覆蓋全部動作。macOS 不在本機 live 驗收範圍。

背景研究代理因模型 RPC admission timeout，任務未送出、無輸出；本文件由主代理直接完成，沒有虛稱獨立雙人審查。之前「SQL Server 模組造成衝突」未有單因子來源定位；目前只證實當時限制系統模組路徑後測試成功，不延續未證實的歸因。

**建議下一個開發批次只做 P1：真實可用性 probe、已載入版本辨識、失敗語義與 opt-in live 驗收。** 這比再暴露更多內部接口，更直接解決本次反覆「測試過了但 Pi 還不能用」的問題。
