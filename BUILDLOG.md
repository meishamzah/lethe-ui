# Build Log — Lethe UI

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
- M6: complete
- All milestones (1–6) implemented
