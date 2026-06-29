import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

const API = import.meta.env.VITE_API_URL || "http://localhost:5000"

const LetheLogo = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#101010" stroke="#2A2A2A" />
    <line x1="9" y1="10" x2="23" y2="10" stroke="#4ECDC4" strokeWidth="2.2" strokeLinecap="round" />
    <line x1="9" y1="16" x2="20" y2="16" stroke="#4ECDC4" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />
    <line x1="9" y1="22" x2="15" y2="22" stroke="#4ECDC4" strokeWidth="2.2" strokeLinecap="round" opacity="0.4" />
  </svg>
)

const GoogleIcon = () => (
  <svg width="17" height="17" viewBox="0 0 18 18">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
  </svg>
)

const ArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M3 8h10M9 4l4 4-4 4" stroke="#0F0F0F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const howSteps = [
  {
    num: "01",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ECDC4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
    ),
    title: "Upload & discuss",
    text: "Drop in images, code, PDFs, or text. Chat about them like you would anywhere else — every asset is tracked in the context panel.",
  },
  {
    num: "02",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ECDC4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" /><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" /><path d="M8 11h8M8 13h5" />
      </svg>
    ),
    title: "Compress when done",
    text: "Select the assets you've finished with. Lethe replaces the raw content with a compact summary of what was actually discussed.",
  },
  {
    num: "03",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ECDC4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z" /><path d="M8 12l3 3 5-6" />
      </svg>
    ),
    title: "Keep chatting",
    text: "Your conversation continues uninterrupted, with the freed-up context window — and none of the meaning left behind.",
  },
]

const features = [
  { title: "Live context panel", text: "A right rail tracks every asset with token counts and compression state — list, tile, or detailed view." },
  { title: "Semantic image compression", text: "Lethe finds every message that referenced an image and swaps the raw pixels for a summary of the discussion." },
  { title: "Code delta tracking", text: "Tracks changes across versions and compresses the full debugging thread once you've moved on." },
  { title: "Bring your own model", text: "Claude, GPT, Gemini, or Deepseek — use your own API key. Gemini Flash is free to start." },
]

