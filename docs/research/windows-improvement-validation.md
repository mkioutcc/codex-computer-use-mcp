# Windows 四項改善驗證紀錄

日期：2026-09-09。此紀錄不把 mock、live 或略過結果混算。

## 已實作

1. Runtime status 增加 connectionReady:null、載入來源／resolver 指紋、版本与驗證阶段耗時；Pi `/computer-use-status --probe`、CLI `--probe`、MCP status probe 使用正式 transport 列舉視窗並清理。Pi native result middleware 將 details.ok:false 標為失敗且保留 observations。直接略過 middleware 的外部 wrapper 需檢查 details.ok/error。
2. Sky 完整 byte comparison 改為八個有界 reader；仍每次驗簽，不快取信任。工具 `tools/windows-benchmark.mjs` 提供交替順序的 serial/bounded 對比。
3. `npm run test:windows:live` 使用已註冊 Pi execute + 真實 worker/session/runtime，僅 ExtensionAPI registration 由 harness 捕捉；新 Notepad++ 分頁、空白與焦點確認、全文 marker 讀回及 image blocks，與普通 suite 分開。
4. sky.target="windows"；官方文件方法／參數名稱／optional 契約檢查；README 與工具指引說明 screenshot geometry、快照延遲、store 及官方停止要求。

Gemini 的本機 `allowBrowserCookies` 已依使用者同意設為 true；其他 API 設定未更動，不在此保存憑證。

## 已通過

- npm run check
- npm run check:pi（包含 build）
- npm test：58 tests，55 passed、0 failed、3 skipped（其中一項是明確 opt-in live test）。
- git diff --check
- 官方 api.md 契約：13 方法，無增漏；有參數的各方法欄位及 optionality 比對通過。
- 新程序 `node dist/mcp-server.js --probe`：runtimeVerified=true、connectionReady=true，10 個視窗；probeMs=7412。未輸出視窗內容。
- byte comparison 同一官方版本、交替順序 4 組：serial 382/343/349/348 ms；bounded 122/119/118/120 ms。約快 2.9 倍，**只是檔案比較階段**，不是整體 cold startup。整體仍約 4.5–5 秒驗證，Authenticode 約 3 秒為主要成本。

## 更新：真實新文件輸入讀回已通過

使用者確認桌面空閒後，第一次重跑發現官方 accessibility 將同一個 New 選單元素列了兩次（相同 element_index），測試以行數判斷唯一性而誤拒。修正測試：以觀察到的元素索引去重，仍要求恰好一個唯一元素；若 File 選單已展開，不再點擊將它收合。沒有修改官方回應或產品 selector。

- `node tools/windows-live.mjs --ui`：1 passed／0 failed／0 skipped；測試耗時 13,208 ms。
- 已真正完成：新空白 Notepad++ 分頁、焦點與空白確認、輸入唯一字串、完整 accessibility 讀回、取得非空圖像、關閉自有 session。
- 隨後重新執行 `npm run check`、`npm run check:pi`、`npm test`、`git diff --check`，全部通過；普通 suite 55 passed／0 failed／3 skipped，live 成功結果獨立記錄，不混算。
- 本驗收依舊是註冊入口捕捉 harness ＋真實 runtime，不宣稱另一個既有 Pi 程序已載入最新 extension middleware，也不等於所有應用程式／多螢幕情境全覆蓋。

## 歷史阻塞：真實新文件輸入讀回

下列為前輪失敗歷史，不代表更新後驗收狀態；當時未達成功門檻，因此沒有宣稱完成。

- 首次快捷鍵後 title 未切換，測試阻止 typing。
- 後續看到官方 `user input was detected in this window; call get_window_state before continuing`，立即失敗清理，沒有盲重播該動作。
- 改用觀察過的 File/New 選單及追加快照，最後仍未通過新文件 title 與空白焦點確認，故未輸入 marker。
- 多次觀察的作用中文件不同（settings.json、AGENTS.md）；不能單憑此證明是使用者手動操作、官方狀態延遲或其他前景干擾，需要安靜桌面條件下再驗證。
- 人工逐步透過當前 Pi 工具點 File/New 曾成功建立未儲存「新文件 1」，但這不是自動 live 測試的全文讀回通過，未拿來替代失敗結果。

全程未儲存、修改或關閉任何既有文件。最終通過的測試新增一個含唯一 marker 的未儲存分頁，留給使用者檢查；沒有降低全文或焦點斷言，也未停用官方保護。
