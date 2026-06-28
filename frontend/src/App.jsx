import { useState, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import SettingsModal from "./Settings"

const API = "http://127.0.0.1:5000"

const DEFAULT_SETTINGS = {
  autoRenameImages: true,
  autoCompressWithoutAsking: false,
  autoCompressThreshold: 80,
  compressionMinTokens: 500,
  showTokenCounts: true,
  autoTitleChats: true,
  showTypingAnimation: true,
  sendOnEnter: true,
  apiKey: "",
  provider: "gemini",
  defaultViewMode: "detailed",
  defaultStatusFilter: "all",
  panelOpenByDefault: true,
}

function loadSettings() {
  try {
    const s = localStorage.getItem("lethe_settings")
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS
  } catch { return DEFAULT_SETTINGS }
}

function relativeTime(ts) {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return "just now"
  if (diff < 3600) { const m = Math.floor(diff / 60); return `${m} min${m > 1 ? "s" : ""} ago` }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return `${h} hr${h > 1 ? "s" : ""} ago` }
  const d = Math.floor(diff / 86400); return `${d} day${d > 1 ? "s" : ""} ago`
}

function BlockThumb({ id, meta, previews, isCompressing, height, square }) {
  const wrapStyle = {
    borderRadius: square ? "6px 6px 0 0" : 6,
    marginBottom: square ? 0 : 6,
    overflow: "hidden"
  }
  const imgStyle = {
    width: "100%",
    height: square ? undefined : height || 80,
    aspectRatio: square ? "1/1" : undefined,
    objectFit: "cover",
    display: "block",
    opacity: meta.compressed ? 0.4 : 1,
    filter: meta.compressed ? "grayscale(100%)" : "none"
  }
  const placeholderStyle = {
    width: "100%",
    height: square ? undefined : height || 80,
    aspectRatio: square ? "1/1" : undefined,
    background: "#2A2A2A",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    color: "#555",
    textAlign: "center",
    padding: 4,
    overflowWrap: "break-word"
  }
  return (
    <div className={isCompressing ? "compressing-thumb" : ""} style={wrapStyle}>
      {previews[id]
        ? <img src={previews[id]} style={imgStyle} />
        : <div style={placeholderStyle}>{id}</div>
      }
    </div>
  )
}

