import os
import sys
import io
import re
import secrets
from flask import Flask, request, jsonify, send_from_directory, session
from flask_cors import CORS
from dotenv import load_dotenv
import anthropic
import litellm
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

# ── API clients ─────────────────────────────────────────────────────────────────

# Anthropic client — used exclusively for compress() calls
_anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Gemini key pools for chat and backend operations.
# GEMINI_CHAT_KEY_POOL / GEMINI_BACKEND_KEY_POOL accept comma-separated lists.
# If those aren't set, fall back to the single-key GEMINI_API_KEY env var.
def _parse_key_pool(pool_var, single_fallback_var=None):
    keys = [k.strip() for k in os.getenv(pool_var, "").split(",") if k.strip()]
    if not keys and single_fallback_var:
        fallback = os.getenv(single_fallback_var, "").strip()
        if fallback:
            keys = [fallback]
    return keys

_GEMINI_CHAT_POOL    = _parse_key_pool("GEMINI_CHAT_KEY_POOL",    "GEMINI_API_KEY")
_GEMINI_BACKEND_POOL = _parse_key_pool("GEMINI_BACKEND_KEY_POOL", "GEMINI_API_KEY")

# Quick switch: set CHAT_PROVIDER=N to route all chat traffic to one provider.
#   1 = Claude  (anthropic/claude-sonnet-4-6, needs ANTHROPIC_API_KEY)
#   2 = Gemini  (gemini/gemini-3.5-flash, uses existing pool)
#   3 = GPT-4o-mini (openai/gpt-4o-mini, needs OPENAI_API_KEY)
#   4 = Groq Llama (groq/llama-3.3-70b-versatile, needs GROQ_API_KEY)
#   5 = DeepSeek (deepseek/deepseek-chat, needs DEEPSEEK_API_KEY)
# Unset (0) = default per-user routing.
_CHAT_PROVIDER = int(os.getenv("CHAT_PROVIDER", "0") or "0")
_PROVIDER_SWITCH = {
    1: ("anthropic/claude-sonnet-4-6", "ANTHROPIC_API_KEY"),
    3: ("openai/gpt-4o-mini",           "OPENAI_API_KEY"),
    4: ("groq/llama-3.3-70b-versatile", "GROQ_API_KEY"),
    5: ("deepseek/deepseek-chat",        "DEEPSEEK_API_KEY"),
}

# Runs at import time (gunicorn + python both) — confirms what was actually read
def _k(var):
    v = os.getenv(var, "")
    return f"set({v[:6]}...)" if v else "NOT SET"
print(f"[init] GEMINI_API_KEY={_k('GEMINI_API_KEY')} "
      f"GEMINI_CHAT_KEY_POOL={_k('GEMINI_CHAT_KEY_POOL')} "
      f"chat_pool_size={len(_GEMINI_CHAT_POOL)} "
      f"CHAT_PROVIDER={_CHAT_PROVIDER or 'default'}", flush=True)

# Per-provider model IDs used with LiteLLM
_PROVIDER_MODEL = {
    "gemini":    "gemini/gemini-3.5-flash",
    "anthropic": "anthropic/claude-sonnet-4-6",
    "openai":    "openai/gpt-4o-mini",
}

# Context window limits per model (tokens)
_MODEL_CONTEXT_LIMITS = {
    "gemini/gemini-3.5-flash":       1_000_000,
    "gemini/gemini-1.5-flash":       1_000_000,
    "anthropic/claude-sonnet-4-6":   200_000,
    "claude-sonnet-4-6":             200_000,
    "openai/gpt-4o-mini":            128_000,
    "groq/llama-3.3-70b-versatile":  128_000,
    "deepseek/deepseek-chat":        128_000,
}

# ── LiteLLM adapter ─────────────────────────────────────────────────────────────
# Wraps LiteLLM to expose the same interface as the Anthropic SDK so lethe.py
# can call .messages.create() without knowing which backend it's talking to.

class _LLMContent:
    def __init__(self, text): self.text = text

class _LLMUsage:
    def __init__(self, input_tokens): self.input_tokens = input_tokens

class _LLMResponse:
    def __init__(self, text, input_tokens=0):
        self.content = [_LLMContent(text)]
        self.usage   = _LLMUsage(input_tokens)

