import sqlite3
import json
import os
import base64

DB_PATH = os.path.join(os.path.dirname(__file__), "lethe.db")
DATABASE_URL = os.getenv("DATABASE_URL")
_USE_PG = bool(DATABASE_URL)

if _USE_PG:
    import psycopg2
    import psycopg2.extras


class _DB:
    """Unified connection wrapper for sqlite3 (local dev) and psycopg2 (production)."""

    def __init__(self):
        if _USE_PG:
            self._conn = psycopg2.connect(DATABASE_URL)
            self._is_pg = True
        else:
            self._conn = sqlite3.connect(DB_PATH)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA foreign_keys = ON")
            self._is_pg = False

    def execute(self, sql, params=()):
        if self._is_pg:
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(sql.replace("?", "%s"), params)
            return cur
        return self._conn.execute(sql, params)

    def execute_returning_id(self, sql, params=()):
        """Execute an INSERT and return the generated primary key."""
        if self._is_pg:
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(sql.replace("?", "%s") + " RETURNING id", params)
            return cur.fetchone()["id"]
        cur = self._conn.execute(sql, params)
        return cur.lastrowid

    def commit(self):
        self._conn.commit()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()
        self._conn.close()
        return False


def get_db():
    return _DB()


# ── Schema ─────────────────────────────────────────────────────────────────────

_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'free',
  api_key_encrypted TEXT,
  api_provider TEXT DEFAULT 'anthropic',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  auto_rename_images BOOLEAN DEFAULT 1,
  auto_compress_without_asking BOOLEAN DEFAULT 0,
  auto_compress_threshold INTEGER DEFAULT 80,
  compression_min_tokens INTEGER DEFAULT 500,
  show_token_counts BOOLEAN DEFAULT 1,
  auto_title_chats BOOLEAN DEFAULT 1,
  show_typing_animation BOOLEAN DEFAULT 1,
  send_on_enter BOOLEAN DEFAULT 1,
  default_view_mode TEXT DEFAULT 'detailed',
  default_status_filter TEXT DEFAULT 'all',
  panel_open_by_default BOOLEAN DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  guest_id TEXT,
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

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT,
  guest_id TEXT,
  user_id INTEGER,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

