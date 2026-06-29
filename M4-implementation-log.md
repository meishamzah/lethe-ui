# Milestone 4 Implementation Log

**Date:** 2026-06-28  
**Branch:** main

---

## Changes Made

### 1. `backend/lethe.py`

**`send()` signature extended:**
- Added `text_path=None` and `pdf_path=None` parameters

**Text file handling in `send()`:**
- Reads file as UTF-8, creates `[Text file '{name}']:\n{content}` text block
- Tracks in `session.blocks` with `type: "text"`, `text_tokens: len(content)//4`, `uploaded_at`
- Stores raw `content` in block for compression later

**PDF file handling in `send()`:**
- Reads file as bytes, base64-encodes, sends as `type: "document"` block (Claude native PDF)
- Tracks in `session.blocks` with `type: "pdf"`, `pdf_tokens: len(bytes)//6`, `uploaded_at`

**Code block token tracking:**
- Added `code_tokens: len(new_code)//4` to code block metadata on upload and re-upload

**New method: `_compress_text(block_id)`:**
- Builds conversation transcript
- Prompts Claude with tiered compression (discussed heavily → summary; lightly mentioned → 2-3 sentences; never mentioned → 1 sentence)
- Replaces `[Text file '...']` text block in history with `[Compressed text '...']`
- Guards: skips if summary_tokens ≥ original_tokens

**New method: `_compress_pdf(block_id)`:**
- Phase 1: conversational summarization (no PDF parsing)
- Prompts Claude to summarize what was discussed about the PDF
- Replaces the `type: "document"` block in history with a text summary
- Guards: skips if summary_tokens ≥ original_tokens (when token estimate is available)

**`compress()` dispatcher updated:**
- Now routes `type: "text"` → `_compress_text()`
- Now routes `type: "pdf"` → `_compress_pdf()`

---

### 2. `backend/app.py`

**`/send` route updated:**
- Added handling for `code_file`, `text_file`, `pdf_file` from `request.files`
- Saves code → `uploads/code/`, text → `uploads/text/`, PDF → `uploads/pdf/`
- PDF size validation: returns 400 if > 32MB (checked via seek/tell before saving)
- All new params passed through to `session.send()`

**`/status` route updated:**
- Strips heavy in-memory fields: `base_code`, `content`, `diffs`
- Computes and returns `versions` count for code blocks (`len(diffs) + 1`)
- Prevents large payloads from being sent on every status poll

**`app.run()` fix:**
- Added `use_reloader=False` — Flask's dev watcher was treating uploaded `.py` files as source changes, killing in-flight API requests

---

### 3. `frontend/src/App.jsx`

**`getBlockTokens(meta)` helper (module-level):**
- Returns `meta.code_tokens`, `meta.text_tokens`, `meta.pdf_tokens`, or `meta.image_tokens` depending on type
- Used everywhere tokens are summed or displayed, replacing the old `meta.image_tokens`-only logic

**Upload button replaced with dropdown menu:**
- `+` button now toggles `uploadMenuOpen` state
- Menu shows 4 options: 📷 Image · 📄 Code file · 📝 Text file · 📑 PDF
- Closes on outside click (via `useRef` + `document.addEventListener("mousedown")`)

**Hidden file inputs (4 total):**
- `imageInputRef` — `accept="image/*"`
- `codeInputRef` — `accept=".py,.js,.jsx,.ts,.tsx,.cpp,.c,.java,.go,.rs,.rb,.swift,.kt,.cs,.html,.css"`
- `textInputRef` — `accept=".txt,.md,.csv,.json,.xml,.yaml,.yml,.log"`
- `pdfInputRef` — `accept=".pdf"`, includes 32MB size check with user alert

**`pendingFile` unified state:**
- Replaces the old `imageFile` / `imagePreview` pair
- Shape: `{ file: File, type: "image"|"code"|"text"|"pdf", preview?: string }`
- Cleared on send, new chat, reset session, clear files

**`sendMessage()` updated:**
- Maps `pendingFile.type` to correct FormData field name (`image`, `code_file`, `text_file`, `pdf_file`)
- `attachedFile` in `userMsg` only set when `capturedFile && capturedFile.type !== "image"` (null guard fixed)
- Non-image attached files shown as a badge in the chat (emoji + filename)

**Token summary (Tracked / Active / Saved):**
- All three values now use `getBlockTokens()` instead of `b.image_tokens || 0`

**`confirmCompress()` updated:**
- `eligibleIds` filter uses `getBlockTokens()` for threshold check
- `prevTokens` / `newTotalTokens` / `savedNow` all use `getBlockTokens()`

**Type filter pills (Right Panel filter pills update — M4):**
- Added `pdfCount` and `textCount` computed values
- Pills `PDFs N` and `Text N` added to the type filter row
- Pills only appear when count > 0 (same pattern as Images and Code)
- Order: All types · Images · Code · PDFs · Text

