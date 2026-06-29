# Lethe UI — Architecture Notes

## Milestone 1 — Bug fixes + Core features

### 1. Flush right panel on new chat
- Frontend: when "+ New" is clicked, call `POST /new_chat` endpoint
- Backend: creates a fresh `ContextSession()`, returns new chat_id
- Frontend: clears `blocks`, `previews`, `selected`, `messages` state
- Right panel shows empty state again

### 2. Right panel view modes
- Three view options for uploaded blocks, toggled by small icons at the top of the panel:
  - **List view** — one block per row, filename + token count + compressed badge, no thumbnail
  - **Tile view** — square thumbnails in a grid (2 per row), filename label below, token count on hover
  - **Detailed view** — current implementation, rectangular thumbnail + filename + type + token count all visible
- View preference stored in React state, defaults to detailed view
- All three views support click-to-select and compress flow unchanged
- Compression sweep animation must work in all three views:
  - List view — animate a left-to-right teal highlight on the row instead of thumbnail
  - Tile view — sweep animation on the square thumbnail
  - Detailed view — sweep animation on the rectangular thumbnail (current behavior)
- Compressed state (greyscale + ✓ badge) must also be consistent across all three views

### 3. Missing thumbnail for late-tracked images
- Problem: images uploaded before `previews` state existed don't have a preview URL
- Fix: when fetching `/status`, if a block has type "image" but no entry in `previews`,
  show a placeholder grey square with the filename instead of nothing
- Placeholder style: same size as thumbnail, background #2A2A2A, centered filename text

### 4. Ephemeral Prompt Injection

#### Chat title (first message only):
- Append to outgoing API message: "Also suggest a 3-5 word chat title wrapped in [CHAT_TITLE]...[/CHAT_TITLE]"
- Backend parses and strips [CHAT_TITLE]...[/CHAT_TITLE] from reply before returning to frontend
- Extracted title updates the sidebar chat entry
- History only stores the original clean user message — no injection persisted

#### Image title (when image uploaded):
- Append to outgoing API message: "Also suggest a short descriptive filename for the uploaded image wrapped in [IMAGE_TITLE]...[/IMAGE_TITLE]"
- Backend parses and strips [IMAGE_TITLE]...[/IMAGE_TITLE] from reply
- Extracted title renames the block in session.blocks and updates the right panel
- History only stores the original clean user message

#### Parsing pattern (both):
- re.search(r'\[TAG\](.*?)\[/TAG\]', reply) to extract
- re.sub(r'\[TAG\].*?\[/TAG\]', '', reply).strip() to clean
- Part of Milestone 1 — touches send() in lethe.py and app.py

## Milestone 2 — Image UX

### 1. Full screen image overlay
- Clicking any sent image in the chat opens a full screen overlay
- Double clicking a block in the right panel also opens the overlay
- Background dims to rgba(0,0,0,0.85) behind the image
- Image is centered, max width 90vw, max height 90vh, object-fit contain so it never gets cropped
- Small ✕ button in the top right corner of the overlay closes it
- Clicking the dimmed background outside the image also closes it
- Pressing Escape key also closes it
- Overlay sits above everything else — zIndex higher than panel tab and confirmation dialog

### 2. Overlay state in React
- Add `overlayImage` state — null when closed, preview URL when open
- Clicking image in chat sets `overlayImage` to that message's image URL
- Double clicking block in right panel sets `overlayImage` to that block's preview URL
- ✕ button and background click set `overlayImage` back to null
- useEffect adds/removes Escape key listener when overlayImage changes

### 3. Overlay animation
- Overlay fades in — opacity 0 to 1 over 0.2s
- Image scales in slightly — transform scale(0.95) to scale(1) over 0.2s
- Feels snappy, not slow

### 4. Right panel interactions
- Single click — selects block for compression (existing behavior)
- Double click — opens full screen overlay
- Hover tooltip on each block — "click to select · double click to view"
- Compressed blocks — single click does nothing, double click still opens overlay
- Touch devices — tap to select, long press to view (handle in a later polish pass)

