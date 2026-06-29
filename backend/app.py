import os
import sys
import io
import re
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
import anthropic
from lethe import ContextSession
import db as database

if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

load_dotenv()

app = Flask(__name__)
CORS(app)

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

sessions = {}
active_chat_id = None

def get_active_session():
    global sessions, active_chat_id
    if active_chat_id is None:
        return None
    if active_chat_id not in sessions:
        session = database.reconstruct_session(active_chat_id, client)
        sessions[active_chat_id] = session
    return sessions.get(active_chat_id)

# Init DB and set active chat on startup
database.init_db()
_startup_chats = database.get_all_chats()
if not _startup_chats:
    _new_id = database.create_chat("New chat")
    active_chat_id = _new_id
    sessions[active_chat_id] = ContextSession(client=client)
else:
    active_chat_id = _startup_chats[0]["id"]

# ── Reply cleaning ─────────────────────────────────────────────────────────────

_HR = re.compile(r'^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$', re.MULTILINE)

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
        visible = raw[:last_hr.start()].rstrip()
        metadata = raw[last_hr.end():]
    else:
        visible = raw
        metadata = raw

    if wants_title:
        m = re.search(r'\[CHAT_TITLE\](.*?)\[/CHAT_TITLE\]', metadata, re.DOTALL)
        if m:
            chat_title = m.group(1).strip()

    if wants_image_title:
        m = re.search(r'\[IMAGE_TITLE\](.*?)\[/IMAGE_TITLE\]', metadata, re.DOTALL)
        if m:
            image_title = m.group(1).strip()

    if not matches:
        if wants_title:
            visible = re.sub(r'\[CHAT_TITLE\].*?\[/CHAT_TITLE\]', '', visible, flags=re.DOTALL)
        if wants_image_title:
            visible = re.sub(r'\[IMAGE_TITLE\].*?\[/IMAGE_TITLE\]', '', visible, flags=re.DOTALL)
        visible = visible.strip()

    return visible, chat_title, image_title

# ── Chat management ────────────────────────────────────────────────────────────

@app.route("/chats", methods=["GET"])
def get_chats():
    return jsonify({"chats": database.get_all_chats()})

@app.route("/new_chat", methods=["POST"])
def new_chat():
    global active_chat_id
    chat_id = database.create_chat("New chat")
    active_chat_id = chat_id
    sessions[chat_id] = ContextSession(client=client)
    return jsonify({"chat_id": chat_id})

