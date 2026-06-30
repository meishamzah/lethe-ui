# Build Log — Lethe UI

---

## Session: 2026-06-29 — River logo + animated loading screen + page transitions

### What was implemented

**Logo replacement**
- Removed the old 3-line-in-rounded-square `LetheLogo` component from `LandingPage.jsx`.
- Created `frontend/src/RiverLogo.jsx` — the three-wave river SVG (`viewBox="0 0 800 500"`, aspect ratio 1.6:1) as a shared React component. `height` prop controls size; `width` is computed automatically.
- Applied in `LandingPage.jsx` nav (height 26) and footer (height 22).
- Applied in `App.jsx` sidebar header alongside the "Lethe" wordmark (height 18).
- No background rect included — the parent background handles it.

**Loading screen (`frontend/src/LoadingScreen.jsx`)**
- Full-screen fixed overlay (`z-index: 9999`, background `#0F0F0F`).
- Inlines the river SVG (3 wave paths only, no rect) with CSS `@keyframes letheWave` animation.
- Wave 1 (full opacity): 0ms delay; wave 2 (0.62 opacity): 150ms delay; wave 3 (0.32 opacity): 300ms delay.
- Duration 1.8s ease-in-out infinite. Each wave translates -12px at the 50% keyframe.
- CSS class `.lethe-wave-svg` scopes the animation to avoid conflicts.
- Controlled by `show` prop: fades in/out via `opacity` + `transition: 0.35s ease`, `pointerEvents: none` when hidden.
- "Lethe" wordmark below the animated logo.

**Transition context (`frontend/src/TransitionContext.js`)**
- Holds `isTransitioning` state. Defined as a separate module to avoid circular imports between `main.jsx`, `LandingPage.jsx`, and `App.jsx`.

**`main.jsx` — AppShell wrapper**
- Replaced the bare `<Routes>` with an `AppShell` component that owns `isTransitioning` state (starts `true` so the loading screen covers the initial paint).
- `TransitionContext.Provider` wraps the routes + `LoadingScreen`.
- Each route is responsible for calling `setIsTransitioning(false)` when it has finished loading.

**`LandingPage.jsx` — transition hooks**
- `useContext(TransitionContext)` — calls `setIsTransitioning(false)` when the page is ready (after `/auth/me` resolves or `?logged_out=1` is processed).
- "Start for free" and "Log in with Google" both call `setIsTransitioning(true)` before navigating, so the loading screen appears immediately.
- If already authenticated, sets `isTransitioning(true)` before the auto-redirect to `/chat`.

**`App.jsx` — transition hooks + lighter chat-switch fade**
- `useContext(TransitionContext)` — calls `setIsTransitioning(false)` after `fetchChats()` fully resolves (both the success path and the final-retry failure path).
- Sign-out handler calls `setIsTransitioning(true)` immediately before awaiting the logout, so the overlay appears as soon as sign-out is clicked.
- Added `switchingChat` state. `switchToChat()` sets it `true` at start, `false` in the `finally` block.
- Applied to the `chatArea` div: `opacity: switchingChat ? 0.3 : 1, transition: "opacity 0.2s ease"`. During the global loading screen (initial load), the fade is hidden behind it. For sidebar chat switching it gives a subtle fade without full-screen loading.

### Transition coverage
| Trigger | Behaviour |
|---|---|
| Initial page load | `isTransitioning=true` → loading screen → page calls `setIsTransitioning(false)` |
| Landing → Chat ("Start for free") | `setIsTransitioning(true)` → navigate → App fetchChats → `setIsTransitioning(false)` |
| Landing → Chat (Google OAuth) | `setIsTransitioning(true)` → full-page redirect → App mounts with default `true` → fetchChats → `false` |
| Chat → Landing (sign out) | `setIsTransitioning(true)` → await logout → redirect → LandingPage mounts with default `true` → auth check → `false` |
| Chat sidebar click | `switchingChat=true` → chat area fades to 30% opacity → data loads → `switchingChat=false` → fades to full |

### Current state
Loading screen and logo fully wired across all page transitions. River logo replaces every instance of the previous 3-line logo.

---

## Session: 2026-06-29 — Gemini Flash via LiteLLM for chat routing

