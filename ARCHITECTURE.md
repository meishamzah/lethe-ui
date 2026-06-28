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

## Persistence Layer (Milestone 4)

### Database: SQLite

Tables:
- `chats` — id, title, created_at
- `messages` — id, chat_id, role, content, created_at  
- `blocks` — id, chat_id, block_id, type, image_tokens, summary_tokens, compressed, summary, path

### Flask Endpoints needed:
- `POST /new_chat` — creates fresh ContextSession, new chat row in DB, returns chat_id
- `POST /switch_chat/<chat_id>` — loads chat's messages from DB, reconstructs ContextSession history and blocks, returns messages + blocks
- `GET /chats` — returns list of all chats for sidebar
- Every `/send` and `/compress` call must write to DB immediately

### On page refresh:
- Frontend calls `/chats` to get list
- Auto-loads most recent chat
- Everything restores from DB

### Session design:
- Each chat has its own ContextSession instance
- Switching chats swaps the active session on the backend
- New chat = new ContextSession()
- Images/blocks are per-chat, not global

