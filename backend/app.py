import os
import sys
import io
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import anthropic
from lethe import ContextSession

if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

load_dotenv()

app = Flask(__name__)
CORS(app)

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
session = ContextSession(client=client)
chat_counter = 1

@app.route("/new_chat", methods=["POST"])
def new_chat():
    global session, chat_counter
    session = ContextSession(client=client)
    chat_counter += 1
    return jsonify({"chat_id": chat_counter})

@app.route("/reset", methods=["POST"])
def reset():
    global session
    session = ContextSession(client=client)
    return jsonify({"status": "ok"})

@app.route("/send", methods=["POST"])
def send():
    text = request.form.get("text", "")
    image = request.files.get("image")
    code_file = request.files.get("code_file")
    text_file = request.files.get("text_file")
    pdf_file = request.files.get("pdf_file")
    auto_rename_images = request.form.get("auto_rename_images", "1") == "1"
    auto_title_chats = request.form.get("auto_title_chats", "1") == "1"

    image_path = None
    code_path = None
    code_id = None
    text_path = None
    pdf_path = None

    if image:
        image_path = os.path.join("uploads", image.filename)
        os.makedirs("uploads", exist_ok=True)
        image.save(image_path)

    if code_file:
        code_path = os.path.join("uploads", "code", code_file.filename)
        os.makedirs(os.path.join("uploads", "code"), exist_ok=True)
        code_file.save(code_path)
        code_id = code_file.filename

    if text_file:
        text_path = os.path.join("uploads", "text", text_file.filename)
        os.makedirs(os.path.join("uploads", "text"), exist_ok=True)
        text_file.save(text_path)

    if pdf_file:
        pdf_file.seek(0, 2)
        pdf_size = pdf_file.tell()
        pdf_file.seek(0)
        if pdf_size > 32 * 1024 * 1024:
            return jsonify({"error": "PDF exceeds 32MB limit"}), 400
        pdf_path = os.path.join("uploads", "pdf", pdf_file.filename)
        os.makedirs(os.path.join("uploads", "pdf"), exist_ok=True)
        pdf_file.save(pdf_path)

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

    response = {"reply": result["reply"]}
    if result.get("chat_title"):
        response["chat_title"] = result["chat_title"]
    if result.get("image_title"):
        response["image_title"] = result["image_title"]

    return jsonify(response)

@app.route("/status", methods=["GET"])
def status():
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
    data = request.json
    block_ids = data.get("block_ids", [])
    results = []
    for block_id in block_ids:
        session.compress(block_id)
        results.append({"block_id": block_id, "compressed": True})
    return jsonify({"results": results})

@app.route("/history", methods=["GET"])
def history():
    safe_history = []
    for msg in session.history:
        role = msg["role"]
        content = msg["content"]
        if isinstance(content, str):
            safe_history.append({"role": role, "content": content})
        elif isinstance(content, list):
            text_parts = []
            for part in content:
                if part.get("type") == "text":
                    text_parts.append(part["text"])
            safe_history.append({"role": role, "content": " ".join(text_parts)})
    return jsonify({"history": safe_history})

if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=False)