_PG_TABLES = [
    """CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      plan TEXT DEFAULT 'free',
      api_key_encrypted TEXT,
      api_provider TEXT DEFAULT 'anthropic',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      auto_rename_images BOOLEAN DEFAULT TRUE,
      auto_compress_without_asking BOOLEAN DEFAULT FALSE,
      auto_compress_threshold INTEGER DEFAULT 80,
      compression_min_tokens INTEGER DEFAULT 500,
      show_token_counts BOOLEAN DEFAULT TRUE,
      auto_title_chats BOOLEAN DEFAULT TRUE,
      show_typing_animation BOOLEAN DEFAULT TRUE,
      send_on_enter BOOLEAN DEFAULT TRUE,
      default_view_mode TEXT DEFAULT 'detailed',
      default_status_filter TEXT DEFAULT 'all',
      panel_open_by_default BOOLEAN DEFAULT TRUE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS chats (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      guest_id TEXT,
      title TEXT DEFAULT 'New chat',
      history_json TEXT DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      metadata TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS blocks (
      id SERIAL PRIMARY KEY,
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
      uploaded_at DOUBLE PRECISION,
      base_code TEXT,
      diffs TEXT,
      UNIQUE(chat_id, block_id)
    )""",
    """CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      event_type TEXT,
      guest_id TEXT,
      user_id INTEGER,
      metadata TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
]


def init_db():
    with get_db() as db:
        if db._is_pg:
            for stmt in _PG_TABLES:
                db.execute(stmt)
            cur = db.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='chats' AND table_schema='public'"
            )
            cols = [r["column_name"] for r in cur.fetchall()]
            if "user_id" not in cols:
                db.execute("ALTER TABLE chats ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE")
            if "guest_id" not in cols:
                db.execute("ALTER TABLE chats ADD COLUMN guest_id TEXT")
        else:
            db._conn.executescript(_SQLITE_DDL)
            cols = [r[1] for r in db._conn.execute("PRAGMA table_info(chats)").fetchall()]
            if "user_id" not in cols:
                db._conn.execute("ALTER TABLE chats ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE")
            if "guest_id" not in cols:
                db._conn.execute("ALTER TABLE chats ADD COLUMN guest_id TEXT")


# ── Users ──────────────────────────────────────────────────────────────────────

def create_user(google_id, email, display_name=None, avatar_url=None):
    with get_db() as db:
        return db.execute_returning_id(
            "INSERT INTO users (google_id, email, display_name, avatar_url) VALUES (?,?,?,?)",
            (google_id, email, display_name, avatar_url))

def get_user_by_google_id(google_id):
    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE google_id=?", (google_id,)).fetchone()
        return dict(row) if row else None

def get_user_by_id(user_id):
    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return dict(row) if row else None

def update_user(user_id, **fields):
    if not fields:
        return
    cols = ", ".join(f"{k}=?" for k in fields)
    with get_db() as db:
        db.execute(f"UPDATE users SET {cols} WHERE id=?", (*fields.values(), user_id))


# ── Settings ───────────────────────────────────────────────────────────────────

_SETTINGS_COLS = [
    "auto_rename_images", "auto_compress_without_asking", "auto_compress_threshold",
    "compression_min_tokens", "show_token_counts", "auto_title_chats",
    "show_typing_animation", "send_on_enter", "default_view_mode",
    "default_status_filter", "panel_open_by_default",
]

def get_settings(user_id):
    with get_db() as db:
        row = db.execute("SELECT * FROM settings WHERE user_id=?", (user_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        for k in ["auto_rename_images", "auto_compress_without_asking", "show_token_counts",
                   "auto_title_chats", "show_typing_animation", "send_on_enter", "panel_open_by_default"]:
            if k in d:
                d[k] = bool(d[k])
        return d

def upsert_settings(user_id, patch):
    valid = {k: v for k, v in patch.items() if k in _SETTINGS_COLS}
    if not valid:
        return
    with get_db() as db:
        existing = db.execute("SELECT 1 FROM settings WHERE user_id=?", (user_id,)).fetchone()
        if existing:
            cols = ", ".join(f"{k}=?" for k in valid)
            db.execute(
                f"UPDATE settings SET {cols}, updated_at=CURRENT_TIMESTAMP WHERE user_id=?",
                (*valid.values(), user_id))
        else:
            cols = ", ".join(valid.keys())
            placeholders = ", ".join("?" * (len(valid) + 1))
            db.execute(
                f"INSERT INTO settings (user_id, {cols}) VALUES ({placeholders})",
                (user_id, *valid.values()))


# ── Chats ──────────────────────────────────────────────────────────────────────

def create_chat(title="New chat", user_id=None, guest_id=None):
    with get_db() as db:
        return db.execute_returning_id(
            "INSERT INTO chats (title, user_id, guest_id) VALUES (?,?,?)",
            (title, user_id, guest_id))

def get_chats_for_user(user_id):
    with get_db() as db:
        rows = db.execute(
            "SELECT id, title, created_at, updated_at FROM chats "
            "WHERE user_id=? ORDER BY updated_at DESC", (user_id,)).fetchall()
        return [dict(r) for r in rows]

def get_chats_for_guest(guest_id):
    with get_db() as db:
        rows = db.execute(
            "SELECT id, title, created_at, updated_at FROM chats "
            "WHERE guest_id=? ORDER BY updated_at DESC", (guest_id,)).fetchall()
        return [dict(r) for r in rows]

def migrate_guest_chats(guest_id, user_id):
    """Reassign all guest chats to a real user on login."""
    with get_db() as db:
        db.execute(
            "UPDATE chats SET user_id=?, guest_id=NULL WHERE guest_id=?",
            (user_id, guest_id))

def get_chat(chat_id):
    with get_db() as db:
        row = db.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
        return dict(row) if row else None

def update_chat_title(chat_id, title):
    with get_db() as db:
        db.execute(
            "UPDATE chats SET title=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (title, chat_id))

def delete_chat(chat_id):
    with get_db() as db:
        db.execute("DELETE FROM chats WHERE id=?", (chat_id,))

def touch_chat(chat_id):
    with get_db() as db:
        db.execute(
            "UPDATE chats SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (chat_id,))


# ── Events ─────────────────────────────────────────────────────────────────────

def log_event(event_type, guest_id=None, user_id=None, metadata=None):
    with get_db() as db:
        db.execute(
            "INSERT INTO events (event_type, guest_id, user_id, metadata) VALUES (?,?,?,?)",
            (event_type, guest_id, user_id,
             json.dumps(metadata) if metadata else None))


# ── History ────────────────────────────────────────────────────────────────────

def save_history(chat_id, history, blocks):
    serialized = _serialize_history(history, blocks)
    with get_db() as db:
        db.execute(
            "UPDATE chats SET history_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (serialized, chat_id))

def load_history(chat_id):
    chat = get_chat(chat_id)
    if not chat:
        return []
    return _deserialize_history(chat.get("history_json") or "[]")

def _serialize_history(history, blocks):
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


# ── Messages ───────────────────────────────────────────────────────────────────

def delete_last_display_message(chat_id, role):
    with get_db() as db:
        db.execute(
            "DELETE FROM messages WHERE id = ("
            "  SELECT MAX(id) FROM messages WHERE chat_id=? AND role=?"
            ")", (chat_id, role))

def save_display_message(chat_id, role, content, image_url=None, metadata=None):
    with get_db() as db:
        db.execute(
            "INSERT INTO messages (chat_id, role, content, image_url, metadata) VALUES (?,?,?,?,?)",
            (chat_id, role, content,
             image_url,
             json.dumps(metadata) if metadata else None))

def get_display_messages(chat_id):
    with get_db() as db:
        rows = db.execute(
            "SELECT role, content, image_url, metadata FROM messages "
            "WHERE chat_id=? ORDER BY created_at",
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


# ── Blocks ─────────────────────────────────────────────────────────────────────

def upsert_block(chat_id, block_id, meta):
    diffs_json = json.dumps(meta.get("diffs", []))
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM blocks WHERE chat_id=? AND block_id=?",
            (chat_id, block_id)).fetchone()
        if existing:
            db.execute("""
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
            db.execute("""
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

def rename_block(chat_id, old_id, new_id):
    with get_db() as db:
        db.execute(
            "UPDATE blocks SET block_id=? WHERE chat_id=? AND block_id=?",
            (new_id, chat_id, old_id))

def get_blocks_for_chat(chat_id):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM blocks WHERE chat_id=?", (chat_id,)).fetchall()
        return [dict(r) for r in rows]


# ── Session reconstruction ─────────────────────────────────────────────────────

def reconstruct_session(chat_id, client, compress_client=None):
    from lethe import ContextSession
    session = ContextSession(client=client, compress_client=compress_client)
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