export default function LandingPage() {
  const navigate = useNavigate()

  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: "include" })
      .then(r => r.json())
      .then(data => { if (data.authenticated) navigate("/chat", { replace: true }) })
      .catch(() => {})
  }, [navigate])

  const startFree = () => navigate("/chat")
  const loginGoogle = () => { window.location.href = `${API}/auth/google` }

  return (
    <div style={{ background: "#0F0F0F", color: "#E8E8E8", fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", minHeight: "100vh", overflowX: "hidden" }}>

      {/* NAV */}
      <nav style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LetheLogo />
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "0.04em" }}>Lethe</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <a href="#how" className="lh-nav-link" style={{ fontSize: 14, color: "#888", textDecoration: "none" }}>How it works</a>
          <a href="#features" className="lh-nav-link" style={{ fontSize: 14, color: "#888", textDecoration: "none" }}>Features</a>
          <button onClick={loginGoogle} className="lh-nav-link" style={{ fontSize: 14, color: "#888", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>Log in</button>
          <button onClick={startFree} className="lh-cta-primary" style={{ fontSize: 14, fontWeight: 600, color: "#0F0F0F", background: "#4ECDC4", padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit" }}>Start for free</button>
        </div>
      </nav>

      {/* HERO */}
      <header style={{ maxWidth: 860, margin: "0 auto", padding: "72px 32px 0", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#161616", border: "1px solid #2A2A2A", borderRadius: 999, padding: "5px 14px", marginBottom: 28 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ECDC4", display: "inline-block" }} />
          <span style={{ fontSize: 12, color: "#aaa", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>Context compression for LLM chats</span>
        </div>
        <h1 style={{ fontSize: "clamp(36px, 5vw, 60px)", lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 24 }}>
          Forget the weight,<br />keep the&nbsp;<span style={{ color: "#4ECDC4" }}>conversation</span>.
        </h1>
        <p style={{ fontSize: 19, lineHeight: 1.6, color: "#999", maxWidth: 620, margin: "0 auto 36px" }}>
          Lethe lets you upload images, code, and files into a chat, then compress them when you're done discussing — freeing up context window space without losing any of the history.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={startFree} className="lh-cta-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, color: "#0F0F0F", background: "#4ECDC4", padding: "13px 22px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit" }}>
            Start for free
            <ArrowRight />
          </button>
          <button onClick={loginGoogle} className="lh-cta-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 500, color: "#E8E8E8", background: "#141414", border: "1px solid #2A2A2A", padding: "12px 20px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit" }}>
            <GoogleIcon />
            Log in with Google
          </button>
        </div>
        <p style={{ fontSize: 13, color: "#555", marginTop: 18 }}>No account needed to start — guest chats are instant.</p>
      </header>

      {/* PRODUCT MOCKUP */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "64px 32px 0", position: "relative" }}>
        <div style={{ position: "absolute", top: 120, left: "50%", transform: "translateX(-50%)", width: "70%", height: 340, background: "radial-gradient(ellipse at center, rgba(78,205,196,0.14), transparent 70%)", filter: "blur(40px)", pointerEvents: "none" }} />
        <div style={{ position: "relative", border: "1px solid #2A2A2A", borderRadius: 14, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.6)", background: "#0F0F0F" }}>
          {/* browser bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, height: 44, background: "#161616", borderBottom: "1px solid #222", padding: "0 16px" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {["a","b","c"].map(k => <span key={k} style={{ width: 11, height: 11, borderRadius: "50%", background: "#3A3A3A", display: "inline-block" }} />)}
            </div>
            <div style={{ flex: 1, maxWidth: 360, margin: "0 auto", background: "#0F0F0F", border: "1px solid #2A2A2A", borderRadius: 7, height: 26, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <rect x="3" y="5.5" width="6" height="4.5" rx="1" stroke="#555" strokeWidth="1" />
                <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="#555" strokeWidth="1" />
              </svg>
              <span style={{ fontSize: 11, color: "#666", fontFamily: "'Courier New',monospace" }}>app.lethe.dev</span>
            </div>
            <div style={{ width: 54 }} />
          </div>
          {/* app body */}
          <div className="lh-mockup-body" style={{ display: "flex", height: 600, background: "#0F0F0F" }}>

            {/* sidebar */}
            <div className="lh-mockup-sidebar" style={{ width: 210, background: "#1A1A1A", display: "flex", flexDirection: "column", borderRight: "1px solid #2A2A2A", flexShrink: 0 }}>
              <div style={{ padding: "16px 12px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.05em" }}>Lethe</span>
                  <span style={{ background: "#2A2A2A", color: "#E8E8E8", padding: "5px 9px", borderRadius: 6, fontSize: 11 }}>+ New</span>
                </div>
                <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Recents</div>
              </div>
              <div style={{ flex: 1, padding: "0 12px", display: "flex", flexDirection: "column", gap: 1 }}>
                <div style={{ fontSize: 12, color: "#E8E8E8", padding: "6px 8px", borderRadius: 6, background: "#2A2A2A" }}>Dashboard layout review</div>
                {["Auth middleware debugging", "API spec questions", "Onboarding copy draft"].map(t => (
                  <div key={t} style={{ fontSize: 12, color: "#aaa", padding: "6px 8px", borderRadius: 6 }}>{t}</div>
                ))}
              </div>
              <div style={{ padding: "10px 12px", borderTop: "1px solid #222" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#2A2A2A", color: "#666", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>?</div>
                  <span style={{ fontSize: 12, color: "#D0D0D0", fontWeight: 500 }}>Guest</span>
                  <span style={{ fontSize: 12, color: "#444" }}>·</span>
                  <span style={{ fontSize: 12, color: "#4ECDC4", fontWeight: 500 }}>Log in</span>
                </div>
              </div>
            </div>

            {/* chat */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ flex: 1, padding: "28px 36px", display: "flex", flexDirection: "column", gap: 20, overflow: "hidden" }}>
                <div style={{ alignSelf: "flex-end", maxWidth: "78%" }}>
                  <div style={{ fontSize: 10, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>You</div>
                  <div style={{ width: 180, height: 120, borderRadius: 10, marginBottom: 6, overflow: "hidden" }}>
                    <div style={{ width: "100%", height: "100%", background: "repeating-linear-gradient(135deg,#202020 0,#202020 8px,#1c1c1c 8px,#1c1c1c 16px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontFamily: "'Courier New',monospace", fontSize: 9, color: "#555" }}>dashboard-mockup.png</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, background: "#1A1A1A", padding: "11px 15px", borderRadius: 10 }}>Here's the dashboard mockup — what do you think of the layout?</div>
                </div>
                <div style={{ alignSelf: "flex-start", maxWidth: "78%" }}>
                  <div style={{ fontSize: 10, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Lethe</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, background: "#1A1A1A", padding: "11px 15px", borderRadius: 10 }}>The three-column structure reads well. The metric cards feel a touch heavy — tighten their vertical padding so the chart gets more room.</div>
                </div>
                <div style={{ alignSelf: "flex-end", maxWidth: "78%" }}>
                  <div style={{ fontSize: 10, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>You</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, background: "#1A1A1A", padding: "11px 15px", borderRadius: 10 }}>Perfect, that's all I needed on this one.</div>
                </div>
              </div>
              <div style={{ padding: "14px 36px 22px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: "100%", maxWidth: 560, background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 14, padding: "11px 15px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13, color: "#666" }}>Message Lethe...</div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ color: "#888", fontSize: 18 }}>+</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ background: "#4ECDC4", color: "#0F0F0F", padding: "5px 13px", borderRadius: 8, fontWeight: 600, fontSize: 12 }}>Send</span>
                  </div>
                </div>
              </div>
            </div>

            {/* context panel */}
            <div className="lh-mockup-panel" style={{ width: 260, background: "#1A1A1A", borderLeft: "1px solid #2A2A2A", flexShrink: 0, padding: 16, display: "flex", flexDirection: "column", gap: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888" }}>Context Panel</span>
                <div style={{ display: "flex", gap: 2 }}>
                  <span style={{ padding: "4px 5px", borderRadius: 4, color: "#555", display: "flex" }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <line x1="4" y1="3" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <line x1="4" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="2" cy="3" r="1" fill="currentColor" />
                      <circle cx="2" cy="7" r="1" fill="currentColor" />
                      <circle cx="2" cy="11" r="1" fill="currentColor" />
                    </svg>
                  </span>
                  <span style={{ padding: "4px 5px", borderRadius: 4, background: "#2A2A2A", color: "#E8E8E8", display: "flex" }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="1" width="12" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                      <line x1="1" y1="10" x2="9" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <line x1="1" y1="13" x2="6" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </span>
                </div>
              </div>
              <div style={{ background: "#0F0F0F", borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                {[["Tracked", "~7,540", "#E8E8E8"], ["Active", "~3,420", "#E8E8E8"], ["Saved", "~4,120", "#4ECDC4"]].map(([label, val, col]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: "#888" }}>{label}</span>
                    <span style={{ fontSize: 11, fontFamily: "'Courier New',monospace", color: col }}>{val}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderRadius: 8, padding: "10px 12px", border: "1px solid #4ECDC4" }}>
                <div style={{ borderRadius: 6, marginBottom: 6, overflow: "hidden" }}>
                  <div style={{ width: "100%", height: 64, background: "repeating-linear-gradient(135deg,#202020 0,#202020 8px,#1c1c1c 8px,#1c1c1c 16px)" }} />
                </div>
                <div style={{ fontSize: 11, fontFamily: "'Courier New',monospace", marginBottom: 4 }}>dashboard-mockup.png</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, color: "#888" }}>image</span>
                  <span style={{ fontSize: 10, fontFamily: "'Courier New',monospace", color: "#888" }}>1,240 tokens</span>
                </div>
              </div>
              <div style={{ borderRadius: 8, padding: "10px 12px", border: "1px solid #2A2A2A", opacity: 0.6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 6, background: "#1E1E1E", border: "1px solid #2A2A2A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 8, fontWeight: 700, color: "#555", fontFamily: "monospace" }}>PDF</span>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "'Courier New',monospace" }}>api-spec.pdf</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "#4ECDC4" }}>✓ compressed</span>
                  <span style={{ fontSize: 10, fontFamily: "'Courier New',monospace", color: "#4ECDC4" }}>410 tokens</span>
                </div>
              </div>
              <div style={{ background: "#4ECDC4", color: "#0F0F0F", padding: 9, borderRadius: 8, fontWeight: 600, fontSize: 12, textAlign: "center" }}>Compress 1 item</div>
            </div>

          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{ maxWidth: 1080, margin: "0 auto", padding: "120px 32px 0" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div style={{ fontSize: 12, color: "#4ECDC4", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, marginBottom: 14 }}>How it works</div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 38px)", fontWeight: 700, letterSpacing: "-0.02em" }}>Three steps. No lost history.</h2>
        </div>
        <div className="lh-how-grid">
          {howSteps.map(({ num, icon, title, text }) => (
            <div key={num} style={{ background: "#141414", border: "1px solid #222", borderRadius: 14, padding: 28 }}>
              <div style={{ fontFamily: "'Courier New',monospace", fontSize: 13, color: "#4ECDC4", marginBottom: 18 }}>{num}</div>
              <div style={{ width: 40, height: 40, borderRadius: 9, background: "#0F0F0F", border: "1px solid #2A2A2A", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
                {icon}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: "#888" }}>{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" style={{ maxWidth: 1080, margin: "0 auto", padding: "120px 32px 0" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div style={{ fontSize: 12, color: "#4ECDC4", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, marginBottom: 14 }}>Built for the work</div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 38px)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 14 }}>A context window that pays attention.</h2>
          <p style={{ fontSize: 17, color: "#888", maxWidth: 560, margin: "0 auto", lineHeight: 1.6 }}>Every uploaded asset is tracked, measured, and reclaimable — so a long session never quietly drains your budget.</p>
        </div>
        <div className="lh-feat-grid">
          {features.map(({ title, text }) => (
            <div key={title} className="lh-feature" style={{ background: "#141414", border: "1px solid #222", borderRadius: 14, padding: 26 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: "#888" }}>{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA BAND */}
      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "120px 32px 0" }}>
        <div style={{ position: "relative", border: "1px solid #2A2A2A", borderRadius: 18, background: "linear-gradient(135deg,#141d1c 0%,#121212 60%)", padding: "64px 32px", textAlign: "center", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -40, left: "50%", transform: "translateX(-50%)", width: "60%", height: 200, background: "radial-gradient(ellipse at center, rgba(78,205,196,0.16), transparent 70%)", filter: "blur(40px)", pointerEvents: "none" }} />
          <div style={{ position: "relative" }}>
            <h2 style={{ fontSize: "clamp(22px, 3.5vw, 36px)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 14 }}>Stop paying to re-send what you've already discussed.</h2>
            <p style={{ fontSize: 17, color: "#999", marginBottom: 32, maxWidth: 520, margin: "0 auto 32px", lineHeight: 1.6 }}>Start a guest chat in seconds. Log in when you want to keep it.</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={startFree} className="lh-cta-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, color: "#0F0F0F", background: "#4ECDC4", padding: "13px 22px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                Start for free
                <ArrowRight />
              </button>
              <button onClick={loginGoogle} className="lh-cta-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 500, color: "#E8E8E8", background: "#141414", border: "1px solid #2A2A2A", padding: "12px 20px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit" }}>
                <GoogleIcon />
                Log in with Google
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ maxWidth: 1180, margin: "0 auto", padding: "80px 32px 48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20, paddingTop: 32, borderTop: "1px solid #1c1c1c" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <LetheLogo size={22} />
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.04em" }}>Lethe</span>
            <span style={{ fontSize: 13, color: "#555", marginLeft: 6 }}>Context compression for LLM chats</span>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <a href="#how" className="lh-nav-link" style={{ fontSize: 13, color: "#666", textDecoration: "none" }}>How it works</a>
            <a href="#features" className="lh-nav-link" style={{ fontSize: 13, color: "#666", textDecoration: "none" }}>Features</a>
            <a href="https://github.com/meishamzah/lethe" className="lh-nav-link" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#666", textDecoration: "none" }}>GitHub</a>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#3A3A3A", marginTop: 24, fontFamily: "'Courier New',monospace" }}>Lethe — named for the river of forgetting. Keep what matters.</div>
      </footer>

    </div>
  )
}