**Right panel block rendering — all 3 views updated:**

`FileIcon` component added:
- Code: `</>` bracket SVG icon
- PDF: "PDF" text badge in red
- Text: horizontal lines SVG icon

*Detailed view:*
- Images: unchanged (thumbnail + filename)
- Code/Text/PDF: `[FileIcon] [filename + versions for code]` row, then meta row
- Version count display: `meta.versions` (from updated `/status`)
- Token display uses `getBlockTokens(meta)`
- Compression sweep animation: `compressing-row` class on non-image blocks

*List view:*
- `FileIcon` shown for non-image blocks before the filename
- Version count shown for code blocks
- Token display uses `getBlockTokens(meta)`

*Tile view:*
- Non-image blocks show `FileIcon` in a square aspect-ratio box (matches image tile size)
- Compression sweep animation: `compressing-row` class on non-image blocks

---

### 4. `frontend/src/index.css`

Added `.upload-menu-item:hover` rule:
- `background: #252525`
- `opacity: 1` (overrides global button hover opacity)

---

---

## Compression Guard — User Notification

**Date implemented:** 2026-06-28 (added after initial M4 commit)

### Overview
Previously, all compress methods returned `None` silently when the guard triggered (summary >= original tokens). No feedback was given to the user — the block appeared unchanged with no explanation.

### Changes

#### `backend/lethe.py`

**`compress()` dispatcher:**
- Now returns the result dict from the type-specific method
- Returns `{"compressed": False, "reason": "block_not_found", ...}` for missing blocks
- Returns `{"compressed": True, "reason": "already_compressed", ...}` for already-compressed blocks

**All 4 compress methods** (`compress_image`, `_compress_code`, `_compress_text`, `_compress_pdf`) now return a result dict:

Guard path (summary too large):
```python
return {
    "compressed": False,
    "reason": "summary_larger_than_original",
    "original_tokens": <int>,
    "summary_tokens": <int>
}
```

Success path:
```python
return {
    "compressed": True,
    "original_tokens": <int>,
    "summary_tokens": <int>
}
```

#### `backend/app.py`

**`/compress` route:**
- Captures return value from `session.compress(block_id)` instead of discarding it
- Merges `block_id` into each result dict
- Falls back to `{"compressed": False, "reason": "unknown", ...}` if result is `None`
- Returns `{"results": [...]}` array — one entry per requested block

**Response format:**
```json
{
  "results": [
    {"block_id": "big.txt", "compressed": true, "original_tokens": 444, "summary_tokens": 223},
    {"block_id": "tiny.txt", "compressed": false, "reason": "summary_larger_than_original", "original_tokens": 0, "summary_tokens": 77}
  ]
}
```

#### `frontend/src/App.jsx`

**`Toast` component** (new, module-level):
- Dark background, amber `⚠` icon, message text, ✕ dismiss button
- `fadeIn 0.2s` animation on mount
- Max width 340px, stacks vertically

**`toasts` state:** `useState([])` — array of `{id, message}` objects

**`flashingBlocks` state:** `useState([])` — array of block IDs with active amber border

**`addToast(message)` helper:**
- Generates unique ID via `Date.now() + Math.random()`
- Appends toast, auto-removes after 5000ms

**`confirmCompress()` updated:**
- Reads compress response JSON (was previously discarded)
- For each failed block with `reason === "summary_larger_than_original"`:
  - Calls `addToast()` with the architecture-specified message format
  - Sets `flashingBlocks` to include that block_id, removes after 1500ms
- Success banner (compressionMsg) only shown when at least one block succeeded

**Block border logic (all 3 views — detailed, list, tile):**
```js
border: flashingBlocks.includes(id) ? "1px solid #c8a020"
      : selected.includes(id)        ? "1px solid #4ECDC4"
      :                                "1px solid #2A2A2A"
```
Combined with existing `transition: "border 0.15s"` on `blockItem`/`listItem`, this produces a smooth amber flash.

**Toast container (fixed position, bottom-right):**
- `position: fixed`, `bottom: 24`, `right: panelOpen ? 296 : 16`
- Shifts with panel open/closed state (0.2s transition)
- `pointerEvents: none` on wrapper so toasts don't block panel interaction
- Individual toasts have `pointerEvents: auto` for dismiss button

### Test Results

| Test | Result |
|------|--------|
| Tiny file (3 chars) → guard fires | ✓ `compressed: false`, `reason: "summary_larger_than_original"`, `original_tokens: 0`, `summary_tokens: 77` |
| Block unchanged after guard | ✓ `compressed: false` confirmed on `/status` after compress attempt |
| Large file (444 tokens) → compression succeeds | ✓ `compressed: true`, `original_tokens: 444`, `summary_tokens: 223` |
| Frontend build | ✓ clean build, no errors |

---

---

## Code File Compression — Bug Fix (multi-version)

**Date:** 2026-06-28