@app.route("/switch_chat/<int:chat_id>", methods=["POST"])
def switch_chat(chat_id):
    global active_chat_id
    chat = database.get_chat(chat_id)
    if not chat:
        return jsonify({"error": "Chat not found"}), 404

    active_chat_id = chat_id
    if chat_id not in sessions:
        sessions[chat_id] = database.reconstruct_session(chat_id, client)

    session = sessions[chat_id]

    strip_keys = {"base_code", "content", "diffs"}
    safe_blocks = {}
    for block_id, meta in session.blocks.items():
        safe_meta = {k: v for k, v in meta.items() if k not in strip_keys}
        if meta.get("type") == "code":
            safe_meta["versions"] = len(meta.get("diffs", [])) + 1
        safe_blocks[block_id] = safe_meta

    return jsonify({
        "chat_id": chat_id,
        "messages": database.get_display_messages(chat_id),
        "blocks": safe_blocks
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
    global active_chat_id, sessions
    database.delete_chat(chat_id)
    sessions.pop(chat_id, None)
    new_active = active_chat_id
    if active_chat_id == chat_id:
        remaining = database.get_all_chats()
        if remaining:
            new_active = remaining[0]["id"]
        else:
            new_active = database.create_chat("New chat")
            sessions[new_active] = ContextSession(client=client)
        active_chat_id = new_active
    return jsonify({"ok": True, "active_chat_id": new_active})

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory("uploads", filename)

# ── Session ────────────────────────────────────────────────────────────────────

@app.route("/reset", methods=["POST"])
def reset():
    global active_chat_id, sessions
    for chat in database.get_all_chats():
        database.delete_chat(chat["id"])
    sessions = {}
    new_id = database.create_chat("New chat")
    active_chat_id = new_id
    sessions[new_id] = ContextSession(client=client)
    return jsonify({"status": "ok", "chat_id": new_id})

# ── Core routes ────────────────────────────────────────────────────────────────

@app.route("/send", methods=["POST"])
def send():
    session = get_active_session()
    if not session:
        return jsonify({"error": "No active session"}), 400

    text = request.form.get("text", "")
    image = request.files.get("image")
    code_file = request.files.get("code_file")
    text_file = request.files.get("text_file")
    pdf_file = request.files.get("pdf_file")
    auto_rename_images = request.form.get("auto_rename_images", "1") == "1"
    auto_title_chats = request.form.get("auto_title_chats", "1") == "1"

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

    is_first_msg = len(session.history) == 0

    result = session.send(
        text,
        image_path=image_path,
        code_path=code_path,
        code_id=code_id,
        text_path=text_path,
        pdf_path=pdf_path,
        auto_rename_images=auto_rename_images,
        auto_title_chats=auto_title_chats
    )

    # ── Clean reply ────────────────────────────────────────────────────────────
    wants_title = is_first_msg and auto_title_chats
    wants_image_title = bool(image) and auto_rename_images

    if wants_title or wants_image_title:
        clean_reply, chat_title, image_title = _clean_injected_reply(
            result["reply"], wants_title, wants_image_title
        )
        session.history[-1]["content"] = clean_reply
    else:
        clean_reply = result["reply"]
        chat_title = None
        image_title = None

    # Rename block in session.blocks if image was retitled
    orig_block_id = image.filename if image else None
    if image_title and orig_block_id and orig_block_id in session.blocks and orig_block_id != image_title:
        session.blocks[image_title] = session.blocks.pop(orig_block_id)
        session.blocks[image_title]["id"] = image_title

    # Persist display messages
    user_image_url = f"/{image_path}" if image_path else None
    user_metadata = None
    if code_file:
        user_metadata = {"attached_file": {"name": code_file.filename, "type": "code"}}
    elif text_file:
        user_metadata = {"attached_file": {"name": text_file.filename, "type": "text"}}
    elif pdf_file:
        user_metadata = {"attached_file": {"name": pdf_file.filename, "type": "pdf"}}

    database.save_display_message(
        active_chat_id, "user", text,
        image_url=user_image_url, metadata=user_metadata)
    database.save_display_message(active_chat_id, "assistant", clean_reply)

    # Persist blocks
    for block_id, meta in session.blocks.items():
        database.upsert_block(active_chat_id, block_id, meta)

    # Persist history
    database.save_history(active_chat_id, session.history, session.blocks)

    # Update chat title in DB
    if chat_title:
        database.update_chat_title(active_chat_id, chat_title)

    # Handle image block rename in DB
    if image_title and orig_block_id and orig_block_id != image_title:
        database.rename_block(active_chat_id, orig_block_id, image_title)
        database.save_history(active_chat_id, session.history, session.blocks)

    response = {"reply": clean_reply}
    if chat_title:
        response["chat_title"] = chat_title
    if image_title:
        response["image_title"] = image_title

    return jsonify(response)

@app.route("/status", methods=["GET"])
def status():
    session = get_active_session()
    if not session:
        return jsonify({"blocks": {}})
    safe_blocks = {}
    strip_keys = {"base_code", "content", "diffs"}
    for block_id, meta in session.blocks.items():
        safe_meta = {k: v for k, v in meta.items() if k not in strip_keys}
        if meta.get("type") == "code":
            safe_meta["versions"] = len(meta.get("diffs", [])) + 1
        safe_blocks[block_id] = safe_meta
    return jsonify({"blocks": safe_blocks})

@app.route("/compress", methods=["POST"])
def compress():
    session = get_active_session()
    if not session:
        return jsonify({"results": []}), 400
    data = request.json or {}
    block_ids = data.get("block_ids", [])
    results = []
    for block_id in block_ids:
        result = session.compress(block_id)
        if result is None:
            result = {"compressed": False, "reason": "unknown", "original_tokens": 0, "summary_tokens": 0}
        result["block_id"] = block_id
        results.append(result)
        if result.get("compressed"):
            database.upsert_block(active_chat_id, block_id, session.blocks.get(block_id, {}))

    database.save_history(active_chat_id, session.history, session.blocks)
    return jsonify({"results": results})

@app.route("/history", methods=["GET"])
def history():
    session = get_active_session()
    if not session:
        return jsonify({"history": []})
    safe_history = []
    for msg in session.history:
        role = msg["role"]
        content = msg["content"]
        if isinstance(content, str):
            safe_history.append({"role": role, "content": content})
        elif isinstance(content, list):
            text_parts = [p["text"] for p in content if p.get("type") == "text"]
            safe_history.append({"role": role, "content": " ".join(text_parts)})
    return jsonify({"history": safe_history})

if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=False)
