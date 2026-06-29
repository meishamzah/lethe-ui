import os
import sys
import io
import re
import secrets
from flask import Flask, request, jsonify, send_from_directory, session
from flask_cors import CORS
from dotenv import load_dotenv
import anthropic
import flask_login
from cryptography.fernet import Fernet
from lethe import ContextSession
import db as database
from auth import auth_bp, init_oauth, User, _load_user

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

load_dotenv()

app = Flask(__name__)

def _load_or_create_secret():
    env_key = os.getenv("FLASK_SECRET_KEY")
    if env_key:
        return env_key
    key_file = os.path.join(os.path.dirname(__file__), ".flask_secret")
    if os.path.exists(key_file):
        with open(key_file, "r") as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(key_file, "w") as f:
        f.write(key)
    return key

app.secret_key = _load_or_create_secret()

# On Railway (HTTPS), cross-origin cookies require SameSite=None + Secure.
# Detected via RAILWAY_ENVIRONMENT env var which Railway sets automatically.
_production = bool(os.getenv("RAILWAY_ENVIRONMENT"))
if _production:
    app.config["SESSION_COOKIE_SAMESITE"] = "None"
    app.config["SESSION_COOKIE_SECURE"] = True
    app.config["REMEMBER_COOKIE_SAMESITE"] = "None"
    app.config["REMEMBER_COOKIE_SECURE"] = True

_frontend_url = os.getenv("FRONTEND_URL", "")
CORS(app, supports_credentials=True,
     origins=["http://localhost:5173", "http://127.0.0.1:5173",
               _frontend_url] if _frontend_url else ["http://localhost:5173", "http://127.0.0.1:5173"])

# ── Flask-Login ─────────────────────────────────────────────────────────────────

login_manager = flask_login.LoginManager(app)

@login_manager.user_loader
def load_user(user_id):
    return _load_user(user_id)

# ── OAuth ───────────────────────────────────────────────────────────────────────

init_oauth(app)
app.register_blueprint(auth_bp)

# ── API key pools ───────────────────────────────────────────────────────────────

_default_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

_CHAT_POOL    = [k.strip() for k in os.getenv("CHAT_KEY_POOL", "").split(",") if k.strip()]
_BACKEND_POOL = [k.strip() for k in os.getenv("BACKEND_KEY_POOL", "").split(",") if k.strip()]

def _pool_client(pool, guest_id):
    if not pool or not guest_id:
        return _default_client
    idx = hash(guest_id) % len(pool)
    return anthropic.Anthropic(api_key=pool[idx])

def _get_client_for_identity():
    """Return the right Anthropic client for the current request's identity."""
    if flask_login.current_user.is_authenticated:
        # Use the user's own stored API key if present
        enc = flask_login.current_user.api_key_encrypted
        if enc:
            try:
                raw = _decrypt_key(enc)
                return anthropic.Anthropic(api_key=raw)
            except Exception:
                pass
    guest_id = request.cookies.get("lethe_guest_id")
    return _pool_client(_CHAT_POOL, guest_id)

# ── Encryption ──────────────────────────────────────────────────────────────────

def _get_fernet():
    key = os.getenv("LETHE_ENCRYPTION_KEY")
    if not key:
        return None
    return Fernet(key.encode() if isinstance(key, str) else key)

def _encrypt_key(raw):
    f = _get_fernet()
    if not f:
        raise RuntimeError("LETHE_ENCRYPTION_KEY not set")
    return f.encrypt(raw.encode()).decode()

def _decrypt_key(enc):
    f = _get_fernet()
    if not f:
        raise RuntimeError("LETHE_ENCRYPTION_KEY not set")
    return f.decrypt(enc.encode()).decode()

# ── Reply cleaning ──────────────────────────────────────────────────────────────

_HR = re.compile(r"^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$", re.MULTILINE)

