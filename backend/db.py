import sqlite3
import json
import os
import base64

DB_PATH = os.path.join(os.path.dirname(__file__), "lethe.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS chats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT DEFAULT 'New chat',
          history_json TEXT DEFAULT '[]',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          image_url TEXT,
          metadata TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS blocks (
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
          diffs TEXT,
          UNIQUE(chat_id, block_id)
        );
        """)
        conn.commit()

def create_chat(title="New chat"):
    with get_db() as conn:
        cursor = conn.execute("INSERT INTO chats (title) VALUES (?)", (title,))
        conn.commit()
        return cursor.lastrowid

def get_all_chats():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

def get_chat(chat_id):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
        return dict(row) if row else None

def update_chat_title(chat_id, title):
    with get_db() as conn:
        conn.execute(
            "UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (title, chat_id))
        conn.commit()

def delete_chat(chat_id):
    with get_db() as conn:
        conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
        conn.commit()

def touch_chat(chat_id):
    with get_db() as conn:
        conn.execute(
            "UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (chat_id,))
        conn.commit()

def save_history(chat_id, history, blocks):
    serialized = _serialize_history(history, blocks)
    with get_db() as conn:
        conn.execute(
            "UPDATE chats SET history_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (serialized, chat_id))
        conn.commit()

def load_history(chat_id):
    chat = get_chat(chat_id)
    if not chat:
        return []
    return _deserialize_history(chat.get("history_json") or "[]")

def _serialize_history(history, blocks):
    """Serialize history to JSON, replacing binary blobs with file refs."""
    block_paths = {}
    for bid, meta in blocks.items():
        midx = meta.get("message_index")
        if midx is None:
            continue
        if meta["type"] == "image":
            block_paths.setdefault(midx, {})["image"] = meta.get("path", "")
        elif meta["type"] == "pdf":
            block_paths.setdefault(midx, {})["document"] = meta.get("path", "")

    result = []
    for i, msg in enumerate(history):
        content = msg["content"]
        if isinstance(content, str):
            result.append({"role": msg["role"], "content": content})
        elif isinstance(content, list):
            parts = []
            for part in content:
                if part.get("type") == "image":
                    path = block_paths.get(i, {}).get("image", "")
                    parts.append({"type": "image_ref", "path": path})
                elif part.get("type") == "document":
                    path = block_paths.get(i, {}).get("document", "")
                    parts.append({"type": "document_ref", "path": path})
                else:
                    parts.append(part)
            result.append({"role": msg["role"], "content": parts})
    return json.dumps(result)

def _deserialize_history(history_json):
    """Deserialize history JSON, re-encoding file refs back to base64."""
    try:
        history = json.loads(history_json)
    except Exception:
        return []

    result = []
    for msg in history:
        content = msg["content"]
        if isinstance(content, str):
            result.append({"role": msg["role"], "content": content})
        elif isinstance(content, list):
            parts = []
            for part in content:
                if part.get("type") == "image_ref":
                    path = part.get("path", "")
                    if path and os.path.exists(path):
                        with open(path, "rb") as f:
                            data = base64.standard_b64encode(f.read()).decode()
                        ext = path.rsplit(".", 1)[-1].lower()
                        media_map = {
                            "jpg": "image/jpeg", "jpeg": "image/jpeg",
                            "png": "image/png", "gif": "image/gif", "webp": "image/webp"
                        }
                        media_type = media_map.get(ext, "image/jpeg")
                        parts.append({
                            "type": "image",
                            "source": {"type": "base64", "media_type": media_type, "data": data}
                        })
                    else:
                        parts.append({"type": "text", "text": f"[Image no longer available: {os.path.basename(path)}]"})
                elif part.get("type") == "document_ref":
                    path = part.get("path", "")
                    if path and os.path.exists(path):
                        with open(path, "rb") as f:
                            data = base64.standard_b64encode(f.read()).decode()
                        parts.append({
                            "type": "document",
                            "source": {"type": "base64", "media_type": "application/pdf", "data": data}
                        })
                    else:
                        parts.append({"type": "text", "text": f"[PDF no longer available: {os.path.basename(path)}]"})
                else:
                    parts.append(part)
            result.append({"role": msg["role"], "content": parts})
    return result

def save_display_message(chat_id, role, content, image_url=None, metadata=None):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO messages (chat_id, role, content, image_url, metadata) VALUES (?, ?, ?, ?, ?)",
            (chat_id, role, content,
             image_url,
             json.dumps(metadata) if metadata else None))
        conn.commit()

def get_display_messages(chat_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT role, content, image_url, metadata FROM messages "
            "WHERE chat_id = ? ORDER BY created_at",
            (chat_id,)).fetchall()
    result = []
    for r in rows:
        msg = {"role": r["role"], "content": r["content"]}
        if r["image_url"]:
            msg["image_url"] = r["image_url"]
        if r["metadata"]:
            try:
                msg.update(json.loads(r["metadata"]))
            except Exception:
                pass
        result.append(msg)
    return result

def upsert_block(chat_id, block_id, meta):
    diffs_json = json.dumps(meta.get("diffs", []))
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM blocks WHERE chat_id = ? AND block_id = ?",
            (chat_id, block_id)).fetchone()
        if existing:
            conn.execute("""
                UPDATE blocks SET type=?, path=?,
                    image_tokens=?, code_tokens=?, text_tokens=?, pdf_tokens=?,
                    summary_tokens=?, compressed=?, summary=?,
                    message_index=?, uploaded_at=?, base_code=?, diffs=?
                WHERE chat_id=? AND block_id=?
            """, (
                meta.get("type"), meta.get("path"),
                meta.get("image_tokens", 0), meta.get("code_tokens", 0),
                meta.get("text_tokens", 0), meta.get("pdf_tokens", 0),
                meta.get("summary_tokens", 0), int(meta.get("compressed", False)),
                meta.get("summary"), meta.get("message_index"),
                meta.get("uploaded_at"), meta.get("base_code"), diffs_json,
                chat_id, block_id
            ))
        else:
            conn.execute("""
                INSERT INTO blocks (chat_id, block_id, type, path,
                    image_tokens, code_tokens, text_tokens, pdf_tokens,
                    summary_tokens, compressed, summary,
                    message_index, uploaded_at, base_code, diffs)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                chat_id, block_id,
                meta.get("type"), meta.get("path"),
                meta.get("image_tokens", 0), meta.get("code_tokens", 0),
                meta.get("text_tokens", 0), meta.get("pdf_tokens", 0),
                meta.get("summary_tokens", 0), int(meta.get("compressed", False)),
                meta.get("summary"), meta.get("message_index"),
                meta.get("uploaded_at"), meta.get("base_code"), diffs_json
            ))
        conn.commit()