class _LiteLLMMessages:
    def __init__(self, model, api_key):
        self._model   = model
        self._api_key = api_key

    @staticmethod
    def _convert(messages):
        """Translate Anthropic-format message content to OpenAI/LiteLLM format."""
        out = []
        for msg in messages:
            content = msg["content"]
            if isinstance(content, str):
                out.append({"role": msg["role"], "content": content})
                continue
            parts = []
            for part in content:
                ptype = part.get("type")
                if ptype == "text":
                    parts.append({"type": "text", "text": part["text"]})
                elif ptype == "image":
                    src = part["source"]
                    url = f"data:{src['media_type']};base64,{src['data']}"
                    parts.append({"type": "image_url", "image_url": {"url": url}})
                elif ptype == "document":
                    # Native PDF document blocks are Anthropic-specific;
                    # represent as a text stub for other providers.
                    parts.append({"type": "text", "text": "[PDF document — not available via this provider]"})
            out.append({"role": msg["role"], "content": parts})
        return out

    def create(self, model=None, max_tokens=1024, messages=None):
        converted = self._convert(messages or [])
        print(f"[litellm] calling model={self._model} key_prefix={self._api_key[:8] if self._api_key else 'None'}", flush=True)
        try:
            resp = litellm.completion(
                model=self._model,
                messages=converted,
                max_tokens=max_tokens,
                api_key=self._api_key,
            )
            text         = resp.choices[0].message.content or ""
            input_tokens = getattr(resp.usage, "prompt_tokens", 0) or 0
            print(f"[litellm] success model={self._model} tokens={input_tokens}", flush=True)
            return _LLMResponse(text, input_tokens)
        except Exception as e:
            print(f"[litellm] ERROR model={self._model}: {type(e).__name__}: {e}", flush=True)
            raise

class _LiteLLMClient:
    def __init__(self, model, api_key):
        self.messages = _LiteLLMMessages(model, api_key)

def _gemini_client_from_pool(pool, identity_id):
    """Pick a Gemini key from pool deterministically by identity, return adapter or None."""
    if not pool:
        return None
    idx = hash(str(identity_id or "anon")) % len(pool)
    return _LiteLLMClient("gemini/gemini-3.5-flash", pool[idx])

def _get_client_and_model_for_identity():
    """Return (client, model) for the current request's identity.

    Priority:
      0. CHAT_PROVIDER env override (if set) — bypasses all per-user routing
      1. Logged-in user with own API key  → LiteLLM with their key/provider/model
      2. Logged-in user, no key           → LiteLLM Gemini pool (keyed by user_id)
      3. Guest                            → LiteLLM Gemini pool (keyed by guest_id)
      4. No Gemini pool configured        → fallback Anthropic client + model
    """
    if _CHAT_PROVIDER:
        if _CHAT_PROVIDER == 2:
            identity_id = (flask_login.current_user.id
                           if flask_login.current_user.is_authenticated
                           else request.cookies.get("lethe_guest_id"))
            pool_client = _gemini_client_from_pool(_GEMINI_CHAT_POOL, identity_id)
            if pool_client:
                print(f"[client] override=2 model=gemini/gemini-3.5-flash", flush=True)
                return pool_client, "gemini/gemini-3.5-flash"
        elif _CHAT_PROVIDER in _PROVIDER_SWITCH:
            model, key_env = _PROVIDER_SWITCH[_CHAT_PROVIDER]
            api_key = os.getenv(key_env, "")
            if api_key:
                print(f"[client] override={_CHAT_PROVIDER} model={model}", flush=True)
                return _LiteLLMClient(model, api_key), model
            print(f"[client] override={_CHAT_PROVIDER} WARN: {key_env} not set — using default routing", flush=True)

    if flask_login.current_user.is_authenticated:
        enc = flask_login.current_user.api_key_encrypted
        if enc:
            try:
                raw      = _decrypt_key(enc)
                provider = (getattr(flask_login.current_user, "api_provider", None) or "anthropic").lower()
                model    = _PROVIDER_MODEL.get(provider, "gemini/gemini-3.5-flash")
                print(f"[client] branch=own-key provider={provider} model={model}", flush=True)
                return _LiteLLMClient(model, raw), model
            except Exception as e:
                print(f"[client] own-key client failed: {type(e).__name__}: {e}", flush=True)
        identity_id = flask_login.current_user.id
    else:
        identity_id = request.cookies.get("lethe_guest_id")

    print(f"[client] identity_id={identity_id!r} authenticated={flask_login.current_user.is_authenticated}", flush=True)
    pool_client = _gemini_client_from_pool(_GEMINI_CHAT_POOL, identity_id)
    if pool_client:
        print(f"[client] branch=gemini-pool identity={identity_id!r} pool_size={len(_GEMINI_CHAT_POOL)}", flush=True)
        return pool_client, "gemini/gemini-3.5-flash"

    print(f"[client] branch=anthropic-fallback pool_empty={not _GEMINI_CHAT_POOL} identity={identity_id!r}", flush=True)
    return _anthropic_client, "claude-sonnet-4-6"

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
        client, model = _get_client_and_model_for_identity()
        _sessions[chat_id] = database.reconstruct_session(
            chat_id, client, _anthropic_client, model=model)
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
    client, model = _get_client_and_model_for_identity()
    _sessions[chat_id] = ContextSession(
        client=client, compress_client=_anthropic_client,
        model=model, compress_model="claude-sonnet-4-6")
    database.log_event("new_chat", **_event_ctx())
    return jsonify({"chat_id": chat_id})