def _clean_injected_reply(raw, wants_title, wants_image_title):
    """
    Split on the lowest horizontal rule; extract metadata tags below it.
    Falls back to inline stripping if no separator is present.
    Returns (visible_reply, chat_title, image_title).
    """
    chat_title = image_title = None
    matches = list(_HR.finditer(raw))

    if matches:
        last_hr = matches[-1]
        visible  = raw[:last_hr.start()].rstrip()
        metadata = raw[last_hr.end():]
    else:
        visible  = raw
        metadata = raw

    if wants_title:
        m = re.search(r"\[CHAT_TITLE\](.*?)\[/CHAT_TITLE\]", metadata, re.DOTALL)
        if m:
            chat_title = m.group(1).strip()

    if wants_image_title:
        m = re.search(r"\[IMAGE_TITLE\](.*?)\[/IMAGE_TITLE\]", metadata, re.DOTALL)
        if m:
            image_title = m.group(1).strip()

    if not matches:
        if wants_title:
            visible = re.sub(r"\[CHAT_TITLE\].*?\[/CHAT_TITLE\]", "", visible, flags=re.DOTALL)
        if wants_image_title:
            visible = re.sub(r"\[IMAGE_TITLE\].*?\[/IMAGE_TITLE\]", "", visible, flags=re.DOTALL)
        visible = visible.strip()

    return visible, chat_title, image_title

# ── Identity helpers ────────────────────────────────────────────────────────────

def get_identity():
    """Returns (type, id) for the current request. type is 'user' or 'guest'."""
    if flask_login.current_user.is_authenticated:
        return ("user", flask_login.current_user.id)
    guest_id = request.cookies.get("lethe_guest_id")
    return ("guest", guest_id)

def get_chats_for_identity():
    kind, ident = get_identity()
    if kind == "user":
        return database.get_chats_for_user(ident)
    return database.get_chats_for_guest(ident) if ident else []

def create_chat_for_identity(title="New chat"):
    kind, ident = get_identity()
    if kind == "user":
        return database.create_chat(title, user_id=ident)
    return database.create_chat(title, guest_id=ident)

# ── Session cache ───────────────────────────────────────────────────────────────

_sessions = {}  # chat_id → ContextSession in-memory cache

def _active_chat_id():
    return session.get("active_chat_id")

def _set_active_chat_id(chat_id):
    session["active_chat_id"] = chat_id

def get_active_session():
    chat_id = _active_chat_id()
    if chat_id is None:
        return None
    if chat_id not in _sessions:
        client = _get_client_for_identity()
        _sessions[chat_id] = database.reconstruct_session(chat_id, client)
    return _sessions.get(chat_id)

# ── DB init ─────────────────────────────────────────────────────────────────────

database.init_db()

# ── Chat management ─────────────────────────────────────────────────────────────

@app.route("/chats", methods=["GET"])
def get_chats():
    return jsonify({"chats": get_chats_for_identity()})

@app.route("/new_chat", methods=["POST"])
def new_chat():
    chat_id = create_chat_for_identity("New chat")
    _set_active_chat_id(chat_id)
    _sessions[chat_id] = ContextSession(client=_get_client_for_identity())
    database.log_event("new_chat", **_event_ctx())
    return jsonify({"chat_id": chat_id})

@app.route("/switch_chat/<int:chat_id>", methods=["POST"])
def switch_chat(chat_id):
    chat = database.get_chat(chat_id)
    if not chat:
        return jsonify({"error": "Chat not found"}), 404

    _set_active_chat_id(chat_id)
    if chat_id not in _sessions:
        _sessions[chat_id] = database.reconstruct_session(chat_id, _get_client_for_identity())

    sess = _sessions[chat_id]

    strip_keys = {"base_code", "content", "diffs"}
    safe_blocks = {}
    for block_id, meta in sess.blocks.items():
        safe_meta = {k: v for k, v in meta.items() if k not in strip_keys}
        if meta.get("type") == "code":
            safe_meta["versions"] = len(meta.get("diffs", [])) + 1
        safe_blocks[block_id] = safe_meta

    return jsonify({
        "chat_id": chat_id,
        "messages": database.get_display_messages(chat_id),
        "blocks": safe_blocks,
    })

@app.route("/chats/<int:chat_id>/title", methods=["PUT"])
def update_title(chat_id):
    data = request.json or {}
    title = data.get("title", "").strip()
    if not title:
        return jsonify({"error": "Title required"}), 400
    database.update_chat_title(chat_id, title)
    return jsonify({"ok": True})

@app.route("/chats/<int:chat_id>", methods=["DELETE"])
def delete_chat_route(chat_id):
    database.delete_chat(chat_id)
    _sessions.pop(chat_id, None)

    new_active = _active_chat_id()
    if _active_chat_id() == chat_id:
        remaining = get_chats_for_identity()
        if remaining:
            new_active = remaining[0]["id"]
        else:
            new_active = create_chat_for_identity("New chat")
            _sessions[new_active] = ContextSession(client=_get_client_for_identity())
        _set_active_chat_id(new_active)

    return jsonify({"ok": True, "active_chat_id": new_active})

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory("uploads", filename)

