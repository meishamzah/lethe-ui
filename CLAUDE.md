# CLAUDE.md — Lethe UI

## Core behavior
Build, test, debug, and iterate until all requirements are fully complete.
Update the log file after every session.

## Log file
After every implementation session, append to `BUILDLOG.md` in the project root:
- What was implemented
- What was tested and how
- Any issues encountered and how they were resolved
- Anything skipped and why
- Current state of the project

## Quality standards

### Before starting
- Read ARCHITECTURE.md fully before writing any code
- Understand which milestone you are implementing
- If anything in the requirements is ambiguous, make a decision and log it

### While building
- Never leave TODO comments in production code
- Always handle error states — no silent failures
- Every new Flask endpoint must return meaningful error responses
- Every new React component must handle loading and error states
- Never hardcode values that should come from config or environment variables

### After every implementation
1. Read back every file that was changed
2. Confirm each requirement from the task is implemented
3. Start the Flask backend and confirm no errors on startup
4. Start the React frontend and confirm no build errors
5. Manually test the implemented feature end to end
6. If any requirement is not met, fix it before stopping
7. Update BUILDLOG.md

### Flask standards
- All endpoints return JSON
- All endpoints handle exceptions with try/except and return error JSON
- Never expose raw exception messages to the frontend
- New endpoints follow existing naming and structure conventions in app.py

### React standards
- No hardcoded colors — use the existing styles object or index.css variables
- New components follow existing patterns in App.jsx
- All fetch calls have try/catch with error state handling
- No console.log left in production code

### File structure
- Backend code: backend/app.py and backend/lethe.py
- Frontend code: frontend/src/App.jsx, frontend/src/index.css, 
  and any new component files in frontend/src/
- Uploads: backend/uploads/ (gitignored)
- Database: backend/lethe.db (gitignored)
- Architecture reference: ARCHITECTURE.md (read before every session)

## Project context
Lethe UI is a React + Flask chat interface built on top of the Lethe 
context compression library. The backend manages ContextSession objects 
and communicates with LLM providers. The frontend is a three-column layout 
with a sidebar, chat area, and collapsible context panel.

Always refer to ARCHITECTURE.md for design decisions. Never make 
architectural decisions that contradict ARCHITECTURE.md without 
logging the deviation and reason in BUILDLOG.md.