# Milestone 5 Phase 1 Implementation Log

**Date:** 2026-06-29  
**Branch:** main

---

## Overview

Implements persistence so chats, messages, and blocks survive server restarts and page refreshes. No auth in Phase 1 — all chats are local with no user association. Phase 2 (Google OAuth) is deferred.

---

## Changes Made

### 1. `backend/db.py` (new file)

SQLite database layer.

**Schema (3 tables, no `users` table in Phase 1):**

```sql
CREATE TABLE chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT 'New chat',
  history_json TEXT DEFAULT '[]',         -- serialized session.history (file refs, not base64)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,                  -- user's text message
  image_url TEXT,                         -- served path like /uploads/image.jpg
  metadata TEXT,                          -- JSON: attached_file name/type for non-image uploads
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT,
  image_tokens INTEGER DEFAULT 0,
  code_tokens INTEGER DEFAULT 0,
  text_tokens INTEGER DEFAULT 0,
  pdf_tokens INTEGER DEFAULT 0,
  summary_tokens INTEGER DEFAULT 0,
  compressed BOOLEAN DEFAULT FALSE,
  summary TEXT,
  message_index INTEGER,
  uploaded_at REAL,
  base_code TEXT,
  diffs TEXT,                             -- JSON-serialized list of diff strings
  UNIQUE(chat_id, block_id)
);
```

**Key design decision — history serialization:**

`session.history` can contain large binary blobs (image base64, PDF base64). Rather than storing these in SQLite TEXT fields (which would bloat the DB), we serialize them as file refs:

- `{"type": "image", "source": {"type": "base64", ...}}` → `{"type": "image_ref", "path": "uploads/image.jpg"}`
- `{"type": "document", "source": {...}}` → `{"type": "document_ref", "path": "uploads/pdf/file.pdf"}`

On reconstruction, file refs are re-encoded back to base64 by reading from disk. If the file is missing, a placeholder text part is substituted so the conversation can still continue.

**`reconstruct_session(chat_id, client)`:**
- Deserializes history from `chats.history_json` (expanding file refs)
- Rebuilds `session.blocks` from the blocks table
- For text blocks: re-reads raw file content from disk (needed by `_compress_text`)
- Returns a fully functional `ContextSession`

**Other helpers:**
- `create_chat()`, `get_all_chats()`, `get_chat()`, `update_chat_title()`, `delete_chat()`
- `save_display_message()`, `get_display_messages()` — for UI restoration
- `upsert_block()`, `rename_block()` — block CRUD
- `save_history()` — called after every send/compress to keep history_json current

---

### 2. `backend/app.py`

**Replaced single global `session`/`chat_counter` with:**
```python
sessions = {}       # dict of chat_id → ContextSession (in-memory cache)
active_chat_id = None
```

**On startup:**
- `database.init_db()` creates tables if not exist
- If no chats in DB: creates a default "New chat" and sets it as active
- If chats exist: sets `active_chat_id` to the most recent one (frontend calls `/switch_chat` to load it)

**`get_active_session()`:**
- Returns `sessions[active_chat_id]`
- If not in cache (e.g. after server restart before frontend calls `/switch_chat`): reconstructs from DB

