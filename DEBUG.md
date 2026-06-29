## Debug Notes — 2026-06-29

### UI fixes needed

1. **Sign out behavior**
   - Signing out currently doesn't update the page state
   - On sign out: clear all React state (messages, blocks, previews, chats, 
     authUser), clear localStorage, and do a full page reload (`window.location.reload()`)
   - No landing page yet — just reset to fresh guest session state

2. **Chatbox vertical expansion**
   - Textarea should auto-expand vertically as content exceeds one line
   - Use `rows={1}` with `overflow-y: hidden` and auto-resize on input:
```javascript
     const handleInput = (e) => {
       e.target.style.height = 'auto'
       e.target.style.height = e.target.scrollHeight + 'px'
     }
```
   - Cap max height at ~200px then scroll within

3. **Chatbox paste support**
   - Should accept pasted images (from clipboard) and text files (drag and drop)
   - Listen for `onPaste` event on the textarea
   - If `event.clipboardData.files` contains an image → treat same as file upload
   - If pasted content is a text file → read as text and attach as text block

4. **Login button inline with Guest**
   - Current: login button appears separately
   - Should be: `Guest · Log in` inline in the sidebar bottom
   - Same pattern as `Ameer · Pro` for logged-in users
   - Dot separator between Guest and Log in

5. **Rename right panel**
   - "Context" → "Context Panel" in the panel title

6. **User message bubble width**
   - Message bubble should be proportionate to content width
   - Short messages should be narrow, not stretched to 70% always
   - Use `width: fit-content` with `max-width: 70%` and `min-width: 80px`
   - Bubble grows with content until it hits the 70% cap then wraps

7. **Retry icon**
   - Current icon looks wrong
   - Replace with a proper refresh/retry icon from Tabler Icons
   - Use `ti-refresh` or `ti-rotate` from the Tabler icon set

8. **Hover tooltips on message action buttons**
   - Copy, retry, thumbs up, thumbs down buttons need tooltip labels on hover
   - Show tooltip below the icon with the button name
   - e.g. "Copy", "Retry", "Helpful", "Not helpful"
   - CSS tooltip or title attribute — keep it simple

9. **When user signs out**
    - Call POST /auth/logout on the backend
    - Clear all React state: messages, blocks, previews, chats, authUser, selected, compressionMsg
    - Clear localStorage (guest ID, any stored tokens)
    - Generate a new guest ID and set it as a cookie
    - Call POST /new_chat to start a fresh session on the backend
    - Do NOT do a full page reload — just reset state cleanly to a fresh guest session
    - User should land on the empty chat screen as if they just opened the site for the first time