def rename_block(chat_id, old_id, new_id):
    with get_db() as conn:
        conn.execute(
            "UPDATE blocks SET block_id=? WHERE chat_id=? AND block_id=?",
            (new_id, chat_id, old_id))
        conn.commit()

def get_blocks_for_chat(chat_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM blocks WHERE chat_id=?", (chat_id,)).fetchall()
        return [dict(r) for r in rows]

def reconstruct_session(chat_id, client):
    """Rebuild a ContextSession from DB — called on cache miss after server restart."""
    from lethe import ContextSession
    session = ContextSession(client=client)
    session.history = load_history(chat_id)

    for block in get_blocks_for_chat(chat_id):
        block_id = block["block_id"]
        diffs = json.loads(block["diffs"]) if block.get("diffs") else []
        meta = {
            "id": block_id,
            "type": block["type"],
            "path": block["path"],
            "image_tokens": block["image_tokens"] or 0,
            "code_tokens": block["code_tokens"] or 0,
            "text_tokens": block["text_tokens"] or 0,
            "pdf_tokens": block["pdf_tokens"] or 0,
            "summary_tokens": block["summary_tokens"] or 0,
            "compressed": bool(block["compressed"]),
            "summary": block["summary"],
            "message_index": block["message_index"],
            "uploaded_at": block["uploaded_at"],
            "base_code": block["base_code"],
            "diffs": diffs,
        }
        if block["type"] == "text" and block.get("path") and os.path.exists(block["path"]):
            try:
                with open(block["path"], "r", encoding="utf-8", errors="replace") as f:
                    meta["content"] = f.read()
            except Exception:
                meta["content"] = ""
        session.blocks[block_id] = meta

    return session