**New endpoints:**

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/chats` | Returns all chats sorted by `updated_at DESC` |
| `POST` | `/new_chat` | Creates chat in DB, returns `chat_id` |
| `POST` | `/switch_chat/<id>` | Sets active chat, reconstructs if needed, returns messages + blocks |
| `PUT` | `/chats/<id>/title` | Updates chat title in DB |
| `DELETE` | `/chats/<id>` | Deletes chat + cascades; auto-creates new chat if last one deleted |
| `GET` | `/uploads/<path:filename>` | Serves files from the `uploads/` directory |

**`/send` now also:**
- Normalizes file paths to forward slashes (`os.sep` → `/`) before saving
- Calls `database.save_display_message()` for both user and assistant messages
- Calls `database.upsert_block()` for all blocks after the send
- Calls `database.save_history()` to persist current session history
- Calls `database.update_chat_title()` when `chat_title` is returned
- Calls `database.rename_block()` when `image_title` renames a block

**`/compress` now also:**
- Calls `database.upsert_block()` for each successfully compressed block
- Calls `database.save_history()` after all compressions (history was modified in-place)

**`/reset` now:**
- Deletes ALL chats from DB and their cascaded messages/blocks
- Creates a fresh "New chat"
- Clears the `sessions` dict

---

### 3. `frontend/src/App.jsx`

**Initial state changes:**
- `chats`: `[]` (was `[{id: 1, title: "New Chat"}]`) — populated from backend on mount
- `activeChatId`: `null` (was `1`) — set when switching to a chat

**New function `switchToChat(id)`:**
```js
const switchToChat = async (id) => {
  setActiveChatId(id)
  const res = await fetch(`${API}/switch_chat/${id}`, { method: "POST" })
  const data = await res.json()

  // Restore display messages
  setMessages(data.messages.map(msg => ({
    role: msg.role,
    content: msg.content,
    image: msg.image_url ? `${API}${msg.image_url}` : null,
    attachedFile: msg.attached_file || null
  })))

  // Restore blocks
  setBlocks(data.blocks)

  // Reconstruct previews from block paths (served via /uploads/)
  const newPreviews = {}
  Object.entries(data.blocks).forEach(([bid, meta]) => {
    if (meta.type === "image" && meta.path) {
      newPreviews[bid] = `${API}/${meta.path.replace(/\\/g, "/")}`
    }
  })
  setPreviews(newPreviews)

  setSelected([])
  setPendingFile(null)
  setCompressionMsg(null)
  setCompressionMsgFading(false)
}
```

**New function `fetchChats()`:**
- Calls `GET /chats` on mount
- Populates sidebar with all chats
- Auto-loads most recent via `switchToChat(chats[0].id)`

**`useEffect` on mount:**
```js
useEffect(() => {
  fetchChats()
}, [])
```

**Sidebar:**
- Chats sorted newest-first (backend returns `ORDER BY updated_at DESC`)
- Clicking a different chat calls `switchToChat(id)`
- Each chat has a `✕` delete button:
  - Calls `DELETE /chats/<id>`
  - Removes from `chats` state
  - If the deleted chat was active, switches to `data.active_chat_id`

**`+ New` button:** Adds new chat to the front of `chats` state (rather than back).

**`handleClearFiles` / `handleResetSession`:** Both update `chats` state from `/reset` response.

---

## Architecture Deviation

The spec's `messages` table includes `image_url TEXT` for storing image references. We extended it with a `metadata TEXT` column (JSON) for non-image attached files (`attached_file: {name, type}`). This avoids needing separate columns for each file type.

The spec includes a `users` table in Phase 1 schema. We omitted it — no auth in Phase 1, so `user_id` references were removed. Phase 2 will add both.

---

## Test Results

| Test | Result |
|------|--------|
| DB init creates tables | PASS |
| `GET /chats` returns all chats | PASS |
| `POST /new_chat` creates DB entry, returns integer ID | PASS |
| `POST /send` persists display messages | PASS — 2 messages restored after switch |
| `POST /send` persists blocks | PASS — `greet.py` restored with correct `code_tokens` |
| `POST /switch_chat` restores messages | PASS |
| `POST /switch_chat` restores blocks | PASS |
| `GET /uploads/<path>` serves files | PASS — 200, correct content length |
| `DELETE /chats/<id>` removes chat | PASS — not in subsequent `/chats` response |
| **Server restart** → chats still accessible | PASS — 4 chats persisted across restart |
| **Server restart** → conversation continues | PASS — Claude replied coherently using reconstructed history |
| `POST /compress` persists after switch | PASS (guard fired for tiny file; large-file compression also verified to persist) |
| Frontend build | PASS — clean build, no errors |

---

## What Was NOT Implemented (Phase 2)

- Google OAuth
- `users` table
- `settings` table (settings stay in localStorage until Phase 2)
- Guest session management
- API key pool
- Context health bar
- Multi-device sync (requires deployment)
