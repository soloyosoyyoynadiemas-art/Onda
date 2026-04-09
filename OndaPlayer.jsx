import { useState, useEffect, useRef, useCallback } from "react";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const STORAGE_KEY = "onda_v3";

function fmt(s) {
  if (!s || isNaN(s)) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sc).padStart(2,"0")}`;
  return `${m}:${String(sc).padStart(2,"0")}`;
}

function Toast({ msg }) {
  return msg ? (
    <div style={{
      position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",
      background:"#1a1a2e",border:"1.5px solid #f0c040",borderRadius:10,
      color:"#eeeef5",fontSize:13,padding:"9px 20px",zIndex:999,
      whiteSpace:"nowrap",fontFamily:"'IBM Plex Mono',monospace",
      boxShadow:"0 4px 24px rgba(0,0,0,.5)"
    }}>{msg}</div>
  ) : null;
}

export default function OndaPlayer() {
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const progressRef = useRef(null);

  const [tracks, setTracks] = useState([]);
  const [ci, setCi] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [urlInput, setUrlInput] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [customMin, setCustomMin] = useState(5);
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const toastTimer = useRef(null);
  const saveTimer = useRef(null);
  const blobUrls = useRef({});

  // ── TOAST ──
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  // ── SAVE STATE ──
  const saveState = useCallback((overrideCi, overrideTracks) => {
    const idx = overrideCi !== undefined ? overrideCi : ci;
    const tks = overrideTracks || tracks;
    const pos = audioRef.current && !isNaN(audioRef.current.currentTime)
      ? audioRef.current.currentTime : 0;
    const meta = tks.map(t => ({
      name: t.name,
      src: t.local ? null : t.src,
      local: t.local,
      dur: t.dur || 0
    }));
    try {
      window.storage?.set(STORAGE_KEY, JSON.stringify({
        tracks: meta, ci: idx, pos,
        speed: audioRef.current?.playbackRate || 1
      }));
    } catch(e) {}
  }, [ci, tracks]);

  // ── LOAD STATE ──
  useEffect(() => {
    async function loadState() {
      try {
        const result = await window.storage?.get(STORAGE_KEY);
        if (!result) return;
        const s = JSON.parse(result.value);
        const restored = (s.tracks || []).filter(t => !t.local && t.src)
          .map(t => ({ name: t.name, src: t.src, local: false, dur: t.dur || 0 }));
        if (restored.length === 0) return;
        setTracks(restored);
        if (s.ci >= 0 && s.ci < restored.length) {
          const t = restored[s.ci];
          setCi(s.ci);
          if (audioRef.current) {
            audioRef.current.src = t.src;
            audioRef.current.currentTime = s.pos || 0;
            audioRef.current.playbackRate = s.speed || 1;
            setSpeed(s.speed || 1);
            setCurrentTime(s.pos || 0);
          }
          showToast(`▶ Continuando en ${fmt(s.pos || 0)}`);
        }
      } catch(e) {}
    }
    loadState();
  }, []);

  // ── ADD URL ──
  function addUrl() {
    const v = urlInput.trim();
    if (!v) return showToast("Pega un enlace primero");
    const name = decodeURIComponent(v.split("/").pop().split("?")[0]) || "Audio web";
    const newTracks = [...tracks, { name, src: v, local: false, dur: 0 }];
    setTracks(newTracks);
    setUrlInput("");
    showToast("✅ Añadido: " + name);
    saveState(ci, newTracks);
  }

  // ── ADD FILES ──
  function addFiles(files) {
    const arr = Array.from(files).filter(f => f.type.startsWith("audio/"));
    if (!arr.length) return;
    const newItems = arr.map(f => {
      const burl = URL.createObjectURL(f);
      blobUrls.current[f.name] = burl;
      return { name: f.name, src: burl, local: true, dur: 0 };
    });
    const newTracks = [...tracks, ...newItems];
    setTracks(newTracks);
    showToast(`✅ ${arr.length} archivo(s) añadido(s)`);
    saveState(ci, newTracks);
  }

  // ── LOAD TRACK ──
  function loadTrack(i, newTracks) {
    const tks = newTracks || tracks;
    const t = tks[i];
    if (!t?.src) return showToast("⚠ Archivo sin fuente disponible");
    saveState(i, tks);
    setCi(i);
    if (audioRef.current) {
      audioRef.current.src = t.src;
      audioRef.current.playbackRate = speed;
      audioRef.current.play().catch(() => {});
    }
  }

  // ── DELETE ──
  function delTrack(i) {
    const newTracks = tracks.filter((_, idx) => idx !== i);
    let newCi = ci;
    if (i === ci) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      setPlaying(false); setCurrentTime(0); setDuration(0);
      newCi = -1;
    } else if (i < ci) newCi = ci - 1;
    setCi(newCi);
    setTracks(newTracks);
    saveState(newCi, newTracks);
  }

  // ── PLAY/PAUSE ──
  function togglePlay() {
    if (!audioRef.current?.src) return showToast("Selecciona un audio primero");
    if (audioRef.current.paused) audioRef.current.play().catch(() => {});
    else audioRef.current.pause();
  }

  function skipTrack(d) {
    const n = ci + d;
    if (n >= 0 && n < tracks.length) loadTrack(n);
  }

  // ── SKIP TIME ──
  function skip(s) {
    if (!audioRef.current?.src) return;
    audioRef.current.currentTime = Math.max(0,
      Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + s));
    showToast((s > 0 ? "⏩ +" : "⏪ ") + Math.abs(s) + "s");
  }

  function customSkip(d) {
    skip(d * customMin * 60);
    setShowModal(false);
  }

  // ── SPEED ──
  function changeSpeed(s) {
    setSpeed(s);
    if (audioRef.current) audioRef.current.playbackRate = s;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveState(), 300);
  }

  // ── AUDIO EVENTS ──
  useEffect(() => {
    const aud = audioRef.current;
    if (!aud) return;
    const onTime = () => {
      if (!dragging) {
        setCurrentTime(aud.currentTime);
        if (Math.floor(aud.currentTime) % 5 === 0) saveState();
      }
    };
    const onMeta = () => {
      setDuration(aud.duration);
      setTracks(prev => {
        const n = [...prev];
        if (ci >= 0 && n[ci]) n[ci] = { ...n[ci], dur: aud.duration };
        return n;
      });
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => { setPlaying(false); saveState(); };
    const onEnded = () => skipTrack(1);
    aud.addEventListener("timeupdate", onTime);
    aud.addEventListener("loadedmetadata", onMeta);
    aud.addEventListener("play", onPlay);
    aud.addEventListener("pause", onPause);
    aud.addEventListener("ended", onEnded);
    return () => {
      aud.removeEventListener("timeupdate", onTime);
      aud.removeEventListener("loadedmetadata", onMeta);
      aud.removeEventListener("play", onPlay);
      aud.removeEventListener("pause", onPause);
      aud.removeEventListener("ended", onEnded);
    };
  }, [ci, dragging, saveState]);

  // ── MEDIA SESSION ──
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => audioRef.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => skipTrack(-1));
    navigator.mediaSession.setActionHandler("nexttrack", () => skipTrack(1));
    navigator.mediaSession.setActionHandler("seekbackward", () => skip(-10));
    navigator.mediaSession.setActionHandler("seekforward", () => skip(10));
  }, [ci]);

  // ── SEEK ──
  function seekFromEvent(e) {
    const r = progressRef.current?.getBoundingClientRect();
    if (!r || !audioRef.current?.duration) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const pct = Math.max(0, Math.min(1, x / r.width));
    audioRef.current.currentTime = pct * audioRef.current.duration;
    setCurrentTime(pct * audioRef.current.duration);
  }

  const pct = duration ? (currentTime / duration) * 100 : 0;
  const currentTrack = ci >= 0 ? tracks[ci] : null;

  // ── STYLES ──
  const S = {
    root: {
      background: "#080810",
      minHeight: "100vh",
      color: "#eeeef5",
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      display: "flex", flexDirection: "column",
      position: "relative", overflow: "hidden",
    },
    bg: {
      position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
      background: `
        radial-gradient(ellipse 80% 60% at 15% 10%, rgba(155,127,255,.08) 0%, transparent 60%),
        radial-gradient(ellipse 60% 40% at 85% 85%, rgba(240,192,64,.06) 0%, transparent 60%)
      `
    },
    header: {
      flexShrink: 0, padding: "44px 20px 14px",
      display: "flex", alignItems: "flex-end", justifyContent: "space-between",
      position: "relative", zIndex: 1,
    },
    logo: {
      fontFamily: "Georgia, 'Times New Roman', serif",
      fontSize: "2.1rem", fontWeight: 700,
      color: "#f0c040", letterSpacing: -1, lineHeight: 1,
    },
    logoEm: { fontStyle: "italic", fontWeight: 400, color: "#eeeef5" },
    hdrBtn: {
      background: "#1a1a2e", border: "none", borderRadius: 10,
      color: "#eeeef5", fontFamily: "inherit", fontSize: 12,
      padding: "8px 14px", cursor: "pointer",
    },
    main: {
      flex: 1, overflowY: "auto", padding: "0 16px 8px",
      position: "relative", zIndex: 1,
    },
    addBox: {
      background: "#111120", borderRadius: 16,
      padding: 16, marginBottom: 14,
      border: "1.5px solid #1a1a2e",
    },
    addRow: { display: "flex", gap: 8, marginBottom: 10 },
    input: {
      flex: 1, background: "#1a1a2e",
      border: "1.5px solid #22223a", borderRadius: 10,
      color: "#eeeef5", fontFamily: "inherit",
      fontSize: 13, padding: "11px 14px", outline: "none", minWidth: 0,
    },
    btnGold: {
      background: "#f0c040", color: "#08080f",
      border: "none", borderRadius: 10, cursor: "pointer",
      fontFamily: "inherit", fontSize: 13, fontWeight: 600,
      padding: "11px 16px", whiteSpace: "nowrap",
    },
    fileBtn: {
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: 8, background: dragOver ? "#1a1a2e" : "#111120",
      border: `1.5px dashed ${dragOver ? "#f0c040" : "#22223a"}`,
      borderRadius: 10, color: dragOver ? "#f0c040" : "#5a5a78",
      fontFamily: "inherit", fontSize: 13,
      padding: "13px 16px", width: "100%", cursor: "pointer",
    },
    secLabel: {
      fontSize: 11, color: "#5a5a78", letterSpacing: 2,
      textTransform: "uppercase", padding: "14px 4px 8px",
    },
    empty: {
      textAlign: "center", padding: "32px 16px",
      color: "#5a5a78", fontSize: 13, lineHeight: 2,
    },
    trackItem: (active) => ({
      background: active ? "#1a1a2e" : "#111120",
      borderRadius: 14, padding: "12px 14px",
      display: "flex", alignItems: "center", gap: 12,
      cursor: "pointer", marginBottom: 6,
      border: `1.5px solid ${active ? "#f0c040" : "transparent"}`,
      position: "relative", overflow: "hidden",
    }),
    trackBar: {
      position: "absolute", left: 0, top: 0, bottom: 0,
      width: 3, background: "#f0c040",
    },
    trackIco: (active) => ({
      width: 40, height: 40, borderRadius: 10,
      background: active ? "#f0c040" : "#1a1a2e",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "1.1rem", flexShrink: 0,
    }),
    trackName: (active) => ({
      fontSize: 13, whiteSpace: "nowrap", overflow: "hidden",
      textOverflow: "ellipsis",
      color: active ? "#f0c040" : "#eeeef5",
    }),
    trackSub: { fontSize: 11, color: "#5a5a78", marginTop: 2 },
    trackDur: { fontSize: 11, color: "#5a5a78", flexShrink: 0 },
    delBtn: {
      background: "none", border: "none", color: "#5a5a78",
      fontSize: 14, cursor: "pointer", padding: 6, flexShrink: 0,
    },
    player: {
      flexShrink: 0, background: "#111120",
      borderTop: "1.5px solid #1a1a2e",
      position: "relative", zIndex: 10,
    },
    progWrap: { padding: "10px 16px 0" },
    progTrack: {
      height: 4, background: "#22223a", borderRadius: 4,
      position: "relative", cursor: "pointer",
    },
    progFill: {
      height: "100%", background: "#f0c040",
      borderRadius: 4, width: pct + "%", pointerEvents: "none",
    },
    progThumb: {
      position: "absolute", top: "50%", left: pct + "%",
      transform: "translate(-50%,-50%)",
      width: 14, height: 14, background: "#f0c040",
      borderRadius: "50%", cursor: "grab",
    },
    timeRow: {
      display: "flex", justifyContent: "space-between",
      fontSize: 10, color: "#5a5a78", padding: "4px 1px 0",
    },
    speedScroll: {
      display: "flex", gap: 6, padding: "8px 16px 0",
      overflowX: "auto", scrollbarWidth: "none",
    },
    speedChip: (active) => ({
      background: active ? "#9b7fff" : "#1a1a2e",
      color: active ? "#fff" : "#5a5a78",
      border: "none", borderRadius: 7, cursor: "pointer",
      fontFamily: "inherit", fontSize: 11,
      padding: "4px 10px", whiteSpace: "nowrap", flexShrink: 0,
    }),
    ctrlRow: {
      display: "flex", alignItems: "center",
      padding: "8px 12px 14px", gap: 2,
    },
    nowWrap: { flex: 1, minWidth: 0, padding: "0 4px" },
    nowName: {
      fontSize: 13, whiteSpace: "nowrap", overflow: "hidden",
      textOverflow: "ellipsis",
    },
    nowSub: { fontSize: 10, color: "#5a5a78", marginTop: 2 },
    cb: {
      background: "none", border: "none", color: "#eeeef5",
      cursor: "pointer", padding: 8, borderRadius: 10,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    },
    ppBtn: {
      background: "#f0c040", color: "#08080f",
      border: "none", borderRadius: "50%",
      width: 46, height: 46, cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      margin: "0 2px", flexShrink: 0,
    },
    overlay: {
      position: "fixed", inset: 0, background: "rgba(0,0,0,.75)",
      zIndex: 200, display: "flex", alignItems: "flex-end",
      justifyContent: "center",
    },
    sheet: {
      background: "#111120", borderRadius: "24px 24px 0 0",
      padding: "24px 20px 44px", width: "100%", maxWidth: 480,
      border: "1.5px solid #1a1a2e", borderBottom: "none",
    },
    sheetTitle: {
      fontFamily: "Georgia, serif", fontSize: "1.2rem",
      marginBottom: 18, display: "flex", alignItems: "center", gap: 8,
    },
    quickGrid: {
      display: "grid", gridTemplateColumns: "repeat(3,1fr)",
      gap: 8, marginBottom: 20,
    },
    qb: (color) => ({
      background: "#1a1a2e", border: "none", borderRadius: 10,
      color, cursor: "pointer", fontFamily: "inherit", fontSize: 13,
      padding: "12px 6px", textAlign: "center",
    }),
    customRow: {
      background: "#1a1a2e", borderRadius: 12,
      padding: "14px 16px", display: "flex",
      alignItems: "center", gap: 10, marginBottom: 12,
    },
    numInput: {
      background: "#080810", border: "1.5px solid #22223a",
      borderRadius: 8, color: "#eeeef5", fontFamily: "inherit",
      fontSize: 16, padding: "8px 10px", outline: "none",
      width: 90, textAlign: "center",
    },
    customBtns: { display: "flex", gap: 8, marginBottom: 10 },
    btnS: {
      flex: 1, background: "#1a1a2e", color: "#eeeef5",
      border: "none", borderRadius: 10, cursor: "pointer",
      fontFamily: "inherit", fontSize: 13, padding: 13,
    },
    closeBtn: {
      display: "block", width: "100%", background: "none",
      border: "1.5px solid #1a1a2e", borderRadius: 10,
      color: "#5a5a78", cursor: "pointer",
      fontFamily: "inherit", fontSize: 13, padding: 11,
    },
  };

  return (
    <div style={S.root}>
      <div style={S.bg} />
      <Toast msg={toast} />
      <audio ref={audioRef} />

      {/* HEADER */}
      <header style={S.header}>
        <div style={S.logo}>on<em style={S.logoEm}>da</em></div>
        <button style={S.hdrBtn} onClick={() => setShowModal(true)}>⏩ Saltar tiempo</button>
      </header>

      {/* MAIN */}
      <div style={S.main}>
        {/* ADD BOX */}
        <div style={S.addBox}>
          <div style={S.addRow}>
            <input
              type="text" style={S.input}
              placeholder="Enlace de audio (mp3, m4b, ogg…)"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addUrl()}
            />
            <button style={S.btnGold} onClick={addUrl}>+ URL</button>
          </div>
          <label
            style={S.fileBtn}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Seleccionar archivos de audio
            <input
              ref={fileInputRef}
              type="file" accept="audio/*" multiple
              style={{ display: "none" }}
              onChange={e => addFiles(e.target.files)}
            />
          </label>
        </div>

        {/* PLAYLIST */}
        <div style={S.secLabel}>Biblioteca</div>
        {tracks.length === 0 ? (
          <div style={S.empty}>
            <div style={{ fontSize: "2.4rem", marginBottom: 8 }}>🎧</div>
            Añade un archivo o pega un enlace<br />para comenzar a escuchar
          </div>
        ) : tracks.map((t, i) => (
          <div key={i} style={S.trackItem(i === ci)} onClick={() => loadTrack(i)}>
            {i === ci && <div style={S.trackBar} />}
            <div style={S.trackIco(i === ci)}>{t.local ? "📁" : "🌐"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.trackName(i === ci)}>{t.name}</div>
              <div style={S.trackSub}>{t.local ? "Archivo local" : "Enlace web"}</div>
            </div>
            <span style={S.trackDur}>{t.dur ? fmt(t.dur) : ""}</span>
            <button style={S.delBtn} onClick={e => { e.stopPropagation(); delTrack(i); }}>✕</button>
          </div>
        ))}
      </div>

      {/* PLAYER BAR */}
      <div style={S.player}>
        {/* PROGRESS */}
        <div style={S.progWrap}>
          <div
            ref={progressRef}
            style={S.progTrack}
            onClick={seekFromEvent}
            onTouchStart={e => { setDragging(true); seekFromEvent(e); }}
            onTouchMove={seekFromEvent}
            onTouchEnd={() => { setDragging(false); saveState(); }}
          >
            <div style={S.progFill} />
            <div style={S.progThumb} />
          </div>
          <div style={S.timeRow}>
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* SPEED */}
        <div style={S.speedScroll}>
          {SPEEDS.map(s => (
            <button key={s} style={S.speedChip(s === speed)} onClick={() => changeSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>

        {/* CONTROLS */}
        <div style={S.ctrlRow}>
          <div style={S.nowWrap}>
            <div style={S.nowName}>{currentTrack?.name || "Sin reproducción"}</div>
            <div style={S.nowSub}>{currentTrack ? (currentTrack.local ? "Archivo local" : "Enlace web") : "—"}</div>
          </div>
          <button style={S.cb} onClick={() => skipTrack(-1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
            </svg>
          </button>
          <button style={S.ppBtn} onClick={togglePlay}>
            {playing
              ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            }
          </button>
          <button style={S.cb} onClick={() => skipTrack(1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zm2-8.14 5.52 3.64L8 18V9.86zM16 6h2v12h-2z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* SKIP MODAL */}
      {showModal && (
        <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div style={S.sheet}>
            <div style={S.sheetTitle}>⚡ Saltar tiempo</div>
            <div style={S.quickGrid}>
              {[[-60,"← 60s"],[-30,"← 30s"],[-10,"← 10s"],[10,"10s →"],[30,"30s →"],[60,"60s →"]].map(([s,l]) => (
                <button key={s} style={S.qb(s < 0 ? "#9b7fff" : "#f0c040")} onClick={() => { skip(s); setShowModal(false); }}>
                  {l}
                </button>
              ))}
            </div>
            <div style={S.customRow}>
              <label style={{ fontSize: 12, color: "#5a5a78", flexShrink: 0 }}>Personalizado</label>
              <input
                type="number" style={S.numInput}
                value={customMin}
                onChange={e => setCustomMin(parseFloat(e.target.value) || 1)}
                min="1" max="999"
              />
              <span style={{ fontSize: 12, color: "#5a5a78" }}>minutos</span>
            </div>
            <div style={S.customBtns}>
              <button style={S.btnS} onClick={() => customSkip(-1)}>← Retroceder</button>
              <button style={S.btnGold} onClick={() => customSkip(1)}>Adelantar →</button>
            </div>
            <button style={S.closeBtn} onClick={() => setShowModal(false)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
