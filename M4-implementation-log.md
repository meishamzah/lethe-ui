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