### 5. Right panel filter pills
- Row of filter pills below token summary — All · Uncompressed · Compressed
- Default: All
- Pill style: small, rounded, inactive is #2A2A2A, active is #4ECDC4 with dark text
- Filters apply to all three view modes (list, tile, detailed)
- Filter state stored in React, no backend call needed

### 6. Block metadata — timestamp
- `uploaded_at` stored in block metadata at upload time (JS Date.now())
- Also stored in Flask session.blocks so it persists with the session
- Displayed as relative time — "2 mins ago", "1 hour ago", "3 days ago"
- Shown below filename in detailed and list views
- Shown on hover in tile view

### 7. Collapse arrow
- Replace current `→` / `←` text with a bold SVG chevron icon
- Size: 16px, stroke-width 2.5, color #888 default, #E8E8E8 on hover
- Smooth rotation animation when toggling — rotates 180deg instead of swapping icons

### 8. Right panel filter pills
- Two independent filter rows:
  - Row 1 — status: All · Uncompressed · Compressed
  - Row 2 — type: All types · Images · Code · PDFs · Text
- Both rows always visible, filters apply independently
- Default: All + All types
- Active pill style: bg-accent background, accent border, accent text
- Inactive pill style: subtle border, muted text, darkens on hover
- Counts shown next to each pill label e.g. "Images 7"
- Counts update reactively when blocks change
- Filtering is pure frontend — no backend call needed
- Both filter rows sit below the token summary (Tracked / Active / Saved)
  and above the block list
- Filter state stored in React: `statusFilter` and `typeFilter`
- When content types are added later (code, PDFs, text), 
  just add a pill to row 2 — no layout change needed

