import { useState, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import SettingsModal from "./Settings"

const API = "http://localhost:5000"

const apiFetch = (path, opts = {}) =>
  fetch(`${API}${path}`, { credentials: "include", ...opts })

const DEFAULT_SETTINGS = {
  autoRenameImages: true,
  autoCompressWithoutAsking: false,
  autoCompressThreshold: 80,
  compressionMinTokens: 500,
  showTokenCounts: true,
  autoTitleChats: true,
  showTypingAnimation: true,
  sendOnEnter: true,
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

function getBlockTokens(meta) {
  if (!meta) return 0
  if (meta.type === "code") return meta.code_tokens || 0
  if (meta.type === "text") return meta.text_tokens || 0
  if (meta.type === "pdf") return meta.pdf_tokens || 0
  return meta.image_tokens || 0
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

function FileIcon({ type, compressed }) {
  const accent = compressed ? "#444" : "#666"
  const teal = compressed ? "#555" : "#4ECDC4"
  const bg = "#1E1E1E"
  const border = compressed ? "#2A2A2A" : "#333"

  const box = {
    width: 32, height: 32, borderRadius: 6,
    background: bg, border: `1px solid ${border}`,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
  }

  if (type === "code") return (
    <div style={box}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M5 5L3 8L5 11" stroke={teal} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11 5L13 8L11 11" stroke={teal} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 3.5L7 12.5" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  )
  if (type === "pdf") return (
    <div style={box}>
      <span style={{ fontSize: 8, fontWeight: 700, color: compressed ? "#555" : "#e05555", fontFamily: "monospace", letterSpacing: "0.02em" }}>PDF</span>
    </div>
  )
  return (
    <div style={box}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <line x1="2" y1="4" x2="12" y2="4" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="2" y1="7" x2="12" y2="7" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="2" y1="10" x2="8" y2="10" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
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

function Toast({ message, onDismiss }) {
  return (
    <div style={{
      background: "#1A1A1A", border: "1px solid rgba(200,140,0,0.4)",
      borderRadius: 10, padding: "12px 14px",
      display: "flex", alignItems: "flex-start", gap: 10,
      maxWidth: 340, boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      animation: "fadeIn 0.2s ease"
    }}>
      <span style={{ fontSize: 15, flexShrink: 0, lineHeight: 1.4, color: "#c8a020" }}>⚠</span>
      <span style={{ fontSize: 12, lineHeight: 1.5, flex: 1, color: "#D0D0D0" }}>{message}</span>
      <button
        style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, flexShrink: 0, padding: 0, lineHeight: 1.4 }}
        onClick={onDismiss}
      >✕</button>
    </div>
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
  const [pendingFile, setPendingFile] = useState(null)
  const imageInputRef = useRef(null)
  const codeInputRef = useRef(null)
  const textInputRef = useRef(null)
  const pdfInputRef = useRef(null)
  const [previews, setPreviews] = useState({})
  const [chats, setChats] = useState([])
  const [activeChatId, setActiveChatId] = useState(null)
  const [chatsLoading, setChatsLoading] = useState(true)
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
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false)
  const uploadWrapperRef = useRef(null)
  const [toasts, setToasts] = useState([])
  const [flashingBlocks, setFlashingBlocks] = useState([])
  const [authUser, setAuthUser] = useState(null)
  const [sentCount, setSentCount] = useState(0)
  const [nudgeDismissed, setNudgeDismissed] = useState(false)

  // ── Persistence: load chats on mount ──────────────────────────────────────

  const switchToChat = async (id) => {
    setActiveChatId(id)
    try {
      const res = await apiFetch(`/switch_chat/${id}`, { method: "POST" })
      const data = await res.json()

      setMessages((data.messages || []).map(msg => ({
        role: msg.role,
        content: msg.content,
        image: msg.image_url ? `${API}${msg.image_url}` : null,
        attachedFile: msg.attached_file || null
      })))

      const safeBlocks = data.blocks || {}
      setBlocks(safeBlocks)

      const newPreviews = {}
      Object.entries(safeBlocks).forEach(([bid, meta]) => {
        if (meta.type === "image" && meta.path) {
          newPreviews[bid] = `${API}/${meta.path.replace(/\\/g, "/")}`
        }
      })
      setPreviews(newPreviews)

      setSelected([])
      setPendingFile(null)
      setCompressionMsg(null)
      setCompressionMsgFading(false)
    } catch (e) {
      console.error("Failed to switch chat", e)
    }
  }

  const fetchChats = async (retries = 5) => {
    try {
      const res = await apiFetch("/chats")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const list = data.chats || []
      setChatsLoading(false)
      if (list.length > 0) {
        setChats(list)
        await switchToChat(list[0].id)
      } else {
        const ncRes = await apiFetch("/new_chat", { method: "POST" })
        const ncData = await ncRes.json()
        setChats([{ id: ncData.chat_id, title: "New Chat" }])
        setActiveChatId(ncData.chat_id)
      }
    } catch (e) {
      console.error("Failed to fetch chats:", e.message)
      if (retries > 0) {
        setTimeout(() => fetchChats(retries - 1), 1500)
      } else {
        setChatsLoading(false)
      }
    }
  }

  useEffect(() => {
    let gid = localStorage.getItem("lethe_guest_id")
    if (!gid) {
      gid = "guest_" + Math.random().toString(36).slice(2, 18)
      localStorage.setItem("lethe_guest_id", gid)
    }
    document.cookie = `lethe_guest_id=${gid}; path=/; max-age=31536000; SameSite=Lax`
    apiFetch("/auth/me").then(r => r.json()).then(data => {
      if (data.authenticated) {
        setAuthUser(data)
        localStorage.removeItem("lethe_guest_id")
        document.cookie = "lethe_guest_id=; path=/; max-age=0"
      }
    }).catch(() => { })
    fetchChats()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (!overlayImage) return
    const handler = (e) => { if (e.key === "Escape") setOverlayImage(null) }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [overlayImage])

  useEffect(() => {
    if (!uploadMenuOpen) return
    const handler = (e) => {
      if (!uploadWrapperRef.current?.contains(e.target)) setUploadMenuOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [uploadMenuOpen])

  const handleSettingsChange = (newSettings) => {
    if (newSettings.defaultViewMode !== settings.defaultViewMode) setViewMode(newSettings.defaultViewMode)
    if (newSettings.defaultStatusFilter !== settings.defaultStatusFilter) setStatusFilter(newSettings.defaultStatusFilter)
    if (newSettings.panelOpenByDefault !== settings.panelOpenByDefault) setPanelOpen(newSettings.panelOpenByDefault)
    setSettings(newSettings)
    try { localStorage.setItem("lethe_settings", JSON.stringify(newSettings)) } catch { }
  }

  const handleClearHistory = () => setMessages([])

  const handleClearFiles = async () => {
    try {
      const res = await apiFetch("/reset", { method: "POST" })
      const data = await res.json()
      setChats([{ id: data.chat_id, title: "New Chat" }])
      setActiveChatId(data.chat_id)
    } catch { }
    setBlocks({})
    setPreviews({})
    setSelected([])
    setPendingFile(null)
    setCompressionMsg(null)
  }

  const handleResetSession = async () => {
    try {
      const res = await apiFetch("/reset", { method: "POST" })
      const data = await res.json()
      setChats([{ id: data.chat_id, title: "New Chat" }])
      setActiveChatId(data.chat_id)
    } catch {
      setChats([{ id: Date.now(), title: "New Chat" }])
    }
    setMessages([])
    setBlocks({})
    setPreviews({})
    setSelected([])
    setPendingFile(null)
    setCompressionMsg(null)
    setCompressionMsgFading(false)
  }

  const fetchStatus = async () => {
    const res = await apiFetch("/status")
    const data = await res.json()
    setBlocks(data.blocks)
  }

  const sendMessage = async () => {
    if (!input.trim() && !pendingFile) return
    const capturedFile = pendingFile
    const isFirstMessage = messages.length === 0
    const userMsg = {
      role: "user",
      content: input,
      image: capturedFile?.type === "image" ? capturedFile.preview : null,
      attachedFile: capturedFile && capturedFile.type !== "image"
        ? { name: capturedFile.file.name, type: capturedFile.type }
        : null
    }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setPendingFile(null)
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append("text", input)
      if (capturedFile) {
        const fieldName = { image: "image", code: "code_file", text: "text_file", pdf: "pdf_file" }[capturedFile.type]
        formData.append(fieldName, capturedFile.file)
      }
      formData.append("auto_rename_images", settings.autoRenameImages ? "1" : "0")
      formData.append("auto_title_chats", settings.autoTitleChats ? "1" : "0")

      const res = await apiFetch("/send", { method: "POST", body: formData })
      const data = await res.json()
      setSentCount(prev => prev + 1)

      if (data.chat_title && settings.autoTitleChats) {
        setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, title: data.chat_title } : c))
      } else if (isFirstMessage) {
        const title = input.slice(0, 30) + (input.length > 30 ? "..." : "")
        setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, title } : c))
      }

      if (data.image_title && capturedFile?.type === "image" && settings.autoRenameImages) {
        const capturedFilename = capturedFile.file.name
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

  const addToast = (message) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
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
    const eligibleIds = selected.filter(id => getBlockTokens(blocks[id]) >= settings.compressionMinTokens)
    const tooSmallIds = selected.filter(id => getBlockTokens(blocks[id]) < settings.compressionMinTokens)

    for (const id of tooSmallIds) {
      const tokens = getBlockTokens(blocks[id])
      addToast(`'${id}' wasn't compressed — it's only ${tokens.toLocaleString()} tokens. Compressing a file this small would likely increase token usage. No changes were made.`)
      setFlashingBlocks(prev => [...prev, id])
      setTimeout(() => setFlashingBlocks(prev => prev.filter(bid => bid !== id)), 1500)
    }

    if (eligibleIds.length === 0) { setSelected([]); return }
    setCompressingIds(eligibleIds)
    setCompressing(true)
    try {
      const [compressData] = await Promise.all([
        apiFetch("/compress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ block_ids: eligibleIds })
        }).then(r => r.json()),
        new Promise(resolve => setTimeout(resolve, 2000))
      ])
      const statusRes = await apiFetch("/status")
      const statusData = await statusRes.json()
      setBlocks(statusData.blocks)

      const results = compressData.results || []
      for (const result of results) {
        if (!result.compressed && result.reason === "summary_larger_than_original") {
          const orig = (result.original_tokens || 0).toLocaleString()
          const summ = (result.summary_tokens || 0).toLocaleString()
          addToast(`'${result.block_id}' wasn't compressed — the summary (${summ} tokens) was larger than the original (${orig} tokens). This usually happens with small files. No changes were made.`)
          setFlashingBlocks(prev => [...prev, result.block_id])
          setTimeout(() => setFlashingBlocks(prev => prev.filter(bid => bid !== result.block_id)), 1500)
        }
      }

      const succeeded = results.filter(r => r.compressed)
      if (succeeded.length > 0) {
        const batchOriginal = succeeded.reduce((sum, r) => sum + (r.original_tokens || 0), 0)
        const batchSummary = succeeded.reduce((sum, r) => sum + (r.summary_tokens || 0), 0)
        setCompressionMsgFading(false)
        setCompressionMsg({ from: batchOriginal, to: batchSummary, saved: batchOriginal - batchSummary })
        setTimeout(() => setCompressionMsgFading(true), 3600)
        setTimeout(() => { setCompressionMsg(null); setCompressionMsgFading(false) }, 4000)
      }
    } finally {
      setCompressing(false)
      setCompressingIds([])
      setSelected([])
    }
  }

  const totalTokens = Object.values(blocks).reduce((sum, b) => sum + getBlockTokens(b), 0)
  const savedTokens = Object.values(blocks).reduce((sum, b) =>
    b.compressed ? sum + getBlockTokens(b) - (b.summary_tokens || 0) : sum, 0)

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
  const pdfCount = Object.values(blocks).filter(b => b.type === "pdf").length
  const textCount = Object.values(blocks).filter(b => b.type === "text").length

  const blockTooltip = (meta) => {
    if (meta.compressed) return meta.type === "image" ? "double click to view" : "compressed"
    return meta.type === "image" ? "click to select · double click to view" : "click to select"
  }

  return (
    <div style={styles.app}>

      {/* LEFT SIDEBAR */}
      <div style={styles.sidebar}>
        <div style={{ padding: "16px 12px 0" }}>
          <div style={styles.sidebarHeader}>
            <span style={styles.logo}>Lethe</span>
            <button style={styles.newChat} onClick={async () => {
              try {
                const res = await apiFetch("/new_chat", { method: "POST" })
                const data = await res.json()
                setChats(prev => [{ id: data.chat_id, title: "New Chat" }, ...prev])
                setActiveChatId(data.chat_id)
              } catch {
                console.error("Failed to create new chat")
              }
              setMessages([])
              setBlocks({})
              setPreviews({})
              setSelected([])
              setPendingFile(null)
              setCompressionMsg(null)
              setCompressionMsgFading(false)
            }}>+ New</button>
          </div>
          <div style={styles.sidebarSection}>Recents</div>
        </div>
        <div style={styles.sidebarChatScroll}>
          {chatsLoading && (
            <div style={{ fontSize: 11, color: "#555", padding: "6px 8px" }}>Connecting…</div>
          )}
          {chats.map(chat => (
            <div
              key={chat.id}
              style={{
                ...styles.sidebarItem,
                background: chat.id === activeChatId ? "#2A2A2A" : "transparent",
                color: chat.id === activeChatId ? "#E8E8E8" : "#aaa",
                display: "flex", alignItems: "center", gap: 4
              }}
              onClick={() => { if (chat.id !== activeChatId) switchToChat(chat.id) }}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {chat.title}
              </span>
              <button
                style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 11, padding: "2px 4px", flexShrink: 0, lineHeight: 1, borderRadius: 3 }}
                title="Delete chat"
                onClick={async (e) => {
                  e.stopPropagation()
                  const res = await apiFetch(`/chats/${chat.id}`, { method: "DELETE" })
                  const data = await res.json()
                  setChats(prev => prev.filter(c => c.id !== chat.id))
                  if (chat.id === activeChatId) {
                    const remaining = chats.filter(c => c.id !== chat.id)
                    if (remaining.length > 0) {
                      await switchToChat(data.active_chat_id)
                    } else {
                      // Server auto-created a new chat
                      setChats([{ id: data.active_chat_id, title: "New Chat" }])
                      setActiveChatId(data.active_chat_id)
                      setMessages([])
                      setBlocks({})
                      setPreviews({})
                      setSelected([])
                    }
                  }
                }}
              >✕</button>
            </div>
          ))}
        </div>
        <div style={styles.sidebarBottom}>
          <div style={styles.userRow}>
            {authUser ? (
              <>
                <div style={styles.avatar}>
                  {authUser.avatar_url
                    ? <img src={authUser.avatar_url} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                    : (authUser.display_name || "?").slice(0, 2).toUpperCase()
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.userName}>{authUser.display_name || authUser.email}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={styles.planBadge}>{authUser.plan === "pro" ? "Pro" : "Free"}</div>
                    <button
                      style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 10, padding: 0 }}
                      onClick={() => apiFetch("/auth/logout", { method: "POST" }).then(() => { setAuthUser(null); setSentCount(0); setNudgeDismissed(false) }).catch(() => { })}
                    >Sign out</button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ ...styles.avatar, background: "#2A2A2A", color: "#666", fontSize: 13 }}>?</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.userName}>Guest</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={styles.planBadge}>Free</div>
                    <a href={`${API}/auth/google`} style={{ fontSize: 10, color: "#4ECDC4", textDecoration: "none" }}>Log in →</a>
                  </div>
                </div>
              </>
            )}
            <button style={styles.gearBtn} onClick={() => setShowSettings(true)} title="Settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
              <div style={styles.emptySubtitle}>Start a conversation. Upload images, code, text, or PDFs to begin tracking context.</div>
            </div>
          )}
          {sentCount >= 4 && !authUser && !nudgeDismissed && (
            <div style={{
              background: "linear-gradient(135deg, #1a2a2a 0%, #1A2520 100%)",
              border: "1px solid rgba(78,205,196,0.25)",
              borderRadius: 10,
              padding: "12px 14px",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0
            }}>
              <span style={{ fontSize: 16 }}>✨</span>
              <span style={{ fontSize: 12, color: "#aaa", flex: 1, lineHeight: 1.5 }}>
                You&apos;re chatting as a guest. <strong style={{ color: "#d0d0d0" }}>Log in with Google</strong> to save chats and sync across devices — it&apos;s free.
              </span>
              <a
                href={`${API}/auth/google`}
                style={{
                  background: "#4ECDC4", color: "#111", fontSize: 11, fontWeight: 600,
                  padding: "5px 10px", borderRadius: 6, textDecoration: "none",
                  flexShrink: 0, whiteSpace: "nowrap"
                }}
              >Log in</a>
              <button
                style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 13, padding: "0 2px", flexShrink: 0 }}
                onClick={() => setNudgeDismissed(true)}
              >✕</button>
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
              {msg.attachedFile && (
                <div style={styles.attachedFileBadge}>
                  <span style={{ fontSize: 13 }}>
                    {msg.attachedFile.type === "code" ? "📄" : msg.attachedFile.type === "pdf" ? "📑" : "📝"}
                  </span>
                  <span style={{ fontSize: 11, color: "#aaa" }}>{msg.attachedFile.name}</span>
                </div>
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
          {/* Hidden file inputs */}
          <input type="file" accept="image/*" ref={imageInputRef} style={{ display: "none" }}
            onChange={e => {
              const file = e.target.files[0]
              e.target.value = ""
              if (!file) return
              const url = URL.createObjectURL(file)
              setPreviews(prev => ({ ...prev, [file.name]: url }))
              setPendingFile({ file, type: "image", preview: url })
            }}
          />
          <input type="file"
            accept=".py,.js,.jsx,.ts,.tsx,.cpp,.c,.java,.go,.rs,.rb,.swift,.kt,.cs,.html,.css"
            ref={codeInputRef} style={{ display: "none" }}
            onChange={e => {
              const file = e.target.files[0]
              e.target.value = ""
              if (!file) return
              setPendingFile({ file, type: "code" })
            }}
          />
          <input type="file"
            accept=".txt,.md,.csv,.json,.xml,.yaml,.yml,.log"
            ref={textInputRef} style={{ display: "none" }}
            onChange={e => {
              const file = e.target.files[0]
              e.target.value = ""
              if (!file) return
              setPendingFile({ file, type: "text" })
            }}
          />
          <input type="file" accept=".pdf" ref={pdfInputRef} style={{ display: "none" }}
            onChange={e => {
              const file = e.target.files[0]
              e.target.value = ""
              if (!file) return
              const MAX_PDF = 32 * 1024 * 1024
              if (file.size > MAX_PDF) {
                alert("PDF must be under 32MB. Please choose a smaller file.")
                return
              }
              setPendingFile({ file, type: "pdf" })
            }}
          />

          <div style={styles.inputWrapper}>
            {pendingFile && (
              <div style={styles.imagePreviewRow}>
                {pendingFile.type === "image"
                  ? <img src={pendingFile.preview} style={styles.imageThumb} />
                  : <div style={styles.fileChip}>
                    <span style={{ fontSize: 14 }}>
                      {pendingFile.type === "code" ? "📄" : pendingFile.type === "pdf" ? "📑" : "📝"}
                    </span>
                    <span style={{ fontSize: 11, color: "#aaa", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
                      {pendingFile.file.name}
                    </span>
                  </div>
                }
                <button style={styles.removeImg} onClick={() => setPendingFile(null)}>✕</button>
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
              {/* Upload button with dropdown menu */}
              <div ref={uploadWrapperRef} style={{ position: "relative" }}>
                <button
                  style={styles.uploadBtn}
                  onClick={() => setUploadMenuOpen(p => !p)}
                  title="Attach file"
                >+</button>
                {uploadMenuOpen && (
                  <div style={styles.uploadMenu}>
                    {[
                      { type: "image", emoji: "📷", label: "Image", ref: imageInputRef },
                      { type: "code", emoji: "📄", label: "Code file", ref: codeInputRef },
                      { type: "text", emoji: "📝", label: "Text file", ref: textInputRef },
                      { type: "pdf", emoji: "📑", label: "PDF", ref: pdfInputRef },
                    ].map(item => (
                      <button
                        key={item.type}
                        className="upload-menu-item"
                        style={styles.uploadMenuItem}
                        onClick={() => { item.ref.current.click(); setUploadMenuOpen(false) }}
                      >
                        <span style={{ fontSize: 14, lineHeight: 1 }}>{item.emoji}</span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
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
                    <line x1="4" y1="3" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="4" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="2" cy="3" r="1" fill="currentColor" />
                    <circle cx="2" cy="7" r="1" fill="currentColor" />
                    <circle cx="2" cy="11" r="1" fill="currentColor" />
                  </svg>
                </button>
                <button
                  title="Tile view"
                  style={{ ...styles.viewBtn, background: viewMode === "tile" ? "#2A2A2A" : "transparent", color: viewMode === "tile" ? "#E8E8E8" : "#555" }}
                  onClick={() => setViewMode("tile")}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
                    <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
                    <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
                    <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
                <button
                  title="Detailed view"
                  style={{ ...styles.viewBtn, background: viewMode === "detailed" ? "#2A2A2A" : "transparent", color: viewMode === "detailed" ? "#E8E8E8" : "#555" }}
                  onClick={() => setViewMode("detailed")}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="1" width="12" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                    <line x1="1" y1="10" x2="9" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="1" y1="13" x2="6" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
                {/* Status filter row */}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <Pill label={`All ${totalCount}`} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
                  <Pill label={`Uncompressed ${uncompressedCount}`} active={statusFilter === "uncompressed"} onClick={() => setStatusFilter("uncompressed")} />
                  <Pill label={`Compressed ${compressedCount}`} active={statusFilter === "compressed"} onClick={() => setStatusFilter("compressed")} />
                </div>
                {/* Type filter row */}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <Pill label="All types" active={typeFilter === "all"} onClick={() => setTypeFilter("all")} />
                  {imageCount > 0 && <Pill label={`Images ${imageCount}`} active={typeFilter === "image"} onClick={() => setTypeFilter("image")} />}
                  {codeCount > 0 && <Pill label={`Code ${codeCount}`} active={typeFilter === "code"} onClick={() => setTypeFilter("code")} />}
                  {pdfCount > 0 && <Pill label={`PDFs ${pdfCount}`} active={typeFilter === "pdf"} onClick={() => setTypeFilter("pdf")} />}
                  {textCount > 0 && <Pill label={`Text ${textCount}`} active={typeFilter === "text"} onClick={() => setTypeFilter("text")} />}
                </div>
              </div>
            )}

            {/* Block list */}
            <div style={viewMode === "tile" ? styles.tileGrid : styles.blockList}>
              {totalCount === 0 && (
                <div style={styles.emptyBlocks}>No blocks yet. Upload an image, code, text, or PDF to start tracking.</div>
              )}

              {/* DETAILED VIEW */}
              {viewMode === "detailed" && filteredBlocks.map(([id, meta]) => (
                <div
                  key={id}
                  className={`block-tooltip${compressing && compressingIds.includes(id) && meta.type !== "image" ? " compressing-row" : ""}`}
                  data-tooltip={blockTooltip(meta)}
                  style={{
                    ...styles.blockItem,
                    border: flashingBlocks.includes(id) ? "1px solid #c8a020" : selected.includes(id) ? "1px solid #4ECDC4" : "1px solid #2A2A2A",
                    opacity: meta.compressed ? 0.6 : 1
                  }}
                  onClick={() => !meta.compressed && toggleSelect(id)}
                  onDoubleClick={() => meta.type === "image" && previews[id] && setOverlayImage(previews[id])}
                >
                  {meta.type === "image" ? (
                    <>
                      <BlockThumb
                        id={id} meta={meta} previews={previews}
                        isCompressing={compressing && compressingIds.includes(id)}
                        height={80}
                      />
                      <div style={styles.blockId}>{meta.id || id}</div>
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                      <FileIcon type={meta.type} compressed={meta.compressed} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.blockId}>{meta.id || id}</div>
                        {meta.type === "code" && meta.versions && (
                          <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
                            {meta.versions} version{meta.versions !== 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div style={styles.blockMeta}>
                    <span style={styles.blockType}>{meta.type}</span>
                    <span style={styles.blockTokens}>{settings.showTokenCounts ? `${getBlockTokens(meta).toLocaleString()} tokens` : "—"}</span>
                  </div>
                  {meta.uploaded_at && <div style={styles.blockTimestamp}>{relativeTime(meta.uploaded_at)}</div>}
                  {meta.compressed && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: "#4ECDC4" }}>✓ compressed</span>
                      {meta.summary_tokens != null && settings.showTokenCounts && (
                        <span style={{ fontSize: 11, fontFamily: "'Courier New', monospace", color: "#4ECDC4" }}>
                          {meta.summary_tokens.toLocaleString()} tokens
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* LIST VIEW */}
              {viewMode === "list" && filteredBlocks.map(([id, meta]) => (
                <div
                  key={id}
                  className={`block-tooltip${compressing && compressingIds.includes(id) ? " compressing-row" : ""}`}
                  data-tooltip={blockTooltip(meta)}
                  style={{
                    ...styles.listItem,
                    border: flashingBlocks.includes(id) ? "1px solid #c8a020" : selected.includes(id) ? "1px solid #4ECDC4" : "1px solid #2A2A2A",
                    opacity: meta.compressed ? 0.6 : 1
                  }}
                  onClick={() => !meta.compressed && toggleSelect(id)}
                  onDoubleClick={() => meta.type === "image" && previews[id] && setOverlayImage(previews[id])}
                >
                  {meta.type !== "image" && (
                    <FileIcon type={meta.type} compressed={meta.compressed} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontFamily: "'Courier New', monospace", color: "#E8E8E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {meta.id || id}
                    </div>
                    {meta.type === "code" && meta.versions && (
                      <div style={{ fontSize: 10, color: "#555", marginTop: 1 }}>
                        {meta.versions} version{meta.versions !== 1 ? "s" : ""}
                      </div>
                    )}
                    {meta.uploaded_at && <div style={styles.blockTimestamp}>{relativeTime(meta.uploaded_at)}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                    {settings.showTokenCounts && (
                      <span style={styles.blockTokens}>{getBlockTokens(meta).toLocaleString()}</span>
                    )}
                    {meta.compressed && meta.summary_tokens != null && settings.showTokenCounts && (
                      <span style={{ fontSize: 10, fontFamily: "'Courier New', monospace", color: "#4ECDC4" }}>
                        {meta.summary_tokens.toLocaleString()}
                      </span>
                    )}
                    {meta.compressed && <span style={{ fontSize: 10, color: "#4ECDC4" }}>✓</span>}
                  </div>
                </div>
              ))}

              {/* TILE VIEW */}
              {viewMode === "tile" && filteredBlocks.map(([id, meta]) => (
                <div
                  key={id}
                  className={`block-tooltip tile-block${compressing && compressingIds.includes(id) && meta.type !== "image" ? " compressing-row" : ""}`}
                  data-tooltip={blockTooltip(meta)}
                  style={{
                    borderRadius: 8,
                    overflow: "hidden",
                    cursor: "pointer",
                    border: flashingBlocks.includes(id) ? "1px solid #c8a020" : selected.includes(id) ? "1px solid #4ECDC4" : "1px solid #2A2A2A",
                    opacity: meta.compressed ? 0.6 : 1
                  }}
                  onClick={() => !meta.compressed && toggleSelect(id)}
                  onDoubleClick={() => meta.type === "image" && previews[id] && setOverlayImage(previews[id])}
                >
                  {meta.type === "image" ? (
                    <BlockThumb
                      id={id} meta={meta} previews={previews}
                      isCompressing={compressing && compressingIds.includes(id)}
                      square
                    />
                  ) : (
                    <div style={{
                      aspectRatio: "1/1",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#161616",
                      borderRadius: "6px 6px 0 0"
                    }}>
                      <FileIcon type={meta.type} compressed={meta.compressed} />
                    </div>
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
          <polyline points="6,4 10,8 6,12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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

      {/* TOAST CONTAINER */}
      <div style={{
        position: "fixed", bottom: 24, right: panelOpen ? 296 : 16,
        zIndex: 300, display: "flex", flexDirection: "column-reverse", gap: 8,
        alignItems: "flex-end", transition: "right 0.2s ease", pointerEvents: "none"
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: "auto" }}>
            <Toast message={t.message} onDismiss={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
          </div>
        ))}
      </div>

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
  emptySubtitle: { fontSize: 14, color: "#888", maxWidth: 400, margin: "0 auto" },
  userMsg: { alignSelf: "flex-end", maxWidth: "70%" },
  assistantMsg: { alignSelf: "flex-start", maxWidth: "70%" },
  msgRole: { fontSize: 11, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" },
  msgContent: { fontSize: 14, lineHeight: 1.6, background: "#1A1A1A", padding: "12px 16px", borderRadius: 10 },
  attachedFileBadge: { display: "inline-flex", alignItems: "center", gap: 6, background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 6, padding: "4px 8px", marginBottom: 6 },
  inputArea: { padding: "16px 48px 24px", display: "flex", justifyContent: "center" },
  inputWrapper: { width: "100%", maxWidth: 700, background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 16, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 },
  inputRow: { display: "flex", alignItems: "center", gap: 8 },
  input: { flex: 1, background: "transparent", border: "none", color: "#E8E8E8", fontSize: 14, resize: "none", outline: "none", fontFamily: "inherit", padding: "0" },
  uploadBtn: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 20, padding: "0 4px", flexShrink: 0 },
  uploadMenu: {
    position: "absolute", bottom: "calc(100% + 8px)", left: 0,
    background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 10,
    padding: 4, zIndex: 50, minWidth: 148,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    display: "flex", flexDirection: "column", gap: 1
  },
  uploadMenuItem: {
    background: "none", border: "none", color: "#D0D0D0", fontSize: 13,
    padding: "8px 12px", textAlign: "left", cursor: "pointer",
    borderRadius: 6, width: "100%", fontFamily: "inherit",
    display: "flex", alignItems: "center", gap: 8
  },
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
  fileChip: { display: "flex", alignItems: "center", gap: 6, background: "#2A2A2A", borderRadius: 6, padding: "6px 10px" },
}
