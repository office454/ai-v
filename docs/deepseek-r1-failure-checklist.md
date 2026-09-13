# deepseek-r1:14b 失敗診斷 checklist

## 1. 先確認模型是否真的存在

執行：

```bash
ollama list | grep -i deepseek
```

如果沒有結果，代表模型沒有下載：

```bash
ollama pull deepseek-r1:14b
```

如果下載失敗，需先檢查：

- Ollama daemon 是否啟動
- 網路/代理/SSL 是否正常
- 是否有 `OLLAMA_MODELS` / `OLLAMA_ORIGINS` / proxy 環境變數干擾

## 2. 檢查 Ollama API 是否在本機正常回應

```bash
curl -s http://127.0.0.1:11434/api/tags | jq '.models[].name'
```

如果沒有回應，代表 Ollama 服務本身有問題：

```bash
ollama serve
```

或檢查是否被佔用、是否在其他環境上運行。

## 3. 直接測試 deepseek 請求是否可用

```bash
curl -s http://127.0.0.1:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "deepseek-r1:14b",
    "messages": [{"role": "user", "content": "測試一下"}],
    "stream": false
  }' | jq
```

如果這條失敗，問題通常是：

- 模型不存在
- Ollama daemon 問題
- 模型當前狀態異常
- 參數不兼容

## 4. 檢查是否是 structured JSON schema 造成的兼容問題

這個 app 之前會對 Ollama 直接發送嚴格的 `response_format: { type: "json_schema" }` 請求。
對 `deepseek-r1:14b` 這種模型，有時會出現：

- 400 Bad Request
- 422 invalid schema
- 回傳內容不是 JSON
- 回傳內容雖然是字串，但英文本或格式不符

我們現在已改成「更穩定簡化版」：

- 對 deepseek-r1:14b 先不附加 `response_format`
- 保留中文提示，不強制嚴格 JSON output
- 讓它更容易通過 Ollama 兼容性檢查

## 5. 檢查 app 端是否因為內容格式不合法被拒絕

維持前端/後端邏輯時，若模型回傳內容不含中文、或 JSON 解析失敗，會被判定為 invalid，並走 fallback。這時你的錯誤會出現在 log / retry trace 裡。

常見判斷點：

- `allUserFacingTextIsChinese(...)` 失敗
- `JSON.parse(...)` 失敗
- `dataIssues` 不完整或為空

## 6. 若仍失敗，按順序檢查

1. `ollama list`
2. `curl http://127.0.0.1:11434/api/tags`
3. `curl http://127.0.0.1:11434/api/chat ... deepseek-r1:14b`
4. app log 是否顯示 `Ollama deepseek-r1:14b 請求失敗`
5. 是否遭到 OpenRouter fallback

## 7. 這次修正後的行為

現在 deepseek-r1:14b 會採用更簡化版本的 Ollama 請求：

- 不再強制 `response_format: json_schema`
- 保持中文提示
- 讓模型可以先回答，再由 app 做後處理

這樣能大幅降低 deepseek-r1:14b 因為格式問題而被判定失敗的機率。