```markdown
## Milestone 3 — Settings Panel

### Access
- Gear icon in the bottom left of the sidebar
- Opens as a modal overlaying the main UI
- Close by clicking ✕ or clicking outside the modal

### Implementation
- Settings stored in localStorage — no backend needed until M5
- Each setting takes effect immediately on change
- No save button except for API key which has an explicit "Save key" button
- Settings panel is a React component rendered conditionally from App.jsx

### State
- Add `showSettings` boolean state to App.jsx
- Add `settings` object state with all defaults:
```javascript
{
  // context management
  autoRenameImages: true,
  autoCompressWithoutAsking: false,
  autoCompressThreshold: 80, // percentage
  compressionMinTokens: 500,
  showTokenCounts: true,

  // chat behaviour
  autoTitleChats: true,
  showTypingAnimation: true,
  sendOnEnter: true,

  // api
  apiKey: "",
  provider: "gemini", // "gemini" | "anthropic" | "openai"

  // right panel
  defaultViewMode: "detailed", // "list" | "tile" | "detailed"
  defaultStatusFilter: "all",
  panelOpenByDefault: true,

  // privacy — these are actions, not toggles
}
```
- Load settings from localStorage on mount
- Save to localStorage on every change

### UI Structure
```
Settings modal
├── Header — "Settings" title + ✕ close button
├── Left nav — vertical list of sections
│   ├── Context management
│   ├── Chat behaviour  
│   ├── Right panel
│   └── Privacy
└── Right content — active section content
```

### Section: Context management
- Toggle — "Auto-rename uploaded images" (autoRenameImages)
- Toggle — "Compress without confirmation" (autoCompressWithoutAsking)
- Toggle + slider — "Auto-compress when context reaches X%" (autoCompressThreshold, 50-95%)
- Number input — "Only compress blocks above X tokens" (compressionMinTokens)
- Toggle — "Show token counts in right panel" (showTokenCounts)

### Section: Chat behaviour
- Toggle — "Auto-title chats from first message" (autoTitleChats)
- Toggle — "Show typing animation" (showTypingAnimation)
- Toggle — "Send on Enter (off = Ctrl+Enter)" (sendOnEnter)

#### API key subsection
- Provider selector — three options as cards or radio buttons:
  - Gemini Flash — "Free · No card required"
  - Claude (Anthropic) — "Paid · Best compression quality"
  - GPT (OpenAI) — "Paid · "
- API key input field — password type, masked
- "Save key" button — saves to localStorage
- Link to get key for selected provider:
  - Gemini — https://aistudio.google.com/app/apikey
  - Anthropic — https://console.anthropic.com
  - OpenAI — https://platform.openai.com/api-keys
- When Gemini is selected, show disclaimer banner:
  "Google may use your conversations to train their models on the 
  free tier. Switch to a paid provider to opt out."
  Style: amber background, warning icon, clear and visible

### Section: Right panel
- Radio select — "Default view mode" — List / Tile / Detailed
- Radio select — "Default status filter" — All / Uncompressed / Compressed
- Toggle — "Panel open by default"

### Section: Privacy
- Button — "Clear all uploaded files" → confirmation dialog → calls POST /reset
- Button — "Clear chat history" → confirmation dialog → clears messages state
- Button — "Reset session" → confirmation dialog → calls POST /reset + clears all state

### Styling
- Modal: max-width 680px, centered, background #1A1A1A, border 1px solid #2A2A2A, border-radius 12px
- Left nav width: 180px, right content fills remainder
- Active nav item: #2A2A2A background, teal left border
- Toggles: use a clean CSS toggle — teal when on, #2A2A2A when off
- Section headings: 11px uppercase muted label, same as panel title style
- Disclaimer banner: amber/warning colors, padding 10px 14px, border-radius 8px, 
  warning icon on left, text on right
- Gear icon in sidebar bottom left — same style as other sidebar elements

### Sidebar bottom — user profile
- Pinned to the bottom of the left sidebar
- Shows: avatar circle with initials + display name + plan tier
- Avatar: circle, background from accent color, initials in white
  e.g. "AH" for Ameer Hamzah
- Plan badge next to name: "Free" or "Pro" in muted small text
- Clicking the settings icon opens the settings modal
- For now (pre-auth): hardcode a placeholder name and "Free" plan
- Once M5 auth is built: pulls from user profile in DB
- Layout: [avatar] [name · plan] [settings icon]
- Settings icon replaces the download icon shown in Claude's UI




## Milestone 4 — Content Types

### Code file upload

#### UI changes
- `+` button expands into a small menu with two options:
  - 📷 Image
  - 📄 Code file
- Code file picker filters to common extensions:
  .py .js .jsx .ts .tsx .cpp .c .java .go .rs .rb .swift .kt .cs .html .css
- Uploaded code file appears in right panel under type filter "Code"
- No thumbnail — shows file icon + filename + token count instead
- Same select-to-compress flow as images

#### Backend changes (app.py)
- Update POST /send to handle code file uploads via FormData
- Save uploaded code file to backend/uploads/code/ subfolder
- Call session.send() with code_path and code_id parameters
- code_id = filename (same as image block_id pattern)
- Return reply + updated blocks as usual

#### Delta compression flow
- First upload of a file → stored as base version in session.blocks
- Re-upload of same filename → Lethe detects existing code_id, 
  computes diff, stores delta only
- Model always sees latest complete version + change history
- User never needs to do anything special — just re-upload the edited file

#### Right panel behavior
- Code blocks show:
  - File icon (no thumbnail)
  - Filename as block ID
  - Token count (estimated from character count / 4)
  - Number of versions tracked e.g. "3 versions"
  - ✓ compressed badge when compressed
- Compression sweep animation: teal highlight on the row 
  instead of thumbnail sweep (same as list view animation)

#### compress() behavior for code
- Already implemented in lethe.py via _compress_code()
- Summarizes: what the code does, problems found, fixes applied, final version
- Guard: won't compress if summary tokens > original tokens
- No changes needed to lethe.py

#### Token estimation for code blocks
- Use character count / 4 as rough estimate
- Show in right panel same as image tokens
- Update Active and Saved totals in token summary accordingly

#### Status endpoint update
- session.blocks already returns code block metadata
- Ensure summary_tokens stored correctly after compression
- Frontend reads meta.type === "code" to render correctly

### Text file upload

#### UI changes
- Add third option to `+` button menu:
  - 📷 Image
  - 📄 Code file
  - 📝 Text file
- Text file picker filters to: .txt .md .csv .json .xml .yaml .yml .log
- Uploaded text file appears in right panel under type filter "Text"
- Shows file icon + filename + token count, no thumbnail
- Same select-to-compress flow as images and code

#### Backend changes (app.py)
- Update POST /send to handle text file uploads via FormData
- Save uploaded text file to backend/uploads/text/ subfolder
- Read file content as plain string
- Send to Claude as a text block in the message content:
```python
  {
    "type": "text",
    "text": f"[Text file '{filename}']:\n{file_content}"
  }