### Bug Found
`_compress_code()` in `lethe.py` only replaced the code block in the FIRST upload message (at `message_index`). When a file was re-uploaded (creating a new message with `[Code block 'name' - updated version]`), those later messages were left untouched after compression. The full raw code remained in conversation history, so no actual token reduction occurred for re-uploaded files.

Additionally, `original_tokens` was estimated as `len(base_code)//4 + sum(len(d)//4 for d in diffs)` — this used the latest code + diffs rather than the actual text in history, making it an inaccurate measure of what compression would actually save.

### Fix (`backend/lethe.py` — `_compress_code()`)

**`original_tokens` now counts actual history text:**
```python
original_tokens = 0
for msg in self.history:
    content = msg.get("content")
    if not isinstance(content, list):
        continue
    for part in content:
        if part.get("type") == "text" and f"[Code block '{block_id}'" in part.get("text", ""):
            original_tokens += len(part["text"]) // 4
if original_tokens == 0:
    original_tokens = int(len(base_code) / 4) + sum(int(len(d) / 4) for d in diffs)
```

**All code block entries in history now replaced:**
- First message (`msg_index`): replaced with full summary as before
- All subsequent messages: replaced with a short stub `[{block_id} — additional version (included in compression summary)]`
- Net effect: ALL raw code is removed from conversation history after compression

### Test Results

| Test | Before Fix | After Fix |
|------|-----------|-----------|
| Single-version compress | ✓ worked | ✓ works |
| Multi-version: raw code in later messages | ✗ `[Code block...]` remained in history | ✓ replaced with stub |
| `original_tokens` accuracy | undercount (missed v1 text in history) | ✓ scans actual history text (1517 vs 976 for 2-version file) |

---

---

## Compressed Block Token Display + Compression Banner Fix

**Date:** 2026-06-28

### Changes

#### `frontend/src/App.jsx`

**Detailed view — teal summary token count on compressed blocks:**

Replaced the standalone `✓ compressed` badge with a flex row that puts the badge on the left and the new token count in teal on the right — directly below the original greyed token count, right-aligned to match:

```
image       1,234 tokens   ← original (grey, unchanged)
✓ compressed    146 tokens ← new (teal, on same row as badge)
```

Only rendered when `meta.summary_tokens != null && settings.showTokenCounts`.

**List view — teal summary token count on compressed blocks:**

Added a teal token count above the `✓` tick in the right-side column:

```
1,234   ← original (grey)
  146   ← summary (teal)
    ✓
```

**Compression success banner — batch-accurate token math:**

Previous: `from = sum of ALL block tokens before`, `to = sum of ALL active block tokens after` — included blocks from previous sessions, making the numbers confusing and misleading.

Fixed: `from` and `to` now come directly from the `/compress` response's per-block `original_tokens` / `summary_tokens`, summed only over the blocks that successfully compressed in this batch.

```js
const succeeded = results.filter(r => r.compressed)
const batchOriginal = succeeded.reduce((sum, r) => sum + (r.original_tokens || 0), 0)
const batchSummary  = succeeded.reduce((sum, r) => sum + (r.summary_tokens  || 0), 0)
setCompressionMsg({ from: batchOriginal, to: batchSummary, saved: batchOriginal - batchSummary })
```

Banner now shows e.g. `454 → 421 tokens` for the compressed files, not total context.

### Test Results

| Test | Result |
|------|--------|
| `/status` has `summary_tokens` after compression | ✓ confirmed (e.g. `code_tokens: 441`, `summary_tokens: 421`) |
| Banner shows batch-only token math | ✓ `454 -> 421` (not total-context numbers) |
| Frontend build | ✓ clean |

---

## What was NOT implemented (per spec)

- **PDF Phase 2** (full multimodal compression): deferred to its own milestone after M5
- **PDF page count validation** (100 pages max): requires PDF parsing library (Phase 2 dependency); only file size validation implemented for Phase 1
- **Scanned PDF detection**: also Phase 2

---

## Bugs Fixed During Implementation

1. **Flask reloader crash on `.py` uploads:** `use_reloader=False` added to `app.run()`
2. **`attachedFile` null guard in `userMsg`:** condition was `capturedFile?.type !== "image"` which evaluates truthy when `capturedFile` is null; fixed to `capturedFile && capturedFile.type !== "image"`

---

## Test Results

| Test | Result |
|------|--------|
| Text file upload (backend) | ✓ block created, `text_tokens` set correctly |
| Code file upload (backend) | ✓ block created, `code_tokens` set, `versions=1` |
| Code re-upload delta tracking | ✓ `versions=2` on second upload |
| `/status` heavy field stripping | ✓ `base_code`, `content`, `diffs` absent; `versions` present |
| Compress dispatcher (text) | ✓ dispatches to `_compress_text()` |
| Frontend build | ✓ clean build, no errors |
| PDF size validation gate | ✓ `pdf_file.seek/tell` pattern validated |
