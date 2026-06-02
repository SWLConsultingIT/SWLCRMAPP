# V8 Native Generator — Haiku migration log (2026-06-02)

Workflow id: `Y3gQXLpaWjpP37XP`
Backup pre-migration: `v8-native-generator-pre-haiku-2026-06-01.json`

## Changes applied via `n8n_update_partial_workflow`

### 1. LLM swap — Main + Repair

| Node | Was | Now |
|---|---|---|
| `llm-main-v8` "OpenAI GPT-4o" → renamed "Haiku Main" | `lmChatOpenAi` model `gpt-4o` temp 0.5 | `lmChatAnthropic` model `claude-haiku-4-5-20251001` temp 0.5, cred id `xBqf4r5HfkCVhEiT` ("Anthropic Fran") |
| `llm-repair-v8` "OpenAI GPT-4o Repair" → renamed "Haiku Repair" | `lmChatOpenAi` model `gpt-4o` temp 0.35 | `lmChatAnthropic` model `claude-haiku-4-5-20251001` temp 0.35, same cred |

Left untouched (intentional):
- `llm-industry-v8` "OpenAI Tool LLM Industry" — `gpt-4o-mini` ($0.15/$0.60 per M) is cheaper than Haiku in the tool-call slot.
- `embed-industry-v8` "Embeddings Industry" — OpenAI embeddings, would break Pinecone vectors if changed.

### 2. JSON extractor robustness — Assemble Campaign + Apply Repairs

Both code nodes had a parser that did `text.indexOf('{')` + `text.lastIndexOf('}')` to slice the JSON. Haiku 4.5 wraps its output in ` ```json ` fences AND adds prose epilogue ("## Key decisions made: 1. **Connection request**…"). The trailing prose mentions placeholders like `{{first_name}}`, whose closing `}}` becomes the last `}` in the string — `JSON.parse` blew up on the slice and the catch returned `messages: []`.

Replaced both with a depth-tracking helper that walks from the first `{`, balances braces across strings + escapes, and stops at the first matching `}`. Robust to any trailing prose.

```js
function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch {}
      }
    }
  }
  return null;
}
```

## Validation

- Anthropic API model list: confirmed only `claude-haiku-4-5-20251001` (no 3.5-haiku) on this credential — first attempt with `claude-3-5-haiku-20241022` returned 404.
- Credential binding required explicit `id` — passing only `name: "Anthropic Fran"` made n8n auto-resolve to a stale `Anthropic account` cred (`cdUce91sLK49kzCn`) that returned 401.
- Ghost test ran against an SWL PE Spain lead (Alicia Calvo Serna @ COFIDES). Webhook returned 200 in 13.9s with a valid 3-message sequence + connectionRequest, all in Spanish (the lead's geography is Spain so the generator picked language correctly).

## Cost (per generation)

| Slot | Was (gpt-4o / 4o-mini) | Now (haiku-4-5 / 4o-mini) |
|---|---|---|
| Main | $0.0425 | $0.0200 |
| Tool LLM | $0.0005 (unchanged) | $0.0005 |
| Repair (× 0.3 trigger rate) | $0.0090 | $0.0042 |
| **TOTAL** | **$0.052** | **$0.025** |

Savings ~52% per campaign approve. At 1k generations/month ≈ $27/mo.