```
- Track in session.blocks with type: "text"

#### session.blocks metadata for text
```python
{
  "id": filename,
  "type": "text",
  "path": file_path,
  "content": file_content,  # store raw content for compression
  "message_index": len(self.history),
  "compressed": False,
  "text_tokens": len(file_content) // 4  # rough estimate
}
```

#### compress() behavior for text
- Same pattern as code compression but simpler — no delta tracking
- Scan conversation for references to the file
- Tiered compression based on engagement:
  - Heavily discussed sections — detailed summary with query highlights
  - Lightly mentioned sections — 2-3 sentence summary
  - Never mentioned sections — 1 sentence label
- Replace raw file content in history with compressed summary
- Add _compress_text() method to lethe.py following same pattern 
  as _compress_image() and _compress_code()

#### Token estimation
- len(file_content) // 4 as rough estimate
- Show in right panel same as other block types
- Update Active and Saved totals accordingly

#### Right panel behavior
- Text blocks show:
  - Text file icon
  - Filename as block ID
  - Token count
  - ✓ compressed badge when compressed
- No version tracking — text files are not delta compressed
- If user re-uploads same filename, treat as a new block 
  (unlike code which diffs)

### PDF upload

#### Phase 1 (ships with M4)
- Add fourth option to `+` button menu:
  - 📷 Image
  - 📄 Code file
  - 📝 Text file
  - 📑 PDF
- PDF picker filters to: .pdf
- Send to Claude as native document block (base64 encoded):
```python
  {
    "type": "document",
    "source": {
      "type": "base64",
      "media_type": "application/pdf",
      "data": base64_encoded_pdf
    }
  }
```
- Claude reads text and images natively — no parsing needed for Phase 1
- Track in session.blocks with type: "pdf"
- Compression falls back to standard conversational summarization —
  scan references, summarize what was discussed, replace raw PDF
- Save to backend/uploads/pdf/ subfolder
- Validation before upload:
  - File size must be under 32MB
  - Page count must be under 100 pages
  - Text-based PDFs only — surface warning for scanned PDFs
- Right panel: PDF icon + filename + token count + compressed badge
- Token estimation: file size in bytes / 6 as rough estimate for Phase 1

### Right panel filter pills update (M4)

#### Type filter row update
- Expand type filter row to include all new content types:
  All types · Images · Code · PDFs · Text
- Pills added as new content types are implemented
- Counts next to each pill update reactively as blocks are added
  e.g. "Images 3 · Code 2 · PDFs 1 · Text 1"
- No category sections or dropdowns in the right panel —
  filter pills are the only navigation between content types
- All existing filter behavior unchanged — status and type 
  filters work independently as designed in M2

### Compression guard — user notification

#### Current behavior (silent)
- _compress_image() and _compress_code() both have a guard that 
  returns early if summary tokens >= original tokens
- No feedback is given to the user when this happens
- User clicks compress, nothing visible changes, no explanation

#### Required behavior
- When compression guard triggers, notify the user clearly
- Do not silently fail

#### UI notification
- Toast notification appears in bottom right corner of screen
- Style: dark background, amber/warning tone, auto-dismisses after 5 seconds
- Message format:
  "'{block_id}' wasn't compressed — the summary ({X} tokens) was 
  larger than the original ({Y} tokens). This usually happens with 
  small files. No changes were made."
- Block remains in right panel in its original uncompressed state
- Block border briefly flashes amber to draw attention to it
- If multiple blocks were selected and only some failed, 
  show one toast per failed block

#### Backend changes
- Update /compress endpoint to return compression result per block:
```python
  {
    "results": [
      {
        "block_id": "image.png",
        "compressed": True,
        "original_tokens": 13685,
        "summary_tokens": 146
      },
      {
        "block_id": "small.png", 
        "compressed": False,
        "reason": "summary_larger_than_original",
        "original_tokens": 420,
        "summary_tokens": 510
      }
    ]
  }
