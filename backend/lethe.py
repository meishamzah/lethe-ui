import base64
import math
import json
import re
import time
from pathlib import Path
from PIL import Image
import difflib

class ContextSession:
    def __init__(self, client, model="claude-sonnet-4-6"):
        self.client = client
        self.model = model
        self.history = []
        self.blocks = {}

    def _encode_image(self, image_path):
        """Convert image file to base64 for API"""
        path = Path(image_path)
        with open(path, "rb") as f:
            data = base64.standard_b64encode(f.read()).decode("utf-8")
        ext = path.suffix.lower().strip(".")
        media_type_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"}
        media_type = media_type_map.get(ext, "image/jpeg")
        return data, media_type

    def _estimate_image_tokens(self, image_path):
        """Estimate image tokens using Anthropic's tile formula"""
        
        img = Image.open(image_path)
        w, h = img.size
        
        # step 1 — scale down to fit within 2048x2048
        max_dim = 2048
        if w > max_dim or h > max_dim:
            scale = min(max_dim / w, max_dim / h)
            w, h = int(w * scale), int(h * scale)
        
        # step 2 — count tiles
        tiles_w = math.ceil(w / 85)
        tiles_h = math.ceil(h / 85)
        total_tiles = tiles_w * tiles_h
        
        # step 3 — apply formula
        tokens = 170 * total_tiles + 85
        return tokens
    
    def send(self, text, image_path=None, code_path=None, code_id=None, text_path=None, pdf_path=None, auto_rename_images=True, auto_title_chats=True):
        """Send a message, optionally with an image, code file, text file, or PDF"""
        content = []
        is_first = len(self.history) == 0

        if image_path:
            block_id = Path(image_path).name
            data, media_type = self._encode_image(image_path)
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": data}
            })
            self.blocks[block_id] = {
                "id": block_id,
                "type": "image",
                "path": image_path,
                "message_index": len(self.history),
                "compressed": False,
                "uploaded_at": time.time()
            }
        if code_path and code_id:
            new_code = self._read_code(code_path)
            code_tokens = len(new_code) // 4

            if code_id not in self.blocks:
                self.blocks[code_id] = {
                    "id": code_id,
                    "type": "code",
                    "path": code_path,
                    "base_code": new_code,
                    "diffs": [],
                    "message_index": len(self.history),
                    "compressed": False,
                    "code_tokens": code_tokens,
                    "uploaded_at": time.time()
                }
                code_content = f"[Code block '{code_id}' - base version]:\n```\n{new_code}\n```"
            else:
                current_code = self._reconstruct_code(code_id)
                diff = self._compute_diff(current_code, new_code)
                self.blocks[code_id]["diffs"].append(diff)
                self.blocks[code_id]["path"] = code_path
                self.blocks[code_id]["base_code"] = new_code
                self.blocks[code_id]["code_tokens"] = code_tokens
                code_content = f"[Code block '{code_id}' - updated version]:\n```\n{new_code}\n```\n\n[Changes from previous version]:\n{diff}"

            content.append({"type": "text", "text": code_content})

        if text_path:
            text_id = Path(text_path).name
            with open(text_path, "r", encoding="utf-8", errors="replace") as f:
                file_content = f.read()
            text_tokens = len(file_content) // 4
            content.append({
                "type": "text",
                "text": f"[Text file '{text_id}']:\n{file_content}"
            })
            self.blocks[text_id] = {
                "id": text_id,
                "type": "text",
                "path": text_path,
                "content": file_content,
                "message_index": len(self.history),
                "compressed": False,
                "text_tokens": text_tokens,
                "uploaded_at": time.time()
            }

        if pdf_path:
            pdf_id = Path(pdf_path).name
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            pdf_data = base64.standard_b64encode(pdf_bytes).decode("utf-8")
            pdf_tokens = len(pdf_bytes) // 6
            content.append({
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": pdf_data
                }
            })
            self.blocks[pdf_id] = {
                "id": pdf_id,
                "type": "pdf",
                "path": pdf_path,
                "message_index": len(self.history),
                "compressed": False,
                "pdf_tokens": pdf_tokens,
                "uploaded_at": time.time()
            }

        content.append({"type": "text", "text": text})

        # Store original content in history (no injections)
        self.history.append({"role": "user", "content": content})

        # Build injected message for the API call only
        injections = []
        if is_first and auto_title_chats:
            injections.append("Also suggest a 3-5 word chat title for this conversation wrapped in [CHAT_TITLE]...[/CHAT_TITLE]")
        if image_path and auto_rename_images:
            injections.append("Also suggest a short descriptive filename for the uploaded image wrapped in [IMAGE_TITLE]...[/IMAGE_TITLE]")

        if injections:
            api_text = text + "\n\n" + "\n".join(injections)
            api_content = content[:-1] + [{"type": "text", "text": api_text}]
            api_messages = self.history[:-1] + [{"role": "user", "content": api_content}]
        else:
            api_messages = self.history

        response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            messages=api_messages
        )

        raw_reply = response.content[0].text

        self.history.append({"role": "assistant", "content": raw_reply})

        if image_path:
            self.blocks[block_id]["image_tokens"] = self._estimate_image_tokens(image_path)

        return {"reply": raw_reply}
    
    def compress(self, block_id):
        if block_id not in self.blocks:
            print(f"No block found with id: {block_id}")
            return {"compressed": False, "reason": "block_not_found", "original_tokens": 0, "summary_tokens": 0}

        if self.blocks[block_id]["compressed"]:
            print(f"{block_id} is already compressed")
            return {"compressed": True, "reason": "already_compressed", "original_tokens": 0, "summary_tokens": 0}

        block_type = self.blocks[block_id]["type"]

        if block_type == "image":
            return self.compress_image(block_id)
        elif block_type == "code":
            return self._compress_code(block_id)
        elif block_type == "text":
            return self._compress_text(block_id)
        elif block_type == "pdf":
            return self._compress_pdf(block_id)

        return {"compressed": False, "reason": "unknown_type", "original_tokens": 0, "summary_tokens": 0}

    def compress_image(self, block_id):
        if block_id not in self.blocks:
            print(f"No block found with id: {block_id}")
            return
    
        if self.blocks[block_id]["compressed"]:
            print(f"{block_id} is already compressed")
            return
    
        msg_index = self.blocks[block_id]["message_index"]
    
        # build transcript
        transcript = []
        for i, msg in enumerate(self.history):
            role = msg["role"]
            content = msg["content"]
            if isinstance(content, str):
                transcript.append(f"[{i}] {role}: {content}")
            elif isinstance(content, list):
                for part in content:
                    if part.get("type") == "text":
                        transcript.append(f"[{i}] {role}: {part['text']}")
                    elif part.get("type") == "image":
                        transcript.append(f"[{i}] {role}: [image: {block_id}]")
    
        transcript_text = "\n".join(transcript)
    
        # step 1 — semantic scanner
        scanner_prompt = f"""You are analyzing a conversation transcript.
    
    An image called '{block_id}' was uploaded at message [{msg_index}].
    
    Here is the full conversation:
    {transcript_text}
    
    Identify every message index that is discussing, referring to, reasoning about, or responding to observations about this image — even if the image is not mentioned by name. Include implicit references like 'it', 'this', 'what you see', 'the image', etc.
    
    Respond with ONLY a JSON array of message indices. Example: [0, 1, 3, 5]"""
    
        scanner_response = self.client.messages.create(
            model=self.model,
            max_tokens=256,
            messages=[{"role": "user", "content": scanner_prompt}]
        )

        raw = scanner_response.content[0].text.strip()
        match = re.search(r'\[.*?\]', raw, re.DOTALL)
        if not match:
            print("Could not parse message indices from scanner")
            return
        related_indices = json.loads(match.group())
        print(f"Related message indices: {related_indices}")
    
        # pull related message text
        related_messages = []
        for i in related_indices:
            msg = self.history[i]
            role = msg["role"]
            content = msg["content"]
            if isinstance(content, str):
                related_messages.append(f"{role}: {content}")
            elif isinstance(content, list):
                for part in content:
                    if part.get("type") == "text":
                        related_messages.append(f"{role}: {part['text']}")
    
        related_text = "\n".join(related_messages)
    
        # step 2 — summarizer
        summarize_prompt = f"""You are a context compression assistant.
    
    An image called '{block_id}' was uploaded in a conversation.
    Below are all the messages that discussed or referenced it:
    
    {related_text}
    
    Write a compact summary that preserves ONLY the features, observations, and conclusions that were actually discussed about this image.
    Ignore anything that was never brought up.
    Be concise. This summary will replace the raw image in the conversation history going forward."""
    
        summary_response = self.client.messages.create(
            model=self.model,
            max_tokens=512,
            messages=[{"role": "user", "content": summarize_prompt}]
        )
    
        summary = summary_response.content[0].text
        summary_tokens = len(summary.split()) * 1.3  # rough token estimate for summary text

        image_tokens = self.blocks[block_id].get("image_tokens", 0)
        if summary_tokens >= image_tokens:
            print(f"⚠ Summary ({int(summary_tokens)} tokens) is larger than original image tokens ({image_tokens})")
            print(f"  Compression not applied.")
            return {
                "compressed": False,
                "reason": "summary_larger_than_original",
                "original_tokens": image_tokens,
                "summary_tokens": int(summary_tokens)
            }

        # step 3 — replace image block with summary
        original_message = self.history[msg_index]
        new_content = []
        for part in original_message["content"]:
            if part.get("type") == "image":
                new_content.append({
                    "type": "text",
                    "text": f"[Compressed image '{block_id}']: {summary}"
                })
            else:
                new_content.append(part)

        self.history[msg_index]["content"] = new_content
        self.blocks[block_id]["compressed"] = True
        self.blocks[block_id]["summary"] = summary
        self.blocks[block_id]["summary_tokens"] = int(summary_tokens)

        if image_tokens:
            tokens_saved = image_tokens - summary_tokens
            pct = round((tokens_saved / image_tokens) * 100)
            print(f"\n✓ Compressed '{block_id}'")
            print(f"Tokens: ~{image_tokens:,} → ~{int(summary_tokens):,} ({pct}% reduction)")
        else:
            print(f"\n✓ Compressed '{block_id}'")

        print(f"\nSummary:\n{summary}")
        return {
            "compressed": True,
            "original_tokens": image_tokens,
            "summary_tokens": int(summary_tokens)
        }
    
    def status(self):
        if not self.blocks:
            print("No blocks in session.")
            return
    
        total_image_tokens = 0
        total_saved = 0
    
        print(f"\nSession Status")
        print("─" * 60)
        print(f"{'Block':<25} {'Type':<8} {'Tokens':>8}    {'State'}")
        print("─" * 60)
    
        for block_id, meta in self.blocks.items():
            block_type = meta.get("type", "image")
            compressed = meta.get("compressed", False)

            if block_type == "image":
                tokens = meta.get("image_tokens", 0)
                if compressed:
                    summary_tokens = meta.get("summary_tokens", 0)
                    state = f"✓ compressed → {int(summary_tokens)}"
                    total_saved += tokens - summary_tokens
                else:
                    state = "⚠ raw"
            elif block_type == "code":
                base_code = meta.get("base_code", "")
                tokens = int(len(base_code) / 4)
                diffs = meta.get("diffs", [])
                state = f"⚠ raw — {len(diffs)} version(s)"
            else:
                tokens = 0
                state = "unknown"

            total_image_tokens += tokens
            print(f"{block_id:<25} {block_type:<8} {tokens:>8,}    {state}")
    
        print("─" * 60)
        print(f"Total tokens tracked:   ~{int(total_image_tokens):,}")
        print(f"Tokens saved so far:          ~{int(total_saved):,}")
        print(f"Messages in history:          {len(self.history)}")

    def _read_code(self, code_path):
        with open(code_path, "r") as f:
            return f.read()
    
    def _compute_diff(self, old_code, new_code):
        old_lines = old_code.splitlines()
        new_lines = new_code.splitlines()
        diff = list(difflib.unified_diff(old_lines, new_lines, lineterm=""))
        return "\n".join(diff)
    
    def _reconstruct_code(self, code_id):
        # for now base_code is always kept current, so just return it
        return self.blocks[code_id]["base_code"]
    
    def _compress_code(self, block_id):
        msg_index = self.blocks[block_id]["message_index"]
        base_code = self.blocks[block_id]["base_code"]
        diffs = self.blocks[block_id]["diffs"]

        # build transcript
        transcript = []
        for i, msg in enumerate(self.history):
            role = msg["role"]
            content = msg["content"]
            if isinstance(content, str):
                transcript.append(f"[{i}] {role}: {content}")
            elif isinstance(content, list):
                for part in content:
                    if part.get("type") == "text":
                        transcript.append(f"[{i}] {role}: {part['text'][:300]}")

        transcript_text = "\n".join(transcript)

        # build diffs summary
        diffs_text = "\n\n".join([f"Version {i+1} diff:\n{d}" for i, d in enumerate(diffs)]) if diffs else "No versions — only base."

        summarize_prompt = f"""You are a context compression assistant.

    A code block called '{block_id}' was shared in a conversation.

    Here is the full conversation transcript:
    {transcript_text}

    Here is the final version of the code:
    {base_code}
    Here are the diffs from each iteration:
{diffs_text}

Write a compact summary that includes:
1. What this code does
2. What problems were found and discussed
3. What fixes were applied across versions
4. The final version of the code

Be concise. This summary replaces the raw code and all its versions in conversation history."""

        summary_response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            messages=[{"role": "user", "content": summarize_prompt}]
        )

        summary = summary_response.content[0].text
        summary_tokens = int(len(summary) / 4)

        # Count actual tokens from ALL code block entries in history (accurate for multi-version)
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

        if summary_tokens >= original_tokens:
            print(f"⚠ Summary ({summary_tokens} tokens) is larger than original ({original_tokens} tokens)")
            print(f"  Compression not applied. Block too small.")
            return {
                "compressed": False,
                "reason": "summary_larger_than_original",
                "original_tokens": original_tokens,
                "summary_tokens": summary_tokens
            }

        # Replace the first upload's code block with the full summary
        if isinstance(self.history[msg_index]["content"], list):
            new_content = []
            for part in self.history[msg_index]["content"]:
                if part.get("type") == "text" and f"[Code block '{block_id}'" in part.get("text", ""):
                    new_content.append({"type": "text", "text": f"[Compressed code '{block_id}']:\n{summary}"})
                else:
                    new_content.append(part)
            self.history[msg_index]["content"] = new_content

        # Replace code blocks in ALL other messages with a short stub
        for i, msg in enumerate(self.history):
            if i == msg_index:
                continue
            content = msg.get("content")
            if not isinstance(content, list):
                continue
            new_content = []
            changed = False
            for part in content:
                if part.get("type") == "text" and f"[Code block '{block_id}'" in part.get("text", ""):
                    new_content.append({"type": "text", "text": f"[{block_id} — additional version (included in compression summary)]"})
                    changed = True
                else:
                    new_content.append(part)
            if changed:
                self.history[i]["content"] = new_content

        self.blocks[block_id]["compressed"] = True
        self.blocks[block_id]["summary"] = summary
        self.blocks[block_id]["summary_tokens"] = summary_tokens

        tokens_saved = original_tokens - summary_tokens
        pct = round((tokens_saved / original_tokens) * 100) if original_tokens else 0
        print(f"\n✓ Compressed '{block_id}'")
        print(f"Tokens: ~{original_tokens:,} → ~{summary_tokens:,} ({pct}% reduction)")
        print(f"\nSummary:\n{summary}")
        return {
            "compressed": True,
            "original_tokens": original_tokens,
            "summary_tokens": summary_tokens
        }

    def _compress_text(self, block_id):
        msg_index = self.blocks[block_id]["message_index"]
        file_content = self.blocks[block_id]["content"]
        original_tokens = self.blocks[block_id].get("text_tokens", len(file_content) // 4)

        # build transcript
        transcript = []
        for i, msg in enumerate(self.history):
            role = msg["role"]
            content = msg["content"]
            if isinstance(content, str):
                transcript.append(f"[{i}] {role}: {content}")
            elif isinstance(content, list):
                for part in content:
                    if part.get("type") == "text":
                        transcript.append(f"[{i}] {role}: {part['text'][:300]}")

        transcript_text = "\n".join(transcript)

        summarize_prompt = f"""You are a context compression assistant.

A text file called '{block_id}' was shared in a conversation.

Here is the full conversation transcript:
{transcript_text}

Here is the text file content (truncated if large):
{file_content[:4000]}

Write a compact summary using tiered compression:
- Sections actively discussed: detailed summary with key specifics
- Sections lightly mentioned: 2-3 sentences
- Sections never mentioned: 1-sentence label only

Be concise. This summary replaces the raw file content in conversation history."""

        summary_response = self.client.messages.create(
            model=self.model,
            max_tokens=512,
            messages=[{"role": "user", "content": summarize_prompt}]
        )

        summary = summary_response.content[0].text
        summary_tokens = int(len(summary) / 4)

        if summary_tokens >= original_tokens:
            print(f"⚠ Summary ({summary_tokens} tokens) is larger than original ({original_tokens} tokens). Compression not applied.")
            return {
                "compressed": False,
                "reason": "summary_larger_than_original",
                "original_tokens": original_tokens,
                "summary_tokens": summary_tokens
            }

        original_message = self.history[msg_index]
        new_content = []
        if isinstance(original_message["content"], list):
            for part in original_message["content"]:
                if part.get("type") == "text" and f"[Text file '{block_id}']" in part.get("text", ""):
                    new_content.append({
                        "type": "text",
                        "text": f"[Compressed text '{block_id}']:\n{summary}"
                    })
                else:
                    new_content.append(part)
        self.history[msg_index]["content"] = new_content

        self.blocks[block_id]["compressed"] = True
        self.blocks[block_id]["summary"] = summary
        self.blocks[block_id]["summary_tokens"] = summary_tokens

        tokens_saved = original_tokens - summary_tokens
        pct = round((tokens_saved / original_tokens) * 100) if original_tokens else 0
        print(f"\n✓ Compressed '{block_id}'")
        print(f"Tokens: ~{original_tokens:,} → ~{summary_tokens:,} ({pct}% reduction)")
        return {
            "compressed": True,
            "original_tokens": original_tokens,
            "summary_tokens": summary_tokens
        }

    def _compress_pdf(self, block_id):
        msg_index = self.blocks[block_id]["message_index"]
        original_tokens = self.blocks[block_id].get("pdf_tokens", 0)

        # build transcript (excluding the PDF document block)
        transcript = []
        for i, msg in enumerate(self.history):
            role = msg["role"]
            content = msg["content"]
            if isinstance(content, str):
                transcript.append(f"[{i}] {role}: {content}")
            elif isinstance(content, list):
                for part in content:
                    if part.get("type") == "text":
                        transcript.append(f"[{i}] {role}: {part['text'][:300]}")
                    elif part.get("type") == "document":
                        transcript.append(f"[{i}] {role}: [PDF: {block_id}]")

        transcript_text = "\n".join(transcript)

        summarize_prompt = f"""You are a context compression assistant.

A PDF called '{block_id}' was shared in a conversation. The AI read it natively during the conversation.

Here is the conversation transcript:
{transcript_text}

Based on the conversation, write a compact summary of:
1. What the PDF was about (1-2 sentences)
2. Key points, sections, or findings that were discussed or referenced
3. Any conclusions or decisions made based on the PDF content

Be concise. This summary replaces the PDF in conversation history."""

        summary_response = self.client.messages.create(
            model=self.model,
            max_tokens=512,
            messages=[{"role": "user", "content": summarize_prompt}]
        )

        summary = summary_response.content[0].text
        summary_tokens = int(len(summary) / 4)

        if original_tokens > 0 and summary_tokens >= original_tokens:
            print(f"⚠ Summary ({summary_tokens} tokens) is larger than original ({original_tokens} tokens). Compression not applied.")
            return {
                "compressed": False,
                "reason": "summary_larger_than_original",
                "original_tokens": original_tokens,
                "summary_tokens": summary_tokens
            }

        original_message = self.history[msg_index]
        new_content = []
        if isinstance(original_message["content"], list):
            replaced = False
            for part in original_message["content"]:
                if not replaced and part.get("type") == "document":
                    new_content.append({
                        "type": "text",
                        "text": f"[Compressed PDF '{block_id}']:\n{summary}"
                    })
                    replaced = True
                else:
                    new_content.append(part)
        self.history[msg_index]["content"] = new_content

        self.blocks[block_id]["compressed"] = True
        self.blocks[block_id]["summary"] = summary
        self.blocks[block_id]["summary_tokens"] = summary_tokens

        tokens_saved = original_tokens - summary_tokens if original_tokens > 0 else 0
        pct = round((tokens_saved / original_tokens) * 100) if original_tokens else 0
        print(f"\n✓ Compressed '{block_id}'")
        if original_tokens:
            print(f"Tokens: ~{original_tokens:,} → ~{summary_tokens:,} ({pct}% reduction)")
        return {
            "compressed": True,
            "original_tokens": original_tokens,
            "summary_tokens": summary_tokens
        }