# Windows probe 單次驗證效能驗收

日期：2026-09-09。此輪只優化 diagnostic probe 的重複驗證，不變更官方操作、安全檢查或 session 壽命。

## 修正

舊流程：Pi／MCP／CLI status → getWindowsStatus 完整驗證 → probe → connect 再完整驗證。

新流程：probe → connect → inspectWindowsRuntime 一次完整驗證；連線把同一次驗證的非敏感 status metadata 交给 probe，再執行 list_windows，最後清理。只查 status 時仍透過 inspectWindowsRuntime 驗證，不建立連線。

- 沒有新增已驗證 runtime 的輸入 override。
- 沒有快取驗簽結果；每次新連線仍驗證 Authenticode 與全部 Sky 檔案。
- 未延長 session，未改動 turn_ended、Job Object 或官方 app。
- 驗證失敗仍回報 runtimeVerified=false／connectionReady=false；新回歸測試確認再次嘗試會重新驗證。
- probeMs 包含驗證與第一次呼叫；verificationMs 是其中子集。probe 返回前會完成 cleanup。

## 實測方法與結果

直接先後三次 CLI 的 before/after 耗時有明顯系統負載波動，不能從這兩批數值可靠歸因。因此用相同新程式、同一官方安裝版本，在同一測量程序中交替執行：

- control：getWindowsStatus + probeWindowsConnection，重現原來雙重驗證。
- optimized：probeWindowsConnection，單次驗證。

每次 probe 都建立並關閉自己的新連線；沒有桌面輸入，也不記錄視窗內容。

重現：`npm run build` 後執行 `node tools/windows-probe-benchmark.mjs`。

| 回合 | 雙重驗證含清理 ms | 單次驗證含清理 ms |
| --- | ---: | ---: |
| 1 | 17056 | 9680 |
| 2（順序反轉） | 15692 | 10203 |
| 3 | 14328 | 9196 |
| 中位數 | 15692 | 9680 |

本輪 diagnostic probe 中位數下降約 **38.3%**。樣本數只有各 3 次，且包含 OS 快取與負載影響，不保證所有電腦或每一次呼叫都有同樣改善。不是一般 UI 方法首次連線也下降 38%。

另以真正 WindowsSessionExecutor，兩次連線各呼叫 list_windows 三次：

- 連線 1：10831 / 27 / 23 ms；驗證回報次數維持 1。
- 關閉後連線 2：10113 / 25 / 26 ms；驗證回報次數為 2。

確認暖呼叫沿用現有連線，重開連線重新驗證，不是永久信任 cache。

## 驗證

- npm run check：通過。
- npm run check:pi（含 build）：通過。
- npm test：59 tests，56 passed，0 failed，3 skipped；macOS suite 依平台略過。
- git diff --check：通過（Git 有 LF/CRLF 提示，不是失敗）。
- 六次交替真實 probe：全部 runtimeVerified=true、connectionReady=true、無 cleanupError。
- 六次真實 list_windows：全部成功，兩次新連線都重新驗證。
- 此輪沒有重跑會新增 Notepad++ 分頁的 opt-in UI 測試；本次僅改驗證與診斷路徑，使用唯讀官方呼叫验收。

## 下一個瓶頸

单次驗證仍主要花在 Authenticode／PowerShell。此輪已把每次 probe 的驗證相關 PowerShell 啟動由兩組降成一組；没有合併單一連線內的 discovery 與簽章程序。若繼續做更深入程序合併，應獨立量測與驗收，不為了追求數字省略驗簽、改變官方啟動條件或放寬權限。
