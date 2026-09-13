# deepseek-r1:14b 實際操作版命令清單

## 1) 檢查模型是否存在

```bash
ollama list | grep -i deepseek
```

如果沒看到：

```bash
ollama pull deepseek-r1:14b
```

## 2) 檢查 Ollama 服務是否正常

```bash
curl -s http://127.0.0.1:11434/api/tags | jq '.models[].name'
```

如果沒回應：

```bash
ollama serve
```

## 3) 直接測 deepseek 是否能回答

```bash
curl -s http://127.0.0.1:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "deepseek-r1:14b",
    "messages": [{"role": "user", "content": "測試一下"}],
    "stream": false
  }' | jq
```

## 4) 如果這條失敗，先看是否為格式兼容問題

```bash
curl -s http://127.0.0.1:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "deepseek-r1:14b",
    "messages": [{"role": "user", "content": "只要回答一句中文就好。"}],
    "stream": false
  }' | jq
```

如果這條能回應，但 app 仍失敗，代表問題在：

- app 的 schema/JSON 驗證
- 中文內容檢查
- app fallback 邏輯

## 5) 如果要直接看 app 是否真的落到 OpenRouter

```bash
grep -R "deepseek-r1:14b\|openrouter/free\|OpenRouter" apps/api/src apps/web/src
```

## 6) 最終判斷

- 沒有 `ollama list` 結果：模型未下載
- `/api/tags` 沒回應：Ollama daemon 問題
- `/api/chat` 直接失敗：模型或 API 兼容問題
- /api/chat 可用，但 app 仍 fallback：是 app 的 schema/驗證問題

## 7) 這次已修正的做法

現在 deepseek-r1:14b 會改用更簡化的 Ollama 請求，不再強制 `response_format: json_schema`。這能避免它因為 structured-output 格式而被判定為失敗。 