# ── Auth helpers ────────────────────────────────────────────────────────────────

def _event_ctx():
    kind, ident = get_identity()
    return {"guest_id": ident if kind == "guest" else None,
            "user_id":  ident if kind == "user"  else None}

# ── Settings endpoints ──────────────────────────────────────────────────────────

@app.route("/settings", methods=["GET"])
def get_settings_route():
    if not flask_login.current_user.is_authenticated:
        return jsonify({"error": "Not authenticated"}), 401
    s = database.get_settings(flask_login.current_user.id) or {}
    return jsonify({"settings": s})

@app.route("/settings", methods=["POST"])
def update_settings_route():
    if not flask_login.current_user.is_authenticated:
        return jsonify({"error": "Not authenticated"}), 401
    patch = request.json or {}
    database.upsert_settings(flask_login.current_user.id, patch)
    return jsonify({"ok": True})

@app.route("/settings/api_key", methods=["POST"])
def save_api_key():
    if not flask_login.current_user.is_authenticated:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.json or {}
    raw_key = (data.get("api_key") or "").strip()
    provider = (data.get("provider") or "anthropic").strip()
    if not raw_key:
        return jsonify({"error": "api_key required"}), 400
    if not _get_fernet():
        return jsonify({"error": "Server encryption not configured (LETHE_ENCRYPTION_KEY missing)"}), 503
    try:
        encrypted = _encrypt_key(raw_key)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    database.update_user(flask_login.current_user.id,
                         api_key_encrypted=encrypted, api_provider=provider)
    return jsonify({"ok": True})

@app.route("/settings/api_key", methods=["DELETE"])
def delete_api_key():
    if not flask_login.current_user.is_authenticated:
        return jsonify({"error": "Not authenticated"}), 401
    database.update_user(flask_login.current_user.id,
                         api_key_encrypted=None, api_provider="anthropic")
    return jsonify({"ok": True})

@app.route("/settings/api_key", methods=["GET"])
def get_api_key_info():
    if not flask_login.current_user.is_authenticated:
        return jsonify({"error": "Not authenticated"}), 401
    u = database.get_user_by_id(flask_login.current_user.id)
    return jsonify({
        "has_key": bool(u and u.get("api_key_encrypted")),
        "provider": u.get("api_provider", "anthropic") if u else "anthropic",
    })

# ── Reset ────────────────────────────────────────────────────────────────────────

@app.route("/reset", methods=["POST"])
def reset():
    for chat in get_chats_for_identity():
        database.delete_chat(chat["id"])
        _sessions.pop(chat["id"], None)
    new_id = create_chat_for_identity("New chat")
    _sessions[new_id] = ContextSession(client=_get_client_for_identity())
    _set_active_chat_id(new_id)
    return jsonify({"status": "ok", "chat_id": new_id})

# ── Core routes ─────────────────────────────────────────────────────────────────

