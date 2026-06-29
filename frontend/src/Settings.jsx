import { useState, useEffect } from "react"


function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      className={`toggle${value ? " toggle-on" : ""}`}
      onClick={() => onChange(!value)}
    />
  )
}

function SettingRow({ label, desc, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid #1F1F1F" }}>
      <div style={{ flex: 1, marginRight: 16 }}>
        <div style={{ fontSize: 13, color: "#D0D0D0" }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>{desc}</div>}
      </div>
      {children}
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#444", paddingTop: 20, paddingBottom: 4, borderBottom: "1px solid #1F1F1F" }}>
      {children}
    </div>
  )
}

const CONFIRM_MAP = {
  files:   { label: "Clear all uploaded files?",   desc: "Resets the current session and removes all tracked blocks." },
  history: { label: "Clear chat history?",          desc: "All messages in the current chat will be removed." },
  session: { label: "Reset entire session?",        desc: "Clears messages, files, and all blocks. This cannot be undone." },
}

export default function SettingsModal({ settings, onChange, onClose, onClearHistory, onClearFiles, onResetSession }) {
  const [section, setSection] = useState("context")
  const [confirmAction, setConfirmAction] = useState(null)
  useEffect(() => {
    const handler = e => { if (e.key === "Escape" && !confirmAction) onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose, confirmAction])

  const set = (key, val) => onChange({ ...settings, [key]: val })

  const doConfirm = () => {
    if (confirmAction === "files")   onClearFiles()
    if (confirmAction === "history") onClearHistory()
    if (confirmAction === "session") { onResetSession(); onClose() }
    setConfirmAction(null)
  }

  const NAVS = [
    { id: "context", label: "Context management" },
    { id: "chat",    label: "Chat behaviour" },
    { id: "panel",   label: "Right panel" },
    { id: "privacy", label: "Privacy" },
  ]

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={S.header}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#E8E8E8", letterSpacing: "0.03em" }}>Settings</span>
          <button type="button" style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={S.body}>
          <nav style={S.nav}>
            {NAVS.map(n => (
              <button key={n.id} type="button"
                style={{ ...S.navItem, ...(section === n.id ? S.navItemActive : {}) }}
                onClick={() => setSection(n.id)}
              >
                {n.label}
              </button>
            ))}
          </nav>

          <div style={S.content}>

            {/* ── Context management ── */}
            {section === "context" && <>
              <SectionTitle>Block tracking</SectionTitle>
              <SettingRow label="Auto-rename uploaded images" desc="AI generates a descriptive filename when you upload an image">
                <Toggle value={settings.autoRenameImages} onChange={v => set("autoRenameImages", v)} />
              </SettingRow>
              <SettingRow label="Show token counts" desc="Display token numbers next to blocks in the right panel">
                <Toggle value={settings.showTokenCounts} onChange={v => set("showTokenCounts", v)} />
              </SettingRow>
              <SectionTitle>Compression</SectionTitle>
              <SettingRow label="Compress without confirmation" desc="Skip the confirmation dialog">
                <Toggle value={settings.autoCompressWithoutAsking} onChange={v => set("autoCompressWithoutAsking", v)} />
              </SettingRow>
              <SettingRow label="Minimum tokens to compress" desc="Blocks smaller than this won't be offered for compression">
                <input
                  type="number"
                  value={settings.compressionMinTokens}
                  onChange={e => set("compressionMinTokens", Math.max(0, Number(e.target.value)))}
                  style={S.numberInput}
                  min={0} step={100}
                />
              </SettingRow>
            </>}

            {/* ── Chat behaviour ── */}
            {section === "chat" && <>
              <SectionTitle>Chat behaviour</SectionTitle>
              <SettingRow label="Auto-title chats from first message" desc="AI generates a short title for new chats">
                <Toggle value={settings.autoTitleChats} onChange={v => set("autoTitleChats", v)} />
              </SettingRow>
              <SettingRow label="Show typing animation" desc="Animated dots while waiting for a response">
                <Toggle value={settings.showTypingAnimation} onChange={v => set("showTypingAnimation", v)} />
              </SettingRow>
              <SettingRow label="Send on Enter" desc="When off, use Ctrl+Enter to send">
                <Toggle value={settings.sendOnEnter} onChange={v => set("sendOnEnter", v)} />
              </SettingRow>

              <SectionTitle>API</SectionTitle>
              <div style={{ fontSize: 12, color: "#666", paddingTop: 12, lineHeight: 1.6 }}>
                This app uses Claude (Anthropic) as its backend. The API key is configured on the server — no key entry needed here.
              </div>
            </>}

            {/* ── Right panel ── */}
            {section === "panel" && <>
              <SectionTitle>Right panel</SectionTitle>
              <SettingRow label="Default view mode">
                <div style={{ display: "flex", gap: 6 }}>
                  {["list", "tile", "detailed"].map(m => (
                    <button key={m} type="button"
                      style={{ ...S.radioBtn, ...(settings.defaultViewMode === m ? S.radioBtnActive : {}) }}
                      onClick={() => set("defaultViewMode", m)}
                    >
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label="Default status filter">
                <div style={{ display: "flex", gap: 6 }}>
                  {["all", "uncompressed", "compressed"].map(f => (
                    <button key={f} type="button"
                      style={{ ...S.radioBtn, ...(settings.defaultStatusFilter === f ? S.radioBtnActive : {}) }}
                      onClick={() => set("defaultStatusFilter", f)}
                    >
                      {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label="Panel open by default">
                <Toggle value={settings.panelOpenByDefault} onChange={v => set("panelOpenByDefault", v)} />
              </SettingRow>
            </>}

            {/* ── Privacy ── */}
            {section === "privacy" && <>
              <SectionTitle>Data management</SectionTitle>
              <SettingRow label="Clear uploaded files" desc="Remove all uploaded images and files from the current session">
                <button type="button" style={S.dangerBtn} onClick={() => setConfirmAction("files")}>Clear files</button>
              </SettingRow>
              <SettingRow label="Clear chat history" desc="Remove all messages in the current chat">
                <button type="button" style={S.dangerBtn} onClick={() => setConfirmAction("history")}>Clear history</button>
              </SettingRow>
              <SettingRow label="Reset session" desc="Clears messages, files, and all blocks — cannot be undone">
                <button type="button" style={{ ...S.dangerBtn, color: "#e74c3c", borderColor: "#5a1a1a" }} onClick={() => setConfirmAction("session")}>Reset</button>
              </SettingRow>
            </>}

          </div>
        </div>

        {/* Inline confirm dialog */}
        {confirmAction && (
          <div style={S.confirmOverlay}>
            <div style={S.confirmBox}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#E8E8E8", marginBottom: 8 }}>
                {CONFIRM_MAP[confirmAction]?.label}
              </div>
              <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginBottom: 20 }}>
                {CONFIRM_MAP[confirmAction]?.desc}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" style={S.cbCancel} onClick={() => setConfirmAction(null)}>Cancel</button>
                <button type="button" style={S.cbConfirm} onClick={doConfirm}>Confirm</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

const S = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 300, fontFamily: "'Inter', -apple-system, sans-serif"
  },
  modal: {
    position: "relative", background: "#1A1A1A", border: "1px solid #2A2A2A",
    borderRadius: 12, width: "100%", maxWidth: 680, maxHeight: "85vh",
    display: "flex", flexDirection: "column", overflow: "hidden"
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 20px", borderBottom: "1px solid #222", flexShrink: 0
  },
  closeBtn: {
    background: "none", border: "none", color: "#555", cursor: "pointer",
    fontSize: 15, padding: "2px 6px", lineHeight: 1, borderRadius: 4
  },
  body: { display: "flex", flex: 1, overflow: "hidden" },
  nav: {
    width: 176, borderRight: "1px solid #222", padding: "8px 0",
    overflowY: "auto", flexShrink: 0
  },
  navItem: {
    display: "block", width: "100%", textAlign: "left", padding: "9px 16px",
    background: "none", border: "none", borderLeft: "2px solid transparent",
    color: "#666", cursor: "pointer", fontSize: 13, transition: "all 0.12s",
    fontFamily: "inherit"
  },
  navItemActive: { background: "#222", color: "#E8E8E8", borderLeftColor: "#4ECDC4" },
  content: { flex: 1, padding: "4px 20px 20px", overflowY: "auto" },
  radioBtn: {
    background: "none", border: "1px solid #2A2A2A", borderRadius: 5,
    color: "#555", padding: "5px 9px", fontSize: 11, cursor: "pointer",
    fontFamily: "inherit", transition: "all 0.12s"
  },
  radioBtnActive: { background: "#4ECDC4", borderColor: "#4ECDC4", color: "#0F0F0F" },
  numberInput: {
    background: "#141414", border: "1px solid #2A2A2A", borderRadius: 6,
    color: "#E8E8E8", padding: "6px 10px", fontSize: 13, fontFamily: "inherit",
    outline: "none", width: 80, textAlign: "right"
  },
  dangerBtn: {
    background: "none", border: "1px solid #2A2A2A", borderRadius: 6, color: "#666",
    padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit"
  },
  confirmOverlay: {
    position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)",
    display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 12, zIndex: 10
  },
  confirmBox: {
    background: "#1E1E1E", border: "1px solid #333", borderRadius: 10,
    padding: "20px 24px", width: 320
  },
  cbCancel: {
    background: "none", border: "1px solid #333", borderRadius: 6, color: "#666",
    padding: "7px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit"
  },
  cbConfirm: {
    background: "#4ECDC4", border: "none", borderRadius: 6, color: "#0F0F0F",
    padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit"
  },
}