@app.route("/switch_chat/<int:chat_id>", methods=["POST"])
def switch_chat(chat_id):
    chat = database.get_chat(chat_id)
    if not chat:
        return jsonify({"error": "Chat not found"}), 404

    _set_active_chat_id(chat_id)
    if chat_id not in _sessions:
        client, model = _get_client_and_model_for_identity()
        _sessions[chat_id] = database.reconstruct_session(
            chat_id, client, _anthropic_client, model=model)

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
            _client, _model = _get_client_and_model_for_identity()
            _sessions[new_active] = ContextSession(
                client=_client, compress_client=_anthropic_client,
                model=_model, compress_model="claude-sonnet-4-6")
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
    _client, _model = _get_client_and_model_for_identity()
    _sessions[new_id] = ContextSession(
        client=_client, compress_client=_anthropic_client,
        model=_model, compress_model="claude-sonnet-4-6")
    _set_active_chat_id(new_id)
    return jsonify({"status": "ok", "chat_id": new_id})

# ── Send helpers ────────────────────────────────────────────────────────────────

def _snapshot_session(sess, code_id):
    """Capture the parts of session state that sess.send() may mutate."""
    return (
        len(sess.history),
        set(sess.blocks.keys()),
        list(sess.blocks[code_id].get("diffs", [])) if code_id and code_id in sess.blocks else None,
    )

def _restore_session(sess, snapshot, code_id):
    """Roll back session state to a snapshot taken before a failed send()."""
    history_len, block_ids, code_diffs = snapshot
    del sess.history[history_len:]
    for bid in [b for b in list(sess.blocks) if b not in block_ids]:
        del sess.blocks[bid]
    if code_diffs is not None and code_id in sess.blocks:
        sess.blocks[code_id]["diffs"] = code_diffs

def _send_with_fallback(sess, text, **kwargs):
    """Call sess.send(); on any API error restore state and retry with Claude.

    The session's client and model are always restored to their original values
    after this call, whether or not the fallback was used.
    """
    code_id  = kwargs.get("code_id")
    snapshot = _snapshot_session(sess, code_id)
    try:
        return sess.send(text, **kwargs)
    except Exception as primary_err:
        print(f"[send] primary error ({type(primary_err).__name__}): {primary_err} — attempting Claude fallback", flush=True)
        _restore_session(sess, snapshot, code_id)

        anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
        already_claude = any(m in sess.model for m in ("claude", "anthropic"))
        if not anthropic_key or already_claude:
            raise  # nothing to fall back to

        original_client, original_model = sess.client, sess.model
        fallback_snapshot = _snapshot_session(sess, code_id)
        sess.client = _LiteLLMClient("anthropic/claude-sonnet-4-6", anthropic_key)
        sess.model  = "anthropic/claude-sonnet-4-6"
        try:
            result = sess.send(text, **kwargs)
            print(f"[send] Claude fallback succeeded", flush=True)
            return result
        except Exception as fallback_err:
            print(f"[send] Claude fallback also failed: {fallback_err}", flush=True)
            _restore_session(sess, fallback_snapshot, code_id)
            raise fallback_err
        finally:
            sess.client = original_client
            sess.model  = original_model

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

    try:
        result = _send_with_fallback(
            sess, text,
            image_path=image_path,
            code_path=code_path,
            code_id=code_id,
            text_path=text_path,
            pdf_path=pdf_path,
            auto_rename_images=auto_rename_images,
            auto_title_chats=auto_title_chats,
        )
    except Exception:
        return jsonify({"error": "AI provider unavailable. Please try again."}), 502

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

@app.route("/model_info", methods=["GET"])
def model_info():
    try:
        _, model = _get_client_and_model_for_identity()
        limit = _MODEL_CONTEXT_LIMITS.get(model, 200_000)
        return jsonify({"model": model, "context_limit": limit})
    except Exception:
        return jsonify({"model": "unknown", "context_limit": 200_000})

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

@app.route("/retry", methods=["POST"])
def retry():
    try:
        sess = get_active_session()
        if not sess:
            return jsonify({"error": "No active session"}), 400
        if not sess.history or sess.history[-1]["role"] != "assistant":
            return jsonify({"error": "Nothing to retry"}), 400

        sess.history.pop()  # remove last assistant message

        if not sess.history or sess.history[-1]["role"] != "user":
            return jsonify({"error": "No preceding user message"}), 400

        last_user = sess.history.pop()
        content = last_user["content"]
        if isinstance(content, str):
            user_text = content
        elif isinstance(content, list):
            user_text = " ".join(p["text"] for p in content if p.get("type") == "text")
        else:
            user_text = ""

        result = _send_with_fallback(sess, user_text)
        raw_reply = result["reply"]
        clean_reply, _, _ = _clean_injected_reply(raw_reply, False, False)
        if clean_reply != raw_reply:
            sess.history[-1]["content"] = clean_reply

        active_cid = _active_chat_id()
        database.delete_last_display_message(active_cid, "assistant")
        database.save_display_message(active_cid, "assistant", clean_reply)
        database.save_history(active_cid, sess.history, sess.blocks)

        return jsonify({"reply": clean_reply})
    except Exception:
        return jsonify({"error": "Retry failed"}), 500

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
    print(f"[startup] Gemini chat pool: {len(_GEMINI_CHAT_POOL)} key(s) | "
          f"backend pool: {len(_GEMINI_BACKEND_POOL)} key(s)", flush=True)
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), use_reloader=False)