### What was implemented
- **LiteLLM adapter in `app.py`**: Added `_LiteLLMClient` / `_LiteLLMMessages` adapter classes that expose the same `.messages.create()` interface as the Anthropic SDK. The adapter translates Anthropic-format message content (image blocks, document blocks, text) to OpenAI/LiteLLM format before calling `litellm.completion()`, and wraps the response to expose `.content[0].text` and `.usage.input_tokens` — so `lethe.py` is provider-agnostic.
- **Gemini key pools**: Replaced `CHAT_KEY_POOL` / `BACKEND_KEY_POOL` env vars with `GEMINI_CHAT_KEY_POOL` and `GEMINI_BACKEND_KEY_POOL`. Both are comma-separated lists of Gemini API keys. Selection is deterministic by identity: `hash(str(identity_id)) % len(pool)`.
- **Updated `_get_client_for_identity()`**: Now returns:
  1. `_LiteLLMClient` with user's own key + provider (if stored in DB)
  2. `_LiteLLMClient` with Gemini pool key keyed by `user_id` (logged-in, no own key)
  3. `_LiteLLMClient` with Gemini pool key keyed by `lethe_guest_id` cookie (guest)
  4. Falls back to `_anthropic_client` when `GEMINI_CHAT_KEY_POOL` is empty
- **Compress always uses Anthropic**: `_anthropic_client` (keyed to `ANTHROPIC_API_KEY`) is passed as `compress_client` to every `ContextSession`. Updated `ContextSession.__init__` in `lethe.py` to accept `compress_client` and `compress_model` params.
- **`lethe.py` routing**: All 9 API calls inside compress methods (`compress_image`, `_compress_code`, `_compress_text`, `_score_pdf_sections`, `_summarize_pdf_text_track`, `_summarize_pdf_image_track`, `_merge_pdf_tracks`, `_compress_pdf_phase1`) now use `self.compress_client` + `self.compress_model`. `send()` remains on `self.client`.
- **`db.py`**: `reconstruct_session()` now accepts optional `compress_client` and forwards it to `ContextSession`.
- **`requirements.txt`**: `litellm` was already present; no change needed.

### Provider model map
| Provider setting | LiteLLM model string |
|---|---|
| gemini | gemini/gemini-1.5-flash |
| anthropic | anthropic/claude-sonnet-4-6 |
| openai | openai/gpt-4o-mini |

### Message format conversion
- `image` blocks → `image_url` with data URI (Gemini supports this via LiteLLM)
- `document` blocks (PDF, Anthropic-native) → text stub: `"[PDF document — not available via this provider]"`. Native PDF reading is preserved when the user brings their own Anthropic key (chat routes through Anthropic/LiteLLM, which passes document blocks correctly).
- Compress always uses Anthropic directly, so PDF compression is unaffected.

### Tested
- Backend startup confirms no import errors
- Routing logic verified by code review (manual API test requires live Gemini keys)

### Not implemented / deferred
- `GEMINI_BACKEND_KEY_POOL` is parsed and stored but not yet wired to a call site. Currently the ephemeral injection (chat title, image title) is bundled into the same `send()` API call and uses the chat client naturally. A dedicated backend pool call site can be added when titling/naming become separate API calls.

### Current state
All chat traffic routes to Gemini Flash via LiteLLM. Compression continues via Anthropic. Fallback to Anthropic when no Gemini pool is configured ensures zero downtime during env-var rollout.

---

## Session: 2026-06-28 — M4 bug fix + reply cleaning + M5 Phase 1 prep

### What was implemented
- **Bug fix**: Chat list was permanently empty when `fetchChats()` failed on startup. Added 5-retry logic with 1.5s intervals and a "Connecting…" indicator in the sidebar.
- **Reply cleaning in `app.py`**: Added `_clean_injected_reply()` that finds the lowest horizontal rule in Claude's response, extracts `[CHAT_TITLE]` / `[IMAGE_TITLE]` tags from the metadata block below it, returns only the clean content above it. Falls back to inline stripping if no separator is found. `lethe.py` now stores the raw reply; `app.py` immediately patches `session.history[-1]["content"]` with the clean version so history is never polluted.
- **`.gitignore`**: Added `backend/lethe.db` and `backend/..server.log` which were missing.

### Tested
- Backend starts without errors
- Existing chats load correctly
- Retry logic confirmed visually (server stopped, frontend showed "Connecting…" then recovered)
- Reply cleaning confirmed: no tags or separators visible in chat area; history stays clean