```
- lethe.py _compress_image() and _compress_code() should return 
  a result dict instead of just printing — so app.py can relay 
  the outcome to the frontend

#### Frontend changes
- Read results array from /compress response
- For each failed block, show a toast notification
- For each successful block, update panel as normal
- Add toast component to App.jsx — 
  stack multiple toasts if needed, each auto-dismisses after 5s

## Milestone 5 — Persistence + Auth

### Phase 1 — Persistence (ships first)

#### Database: SQLite
- Single file database: backend/lethe.db
- Library: sqlite3 (built into Python, no install needed)
- Initialize on app startup if db doesn't exist

#### Schema
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'free',
  api_key_encrypted TEXT,
  api_provider TEXT DEFAULT 'gemini',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'New chat',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT,
  image_tokens INTEGER DEFAULT 0,
  summary_tokens INTEGER DEFAULT 0,
  compressed BOOLEAN DEFAULT FALSE,
  summary TEXT,
  message_index INTEGER,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  base_code TEXT,
  diffs TEXT
);
```

#### Flask endpoints

```python
GET    /chats              # returns list of all chats for current user
POST   /new_chat           # creates new chat, returns chat_id
POST   /switch_chat/<id>   # loads chat history and blocks, returns both
PUT    /chats/<id>/title   # update chat title
DELETE /chats/<id>         # delete chat and all its messages and blocks
```

#### Session management
- Flask keeps a dict of active ContextSession objects keyed by chat_id:
```python
  sessions = {}
  active_chat_id = None
```
- POST /new_chat → creates new ContextSession, stores in sessions dict,
  inserts row in chats table, sets active_chat_id
- POST /switch_chat/<id> → checks if session exists in dict,
  if not: reconstructs from DB, sets active_chat_id
- All /send, /compress, /status calls operate on sessions[active_chat_id]

#### Writing to DB
Every operation writes to DB immediately:
- POST /send → insert user message + assistant reply into messages,
  update blocks if file uploaded, update chats.updated_at
- POST /compress → update blocks row: compressed, summary, summary_tokens
- POST /new_chat → insert row into chats
- Ephemeral prompt injection results → update chats.title and 
  blocks.block_id in DB when extracted

#### Reconstructing a session from DB
```python
def reconstruct_session(chat_id):
    session = ContextSession(client=client)
    
    messages = db.execute(
        "SELECT role, content FROM messages 
         WHERE chat_id = ? ORDER BY created_at",
        [chat_id]
    )
    for msg in messages:
        session.history.append({
            "role": msg["role"],
            "content": msg["content"]
        })
    
    blocks = db.execute(
        "SELECT * FROM blocks WHERE chat_id = ?",
        [chat_id]
    )
    for block in blocks:
        session.blocks[block["block_id"]] = {
            "id": block["block_id"],
            "type": block["type"],
            "path": block["path"],
            "image_tokens": block["image_tokens"],
            "summary_tokens": block["summary_tokens"],
            "compressed": block["compressed"],
            "summary": block["summary"],
            "message_index": block["message_index"],
            "base_code": block["base_code"],
            "diffs": json.loads(block["diffs"]) if block["diffs"] else []
        }
    
    sessions[chat_id] = session
    return session
```

#### On page refresh
- Frontend calls GET /chats on mount
- Gets list of chats sorted by updated_at descending
- Auto-loads most recent chat via POST /switch_chat/<id>
- Sidebar populates with all chat titles
- Right panel restores that chat's blocks
- Chat area restores that chat's messages

