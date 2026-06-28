# Lethe UI

A full-stack chat interface built on top of [Lethe](https://github.com/meishamzah/lethe) — 
a context compression library for LLMs. Lethe UI gives you a clean, Claude-style chat 
experience with built-in tools to manage what gets sent to the model.

---

![Lethe UI Screenshot](screenshots/main.png)

---

## What it does

Every time you send a message to an LLM, your entire conversation history gets re-sent — 
including every image, file, and code block you've ever uploaded. This gets expensive fast.

Lethe UI lets you compress those assets once you're done with them. It replaces raw content 
with a compact summary of what was actually discussed, freeing up your context window without 
losing any meaningful history.

## Features

- **Context panel** — right sidebar tracks every uploaded asset with token counts and compression state
- **Image compression** — semantic scanner finds every message that referenced an image, 
  summarizes the discussion, replaces the raw image with that summary
- **Code compression** — delta tracking across versions, compresses the full debugging thread 
  when you're done
- **Three view modes** — list, tile, or detailed view for uploaded assets
- **Filter pills** — filter by status (all / uncompressed / compressed) and type (images / code / PDFs / text)
- **Auto-rename** — uploaded files get descriptive names based on what the model sees in them
- **Auto-title** — chats get titled automatically from the first message
- **Multi-provider** — bring your own API key for Claude, GPT, Gemini Flash (free), or Deepseek
- **Settings panel** — configure compression behaviour, chat defaults, and API keys

---

## Stack

- **Frontend** — React + Vite
- **Backend** — Flask
- **Library** — [Lethe](https://github.com/meishamzah/lethe)

---

## Running locally

### Prerequisites
- Python 3.11+
- Node.js 18+
- An API key for your preferred provider (Gemini Flash is free — get one at 
  [Google AI Studio](https://aistudio.google.com/app/apikey))

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Mac/Linux
pip install -r requirements.txt
```

Create a `.env` file in the `backend` folder:
```
ANTHROPIC_API_KEY=your_key_here
```

Start the server:
```bash
python app.py
```

Backend runs on `http://127.0.0.1:5000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`

---

## Screenshots

| Chat interface | Context panel | Settings |
|---|---|---|
| ![Chat](screenshots/chat.png) | ![Panel](screenshots/panel.png) | ![Settings](screenshots/settings.png) |

---

## Roadmap

- [ ] Persistent chat history (SQLite)
- [ ] User accounts and authentication
- [ ] Google OAuth
- [ ] PDF and text file compression
- [ ] Hosted version at lethe.app
- [ ] Mobile responsive layout
- [ ] Export chat as markdown or PDF
- [ ] Usage analytics dashboard

---

## Related

- [Lethe](https://github.com/meishamzah/lethe) — the underlying Python context compression library

---

## License

MIT