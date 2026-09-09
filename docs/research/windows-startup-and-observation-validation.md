# Windows 首次連線與觀察穩定性驗證

## 範圍

本次不使用 Fabric。保留官方 13 個 window2 方法、selector／參數原樣傳遞、每次新連線完整驗證、官方權限、零模型執行與 Job Object 清理。沒有新增正式 API 動作閘門、重播、焦點策略或替代控制引擎。

## 首次連線

- App discovery 與五個 executable 的 Authenticode 驗證合併為一個 PowerShell 程序。
- 仍明確從系統 PowerShell 模組目錄載入 `Microsoft.PowerShell.Security`。
- canonical 路徑、官方 deployment layout、native pipe 設定及完整 Sky byte comparison 通過後，才執行 broker。
- `powerShellTimingsMs` 是 `timingsMs.discoveryAndAuthenticode` 的子項，不能相加成總耗時。
- `sessionTimingsMs` 拆出 runtime verification、private directory、launcher/initialize、thread start、REPL setup、首次官方呼叫、turn ended、process cleanup。
- 沒有延長 session 壽命，也沒有信任快取。

### 相同驗證內容的交替程序比較

`node tools/windows-verification-benchmark.mjs` 將相同 discovery／驗簽內容分別在兩個、一個 PowerShell 程序執行，每輪交替順序：

| 輪次 | 兩個程序 ms | 一個程序 ms |
|---|---:|---:|
| 1 | 4669 | 4309 |
| 2 | 4509 | 4264 |
| 3 | 4527 | 3948 |
| 中位數 | **4527** | **4264** |

此階段約節省 **263 ms／5.8%**。不是所有 UI 呼叫或完整冷啟動都快 5.8%。

### 正式首次連線與暖呼叫

`node tools/windows-startup-benchmark.mjs` 使用三個新的正式 session，各執行三次唯讀 `list_windows`，斷言每個 session 只驗證一次並完成清理：

| 樣本 | 首次呼叫 ms | 第二次 ms | 第三次 ms | runtime 驗證 ms | initialize ms | REPL setup ms | 首次官方方法 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 11659 | 27 | 27 | 5558 | 1669 | 1547 | 2050 |
| 2 | 9795 | 35 | 28 | 5549 | 1785 | 1484 | 65 |
| 3 | 10477 | 28 | 32 | 5958 | 2083 | 1530 | 59 |

首次呼叫中位數 **10477 ms**，暖呼叫 **27–35 ms**。cleanup 為 195–228 ms。這是新的 adapter sessions，不是清除 OS／官方 App 快取後的測試；官方服務的首次呼叫耗時也受既有 App 狀態影響。

改動前曾量得首次呼叫 19661／24847／11162 ms；改動後早期樣本為 14155／13524／12966 ms。系統負載與 App 狀態差異很大，不能把這些非交替樣本的差距當成本次改動的因果加速比例。

## 觀察與實機驗收

`test/helpers/windows-observation.ts` 僅供 acceptance tests 使用：

- 相同 `element_index` 重複行去重；不同匹配索引仍視為模糊，不任選。
- 多個候選 Window 不任選，也不改寫官方 selector。
- 有界重讀快照；等待文件內容、焦點或相關索引一致，不以 title 更新當成文件已更新。
- 需要選取控制項時，可等待相關索引連續兩次一致。這不是官方快照原子性的保證。
- 所有輸入只發出一次；官方錯誤與取消立即往外傳遞，不自動重播。

正式流程明確啟用已回傳的 Notepad++ 視窗，再重新觀察。新建未儲存分頁後，確認空白編輯器焦點才輸入 marker；讀回依據是文件／focused editor，不是包含 marker 的視窗標題。

搜尋對話框實測是 **owner 視窗內的 transient UI**：`list_windows` 不另列它，但 owner 的 accessibility 和 screenshots 包含對話框。測試使用實際回傳的 owner，而不是合成 HWND。加強案例驗證主視窗與對話框的圖片數量、非空影像、唯一 screenshot IDs、origin／尺寸 metadata，使用 Escape 關閉搜尋，並確認回到原測試編輯器。

```powershell
node tools/windows-live.mjs --ui --dialog
```

調整後連續兩次通過，各 **1 passed、0 failed、0 skipped**；最近一次也包含多圖 metadata 斷言。沒有儲存或編輯使用者原有文件；新測試分頁留在 Notepad++。

### 過程中的失敗與仍有的限制

1. 桌面未恢復互動時，官方回報 `failed to activate captured window`，截圖為黑畫面。停止輸入，使用者確認解鎖後才繼續，沒有替代引擎或繞過。
2. 第一版錯把 owned dialog 當成獨立 Window，實測後修正為依官方實際表示方式觀察。
3. 元素索引曾在重新觀察後改變；曾遇到 `element ... is not available in cached app state`。重新觀察後才另行決定操作，沒有重播舊索引。
4. File menu 與浮動對話框的點擊曾回報成功但未呈現預期效果。明確 activation 解決了最後兩次測試的起始 File menu 操作；**不能宣稱官方 Close 按鈕點擊問題已修復**。目前宣告的 dialog 驗收使用 Escape，不是點擊失敗後自動 fallback。
5. 真正的不同 DPI、任意多螢幕配置、其他 App／語言、`drag`、`set_value`、`perform_secondary_action`、physical Escape，仍未完成全面實機驗收。負 origin、不同 screenshot region／座標不縮放已有 deterministic transport regression；不把它當成完整實機 DPI 測試。

## 最終驗證

- `npm run check`、`npm run check:pi`、`npm test`、`npm run build`、`git diff --check` 通過。
- 最新普通 suite：**69 tests、66 passed、0 failed、3 skipped**。opt-in UI 另跑，不拿 skipped 當成功。
- `node dist/mcp-server.js --probe`：`runtimeVerified: true`、`connectionReady: true`、12 windows、10705 ms；broker `codex-cli 0.153.4`、plugin `26.901.51231`。不輸出視窗標題。
- 直接以 `node tools/windows-contract.mjs "<官方 api.md>"` 檢查：**13 compatible、missing []、extra []**。本機 shell 透過 npm 轉交含空白路徑時曾產生 caret quoting 問題，因此這次 contract 結果來自直接 Node 呼叫，不宣稱那次 npm 指令成功。
- 驗簽測試包含 mock 的缺 App／無效簽章／錯誤 signer，以及真實 Windows Authenticode 對未簽署檔案的拒絕；正式 probe 另驗證實際已簽署 runtime。
- 未執行 Git add、commit 或 push；`.pi/` 與本機 Cookie 設定不納入本次修改。