@app.route("/send", methods=["POST"])
def send():
    sess = get_active_session()
    if not sess:
        return jsonify({"error": "No active session"}), 400

    text            = request.form.get("text", "")
    image           = request.files.get("image")
    code_file       = request.files.get("code_file")
    text_file       = request.files.get("text_file")
    pdf_file        = request.files.get("pdf_file")
    auto_rename_images = request.form.get("auto_rename_images", "1") == "1"
    auto_title_chats   = request.form.get("auto_title_chats",   "1") == "1"

    image_path = code_path = code_id = text_path = pdf_path = None

    if image:
        image_path = os.path.join("uploads", image.filename).replace(os.sep, "/")
        os.makedirs("uploads", exist_ok=True)
        image.save(image_path)

    if code_file:
        code_path = os.path.join("uploads", "code", code_file.filename).replace(os.sep, "/")
        os.makedirs(os.path.join("uploads", "code"), exist_ok=True)
        code_file.save(code_path)
        code_id = code_file.filename

    if text_file:
        text_path = os.path.join("uploads", "text", text_file.filename).replace(os.sep, "/")
        os.makedirs(os.path.join("uploads", "text"), exist_ok=True)
        text_file.save(text_path)

    if pdf_file:
        pdf_file.seek(0, 2)
        pdf_size = pdf_file.tell()
        pdf_file.seek(0)
        if pdf_size > 32 * 1024 * 1024:
            return jsonify({"error": "PDF exceeds 32MB limit"}), 400
        pdf_path = os.path.join("uploads", "pdf", pdf_file.filename).replace(os.sep, "/")
        os.makedirs(os.path.join("uploads", "pdf"), exist_ok=True)
        pdf_file.save(pdf_path)

    is_first_msg = len(sess.history) == 0

    result = sess.send(
        text,
        image_path=image_path,
        code_path=code_path,
        code_id=code_id,
        text_path=text_path,
        pdf_path=pdf_path,
        auto_rename_images=auto_rename_images,
        auto_title_chats=auto_title_chats,
    )

    # ── Clean reply ─────────────────────────────────────────────────────────────
    wants_title       = is_first_msg and auto_title_chats
    wants_image_title = bool(image) and auto_rename_images

    if wants_title or wants_image_title:
        clean_reply, chat_title, image_title = _clean_injected_reply(
            result["reply"], wants_title, wants_image_title
        )
        sess.history[-1]["content"] = clean_reply
    else:
        clean_reply  = result["reply"]
        chat_title   = None
        image_title  = None

    # Rename block in session if image was retitled
    orig_block_id = image.filename if image else None
    if image_title and orig_block_id and orig_block_id in sess.blocks and orig_block_id != image_title:
        sess.blocks[image_title] = sess.blocks.pop(orig_block_id)
        sess.blocks[image_title]["id"] = image_title

    # Persist
    active_cid = _active_chat_id()
    user_image_url = f"/{image_path}" if image_path else None
    user_metadata  = None
    if code_file:
        user_metadata = {"attached_file": {"name": code_file.filename, "type": "code"}}
    elif text_file:
        user_metadata = {"attached_file": {"name": text_file.filename, "type": "text"}}
    elif pdf_file:
        user_metadata = {"attached_file": {"name": pdf_file.filename, "type": "pdf"}}

    database.save_display_message(active_cid, "user", text,
                                  image_url=user_image_url, metadata=user_metadata)
    database.save_display_message(active_cid, "assistant", clean_reply)

    for bid, meta in sess.blocks.items():
        database.upsert_block(active_cid, bid, meta)

    database.save_history(active_cid, sess.history, sess.blocks)

    if chat_title:
        database.update_chat_title(active_cid, chat_title)

    if image_title and orig_block_id and orig_block_id != image_title:
        database.rename_block(active_cid, orig_block_id, image_title)
        database.save_history(active_cid, sess.history, sess.blocks)

    database.log_event("message_sent", **_event_ctx())

    response = {"reply": clean_reply}
    if chat_title:
        response["chat_title"] = chat_title
    if image_title:
        response["image_title"] = image_title
    return jsonify(response)

@app.route("/status", methods=["GET"])
def status():
    sess = get_active_session()
    if not sess:
        return jsonify({"blocks": {}})
    strip_keys = {"base_code", "content", "diffs"}
    safe_blocks = {}
    for block_id, meta in sess.blocks.items():
        safe_meta = {k: v for k, v in meta.items() if k not in strip_keys}
        if meta.get("type") == "code":
            safe_meta["versions"] = len(meta.get("diffs", [])) + 1
        safe_blocks[block_id] = safe_meta
    return jsonify({"blocks": safe_blocks})

@app.route("/compress", methods=["POST"])
def compress():
    sess = get_active_session()
    if not sess:
        return jsonify({"results": []}), 400
    data = request.json or {}
    block_ids = data.get("block_ids", [])
    results = []
    active_cid = _active_chat_id()
    for block_id in block_ids:
        result = sess.compress(block_id)
        if result is None:
            result = {"compressed": False, "reason": "unknown",
                      "original_tokens": 0, "summary_tokens": 0}
        result["block_id"] = block_id
        results.append(result)
        if result.get("compressed"):
            database.upsert_block(active_cid, block_id, sess.blocks.get(block_id, {}))

    database.save_history(active_cid, sess.history, sess.blocks)
    return jsonify({"results": results})

@app.route("/history", methods=["GET"])
def history():
    sess = get_active_session()
    if not sess:
        return jsonify({"history": []})
    safe_history = []
    for msg in sess.history:
        role    = msg["role"]
        content = msg["content"]
        if isinstance(content, str):
            safe_history.append({"role": role, "content": content})
        elif isinstance(content, list):
            text_parts = [p["text"] for p in content if p.get("type") == "text"]
            safe_history.append({"role": role, "content": " ".join(text_parts)})
    return jsonify({"history": safe_history})

if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=False)