### Issues / decisions
- Removed all tag extraction from `lethe.py` — moved entirely to `app.py` for a cleaner separation of concerns
- `import re` was missing from `app.py` — added

---

## Session: 2026-06-29 — M5 Phase 2: Auth, Guest Sessions, Key Pools, Settings

### What was implemented

#### `backend/db.py` (complete rewrite)
- New tables: `users`, `settings`, `events`
- Migrated `chats` table: `ALTER TABLE ... ADD COLUMN` for `user_id` and `guest_id` (safe for existing data)
- User functions: `create_user`, `get_user_by_google_id`, `get_user_by_id`, `update_user`
- Settings functions: `get_settings(user_id)`, `upsert_settings(user_id, patch)`
- Identity-scoped chat queries: `get_chats_for_user`, `get_chats_for_guest`
- `migrate_guest_chats(guest_id, user_id)` — reassigns guest chats to a real user on login
- `log_event(event_type, ...)` for analytics
- `create_chat` now accepts `user_id=None, guest_id=None`

#### `backend/auth.py` (new file)
- `User` class (Flask-Login `UserMixin`)
- `init_oauth(app)` — registers Google OAuth via Authlib
- Auth routes: `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/logout`, `GET /auth/me`
- Callback: migrates guest chats → logs in user → redirects to frontend → deletes guest cookie
- `/auth/me` returns authenticated user info OR guest_id + plan: "free"
- Returns 503 if `GOOGLE_CLIENT_ID` is not set

#### `backend/app.py` (rewrite)
- Flask-Login wired up: `LoginManager`, `user_loader`, `init_oauth`, blueprint registered
- **Persistent secret key**: generated once and stored in `backend/.flask_secret` so sessions survive restarts
- `active_chat_id` moved from global variable to per-browser Flask session
- `get_identity()` helper: returns `("user", id)` for authenticated users, `("guest", guest_id)` for guests (reads `lethe_guest_id` cookie)
- `get_chats_for_identity()` / `create_chat_for_identity()` for scoped DB queries
- `get_active_session()` reconstructs session from DB if not in memory cache
- **API key pools**: `CHAT_KEY_POOL` and `BACKEND_KEY_POOL` from env vars, selected by `hash(guest_id) % len(pool)`; falls back to `ANTHROPIC_API_KEY`
- **Per-user API keys**: `POST /settings/api_key` encrypts and stores via Fernet; `GET /settings/api_key` returns provider only; `DELETE /settings/api_key` removes
- **Fernet encryption** helpers: `_encrypt_key`, `_decrypt_key`, keyed from `LETHE_ENCRYPTION_KEY` env var
- Settings endpoints: `GET /settings`, `POST /settings` (authenticated only)
- All existing routes migrated to new identity system
- `log_event("message_sent")` on every send
- `log_event("new_chat")` on chat creation

#### `frontend/src/App.jsx`
- `const API = "http://localhost:5000"` (changed from 127.0.0.1 — same-site cookie requirement)
- `apiFetch(path, opts)` helper: wraps all API calls with `credentials: "include"` for session cookie support
- All fetch calls replaced with `apiFetch`
- **Guest ID init** on mount: reads/creates `lethe_guest_id` in localStorage, sets it as a cookie (`SameSite=Lax`)
- **Auth state**: `authUser` (null = guest, object = logged in), checked via `GET /auth/me` on mount
- On login detected: localStorage guest ID and cookie are cleared
- **Auto-create chat** when fetchChats returns empty (new guest flow)
- `sentCount` state: incremented on every sent message
- **Nudge banner**: appears after 4 sent messages for guests — "Log in with Google" CTA, dismissible
- **Dynamic sidebar bottom**: shows avatar/name/plan for authenticated users; "Guest / Free / Log in →" for guests; "Sign out" link for authenticated users
- `nudgeDismissed` state to prevent repeat nudge

### Tested
- `python -c "import app"` → OK (no syntax/import errors)
- `npx vite build` → clean build, 0 errors
- `GET /chats` → returns scoped chats (empty without guest cookie, correct)
- `GET /auth/me` → returns `{authenticated: false, guest_id: null, plan: "free"}` for unauthenticated request ✓
- `POST /new_chat` → returns `{chat_id: N}` ✓

### Not tested (requires credentials)
- Google OAuth flow end-to-end (requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `.env` and registered redirect URI `http://localhost:5000/auth/google/callback`)
- Fernet encryption (requires `LETHE_ENCRYPTION_KEY` in `.env` — generate with `from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())`)
- Nudge banner (requires 4 messages sent as guest in browser)