#### Serving uploaded files
```python
@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory('uploads', filename)
```
Frontend reconstructs previews from block paths:
```javascript
previews[block.block_id] = `http://127.0.0.1:5000/uploads/${block.path}`
```

#### Frontend changes
- On mount: fetch /chats, load most recent, populate sidebar
- "+ New" button: calls POST /new_chat, clears state
- Clicking chat in sidebar: calls POST /switch_chat/<id>,
  restores messages and blocks
- previews reconstructed from served file paths

---

### Phase 2 — Auth

#### Approach
- Google OAuth only — no email/password
- authlib for OAuth flow
- Flask-Login for session management
- Multi-device by design — chats tied to user_id, accessible from any device

#### What Google gives us (no forms needed)
- google_id — unique, permanent identifier
- email
- display_name
- avatar_url — Google profile picture

#### Auth endpoints
```python
GET  /auth/google           # redirects to Google OAuth consent screen
GET  /auth/google/callback  # handles callback, creates or logs in user
POST /auth/logout           # clears session
GET  /auth/me               # returns current user info for sidebar
```
#### Guest sessions
- Users who haven't logged in get a guest session
- Guest ID generated as `guest_<uuid>` and stored in localStorage on first visit
- Bottom left sidebar shows: `[?] Guest · Free ∨` in guest state
- Clicking opens popover with:
  - "Log in with Google" as primary option (teal accent)
  - Settings
  - Log out hidden/greyed out in guest state
- Guest chats are saved in DB tagged with guest_id instead of user_id
- Schema: chats.guest_id TEXT column added alongside chats.user_id
  (one or the other is set, never both)

#### Guest to user migration on login
- When a guest logs in with Google, all chats tagged with their guest_id
  are migrated to their new user_id
- Migration happens in /auth/google/callback after user row is created/found:
```python
  db.execute(
      "UPDATE chats SET user_id = ?, guest_id = NULL 
       WHERE guest_id = ?",
      [user_id, guest_id_from_cookie]
  )
```
- guest_id cookie/localStorage cleared after migration
- User sees all their previous guest chats immediately after login
- Nothing is lost on login

#### Guest API key pool
- Lethe maintains two separate Gemini Flash key pools:
  - **Chat key pool** — for user-facing chat messages (session.send())
  - **Backend key pool** — for Lethe operations (compress(), ephemeral 
    prompt injection, image renaming, chat titling)
- Keeping pools separate prevents compression calls from eating into 
  the user's chat rate limits
- One key per pool per 5 users:
  - Users 1-5 → Chat Key A + Backend Key A
  - Users 6-10 → Chat Key B + Backend Key B
  - And so on
- Key assignment is deterministic by guest_id:
```python
  def get_chat_key(guest_id):
      index = hash(guest_id) % len(CHAT_KEY_POOL)
      return CHAT_KEY_POOL[index]

  def get_backend_key(guest_id):
      index = hash(guest_id) % len(BACKEND_KEY_POOL)
      return BACKEND_KEY_POOL[index]
