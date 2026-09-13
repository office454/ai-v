#!/usr/bin/env bash
set -u

MODEL="deepseek-r1:14b"
OLLAMA_URL="http://127.0.0.1:11434"

echo "== 1/4 檢查模型是否存在 =="
echo "- 指令: ollama list | grep -i deepseek"
ollama list | grep -i deepseek || {
  echo "- 沒找到 deepseek 模型，先下載..."
  ollama pull "$MODEL"
}

echo

echo "== 2/4 檢查 Ollama API =="
echo "- 指令: curl -s $OLLAMA_URL/api/tags | jq '.models[].name'"
curl -s "$OLLAMA_URL/api/tags" | jq '.models[].name' || {
  echo "- Ollama API 沒回應，先啟動服務..."
  ollama serve
  exit 1
}

echo

echo "== 3/4 直接測試 deepseek =="
curl -s "$OLLAMA_URL/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{\
    \"model\": \"$MODEL\",\
    \"messages\": [{\"role\": \"user\", \"content\": \"測試一下\"}],\
    \"stream\": false\
  }" | jq

status=$?
if [ "$status" -ne 0 ]; then
  echo "- deepseek 測試失敗，請檢查模型是否正常或 Ollama 是否可用。"
  exit "$status"
fi

echo

echo "== 4/4 簡化版兼容性測試 =="
curl -s "$OLLAMA_URL/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{\
    \"model\": \"$MODEL\",\
    \"messages\": [{\"role\": \"user\", \"content\": \"只要回答一句中文就好。\"}],\
    \"stream\": false\
  }" | jq

echo

echo "== 結論 =="
echo "- 如果 /api/chat 可以正常回應，代表 Ollama 端本身是正常的。"
echo "- 若 app 仍 fallback 到 OpenRouter，通常是 app 的 schema/JSON 驗證或內容格式判斷問題。"
echo "- 目前 deepseek 已改為更穩定簡化請求，不再強制使用 response_format=json_schema。"