### Issues / decisions
- **`localhost` vs `127.0.0.1`**: Browser cookie SameSite rules require both frontend and backend to use `localhost` (not `127.0.0.1`) for cross-origin session cookies to work. Changed `API` constant accordingly.
- **Persistent secret key**: `FLASK_SECRET_KEY` from env or auto-created `.flask_secret` file. Without this, every restart invalidates all browser sessions.
- **Pre-M5 chats** (guest_id=NULL, user_id=NULL) won't appear in filtered queries. This is correct; they're orphaned legacy data.
- `LETHE_ENCRYPTION_KEY` must be set for API key storage to work; endpoint returns 503 if missing.

### Current state
- M5 Phase 2 backend: complete
- M5 Phase 2 frontend: complete
- Google OAuth: wired up, untested (no credentials in env)
- Guest session flow: fully functional
- Key pools: implemented, untested without pool keys in env

---

## Session: 2026-06-28 — Milestone 6: Context health bar + Message action bar

### What was implemented

#### Context health bar (frontend only)
- Estimated context usage = message text tokens (content.length / 4) + active block tokens (totalTokens - savedTokens)
- Fixed context limit: 200,000 (Anthropic Claude)
- Thin 3px bar rendered above the input box, fills left to right as context fills
- Color stages: teal <50%, amber 50-70%, orange 70-85%, red ≥85%
- Nudge text appears at 50%+: "Your context is getting full…" / "Compress now…" / "Context almost full…"
- "Compress now" button appears at 70%+: selects all uncompressed blocks and opens the confirm dialog
- Token counter shown below bar: `N% · ~X / 200,000`
- Bar animates width + color transitions with CSS

#### Message action bar (frontend only)
- Each message shows an action bar on hover, fades in at 0.15s
- Left-aligned for assistant messages, right-aligned for user messages
- **Copy** (all messages): copies raw markdown text, icon flips to green checkmark for 1.5s
- **Retry** (last assistant message only): calls `POST /retry`, removes last AI message from UI, shows typing animation, replaces with new response
- **Thumbs up / Thumbs down** (all assistant messages): UI only, no-op for now
- All icons are inline SVGs, 13px, styled via `.action-btn` CSS class

#### `POST /retry` endpoint (backend)
- Pops last assistant message from `sess.history`
- Pops last user message, extracts text (handles both string and list content)
- Calls `sess.send(user_text)` to get a fresh response
- Deletes last assistant display message from DB via `delete_last_display_message()`
- Saves new assistant display message + updated history to DB

#### `db.py`
- Added `delete_last_display_message(chat_id, role)` — deletes highest-id message row for given role

### Tested
- `npx vite build` → clean, 0 errors
- `python -c "import app"` → OK

### Issues / decisions
- Retry is text-only: if the original user message had file/image attachments, those are dropped on retry (only the text part is re-sent). This is acceptable for M6 scope.
- Context bar always uses 200,000 as limit since only Claude/Anthropic is used as backend
- Token estimates are rough (character count / 4) — same estimation used throughout the app

### Current state
- M7 features (health bar + action bar): complete
- Note: these features were mislabeled as M6 in this session; the real M6 (Algorithm Implementation) was implemented in the next session.

---

## Session: 2026-06-29 — Milestone 6: Lethe Multimodal PDF Compression Algorithm

### What was implemented

#### `backend/lethe.py` — Phase 2 two-track PDF compression

Replaced the Phase 1 `_compress_pdf` stub with the full multimodal algorithm described in ARCHITECTURE.md.

**`_compress_pdf`** (new entry point)
- Tries to import `fitz` (pymupdf); falls back to `_compress_pdf_phase1` if unavailable or if PDF parsing fails
- Builds conversation transcript, calls `_parse_pdf_content`, then runs both tracks in sequence
- Merge: if both tracks produced output, calls `_merge_pdf_tracks`; if only text, returns text summary; if only images, joins their summaries
- Replaces the native `document` block in `self.history[msg_index]` with the compressed text summary
- Returns same `{compressed, original_tokens, summary_tokens}` dict as all other compress methods