```
- Keys stored as environment variables, never in DB
- New keys added to pool manually as guest count grows

#### Guest message limit
- No hard stop for now — revisit when traffic data is available
- Soft nudge shown at message 4-5:
  "You're chatting on Gemini Flash. Log in with Google to save 
  your chats and unlock better limits — it's free."
- Two CTAs: Log in with Google (primary) · Bring your own key (secondary)
- Nudge shown once per session, dismissible
- Hard stop threshold to be decided based on real usage patterns

#### Analytics
- Log every guest_id creation with timestamp
- Events table for funnel tracking:
```sql
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT,  -- page_visit, message_sent, login, key_added, compressed
    guest_id TEXT,
    user_id INTEGER,
    metadata TEXT,    -- JSON for extra context
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
```
- Visitors = guest rows created
- Active users = guests who sent at least one message
- Use TablePlus or DB viewer for now — no admin dashboard until M6

#### Auth flow
1. User hits /auth/google → redirected to Google
2. User approves → Google redirects to /auth/google/callback
3. Backend checks if google_id exists in users table
   - If yes: log them in
   - If no: create new user row, log them in
4. Flask-Login sets session cookie
5. Frontend redirects to main app

#### Multi-device
- Works automatically once auth is in place
- Chats are server-side, tied to user_id
- Any device that logs in with the same Google account sees the same chats
- Requires app to be deployed to a real server (not localhost)

#### API key storage
- API keys stored encrypted in users table (api_key_encrypted column)
- Encryption: Python cryptography library, Fernet symmetric encryption
- Encryption key stored as environment variable on server, never in DB
- Flow:
  - User pastes key in settings → POST /settings/api_key → 
    backend encrypts, stores in DB
  - API call needed → backend decrypts key server-side, uses it,
    never sends raw key to frontend
  - Frontend only knows which provider is active, never sees raw key
- Even if DB is compromised, keys are unreadable without server encryption key

#### API key endpoints
```python
POST /settings/api_key  # receives raw key, encrypts, stores
GET  /settings/api_key  # returns provider name only, never raw key
```

#### Settings migration
- All settings move from localStorage to a settings table keyed by user_id
- On login, settings loaded from DB
- localStorage cleared after migration

#### Settings table
```sql
CREATE TABLE settings (
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
);
```

#### Frontend changes for auth
- Login page: single "Continue with Google" button
- If not authenticated: redirect to login page
- If authenticated: load main app
- User profile in sidebar bottom:
  - Avatar: Google profile picture or initials fallback
  - Display name from Google
  - Plan tier from users.plan
  - Reads from GET /auth/me on mount

## Milestone 6 - Algorithm Implementation

## Lethe Multimodal PDF Compression Algorithm

### Core principle
A PDF is not a flat file — it is a structured document where text and images 
are semantically coupled. "As shown in Figure 3" means the surrounding text 
and Figure 3 are one unit of meaning. Compression must respect this coupling.

### Two-track approach

#### Track 1 — Text blocks
- Extract all text content from the PDF using pymupdf (fitz)
- Identify which text sections were actually referenced in the conversation
- User questions act as the filter — same conversational footprint principle
  as image compression
- Text that was never discussed gets dropped entirely
- Text that was discussed gets summarized with highlights around the user's
  specific questions
- Dense unreferenced sections (e.g. bibliography, appendices nobody asked 
  about) are discarded

#### Track 2 — Image blocks within the PDF
- Extract each significant figure, chart, diagram, or photo from the PDF
- Each image is treated as a standalone block — same as an uploaded image
- BUT with additional context: the surrounding text, caption, and section 
  heading from the PDF are passed to the summarizer alongside user queries
- This produces better summaries than standalone image compression because
  the model knows what the figure is about from the document context
- Example: compressing Figure 3 uses its caption "Reaction yield vs 
  temperature", surrounding paragraph text, AND user queries about it

### Relationship preservation
- Track the semantic links between text and images before compression
- When a text block references an image ("as shown in Figure 3"), that 
  link is preserved in the combined summary
- Final compressed output maintains the relationship:
  "Figure 3 showed X (reaction yield peaks at 80°C), which the 
  surrounding text explained as Y, and the user asked about Z"

### Combined compression output
Single unified summary per PDF containing:
- What the document is about (one sentence)
- Text sections that were discussed — summarized with user query highlights
- Image blocks that were discussed — summarized with document context
- Preserved references between text and images

### Tiered compression by engagement level

**Tier 1 — Heavily discussed sections:**
Full detailed summary with user query highlights. Preserves specific 
numbers, findings, arguments, and conclusions that came up in conversation.
No detail dropped if it was referenced by the user.

**Tier 2 — Lightly mentioned sections:**
2-3 sentences capturing the core of the section. Covers what the section 
is about, the central finding or argument, and any key specifics. Enough 
for the model to reason about it meaningfully if referenced later.

**Tier 3 — Never mentioned sections:**
1 sentence maximum. Just the essence of what's there.
Example: "The appendix contains raw experimental data tables for the 
three yield experiments."
Never dropped entirely — model always retains a map of the full document.

### Engagement scoring
- Tier 1: section was directly questioned, quoted, or discussed in detail
- Tier 2: section was mentioned or briefly referenced in passing
- Tier 3: section never appeared in the conversation at all
- Scoring is determined by the semantic scanner — same reference detection 
  used for image compression, applied to text sections instead of image blocks

### Implementation notes
- Library: pymupdf (fitz) for PDF parsing — extracts text blocks and 
  images with position data so we know what's near what
- Text extraction: fitz.open() → page.get_text("blocks") for text,
  page.get_images() for embedded images
- Relationship detection: use bounding box proximity — text within 
  N points of an image is considered related; also parse explicit 
  references ("Figure X", "see above", "as shown")
- Two API calls for compression:
  1. Text track summarizer — conversation + text blocks + user queries
  2. Image track summarizer — each image + surrounding PDF text + user queries
  3. Merge call — combine both summaries into one coherent output
- Token estimation: text tokens from character count / 4, 
  image tokens from tile formula per extracted image

### Two-phase implementation plan
Phase 1 (basic): Upload whole PDF as a native document block, let Claude 
read it natively. No parsing, no separation. Works for most use cases.
Compression falls back to standard summarization of the conversation.

Phase 2 (full algorithm): Implement the two-track multimodal approach 
described above. PDF is parsed, text and images separated, relationship 
graph built, two-track compression applied.

Phase 1 ships with M4. Phase 2 is its own milestone after M5.

### Privacy note for UI
- "Text-based PDFs only — scanned PDFs without embedded text are not supported"
- File size limit: 32MB (Anthropic's limit)
- Page limit: 100 pages (Anthropic's limit)
- Surface these as validation errors before upload, not after

## Milestone 7 - Polishing  


### Context health bar
- Thin bar above the input box, full width of chat area
- Fills left to right based on estimated tokens used vs provider limit
- Label and percentage right-aligned, bar stops just before label
- Provider context limits:
```javascript
  const contextLimits = {
    gemini: 1000000,
    anthropic: 200000,
    openai: 128000,
    deepseek: 128000
  }