function Pill({ label, active, onClick }) {
  return (
    <button className={`pill${active ? " pill-active" : ""}`} onClick={onClick}>
      {label}
    </button>
  )
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() => loadSettings().panelOpenByDefault)
  const [blocks, setBlocks] = useState({})
  const [selected, setSelected] = useState([])
  const [showConfirm, setShowConfirm] = useState(false)
  const bottomRef = useRef(null)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const fileInputRef = useRef(null)
  const [previews, setPreviews] = useState({})
  const [chats, setChats] = useState([{ id: 1, title: "New Chat" }])
  const [activeChatId, setActiveChatId] = useState(1)
  const [compressing, setCompressing] = useState(false)
  const [compressionMsg, setCompressionMsg] = useState(null)
  const [compressingIds, setCompressingIds] = useState([])
  const [compressionMsgFading, setCompressionMsgFading] = useState(false)
  const [viewMode, setViewMode] = useState(() => loadSettings().defaultViewMode)
  const [overlayImage, setOverlayImage] = useState(null)
  const [statusFilter, setStatusFilter] = useState(() => loadSettings().defaultStatusFilter)
  const [typeFilter, setTypeFilter] = useState("all")
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (!overlayImage) return
    const handler = (e) => { if (e.key === "Escape") setOverlayImage(null) }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [overlayImage])

  const handleSettingsChange = (newSettings) => {
    if (newSettings.defaultViewMode !== settings.defaultViewMode) setViewMode(newSettings.defaultViewMode)
    if (newSettings.defaultStatusFilter !== settings.defaultStatusFilter) setStatusFilter(newSettings.defaultStatusFilter)
    if (newSettings.panelOpenByDefault !== settings.panelOpenByDefault) setPanelOpen(newSettings.panelOpenByDefault)
    setSettings(newSettings)
    try { localStorage.setItem("lethe_settings", JSON.stringify(newSettings)) } catch {}
  }

  const handleClearHistory = () => setMessages([])

  const handleClearFiles = async () => {
    try { await fetch(`${API}/reset`, { method: "POST" }) } catch {}
    setBlocks({})
    setPreviews({})
    setSelected([])
    setCompressionMsg(null)
  }

  const handleResetSession = async () => {
    try { await fetch(`${API}/reset`, { method: "POST" }) } catch {}
    const id = Date.now()
    setChats([{ id, title: "New Chat" }])
    setActiveChatId(id)
    setMessages([])
    setBlocks({})
    setPreviews({})
    setSelected([])
    setCompressionMsg(null)
    setCompressionMsgFading(false)
  }

  const fetchStatus = async () => {
    const res = await fetch(`${API}/status`)
    const data = await res.json()
    setBlocks(data.blocks)
  }

  const sendMessage = async () => {
    if (!input.trim() && !imageFile) return
    const capturedPreview = imagePreview
    const capturedFilename = imageFile?.name
    const isFirstMessage = messages.length === 0
    const userMsg = { role: "user", content: input, image: capturedPreview }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setImageFile(null)
    setImagePreview(null)
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append("text", input)
      if (imageFile) formData.append("image", imageFile)
      formData.append("auto_rename_images", settings.autoRenameImages ? "1" : "0")
      formData.append("auto_title_chats", settings.autoTitleChats ? "1" : "0")

      const res = await fetch(`${API}/send`, { method: "POST", body: formData })
      const data = await res.json()

      if (data.chat_title && settings.autoTitleChats) {
        setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, title: data.chat_title } : c))
      } else if (isFirstMessage) {
        const title = input.slice(0, 30) + (input.length > 30 ? "..." : "")
        setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, title } : c))
      }

      if (data.image_title && capturedFilename && settings.autoRenameImages) {
        setPreviews(prev => {
          const next = { ...prev }
          if (next[capturedFilename]) {
            next[data.image_title] = next[capturedFilename]
            delete next[capturedFilename]
          }
          return next
        })
      }

      setMessages(prev => [...prev, { role: "assistant", content: data.reply }])
      fetchStatus()
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Error reaching backend." }])
    }
    setLoading(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (settings.sendOnEnter || e.ctrlKey) { e.preventDefault(); sendMessage() }
    }
  }

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleCompress = () => {
    if (selected.length > 0) {
      if (settings.autoCompressWithoutAsking) confirmCompress()
      else setShowConfirm(true)
    }
  }

  const confirmCompress = async () => {
    setShowConfirm(false)
    const eligibleIds = selected.filter(id => (blocks[id]?.image_tokens || 0) >= settings.compressionMinTokens)
    if (eligibleIds.length === 0) { setSelected([]); return }
    setCompressingIds(eligibleIds)
    setCompressing(true)
    const prevTokens = Object.values(blocks).reduce((sum, b) => sum + (b.image_tokens || 0), 0)
    try {
      await Promise.all([
        fetch(`${API}/compress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ block_ids: eligibleIds })
        }),
        new Promise(resolve => setTimeout(resolve, 2000))
      ])
      const statusRes = await fetch(`${API}/status`)
      const statusData = await statusRes.json()
      const newBlocksData = statusData.blocks
      const newTotalTokens = Object.values(newBlocksData).reduce((sum, b) =>
        sum + (b.compressed ? (b.summary_tokens || 0) : (b.image_tokens || 0)), 0)
      const savedNow = Object.values(newBlocksData).reduce((sum, b) =>
        b.compressed ? sum + (b.image_tokens || 0) - (b.summary_tokens || 0) : sum, 0)
      setBlocks(newBlocksData)
      setCompressionMsgFading(false)
      setCompressionMsg({ from: prevTokens, to: newTotalTokens, saved: savedNow })
      setTimeout(() => setCompressionMsgFading(true), 3600)
      setTimeout(() => { setCompressionMsg(null); setCompressionMsgFading(false) }, 4000)
    } finally {
      setCompressing(false)
      setCompressingIds([])
      setSelected([])
    }
  }

  const totalTokens = Object.values(blocks).reduce((sum, b) => sum + (b.image_tokens || 0), 0)
  const savedTokens = Object.values(blocks).reduce((sum, b) =>
    b.compressed ? sum + (b.image_tokens || 0) - (b.summary_tokens || 0) : sum, 0)

  const filteredBlocks = Object.entries(blocks).filter(([, meta]) => {
    const statusOk = statusFilter === "all"
      || (statusFilter === "compressed" && meta.compressed)
      || (statusFilter === "uncompressed" && !meta.compressed)
    const typeOk = typeFilter === "all" || meta.type === typeFilter
    return statusOk && typeOk
  })

  const totalCount = Object.keys(blocks).length
  const compressedCount = Object.values(blocks).filter(b => b.compressed).length
  const uncompressedCount = totalCount - compressedCount
  const imageCount = Object.values(blocks).filter(b => b.type === "image").length
  const codeCount = Object.values(blocks).filter(b => b.type === "code").length

  return (
    <div style={styles.app}>

      {/* LEFT SIDEBAR */}
      <div style={styles.sidebar}>
        <div style={{ padding: "16px 12px 0" }}>
          <div style={styles.sidebarHeader}>
            <span style={styles.logo}>Lethe</span>
            <button style={styles.newChat} onClick={async () => {
              try {
                const res = await fetch(`${API}/new_chat`, { method: "POST" })
                const data = await res.json()
                setChats(prev => [...prev, { id: data.chat_id, title: "New Chat" }])
                setActiveChatId(data.chat_id)
              } catch {
                const fallbackId = Date.now()
                setChats(prev => [...prev, { id: fallbackId, title: "New Chat" }])
                setActiveChatId(fallbackId)
              }
              setMessages([])
              setBlocks({})
              setPreviews({})
              setSelected([])
              setCompressionMsg(null)
              setCompressionMsgFading(false)
            }}>+ New</button>
          </div>
          <div style={styles.sidebarSection}>Recents</div>
        </div>
        <div style={styles.sidebarChatScroll}>
          {chats.slice().reverse().map(chat => (
            <div
              key={chat.id}
              style={{
                ...styles.sidebarItem,
                background: chat.id === activeChatId ? "#2A2A2A" : "transparent",
                color: chat.id === activeChatId ? "#E8E8E8" : "#aaa"
              }}
              onClick={() => setActiveChatId(chat.id)}
            >
              {chat.title}
            </div>
          ))}
        </div>
        <div style={styles.sidebarBottom}>
          <div style={styles.userRow}>
            <div style={styles.avatar}>AH</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.userName}>Ameer Hamzah</div>
              <div style={styles.planBadge}>Free</div>
            </div>
            <button style={styles.gearBtn} onClick={() => setShowSettings(true)} title="Settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* MIDDLE CHAT */}
      <div style={styles.main}>
        <div style={styles.chatArea}>
          {messages.length === 0 && (
            <div style={styles.empty}>
              <div style={styles.emptyTitle}>Lethe</div>
              <div style={styles.emptySubtitle}>Start a conversation. Upload images or code to begin tracking context.</div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} style={msg.role === "user" ? styles.userMsg : styles.assistantMsg}>
              <div style={styles.msgRole}>{msg.role === "user" ? "You" : "Lethe"}</div>
              {msg.image && (
                <img
                  src={msg.image}
                  style={{ width: 200, height: 140, objectFit: "cover", borderRadius: 10, marginBottom: 6, display: "block", cursor: "pointer" }}
                  onClick={() => setOverlayImage(msg.image)}
                />
              )}
              <div style={styles.msgContent} className="msg-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              </div>
            </div>
          ))}
          {loading && settings.showTypingAnimation && (
            <div style={styles.assistantMsg}>
              <div style={styles.msgRole}>Lethe</div>
              <div style={styles.msgContent}>
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div style={styles.inputArea}>
          <input type="file" accept="image/*" ref={fileInputRef} style={{ display: "none" }}
            onChange={e => {
              const file = e.target.files[0]
              if (!file) return
              setImageFile(file)
              const url = URL.createObjectURL(file)
              setImagePreview(url)
              setPreviews(prev => ({ ...prev, [file.name]: url }))
            }}
          />
          <div style={styles.inputWrapper}>
            {imagePreview && (
              <div style={styles.imagePreviewRow}>
                <img src={imagePreview} style={styles.imageThumb} />
                <button style={styles.removeImg} onClick={() => { setImageFile(null); setImagePreview(null) }}>✕</button>
              </div>
            )}
            <textarea
              style={styles.input}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Lethe..."
              rows={1}
            />
            <div style={styles.inputRow}>
              <div className="upload-btn-wrapper">
                <button style={styles.uploadBtn} onClick={() => fileInputRef.current.click()}>+</button>
                <div className="upload-tooltip">Add image</div>
              </div>
              <div style={{ flex: 1 }} />
              <button style={styles.sendBtn} onClick={sendMessage}>Send</button>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div style={{ ...styles.panel, width: panelOpen ? 280 : 0 }}>
        {panelOpen && (
          <div style={styles.panelContent}>

            {/* Panel title + view mode icons */}
            <div style={styles.panelTitleRow}>
              <span style={styles.panelTitle}>Context</span>
              <div style={{ display: "flex", gap: 2 }}>
                <button
                  title="List view"
                  style={{ ...styles.viewBtn, background: viewMode === "list" ? "#2A2A2A" : "transparent", color: viewMode === "list" ? "#E8E8E8" : "#555" }}
                  onClick={() => setViewMode("list")}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <line x1="4" y1="3" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <line x1="4" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <circle cx="2" cy="3" r="1" fill="currentColor"/>
                    <circle cx="2" cy="7" r="1" fill="currentColor"/>
                    <circle cx="2" cy="11" r="1" fill="currentColor"/>
                  </svg>
                </button>
                <button
                  title="Tile view"
                  style={{ ...styles.viewBtn, background: viewMode === "tile" ? "#2A2A2A" : "transparent", color: viewMode === "tile" ? "#E8E8E8" : "#555" }}
                  onClick={() => setViewMode("tile")}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                    <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                    <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                    <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                </button>
                <button
                  title="Detailed view"
                  style={{ ...styles.viewBtn, background: viewMode === "detailed" ? "#2A2A2A" : "transparent", color: viewMode === "detailed" ? "#E8E8E8" : "#555" }}
                  onClick={() => setViewMode("detailed")}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="1" width="12" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                    <line x1="1" y1="10" x2="9" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <line x1="1" y1="13" x2="6" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Token summary */}
            <div style={styles.tokenSummary}>
              <div style={styles.tokenRow}>
                <span style={styles.tokenLabel}>Tracked</span>
                <span style={styles.tokenValue}>{settings.showTokenCounts ? `~${totalTokens.toLocaleString()}` : "—"}</span>
              </div>
              <div style={styles.tokenRow}>
                <span style={styles.tokenLabel}>Active</span>
                <span style={styles.tokenValue}>{settings.showTokenCounts ? `~${(totalTokens - savedTokens).toLocaleString()}` : "—"}</span>
              </div>
              <div style={styles.tokenRow}>
                <span style={styles.tokenLabel}>Saved</span>
                <span style={{ ...styles.tokenValue, color: "#4ECDC4" }}>{settings.showTokenCounts ? `~${savedTokens.toLocaleString()}` : "—"}</span>
              </div>
            </div>

            {/* Compression success message */}
            {compressionMsg && (
              <div style={{
                background: "#0F0F0F", borderRadius: 8, padding: "10px 14px", fontSize: 12,
                color: "#4ECDC4", display: "flex", flexDirection: "column", gap: 4,
                animation: compressionMsgFading ? "fadeOut 0.4s ease forwards" : "fadeIn 0.3s ease"
              }}>
                <div style={{ fontWeight: 600 }}>✓ Compressed</div>
                <div style={{ fontFamily: "'Courier New', monospace", color: "#E8E8E8" }}>
                  {compressionMsg.from.toLocaleString()} → {compressionMsg.to.toLocaleString()} tokens
                </div>
                <div>{compressionMsg.saved.toLocaleString()} tokens saved</div>
              </div>
            )}

            {/* Filter pills — only shown when blocks exist */}
            {totalCount > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <Pill label={`All ${totalCount}`} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
                  <Pill label={`Uncompressed ${uncompressedCount}`} active={statusFilter === "uncompressed"} onClick={() => setStatusFilter("uncompressed")} />
                  <Pill label={`Compressed ${compressedCount}`} active={statusFilter === "compressed"} onClick={() => setStatusFilter("compressed")} />
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <Pill label="All types" active={typeFilter === "all"} onClick={() => setTypeFilter("all")} />
                  {imageCount > 0 && <Pill label={`Images ${imageCount}`} active={typeFilter === "image"} onClick={() => setTypeFilter("image")} />}
                  {codeCount > 0 && <Pill label={`Code ${codeCount}`} active={typeFilter === "code"} onClick={() => setTypeFilter("code")} />}
                </div>
              </div>
            )}

            {/* Block list */}
            <div style={viewMode === "tile" ? styles.tileGrid : styles.blockList}>
              {totalCount === 0 && (
                <div style={styles.emptyBlocks}>No blocks yet. Upload an image or file to start tracking.</div>
              )}

              {/* DETAILED VIEW */}
              {viewMode === "detailed" && filteredBlocks.map(([id, meta]) => (
                <div
                  key={id}
                  className="block-tooltip"
                  data-tooltip={meta.compressed ? "double click to view" : "click to select · double click to view"}
                  style={{
                    ...styles.blockItem,
                    border: selected.includes(id) ? "1px solid #4ECDC4" : "1px solid #2A2A2A",
                    opacity: meta.compressed ? 0.6 : 1
                  }}
                  onClick={() => !meta.compressed && toggleSelect(id)}
                  onDoubleClick={() => previews[id] && setOverlayImage(previews[id])}
                >
                  {meta.type === "image" && (
                    <BlockThumb
                      id={id} meta={meta} previews={previews}
                      isCompressing={compressing && compressingIds.includes(id)}
                      height={80}
                    />
                  )}
                  <div style={styles.blockId}>{meta.id || id}</div>
                  <div style={styles.blockMeta}>
                    <span style={styles.blockType}>{meta.type}</span>
                    <span style={styles.blockTokens}>{(meta.image_tokens || 0).toLocaleString()} tokens</span>
                  </div>
                  {meta.uploaded_at && <div style={styles.blockTimestamp}>{relativeTime(meta.uploaded_at)}</div>}
                  {meta.compressed && <div style={styles.compressedBadge}>✓ compressed</div>}
                </div>
              ))}

              {/* LIST VIEW */}
              {viewMode === "list" && filteredBlocks.map(([id, meta]) => (
                <div
                  key={id}
                  className={`block-tooltip${compressing && compressingIds.includes(id) ? " compressing-row" : ""}`}
                  data-tooltip={meta.compressed ? "double click to view" : "click to select · double click to view"}
                  style={{
                    ...styles.listItem,
                    border: selected.includes(id) ? "1px solid #4ECDC4" : "1px solid #2A2A2A",
                    opacity: meta.compressed ? 0.6 : 1
                  }}
                  onClick={() => !meta.compressed && toggleSelect(id)}
                  onDoubleClick={() => previews[id] && setOverlayImage(previews[id])}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontFamily: "'Courier New', monospace", color: "#E8E8E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {meta.id || id}
                    </div>
                    {meta.uploaded_at && <div style={styles.blockTimestamp}>{relativeTime(meta.uploaded_at)}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                    <span style={styles.blockTokens}>{(meta.image_tokens || 0).toLocaleString()}</span>
                    {meta.compressed && <span style={{ fontSize: 10, color: "#4ECDC4" }}>✓</span>}
                  </div>
                </div>
              ))}

              {/* TILE VIEW */}
              {viewMode === "tile" && filteredBlocks.map(([id, meta]) => (
                <div
                  key={id}
                  className="block-tooltip tile-block"
                  data-tooltip={meta.compressed ? "double click to view" : "click to select · double click to view"}
                  style={{
                    borderRadius: 8,
                    overflow: "hidden",
                    cursor: "pointer",
                    border: selected.includes(id) ? "1px solid #4ECDC4" : "1px solid #2A2A2A",
                    opacity: meta.compressed ? 0.6 : 1
                  }}
                  onClick={() => !meta.compressed && toggleSelect(id)}
                  onDoubleClick={() => previews[id] && setOverlayImage(previews[id])}
                >
                  {meta.type === "image" && (
                    <BlockThumb
                      id={id} meta={meta} previews={previews}
                      isCompressing={compressing && compressingIds.includes(id)}
                      square
                    />
                  )}
                  <div style={{ padding: "5px 7px", fontSize: 10, color: "#aaa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {meta.id || id}
                  </div>
                  {meta.uploaded_at && (
                    <div className="tile-timestamp" style={{ padding: "0 7px 5px", fontSize: 9, color: "#555" }}>
                      {relativeTime(meta.uploaded_at)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {selected.length > 0 && (
              <button style={styles.compressBtn} onClick={handleCompress}>
                Compress {selected.length} item{selected.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
        )}
      </div>

      {/* PANEL TAB — chevron toggle */}
      <div
        className="panel-tab"
        style={{
          position: "fixed",
          right: panelOpen ? 280 : 0,
          top: "50%",
          transform: "translateY(-50%)",
          background: "#1A1A1A",
          border: "1px solid #2A2A2A",
          borderRight: "none",
          cursor: "pointer",
          padding: "12px 6px",
          borderRadius: "6px 0 0 6px",
          transition: "right 0.2s ease",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
        onClick={() => setPanelOpen(p => !p)}
      >
        <svg
          width="16" height="16" viewBox="0 0 16 16" fill="none"
          style={{ transition: "transform 0.2s ease", transform: panelOpen ? "rotate(0deg)" : "rotate(180deg)" }}
        >
          <polyline points="6,4 10,8 6,12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* CONFIRMATION DIALOG */}
      {showConfirm && (
        <div style={styles.overlayBg}>
          <div style={styles.dialog}>
            <div style={styles.dialogTitle}>Compress {selected.length} item{selected.length > 1 ? "s" : ""}?</div>
            <div style={styles.dialogText}>You can add more to the selection before confirming. This will replace the raw content with a summary.</div>
            <div style={styles.dialogActions}>
              <button style={styles.cancelBtn} onClick={() => setShowConfirm(false)}>Add more</button>
              <button style={styles.confirmBtn} onClick={confirmCompress}>Compress</button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
          onClearHistory={handleClearHistory}
          onClearFiles={handleClearFiles}
          onResetSession={handleResetSession}
        />
      )}

      {/* FULL SCREEN IMAGE OVERLAY */}
      {overlayImage && (
        <div
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 200,
            animation: "fadeIn 0.2s ease"
          }}
          onClick={() => setOverlayImage(null)}
        >
          <div
            style={{ position: "relative", animation: "overlayImageIn 0.2s ease" }}
            onClick={e => e.stopPropagation()}
          >
            <img
              src={overlayImage}
              style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8, display: "block" }}
            />
            <button
              style={{
                position: "absolute", top: -14, right: -14,
                background: "#2A2A2A", border: "1px solid #3A3A3A", color: "#E8E8E8",
                borderRadius: "50%", width: 28, height: 28,
                cursor: "pointer", fontSize: 13,
                display: "flex", alignItems: "center", justifyContent: "center"
              }}
              onClick={() => setOverlayImage(null)}
            >✕</button>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  app: { display: "flex", height: "100vh", background: "#0F0F0F", color: "#E8E8E8", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", overflow: "hidden" },
  sidebar: { width: 240, background: "#1A1A1A", display: "flex", flexDirection: "column", borderRight: "1px solid #2A2A2A", flexShrink: 0, overflow: "hidden" },
  sidebarChatScroll: { flex: 1, overflowY: "auto", padding: "0 12px 8px" },
  sidebarBottom: { padding: "10px 12px", borderTop: "1px solid #222", flexShrink: 0 },
  userRow: { display: "flex", alignItems: "center", gap: 10 },
  avatar: { width: 30, height: 30, borderRadius: "50%", background: "#4ECDC4", display: "flex", alignItems: "center", justifyContent: "center", color: "#0F0F0F", fontSize: 11, fontWeight: 700, flexShrink: 0, letterSpacing: "0.03em" },
  userName: { fontSize: 12, color: "#D0D0D0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  planBadge: { fontSize: 10, color: "#555" },
  gearBtn: { background: "none", border: "none", color: "#555", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, flexShrink: 0, transition: "color 0.15s" },
  sidebarHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  logo: { fontSize: 18, fontWeight: 600, letterSpacing: "0.05em" },
  newChat: { background: "#2A2A2A", border: "none", color: "#E8E8E8", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 },
  sidebarSection: { fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 },
  sidebarItem: { fontSize: 13, color: "#aaa", padding: "6px 8px", borderRadius: 6, cursor: "pointer" },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  chatArea: { flex: 1, overflowY: "auto", padding: "32px 48px", display: "flex", flexDirection: "column", gap: 24 },
  empty: { margin: "auto", textAlign: "center" },
  emptyTitle: { fontSize: 32, fontWeight: 600, marginBottom: 8, letterSpacing: "0.05em" },
  emptySubtitle: { fontSize: 14, color: "#888", maxWidth: 360, margin: "0 auto" },
  userMsg: { alignSelf: "flex-end", maxWidth: "70%" },
  assistantMsg: { alignSelf: "flex-start", maxWidth: "70%" },
  msgRole: { fontSize: 11, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" },
  msgContent: { fontSize: 14, lineHeight: 1.6, background: "#1A1A1A", padding: "12px 16px", borderRadius: 10 },
  inputArea: { padding: "16px 48px 24px", display: "flex", justifyContent: "center" },
  inputWrapper: { width: "100%", maxWidth: 700, background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 16, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 },
  inputRow: { display: "flex", alignItems: "center", gap: 8 },
  input: { flex: 1, background: "transparent", border: "none", color: "#E8E8E8", fontSize: 14, resize: "none", outline: "none", fontFamily: "inherit", padding: "0" },
  uploadBtn: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 20, padding: "0 4px", flexShrink: 0 },
  sendBtn: { background: "#4ECDC4", border: "none", color: "#0F0F0F", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, flexShrink: 0 },
  panel: { background: "#1A1A1A", borderLeft: "1px solid #2A2A2A", display: "flex", flexDirection: "column", flexShrink: 0, transition: "width 0.2s ease", overflow: "hidden" },
  panelContent: { padding: "16px", gap: 16, display: "flex", flexDirection: "column", overflowY: "auto", height: "100%" },
  panelTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  panelTitle: { fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888" },
  viewBtn: { border: "none", cursor: "pointer", padding: "4px 5px", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s, color 0.15s" },
  tokenSummary: { background: "#0F0F0F", borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 },
  tokenRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  tokenLabel: { fontSize: 12, color: "#888" },
  tokenValue: { fontSize: 12, fontFamily: "'Courier New', monospace", color: "#E8E8E8" },
  tileGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  blockList: { display: "flex", flexDirection: "column", gap: 8 },
  emptyBlocks: { fontSize: 12, color: "#555", lineHeight: 1.5 },
  blockItem: { borderRadius: 8, padding: "10px 12px", cursor: "pointer", transition: "border 0.15s" },
  listItem: { borderRadius: 6, padding: "8px 10px", cursor: "pointer", transition: "border 0.15s", display: "flex", alignItems: "center", gap: 8, position: "relative", overflow: "hidden" },
  blockId: { fontSize: 12, fontFamily: "'Courier New', monospace", marginBottom: 4, wordBreak: "break-all" },
  blockMeta: { display: "flex", justifyContent: "space-between" },
  blockType: { fontSize: 11, color: "#888" },
  blockTokens: { fontSize: 11, fontFamily: "'Courier New', monospace", color: "#888" },
  blockTimestamp: { fontSize: 10, color: "#555", marginTop: 2 },
  compressedBadge: { fontSize: 11, color: "#4ECDC4", marginTop: 4 },
  compressBtn: { background: "#4ECDC4", border: "none", color: "#0F0F0F", padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, width: "100%" },
  overlayBg: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  dialog: { background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 12, padding: 24, maxWidth: 360, width: "90%" },
  dialogTitle: { fontSize: 16, fontWeight: 600, marginBottom: 8 },
  dialogText: { fontSize: 13, color: "#888", lineHeight: 1.6, marginBottom: 20 },
  dialogActions: { display: "flex", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { background: "#2A2A2A", border: "none", color: "#E8E8E8", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  confirmBtn: { background: "#4ECDC4", border: "none", color: "#0F0F0F", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  imagePreviewRow: { display: "flex", alignItems: "center", gap: 8, padding: "0 4px" },
  imageThumb: { width: 48, height: 48, objectFit: "cover", borderRadius: 6 },
  removeImg: { background: "#2A2A2A", border: "none", color: "#888", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: 10 },
}