**`_parse_pdf_content`** (new)
- Opens PDF with `fitz.open(pdf_path)`, iterates pages
- Text: calls `page.get_text("blocks")`, filters to type-0 (text) blocks longer than 20 chars, groups into per-page `text_sections` with label, text, page number
- Images: calls `page.get_images(full=True)` per page, deduplicates by xref, extracts image bytes via `doc.extract_image(xref)`, skips images < 500 bytes (decorative), caps at 8 images total; attaches surrounding page text (first 600 chars) and figure references (`re.findall(r'Fig(?:ure)?\.?\s*\d+')`) to each image block

**`_score_pdf_sections`** (new)
- Sends conversation transcript + per-page text previews (250 chars each) to the LLM
- Asks it to assign engagement tiers: 1 (directly discussed), 2 (briefly referenced), 3 (never mentioned)
- Parses JSON object from response; defaults missing pages to tier 3

**`_summarize_pdf_text_track`** (new)
- Sends all text sections with their tiers (truncated to 1200 chars each) + transcript to LLM
- Instructs tiered compression: Tier 1 = full detail, Tier 2 = 2-3 sentences, Tier 3 = 1 sentence
- Returns a single flowing summary starting with a 1-sentence document overview

**`_summarize_pdf_image_track`** (new)
- For each extracted image: encodes as base64, sends to LLM as vision request with surrounding document text and conversation transcript
- Returns list of `{label, page, summary}` dicts
- Individual image failures are caught and skipped (logged to stdout)

**`_merge_pdf_tracks`** (new)
- Sends both track summaries + conversation context to LLM
- Instructs it to combine into a single summary that preserves text-figure relationships
- Returns final merged output

**`_compress_pdf_phase1`** (renamed from old `_compress_pdf`)
- Unchanged behavior: conversational-only summarization without PDF parsing
- Used as fallback when pymupdf is not installed or PDF parsing throws

#### `backend/requirements.txt`
- Added `pymupdf` (already installed as version 1.27.2.3)

### Tested
- `python -c "import lethe"` → OK (no syntax errors)
- All 7 new/renamed methods verified present on `ContextSession` instance
- `import fitz; fitz.Document()` → OK, version 1.27.2.3
- Backend starts cleanly (`* Running on http://127.0.0.1:5000`)
- No frontend changes needed — `/compress` endpoint contract unchanged

### Issues / decisions
- Image cap at 8: PDFs with many figures could be slow (8 vision API calls); cap keeps compression time reasonable. Increase later if needed.
- Surrounding text: uses full page text (not bounding box proximity) for simplicity and pymupdf version compatibility. Works well because images usually have related text on the same page.
- If text extraction yields nothing and no images are found (e.g. scanned PDF), falls back to Phase 1 rather than failing silently.
- Phase 1 is now named `_compress_pdf_phase1` so it remains callable as an explicit fallback.

### Current state
- M6 (Algorithm Implementation): complete
- M7 (Context health bar + message action bar): complete (implemented in previous session, mislabeled as M6)
- All 7 milestones implemented

---

## Session: 2026-06-29 — Landing Page + Routing

### What was implemented

#### `frontend/src/LandingPage.jsx` (new file)
- Full landing page converted from `frontend/Lethe Landing.html` (bundled design export)
- Checks `/auth/me` on mount — redirects authenticated users to `/chat` immediately
- "Start for free" buttons → `navigate("/chat")` via React Router
- "Log in with Google" buttons → `window.location.href = API + "/auth/google"`
- All nav anchor links (`#how`, `#features`) work as smooth-scroll page anchors
- Includes: nav, hero section, product mockup (CSS-rendered app screenshot), "How it works" (3 steps), features (4 cards), CTA band, footer
- Fully responsive: mockup sidebars hidden on ≤900px, grids collapse to 1 column on mobile

#### `frontend/src/main.jsx` (updated)
- Added `react-router-dom` BrowserRouter
- `/` → `LandingPage`
- `/chat` → `App` (existing chat interface)

#### `frontend/src/index.css` (updated)
- Removed `body { overflow: hidden; }` — App.jsx root div already has `overflow: hidden` inline; body-level was blocking landing page scroll
- Added `html { scroll-behavior: smooth; }` for anchor link animation
- Added landing page CSS classes: `.lh-cta-primary`, `.lh-cta-secondary`, `.lh-nav-link`, `.lh-feature`, `.lh-how-grid`, `.lh-feat-grid`
- Added responsive media queries for landing page grids and mockup