```
- Color stages:
  - 0-50% — teal (healthy)
  - 50-70% — amber (consider compressing soon)
  - 70-85% — orange (compress now)
  - 85-100% — red (urgent)
- Nudge messages above input box:
  - 50-70%: "Your context is getting full. Consider compressing some blocks."
  - 70-85%: "Compress now for the best experience." + "Compress now" button
  - 85%+: "Context almost full — compress to continue chatting effectively."
- After compression: bar animates down to new value
- Token estimate: sum of all message text tokens + active block tokens
- Two separate pools means compression calls never spike user chat rate limits

### Message action bar

#### Trigger
- Appears below each message on hover
- Fades in smoothly — opacity 0 to 1 over 0.15s
- Disappears when mouse leaves the message area

#### Actions — assistant messages
- **Copy** — copies the raw markdown text of the message to clipboard
- **Retry** — resends the last user message to get a different response,
  replaces the current assistant message in the chat
- **Thumbs up / Thumbs down** — feedback buttons, 
  for now just UI (store locally or no-op until analytics is built)

#### Actions — user messages
- **Copy** — copies the user's message text to clipboard
- **Edit** — future milestone, not in current scope

#### UI
- Small icon buttons, same style as Claude's action bar
- Icons: copy (ti-copy), play/retry (ti-refresh), thumbs up (ti-thumb-up), 
  thumbs down (ti-thumb-down)
- Icon size: 16px, color: #888, hover: #E8E8E8
- No labels — icons only, tooltips on hover
- Action bar sits 8px below the message bubble
- Left-aligned for assistant messages, right-aligned for user messages

#### Copy behavior
- Copies raw text (not rendered HTML)
- Brief visual confirmation — icon flips to a checkmark (ti-check) 
  for 1.5 seconds then reverts

#### Retry behavior
- Removes the last assistant message from messages state
- Re-sends the last user message to /send
- Shows typing animation while waiting
- Replaces with new response when it arrives