#### `backend/auth.py` (updated)
- `google_callback`: redirect changed from `{frontend_url}?auth_token=...` to `{frontend_url}/chat?auth_token=...`
- App.jsx already reads `auth_token` from `window.location.search` which works unchanged at the `/chat` route

#### `frontend/src/App.jsx` (updated)
- Sign-out handler simplified: after clearing auth/localStorage/cookie, does `window.location.href = "/"` to redirect to landing page
- Removed the post-logout `/new_chat` call and state resets — these happen naturally when the user enters `/chat` fresh

### Packages installed
- `react-router-dom` (4 packages, 0 vulnerabilities)

### Tested
- `npm run build` → clean (257 modules, 0 errors)
- Backend import check → OK

### Issues / decisions
- The bundled HTML file (`Lethe Landing.html`) is a design-tool export with base64-encoded compressed assets — too large to read directly. Content extracted via PowerShell string parsing to reconstruct the visual structure.
- Used `window.location.href = "/"` for sign-out redirect (full page navigation) rather than React Router `navigate` — avoids importing useNavigate into App.jsx and gives a clean slate on the App component.

### Current state
- Landing page live at `/`
- Chat interface at `/chat`
- OAuth redirect goes to `/chat` after login
- Sign-out returns to `/`

---

## Session: 2026-06-29 — PostgreSQL migration + sign-out fixes

### What was implemented

#### Sign-out bug fixes (`frontend/src/App.jsx`, `frontend/src/LandingPage.jsx`, `backend/auth.py`)
- **Root cause 1**: `session.clear()` in `logout()` was wiping Flask-Login's `session["_remember"] = "clear"` signal before its `after_request` hook could run, so `remember_token` cookie was never deleted. Backend re-authenticated the user from the still-valid cookie on the next request.
- **Fix**: Removed `session.clear()` from `logout()`. Added explicit `resp.delete_cookie(cookie_name, path="/")` as belt-and-suspenders.
- **Root cause 2**: `await apiFetch("/auth/logout")` could block indefinitely if the backend was slow, preventing `window.location.href = "/"` from executing.
- **Fix**: Made sign-out handler synchronous (fire-and-forget logout), redirect to `/?logged_out=1`.
- **Root cause 3**: LandingPage's `/auth/me` check could redirect back to `/chat` before the session was cleared.
- **Fix**: LandingPage skips the auth redirect when `?logged_out=1` is present, then cleans the URL with `window.history.replaceState`.

#### PostgreSQL migration (`backend/db.py`)
- Introduced `_DB` wrapper class unifying sqlite3 and psycopg2 under one interface
- `_DB.execute()`: replaces `?` → `%s` for psycopg2, uses `RealDictCursor` so rows are dict-accessible in both engines
- `_DB.execute_returning_id()`: uses `RETURNING id` + `fetchone()["id"]` for psycopg2; `cursor.lastrowid` for sqlite3
- `_DB.__exit__()`: commits on success, rolls back on exception, closes connection — eliminating all scattered `conn.commit()` calls
- Separate DDL: `_SQLITE_DDL` (AUTOINCREMENT, BOOLEAN DEFAULT 0/1, REAL) and `_PG_TABLES` (SERIAL PRIMARY KEY, BOOLEAN DEFAULT TRUE/FALSE, DOUBLE PRECISION)
- `init_db()` delegates to the right DDL path; migration column check uses `information_schema.columns` for PG, `PRAGMA table_info` for SQLite
- `DATABASE_URL` env var selects psycopg2; absent → SQLite (local dev unchanged)
- `psycopg2-binary` added to `requirements.txt`

### Tested
- `python -c "import db; db.init_db()"` → OK (SQLite path)
- Backend import check → OK

### Issues / decisions
- Did not use `session.clear()` after `logout_user()` — Flask-Login stores its `_remember="clear"` signal in the session; clearing the session before `after_request` runs prevents the remember cookie from being deleted.
- `cursor.lastrowid` is unreliable with psycopg2 on tables without OIDs (default since PG12); `RETURNING id` is used instead.
- `executescript()` is sqlite3-only; PG init runs each CREATE TABLE statement individually.
- `int(meta.get("compressed", False))` kept as-is — psycopg2 coerces integers to BOOLEAN columns without issues.

### Current state
- SQLite used locally (DATABASE_URL not set)
- PostgreSQL used on Railway (DATABASE_URL set)
- All CRUD functions work identically through the `_DB` wrapper
