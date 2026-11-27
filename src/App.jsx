import { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import katex from 'katex';
import 'katex/dist/katex.min.css';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const SECRET_PASSCODE = import.meta.env.VITE_SECRET_PASSCODE || "demo";

const DEMO_PAPERS = [
  {
    id: "demo-1",
    title: "Minimum Wages and Employment: A Case Study of the Fast-Food Industry (Card & Krueger, 1994)",
    folder: "Labor Economics/Minimum Wage",
    abstract: "Research Question: Does an increase in the minimum wage reduce employment in low-wage industries?\nData Used: Survey data from 410 fast-food restaurants in New Jersey and eastern Pennsylvania before and after NJ's 1992 minimum wage increase.\nMethodology: Difference-in-Differences (DID).\nConclusion: Found no indication that the rise in the minimum wage reduced employment.",
    memo: "<span style=\"color:#1a73e8\">## 識別戦略メモ</span><br>- $\\Delta E_i$：店舗 $i$ の雇用変化<br>- $\\text{NJ}_i$：ニュージャージー州ダミー（処置群）<br>$$\\Delta E_i = \\alpha + \\beta \\cdot \\text{NJ}_i + \\varepsilon_i$$"
  },
  {
    id: "demo-2",
    title: "Children and Gender Inequality: Evidence from Denmark (Kleven et al., 2019)",
    folder: "Labor Economics/Gender",
    abstract: "Research Question: How much of the remaining gender inequality in earnings can be explained by the arrival of children?\nData Used: Danish administrative data covering the full population from 1980 to 2013.\nMethodology: Event Study around the birth of the first child.\nConclusion: The arrival of children creates a long-run gender gap in earnings of about 20%, driven by labor force participation, hours worked, and wage rates.",
    memo: "## チャイルド・ペナルティ整理\n- 第一子出産をイベントとしたイベントスタディ。\n- 出産前は男女で平行トレンドだが、出産直後に女性のみ所得が急落し回復しない。"
  },
  {
    id: "demo-3",
    title: "The Colonial Origins of Comparative Development (Acemoglu, Johnson, & Robinson, 2001)",
    folder: "Development & Institutions",
    abstract: "Research Question: What is the fundamental cause of large differences in income per capita across countries?\nData Used: Cross-country data on settler mortality, institutional quality (expropriation risk), and GDP per capita.\nMethodology: Instrumental Variables (2SLS) using European settler mortality as an instrument for current institutions.\nConclusion: Differences in institutions account for roughly three-quarters of the income per capita differences across former colonies.",
    memo: "## 操作変数（IV）の妥当性\n- **除外制約**：過去の入植者死亡率は「当時の制度形成」を通じてのみ現代の所得に影響する。"
  }
];

const HIGHLIGHT_COLORS = [
  { name: "黄", code: "#fff3a3" },
  { name: "緑", code: "#c8f7c5" },
  { name: "ピンク", code: "#ffd1dc" }
];

const MEMO_COLORS = [
  { key: "black", label: "黒", code: "#1f2328" },
  { key: "orange", label: "オレンジ", code: "#e67e22" },
  { key: "blue", label: "青", code: "#1a73e8" },
  { key: "green", label: "緑", code: "#1e8e3e" }
];

const MEMO_COLOR_MAP = { black: "#1f2328", orange: "#e67e22", blue: "#1a73e8", green: "#1e8e3e" };

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

const loadStorage = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const saveStorage = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
};

const detectIOS = () => {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
};

const escapeHtml = (str = "") =>
  str.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, """).replace(/'/g, "'");

const decodeEntities = (str = "") =>
  str.replace(/</g, "<").replace(/>/g, ">").replace(/&/g, "&").replace(/"/g, '"').replace(/'/g, "'").replace(/ /g, " ");

const normalizeTeX = (expr = "") =>
  expr.replace(/@@STY\d+@@/g, "").replace(/＿/g, "_").replace(/＾/g, "^").replace(/｛/g, "{").replace(/｝/g, "}").replace(/＝/g, "=").replace(/＋/g, "+").replace(/－/g, "-").trim();

const memoToHtml = (raw = "") => {
  if (!raw) return "";
  if (/<(div|br|span|font|p|b|strong|i|em|u|s|strike|del)\b/i.test(raw)) return raw;
  let html = escapeHtml(raw);
  for (let i = 0; i < 4; i++) {
    html = html.replace(/\[(black|orange|blue|green)\]([\s\S]*?)\[\/\1\]/g, (_, c, inner) => `<span style="color:${MEMO_COLOR_MAP[c] || '#1f2328'}">${inner}</span>`);
  }
  return html.replace(/\n/g, "<br>");
};

const sanitizeInlineStyle = (styleStr = "") => {
  const allowed = [];
  styleStr.split(";").forEach(rule => {
    const [propRaw, valRaw] = rule.split(":");
    if (!propRaw || !valRaw) return;
    const prop = propRaw.trim().toLowerCase();
    const val = valRaw.trim();
    if (["color", "font-weight", "font-style", "text-decoration", "text-decoration-line"].includes(prop) && !/[<>]|url\s*\(|expression\s*\(/i.test(val)) {
      allowed.push(`${prop}:${val}`);
    }
  });
  return allowed.join(";");
};

const renderMarkdownAndMathHtml = (rawInput = "", { preserveColors = false } = {}) => {
  if (!rawInput) return "";
  let working = rawInput;
  const styleTokens = [];
  const pushStyleToken = (tagHtml) => {
    const idx = styleTokens.length;
    styleTokens.push(tagHtml);
    return `@@STY${idx}@@`;
  };

  if (preserveColors) {
    let html = memoToHtml(rawInput)
      .replace(/<div[^>]*><br\s*\/?><\/div>/gi, "\n")
      .replace(/<p[^>]*><br\s*\/?><\/p>/gi, "\n")
      .replace(/<\/(div|p)>\s*<(div|p)[^>]*>/gi, "\n")
      .replace(/<(div|p)[^>]*>/gi, "\n")
      .replace(/<\/(div|p)>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n");
    html = html.replace(/<span\b[^>]*style=["']([^"']+)["'][^>]*>/gi, (_, styleAttr) => {
      const safeStyle = sanitizeInlineStyle(styleAttr);
      return safeStyle ? pushStyleToken(`<span style="${safeStyle}">`) : pushStyleToken(`<span>`);
    });
    html = html.replace(/<font\b[^>]*color=["']?([^"'\s>]+)["']?[^>]*>/gi, (_, col) => pushStyleToken(`<span style="color:${col.trim()}">`));
    html = html.replace(/<\/(span|font)>/gi, () => pushStyleToken(`</span>`));
    html = html.replace(/<(\/?)(b|strong|i|em|u|s|strike|del)\b[^>]*>/gi, (_, slash, tag) => pushStyleToken(`<${slash}${tag.toLowerCase()}>`));
    html = html.replace(/<[^>]+>/g, "");
    working = decodeEntities(html).replace(/^\n+/, "");
  }

  const codeBlockTokens = [];
  working = working.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlockTokens.length;
    codeBlockTokens.push(`<pre style="background:#f3f4f6;color:#1f2328;padding:6px 8px;border-radius:5px;overflow-x:auto;font-size:12px;margin:4px 0;font-family:monospace;line-height:1.4;"><code>${escapeHtml(code.replace(/@@STY\d+@@/g, "").trimEnd())}</code></pre>`);
    return `@@CODEBLK${idx}@@`;
  });

  const mathTokens = [];
  working = working.replace(/(^|\n)((?:@@STY\d+@@)*)[ \t]*\$\$([\s\S]+?)\$\$[ \t]*((?:@@STY\d+@@)*)(?=\n|$)/g, (_, lead, preSty, expr, postSty) => {
    const idx = mathTokens.length;
    const rendered = katex.renderToString(normalizeTeX(expr), { displayMode: true, throwOnError: false });
    mathTokens.push(`<div style="overflow-x:auto;margin:2px 0;text-align:left;">${preSty}${rendered}${postSty}</div>`);
    return `${lead}@@MATHBLK${idx}@@`;
  });
  working = working.replace(/\$\$([^$\n]+?)\$\$/g, (_, expr) => {
    const idx = mathTokens.length;
    mathTokens.push(katex.renderToString(normalizeTeX(expr), { displayMode: false, throwOnError: false }));
    return `@@MATH${idx}@@`;
  });
  working = working.replace(/\$([^$\n]+?)\$/g, (full, expr) => {
    const cleanExpr = normalizeTeX(expr);
    if (!cleanExpr || /^\d+(\.\d+)?[\s→,-]/.test(cleanExpr)) return full;
    const idx = mathTokens.length;
    mathTokens.push(katex.renderToString(cleanExpr, { displayMode: false, throwOnError: false }));
    return `@@MATH${idx}@@`;
  });

  const inlineCodeTokens = [];
  working = working.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodeTokens.length;
    inlineCodeTokens.push(`<code style="background:#eef0f3;color:#c7254e;padding:1px 4px;border-radius:3px;font-size:0.92em;font-family:monospace;">${escapeHtml(code.replace(/@@STY\d+@@/g, ""))}</code>`);
    return `@@INCODE${idx}@@`;
  });

  let safe = escapeHtml(working)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  const lines = safe.split("\n");
  const out = [];
  let inUl = false;
  let inOl = false;
  const closeLists = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^@@(CODEBLK|MATHBLK)\d+@@$/.test(trimmed)) { closeLists(); out.push(trimmed); continue; }
    const hMatch = rawLine.match(/^((?:@@STY\d+@@)*)\s*(#{1,3})\s+(.+)$/);
    if (hMatch) {
      closeLists();
      const level = hMatch[2].length;
      const size = level === 1 ? "1.18em" : level === 2 ? "1.08em" : "1.02em";
      const border = level === 1 ? "border-bottom:1px solid #e5e7eb;padding-bottom:1px;" : "";
      out.push(`<div style="font-size:${size};font-weight:bold;margin:4px 0 2px;line-height:1.3;${border}">${hMatch[1]}${hMatch[3]}</div>`);
      continue;
    }
    if (/^---+$/.test(trimmed)) { closeLists(); out.push(`<hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0;" />`); continue; }
    const bqMatch = rawLine.match(/^((?:@@STY\d+@@)*)\s*>\s?(.*)$/);
    if (bqMatch) { closeLists(); out.push(`<div style="border-left:3px solid #cbd5e1;padding-left:7px;margin:2px 0;color:#555;">${bqMatch[1]}${bqMatch[2]}</div>`); continue; }
    const ulMatch = rawLine.match(/^((?:@@STY\d+@@)*)\s*[-*]\s+(.+)$/);
    if (ulMatch) {
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push(`<ul style="margin:2px 0;padding-left:18px;">`); inUl = true; }
      out.push(`<li style="margin:0;">${ulMatch[1]}${ulMatch[2]}</li>`);
      continue;
    }
    const olMatch = rawLine.match(/^((?:@@STY\d+@@)*)\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push(`<ol style="margin:2px 0;padding-left:20px;">`); inOl = true; }
      out.push(`<li style="margin:0;">${olMatch[1]}${olMatch[2]}</li>`);
      continue;
    }
    closeLists();
    out.push(trimmed === "" ? `<div style="height:4px;"></div>` : `<div style="margin:0;">${rawLine}</div>`);
  }
  closeLists();

  return out.join("")
    .replace(/@@INCODE(\d+)@@/g, (_, i) => inlineCodeTokens[Number(i)] || "")
    .replace(/@@MATHBLK(\d+)@@/g, (_, i) => mathTokens[Number(i)] || "")
    .replace(/@@MATH(\d+)@@/g, (_, i) => mathTokens[Number(i)] || "")
    .replace(/@@CODEBLK(\d+)@@/g, (_, i) => codeBlockTokens[Number(i)] || "")
    .replace(/@@STY(\d+)@@/g, (_, i) => styleTokens[Number(i)] || "");
};

const splitTextByHighlights = (text, paraHighlights) => {
  if (!paraHighlights || paraHighlights.length === 0) return [{ text, highlight: null }];
  let segments = [{ text, highlight: null }];
  for (const hl of paraHighlights) {
    if (!hl.text) continue;
    const next = [];
    for (const seg of segments) {
      if (seg.highlight) { next.push(seg); continue; }
      const pos = seg.text.indexOf(hl.text);
      if (pos === -1) {
        next.push(seg);
      } else {
        if (pos > 0) next.push({ text: seg.text.slice(0, pos), highlight: null });
        next.push({ text: hl.text, highlight: hl });
        if (pos + hl.text.length < seg.text.length) next.push({ text: seg.text.slice(pos + hl.text.length), highlight: null });
      }
    }
    segments = next;
  }
  return segments;
};

const extractReadingPagesFromPdf = async (pdfUrl, onProgress) => {
  const response = await fetch(pdfUrl);
  const pdf = await pdfjsLib.getDocument({ data: await response.arrayBuffer() }).promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (onProgress) onProgress(pageNum, pdf.numPages);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const paragraphs = [];
    let currentPara = "";
    let lastY = null;
    for (const item of textContent.items) {
      const str = item.str;
      if (!str) continue;
      const y = item.transform ? item.transform[5] : null;
      const fontHeight = item.height || (item.transform ? Math.abs(item.transform[0]) : 12) || 12;
      if (lastY !== null && y !== null) {
        const yDiff = Math.abs(lastY - y);
        if (yDiff > fontHeight * 1.65) {
          if (currentPara.trim()) paragraphs.push(currentPara.trim());
          currentPara = str;
        } else if (yDiff > fontHeight * 0.45) {
          currentPara = currentPara.endsWith("-") ? currentPara.slice(0, -1) + str.trimStart() : currentPara + " " + str;
        } else {
          currentPara += str;
        }
      } else {
        currentPara += str;
      }
      if (y !== null) lastY = y;
    }
    if (currentPara.trim()) paragraphs.push(currentPara.trim());
    pages.push({ pageNum, paragraphs });
  }
  return pages;
};

const buildReadingModeHtml = (title, pages, initialTheme = "light", initialFontSize = 17, highlights = []) => {
  const safeTitle = escapeHtml(title || "Reading Mode");
  const bodyHtml = pages.map((p) => {
    const parasHtml = p.paragraphs.map((para, idx) => {
      const pHls = highlights.filter(h => h.pageNum === p.pageNum && h.paraIdx === idx);
      const inner = splitTextByHighlights(para, pHls).map(s =>
        s.highlight ? `<mark style="background:${s.highlight.color};color:#1f2328;padding:0 2px;border-radius:3px;">${escapeHtml(s.text)}</mark>` : escapeHtml(s.text)
      ).join("");
      return `<p>${inner}</p>`;
    }).join("\n");
    return `<section class="page-block"><div class="page-label">Page ${p.pageNum}</div>${parasHtml}</section>`;
  }).join("\n");

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" /><title>📖 ${safeTitle}</title><style>:root{--bg:#fff;--text:#1f2328;--sub:#656d76;--bar:rgba(248,249,250,.94);--bd:#e1e4e8;--btn:#fff}body[data-theme="sepia"]{--bg:#f6efe2;--text:#3b2f23;--sub:#7a6855;--bar:rgba(239,229,211,.95);--bd:#dfd1b8;--btn:#fbf6ec}body[data-theme="dark"]{--bg:#16181c;--text:#e6e8eb;--sub:#9aa0a6;--bar:rgba(28,31,38,.95);--bd:#2f343d;--btn:#242830}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Georgia,"Hiragino Mincho ProN","Yu Mincho",serif;transition:background .2s,color .2s;text-align:left}.toolbar{position:sticky;top:0;z-index:100;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:10px 16px;padding-top:max(10px,env(safe-area-inset-top));background:var(--bar);backdrop-filter:blur(8px);border-bottom:1px solid var(--bd);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.toolbar-title{font-size:13px;font-weight:700;max-width:48vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap}button{background:var(--btn);color:var(--text);border:1px solid var(--bd);border-radius:6px;padding:6px 10px;font-size:13px;cursor:pointer}main{max-width:740px;margin:0 auto;padding:28px 20px 80px;font-size:${initialFontSize}px;line-height:1.85}h1{font-size:1.55em;line-height:1.35;margin:0 0 28px;padding-bottom:16px;border-bottom:1px solid var(--bd)}.page-block{margin-bottom:32px}.page-label{font-family:sans-serif;font-size:12px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.08em;margin:24px 0 12px;padding-bottom:4px;border-bottom:1px dashed var(--bd)}p{margin:0 0 1.05em;word-break:break-word}</style></head><body data-theme="${initialTheme}"><header class="toolbar"><div class="toolbar-title">📖 ${safeTitle}</div><div class="controls"><button onclick="changeSize(-2)">A-</button><button onclick="changeSize(2)">A+</button><button onclick="setTheme('light')">☀️</button><button onclick="setTheme('sepia')">📜</button><button onclick="setTheme('dark')">🌙</button></div></header><main id="article"><h1>${safeTitle}</h1>${bodyHtml}</main><script>let s=${initialFontSize};function changeSize(d){s=Math.min(28,Math.max(13,s+d));document.getElementById('article').style.fontSize=s+'px'}function setTheme(t){document.body.setAttribute('data-theme',t)}</script></body></html>`;
};

const openPdfDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open("PaperManagerPDFs", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("pdfs");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const savePdfLocally = async (paperId, file) => {
  const idb = await openPdfDB();
  return new Promise((res, rej) => {
    const tx = idb.transaction("pdfs", "readwrite");
    tx.objectStore("pdfs").put(file, paperId);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
};
const getPdfLocally = async (paperId) => {
  const idb = await openPdfDB();
  return new Promise((res, rej) => {
    const tx = idb.transaction("pdfs", "readonly");
    const req = tx.objectStore("pdfs").get(paperId);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};
const deletePdfLocally = async (paperId) => {
  const idb = await openPdfDB();
  idb.transaction("pdfs", "readwrite").objectStore("pdfs").delete(paperId);
};

const generateWithFallback = async (prompt, mode = "flash") => {
  const modelsToTry = mode === "pro"
    ? ["gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.5-flash-lite"]
    : ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
  let lastError = null;
  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      lastError = error;
      const msg = error.message || "";
      if (msg.includes("503") || msg.includes("429") || msg.includes("404") || msg.includes("high demand")) continue;
      throw error;
    }
  }
  throw lastError;
};

const reorderList = (currentIds, savedOrder, draggedId, targetId, pos) => {
  const merged = [...savedOrder.filter(id => currentIds.includes(id)), ...currentIds.filter(id => !savedOrder.includes(id))];
  const without = merged.filter(id => id !== draggedId);
  const idx = without.indexOf(targetId);
  if (idx === -1) return [...without, draggedId];
  without.splice(pos === "after" ? idx + 1 : idx, 0, draggedId);
  return without;
};

function PdfCanvasViewer({ pdfUrl }) {
  const containerRef = useRef(null);
  const [rendering, setRendering] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    const renderAllPages = async () => {
      if (!pdfUrl || !containerRef.current) return;
      setRendering(true);
      setErrorMsg("");
      containerRef.current.innerHTML = "";
      try {
        const res = await fetch(pdfUrl);
        const pdf = await pdfjsLib.getDocument({ data: await res.arrayBuffer() }).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const containerWidth = Math.max((containerRef.current.clientWidth || window.innerWidth) - 24, 280);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const scale = containerWidth / page.getViewport({ scale: 1 }).width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.cssText = `width:${Math.floor(viewport.width)}px;height:${Math.floor(viewport.height)}px;display:block;margin:0 auto 12px;box-shadow:0 2px 6px rgba(0,0,0,.12);background:#fff;`;
          ctx.scale(dpr, dpr);
          containerRef.current.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
      } catch (err) {
        if (!cancelled) setErrorMsg("PDFの描画に失敗しました。");
      } finally {
        if (!cancelled) setRendering(false);
      }
    };
    renderAllPages();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#e9ecef' }}>
      {rendering && (
        <div style={{ padding: '6px 12px', backgroundColor: '#fff3cd', color: '#856404', fontSize: '12px', textAlign: 'center', flexShrink: 0 }}>
          ⏳ PDFを読み込み中... {pageCount > 0 ? `(全 ${pageCount} ページ)` : ""}
        </div>
      )}
      <div ref={containerRef} style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px', boxSizing: 'border-box' }} />
      {errorMsg && <div style={{ padding: '16px', textAlign: 'center', color: '#d9534f', fontSize: '13px' }}>{errorMsg}</div>}
    </div>
  );
}

function App() {
  const isIOS = detectIOS();
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [mobileTab, setMobileTab] = useState(() => loadStorage("pm_mobileTab", "pdf"));
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [isPersonalMode, setIsPersonalMode] = useState(() => localStorage.getItem("paperManagerUnlocked") === "true");
  const [papers, setPapers] = useState([]);
  const [selectedPaper, setSelectedPaper] = useState(null);
  const [chatHistoryMap, setChatHistoryMap] = useState(() => loadStorage("pm_chats", {}));
  const [chat, setChat] = useState([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  const [memoText, setMemoText] = useState("");
  const [memoStatus, setMemoStatus] = useState("");
  const [isMemoPreview, setIsMemoPreview] = useState(false);
  const [activeMemoColor, setActiveMemoColor] = useState("#1f2328");
  const [isMdMenuOpen, setIsMdMenuOpen] = useState(false);
  const isEditingMemoRef = useRef(false);
  const memoEditorRef = useRef(null);
  const memoHistoryRef = useRef({ stack: [], index: -1 });

  const pushMemoHistory = (html) => {
    const h = memoHistoryRef.current;
    if (h.stack[h.index] === html) return;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(html);
    if (h.stack.length > 50) h.stack.shift();
    h.index = h.stack.length - 1;
  };

  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAbstract, setNewAbstract] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [pendingPdfFile, setPendingPdfFile] = useState(null);

  const [aiLanguage, setAiLanguage] = useState(() => loadStorage("pm_aiLanguage", "Japanese"));
  const [currentPdfUrl, setCurrentPdfUrl] = useState(null);
  const [savedPdfIds, setSavedPdfIds] = useState({});

  const [isReadingMode, setIsReadingMode] = useState(false);
  const [readingPages, setReadingPages] = useState(null);
  const [readingLoading, setReadingLoading] = useState(false);
  const [readingProgress, setReadingProgress] = useState("");
  const [readingTheme, setReadingTheme] = useState(() => loadStorage("pm_readingTheme", "light"));
  const [readingFontSize, setReadingFontSize] = useState(() => loadStorage("pm_readingFontSize", 16));
  const [highlights, setHighlights] = useState([]);
  const lastSelectionRef = useRef(null);
  const [translationBox, setTranslationBox] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const [sidebarWidth, setSidebarWidth] = useState(() => loadStorage("pm_sidebarWidth", 280));
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() => loadStorage("pm_leftWidth", 50));
  const [isDragging, setIsDragging] = useState(false);
  const [aiHeightPercent, setAiHeightPercent] = useState(() => loadStorage("pm_aiHeightPercent", 50));
  const [isDraggingVertical, setIsDraggingVertical] = useState(false);
  const rightPaneRef = useRef(null);
  const chatEndRef = useRef(null);

  const [activeFolder, setActiveFolder] = useState(() => loadStorage("pm_activeFolder", ""));
  const [customFolders, setCustomFolders] = useState(() => loadStorage("pm_customFolders", []));
  const [expandedFolders, setExpandedFolders] = useState(() => loadStorage("pm_expandedFolders", {}));
  const [folderOrder, setFolderOrder] = useState(() => loadStorage("pm_folderOrder", []));
  const [paperOrder, setPaperOrder] = useState(() => loadStorage("pm_paperOrder", []));
  const [openMenuId, setOpenMenuId] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverInfo, setDragOverInfo] = useState(null);
  const [isFileDragging, setIsFileDragging] = useState(false);

  const hasRestoredForMode = useRef(null);
  const isSidebarOpen = sidebarWidth > 0;
  const selectedPaperId = selectedPaper?.id || null;

  useEffect(() => { memoHistoryRef.current = { stack: [], index: -1 }; }, [selectedPaperId]);

  useEffect(() => {
    if (!isMemoPreview && memoEditorRef.current) {
      const targetHtml = memoToHtml(memoText);
      if (memoEditorRef.current.innerHTML !== targetHtml) memoEditorRef.current.innerHTML = targetHtml;
    }
  }, [selectedPaperId, isMemoPreview, mobileTab]);

  useEffect(() => {
    if (!isReadingMode) {
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
      setTranslationBox(null);
    }
  }, [isReadingMode]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, loading, mobileTab]);

  useEffect(() => { setReadingPages(null); setIsReadingMode(false); setReadingProgress(""); }, [currentPdfUrl]);

  useEffect(() => {
    if (!isPersonalMode || !selectedPaperId) return;
    const unsub = onSnapshot(doc(db, "papers", selectedPaperId), (snap) => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      const data = { id: snap.id, ...snap.data() };
      setSelectedPaper((prev) => (prev && prev.id === data.id ? { ...prev, ...data } : prev));
      setPapers((prev) => prev.map((p) => (p.id === data.id ? { ...p, ...data } : p)));
      if (Array.isArray(data.chat)) {
        setChat((prev) => (JSON.stringify(prev) === JSON.stringify(data.chat) ? prev : data.chat));
        setChatHistoryMap((prev) => ({ ...prev, [data.id]: data.chat }));
      }
      if (Array.isArray(data.highlights)) {
        setHighlights((prev) => (JSON.stringify(prev) === JSON.stringify(data.highlights) ? prev : data.highlights));
      }
      if (!isEditingMemoRef.current) {
        const remoteMemo = data.memo || "";
        setMemoText((prev) => (prev === remoteMemo ? prev : remoteMemo));
        if (memoEditorRef.current && !isMemoPreview) {
          const remoteHtml = memoToHtml(remoteMemo);
          if (memoEditorRef.current.innerHTML !== remoteHtml) memoEditorRef.current.innerHTML = remoteHtml;
        }
      }
    }, (error) => console.error("Realtime sync error:", error));
    return () => unsub();
  }, [isPersonalMode, selectedPaperId, isMemoPreview]);

  useEffect(() => {
    if (!isReadingMode) return;
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text) return;
      const node = sel.anchorNode;
      const pEl = (node?.nodeType === 3 ? node.parentElement : node)?.closest?.('p[data-page]');
      if (pEl) lastSelectionRef.current = { pageNum: Number(pEl.dataset.page), paraIdx: Number(pEl.dataset.para), text };
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [isReadingMode]);

  useEffect(() => saveStorage("pm_aiLanguage", aiLanguage), [aiLanguage]);
  useEffect(() => saveStorage("pm_sidebarWidth", sidebarWidth), [sidebarWidth]);
  useEffect(() => saveStorage("pm_leftWidth", leftWidth), [leftWidth]);
  useEffect(() => saveStorage("pm_aiHeightPercent", aiHeightPercent), [aiHeightPercent]);
  useEffect(() => saveStorage("pm_activeFolder", activeFolder), [activeFolder]);
  useEffect(() => saveStorage("pm_customFolders", customFolders), [customFolders]);
  useEffect(() => saveStorage("pm_expandedFolders", expandedFolders), [expandedFolders]);
  useEffect(() => saveStorage("pm_folderOrder", folderOrder), [folderOrder]);
  useEffect(() => saveStorage("pm_paperOrder", paperOrder), [paperOrder]);
  useEffect(() => saveStorage("pm_mobileTab", mobileTab), [mobileTab]);
  useEffect(() => saveStorage("pm_chats", chatHistoryMap), [chatHistoryMap]);
  useEffect(() => saveStorage("pm_readingTheme", readingTheme), [readingTheme]);
  useEffect(() => saveStorage("pm_readingFontSize", readingFontSize), [readingFontSize]);

  const handleMemoKeyDown = (e) => {
    if (e.nativeEvent?.isComposing) return;
    const editor = memoEditorRef.current;
    if (!editor) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && !e.shiftKey && key === "z") {
      e.preventDefault();
      const h = memoHistoryRef.current;
      if (h.index > 0) { h.index -= 1; editor.innerHTML = h.stack[h.index]; setMemoText(h.stack[h.index]); }
      return;
    }
    if ((mod && key === "y") || (mod && e.shiftKey && key === "z")) {
      e.preventDefault();
      const h = memoHistoryRef.current;
      if (h.index < h.stack.length - 1) { h.index += 1; editor.innerHTML = h.stack[h.index]; setMemoText(h.stack[h.index]); }
      return;
    }
    if (mod && !e.shiftKey && !e.altKey) {
      if (key === "b") { e.preventDefault(); handleApplyRichCommand("bold"); return; }
      if (key === "i") { e.preventDefault(); handleApplyRichCommand("italic"); return; }
      if (key === "u") { e.preventDefault(); handleApplyRichCommand("underline"); return; }
    }
    if (e.altKey && e.shiftKey && (e.code === "Digit5" || key === "5" || key === "%")) {
      e.preventDefault(); handleApplyRichCommand("strikeThrough"); return;
    }
    if (mod && e.shiftKey && (e.code === "Digit8" || key === "8" || key === "*")) {
      e.preventDefault(); handleInsertPrefix("- "); return;
    }
  };

  const handleApplyMemoColor = (colorCode) => {
    setActiveMemoColor(colorCode);
    if (isMemoPreview) setIsMemoPreview(false);
    const editor = memoEditorRef.current;
    if (!editor) return;
    editor.focus();
    pushMemoHistory(editor.innerHTML);
    try { document.execCommand("styleWithCSS", false, true); document.execCommand("foreColor", false, colorCode); }
    catch { document.execCommand("foreColor", false, colorCode); }
    pushMemoHistory(editor.innerHTML);
    setMemoText(editor.innerHTML);
  };

  const handleApplyRichCommand = (command) => {
    setIsMdMenuOpen(false);
    if (isMemoPreview) setIsMemoPreview(false);
    const editor = memoEditorRef.current;
    if (!editor) return;
    editor.focus();
    pushMemoHistory(editor.innerHTML);
    try { document.execCommand("styleWithCSS", false, false); document.execCommand(command, false, null); }
    catch { document.execCommand(command, false, null); }
    pushMemoHistory(editor.innerHTML);
    setMemoText(editor.innerHTML);
  };

  const handleInsertPrefix = (prefix) => {
    setIsMdMenuOpen(false);
    if (isMemoPreview) setIsMemoPreview(false);
    const editor = memoEditorRef.current;
    if (!editor) return;
    editor.focus();
    pushMemoHistory(editor.innerHTML);
    const sel = window.getSelection();
    const selectedText = sel ? sel.toString() : "";
    if (selectedText) {
      const lines = selectedText.split(/\r?\n/);
      const nonEmpty = lines.filter((line) => line.trim() !== "");
      const allHave = nonEmpty.length > 0 && nonEmpty.every((line) => line.startsWith(prefix));
      const formatted = lines.map((line) => {
        if (line.trim() === "") return line;
        if (allHave) return line.slice(prefix.length);
        return line.startsWith(prefix) ? line : `${prefix}${line}`;
      }).join("\n");
      document.execCommand("insertText", false, formatted);
    } else {
      document.execCommand("insertText", false, prefix);
    }
    pushMemoHistory(editor.innerHTML);
    setMemoText(editor.innerHTML);
  };

  const handleInsertDelim = (delim = "$") => {
    setIsMdMenuOpen(false);
    if (isMemoPreview) setIsMemoPreview(false);
    const editor = memoEditorRef.current;
    if (!editor) return;
    editor.focus();
    pushMemoHistory(editor.innerHTML);
    const sel = window.getSelection();
    const selectedText = sel ? sel.toString() : "";
    if (selectedText) {
      document.execCommand("insertText", false, `${delim}${selectedText}${delim}`);
    } else {
      document.execCommand("insertText", false, `${delim}${delim}`);
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (range.startContainer.nodeType === 3 && range.startOffset >= delim.length) {
          const newPos = range.startOffset - delim.length;
          range.setStart(range.startContainer, newPos);
          range.setEnd(range.startContainer, newPos);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }
    pushMemoHistory(editor.innerHTML);
    setMemoText(editor.innerHTML);
  };

  const syncHighlights = async (paperId, nextHighlights) => {
    setHighlights(nextHighlights);
    if (!paperId) return;
    setPapers(prev => prev.map(p => (p.id === paperId ? { ...p, highlights: nextHighlights } : p)));
    setSelectedPaper(prev => (prev && prev.id === paperId ? { ...prev, highlights: nextHighlights } : prev));
    if (isPersonalMode) {
      try { await updateDoc(doc(db, "papers", paperId), { highlights: nextHighlights }); }
      catch (e) { console.error("Failed to sync highlights:", e); }
    }
  };

  const handleAddHighlight = async (colorCode) => {
    if (!selectedPaper) return;
    let target = null;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      const node = sel.anchorNode;
      const pEl = (node?.nodeType === 3 ? node.parentElement : node)?.closest?.('p[data-page]');
      if (pEl) target = { pageNum: Number(pEl.dataset.page), paraIdx: Number(pEl.dataset.para), text: sel.toString().trim() };
    }
    if (!target) target = lastSelectionRef.current;
    if (!target || !target.text) { alert("先にリーディングモード内の文章をなぞって選択してください。"); return; }
    const nextHighlights = [...highlights, { id: `hl-${Date.now()}`, ...target, color: colorCode }];
    lastSelectionRef.current = null;
    if (sel) sel.removeAllRanges();
    await syncHighlights(selectedPaper.id, nextHighlights);
  };

  const handleRemoveHighlight = async (hlId) => {
    if (!selectedPaper || !window.confirm("このマーカーを削除しますか？")) return;
    await syncHighlights(selectedPaper.id, highlights.filter(h => h.id !== hlId));
  };

  const handleTranslateSelection = async () => {
    const sel = window.getSelection();
    const text = (sel && !sel.isCollapsed ? sel.toString().trim() : "") || lastSelectionRef.current?.text || "";
    if (!text) { alert("先にリーディングモード内の文章をなぞって選択してください。"); return; }
    lastSelectionRef.current = null;
    if (sel) sel.removeAllRanges();
    setTranslationBox({ source: text, translated: "", loading: true });
    try {
      const prompt = `Translate the following excerpt from an academic paper into ${aiLanguage} naturally and accurately. Output only the translation.\n\n${text}`;
      const translated = await generateWithFallback(prompt);
      setTranslationBox({ source: text, translated: translated.trim(), loading: false });
    } catch {
      setTranslationBox({ source: text, translated: "翻訳に失敗しました。少し時間をおいて再度お試しください。", loading: false });
    }
  };

  const handleAskAiAboutTranslation = async () => {
    if (!selectedPaper || !translationBox || translationBox.loading) return;
    const nextChat = [
      ...chat,
      { role: 'user', text: `【翻訳した箇所】\n> ${translationBox.source}` },
      { role: 'ai', text: `**翻訳 (${aiLanguage})**\n${translationBox.translated}\n\nこの部分について気になる表現や内容があれば聞いてください！` }
    ];
    await updateChatForPaper(selectedPaper.id, nextChat);
    setTranslationBox(null);
    if (isMobile) { setMobileTab("ai"); }
    else {
      if (leftWidth >= 100) setLeftWidth(50);
      if (aiHeightPercent <= 0) setAiHeightPercent(50);
    }
  };

  const handleToggleSpeech = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert("このブラウザは音声読み上げに対応していません。");
      return;
    }
    if (isSpeaking) { window.speechSynthesis.cancel(); setIsSpeaking(false); return; }
    const sel = window.getSelection();
    const selectedText = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    const chunks = selectedText ? [selectedText] : (readingPages || []).flatMap((p) => p.paragraphs).filter(Boolean);
    if (chunks.length === 0) { alert("読み上げる文章がありません。"); return; }
    window.speechSynthesis.cancel();
    setIsSpeaking(true);
    chunks.forEach((chunk, idx) => {
      const utter = new SpeechSynthesisUtterance(chunk);
      utter.lang = /[ぁ-んァ-ヶ一-龠]/.test(chunk) ? "ja-JP" : "en-US";
      utter.rate = 1.0;
      if (idx === chunks.length - 1) utter.onend = () => setIsSpeaking(false);
      utter.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utter);
    });
  };

  const handleToggleReadingMode = async () => {
    if (isReadingMode) { setIsReadingMode(false); return; }
    setIsReadingMode(true);
    if (!currentPdfUrl || readingPages) return;
    setReadingLoading(true);
    setReadingProgress("PDFからテキストを抽出中...");
    try {
      const pages = await extractReadingPagesFromPdf(currentPdfUrl, (cur, total) => setReadingProgress(`ページを変換中 (${cur} / ${total})...`));
      setReadingPages(pages);
    } catch (err) {
      alert("リーディングモードへの変換に失敗しました: " + err.message);
      setIsReadingMode(false);
    } finally {
      setReadingLoading(false);
      setReadingProgress("");
    }
  };

  const handleOpenReadingNewTab = async () => {
    const title = selectedPaper?.title || "Reading Mode";
    const newWin = window.open("", "_blank");
    if (!newWin) { alert("ポップアップがブロックされました。"); return; }
    newWin.document.open();
    newWin.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>読み込み中...</title></head><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#555;"><div>⏳ リーディングモードを準備しています...</div></body></html>`);
    newWin.document.close();
    try {
      let pagesToShow = readingPages;
      if (!pagesToShow && currentPdfUrl) {
        pagesToShow = await extractReadingPagesFromPdf(currentPdfUrl);
        setReadingPages(pagesToShow);
      } else if (!pagesToShow && selectedPaper?.abstract) {
        const plainMemo = memoText.replace(/<[^>]+>/g, " ").trim();
        pagesToShow = [{ pageNum: 1, paragraphs: [...(selectedPaper.abstract || "").split("\n").filter(Boolean), ...(plainMemo ? ["--- Notes ---", plainMemo] : [])] }];
      }
      if (!pagesToShow || pagesToShow.length === 0) { newWin.close(); alert("表示できるPDFまたはテキストがありません。"); return; }
      newWin.document.open();
      newWin.document.write(buildReadingModeHtml(title, pagesToShow, readingTheme, readingFontSize, highlights));
      newWin.document.close();
    } catch (err) { newWin.close(); alert("別タブ生成に失敗しました: " + err.message); }
  };

  const updateChatForPaper = async (paperId, newChatArray) => {
    setChat(newChatArray);
    if (!paperId) return;
    setChatHistoryMap(prev => ({ ...prev, [paperId]: newChatArray }));
    setPapers(prev => prev.map(p => (p.id === paperId ? { ...p, chat: newChatArray } : p)));
    setSelectedPaper(prev => (prev && prev.id === paperId ? { ...prev, chat: newChatArray } : prev));
    if (isPersonalMode) {
      try { await updateDoc(doc(db, "papers", paperId), { chat: newChatArray }); }
      catch (error) { console.error("Failed to sync chat:", error); }
    }
  };

  const handleToggleMode = () => {
    if (isPersonalMode) {
      if (window.confirm("デモモード（面接官・閲覧者向け表示）に戻しますか？")) {
        localStorage.removeItem("paperManagerUnlocked");
        hasRestoredForMode.current = null;
        setIsPersonalMode(false); setSelectedPaper(null); setIsAdding(false);
      }
    } else {
      const input = window.prompt("自分専用モードの合言葉を入力してください：");
      if (input === SECRET_PASSCODE) {
        localStorage.setItem("paperManagerUnlocked", "true");
        hasRestoredForMode.current = null;
        setIsPersonalMode(true); setSelectedPaper(null); setIsAdding(false);
      } else if (input !== null) alert("合言葉が違います。");
    }
  };

  const handlePointerMove = (clientX, clientY) => {
    if (isDraggingSidebar) setSidebarWidth(clientX < 80 ? 0 : Math.min(Math.max(clientX, 160), 520));
    if (isDragging) {
      const leftAreaWidth = isSidebarOpen ? sidebarWidth + 6 : 40;
      const availableWidth = window.innerWidth - leftAreaWidth - 6;
      if (availableWidth > 0) {
        const raw = ((clientX - leftAreaWidth) / availableWidth) * 100;
        setLeftWidth(raw >= 95 ? 100 : raw >= 20 ? raw : 20);
      }
    }
    if (isDraggingVertical && rightPaneRef.current) {
      const rect = rightPaneRef.current.getBoundingClientRect();
      const availableHeight = rect.height - 6;
      if (availableHeight > 0) {
        const raw = ((clientY - rect.top) / availableHeight) * 100;
        setAiHeightPercent(raw <= 5 ? 0 : raw >= 95 ? 100 : raw);
      }
    }
  };

  const handlePointerUp = () => {
    if (isDraggingSidebar) setIsDraggingSidebar(false);
    if (isDragging) setIsDragging(false);
    if (isDraggingVertical) setIsDraggingVertical(false);
  };

  const checkSavedPdfs = async (papersList) => {
    const statusMap = {};
    for (const p of papersList) {
      try { if (await getPdfLocally(p.id)) statusMap[p.id] = true; } catch {}
    }
    setSavedPdfIds(statusMap);
  };

  const fetchPapers = async () => {
    if (!isPersonalMode) { setPapers(DEMO_PAPERS); setSavedPdfIds({}); return DEMO_PAPERS; }
    try {
      const snap = await getDocs(collection(db, "papers"));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setPapers(data);
      await checkSavedPdfs(data);
      return data;
    } catch (error) { console.error("Failed to fetch data", error); return []; }
  };

  useEffect(() => {
    const init = async () => {
      const loadedPapers = await fetchPapers();
      const modeKey = isPersonalMode ? "personal" : "demo";
      if (hasRestoredForMode.current !== modeKey) {
        hasRestoredForMode.current = modeKey;
        const lastId = loadStorage(`pm_lastPaperId_${modeKey}`, null);
        if (lastId) {
          const target = loadedPapers.find(p => p.id === lastId);
          if (target) handleSelectPaper(target, { isRestoring: true });
        }
      }
    };
    init();
  }, [isPersonalMode]);

  useEffect(() => {
    const closeMenus = () => { setOpenMenuId(null); setIsMdMenuOpen(false); };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  const handleSaveMemo = async (paperId, textToSave) => {
    if (!paperId) return;
    if (!isPersonalMode) {
      setPapers(prev => prev.map(p => (p.id === paperId ? { ...p, memo: textToSave } : p)));
      setSelectedPaper(prev => (prev && prev.id === paperId ? { ...prev, memo: textToSave } : prev));
      isEditingMemoRef.current = false;
      setMemoStatus("✓");
      return;
    }
    setMemoStatus("...");
    try {
      await updateDoc(doc(db, "papers", paperId), { memo: textToSave });
      setPapers(prev => prev.map(p => (p.id === paperId ? { ...p, memo: textToSave } : p)));
      setSelectedPaper(prev => (prev && prev.id === paperId ? { ...prev, memo: textToSave } : prev));
      isEditingMemoRef.current = false;
      setMemoStatus("✓");
    } catch { setMemoStatus("!"); }
  };

  useEffect(() => {
    if (!selectedPaper) return;
    if (memoText === (selectedPaper.memo || "")) { isEditingMemoRef.current = false; return; }
    isEditingMemoRef.current = true;
    setMemoStatus("…");
    const timer = setTimeout(() => handleSaveMemo(selectedPaper.id, memoText), 1200);
    return () => clearTimeout(timer);
  }, [memoText, selectedPaper]);

  const getAllFolderPaths = () => {
    const rawSet = new Set([...customFolders, ...papers.map(p => p.folder || "Uncategorized")]);
    const fullSet = new Set();
    rawSet.forEach(path => {
      if (!path || path === "All") return;
      let cur = "";
      path.split('/').forEach((part, idx) => {
        cur = idx === 0 ? part : `${cur}/${part}`;
        fullSet.add(cur);
      });
    });
    return Array.from(fullSet).sort((a, b) => (a === "Uncategorized" ? 1 : b === "Uncategorized" ? -1 : a.localeCompare(b)));
  };
  const allFolderPaths = getAllFolderPaths();

  const handleDropOnPaper = async (targetPaper, pos) => {
    setDragOverInfo(null);
    if (!draggedItem || draggedItem.type !== 'paper' || draggedItem.id === targetPaper.id) {
      setDraggedItem(null);
      return;
    }
    const targetFolder = targetPaper.folder || "Uncategorized";
    const allPaperIds = papers.map(p => p.id);
    setPaperOrder(prev => reorderList(allPaperIds, prev, draggedItem.id, targetPaper.id, pos));

    if (draggedItem.currentFolder !== targetFolder) {
      if (!isPersonalMode) {
        setPapers(prev => prev.map(p => (p.id === draggedItem.id ? { ...p, folder: targetFolder } : p)));
      } else {
        try {
          await updateDoc(doc(db, "papers", draggedItem.id), { folder: targetFolder });
          await fetchPapers();
        } catch (e) { alert("移動に失敗しました: " + e.message); }
      }
    }
    setDraggedItem(null);
  };

  const handleDropOnFolder = async (targetPath, pos = "inside") => {
    setDragOverInfo(null);
    if (!draggedItem) return;
    if (draggedItem.type === 'paper') {
      const dest = targetPath === "ROOT" ? "Uncategorized" : targetPath;
      if (draggedItem.currentFolder === dest) { setDraggedItem(null); return; }
      if (!isPersonalMode) {
        setPapers(prev => prev.map(p => (p.id === draggedItem.id ? { ...p, folder: dest } : p)));
        setExpandedFolders(prev => ({ ...prev, [dest]: true }));
        setDraggedItem(null);
        return;
      }
      try {
        await updateDoc(doc(db, "papers", draggedItem.id), { folder: dest });
        setExpandedFolders(prev => ({ ...prev, [dest]: true }));
        await fetchPapers();
      } catch (e) { alert("移動に失敗しました: " + e.message); }
      setDraggedItem(null);
      return;
    }

    if (draggedItem.type === 'folder') {
      const src = draggedItem.path;
      setDraggedItem(null);
      if (src === "Uncategorized" || src === targetPath) return;

      if ((pos === "before" || pos === "after") && targetPath !== "ROOT") {
        const srcParent = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : "";
        const tgtParent = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : "";
        if (srcParent === tgtParent) {
          setFolderOrder(prev => reorderList(allFolderPaths, prev, src, targetPath, pos));
          return;
        }
      }

      if (targetPath !== "ROOT" && targetPath.startsWith(src + '/')) return;
      const leaf = src.split('/').pop();
      const newPath = targetPath === "ROOT" ? leaf : `${targetPath}/${leaf}`;
      if (newPath === src) return;

      const updateFolderState = () => {
        setCustomFolders(prev => {
          const next = prev.map(f => (f === src ? newPath : f.startsWith(src + '/') ? newPath + f.slice(src.length) : f));
          return Array.from(new Set([...next, newPath]));
        });
        if (targetPath !== "ROOT") setExpandedFolders(prev => ({ ...prev, [targetPath]: true }));
      };

      if (!isPersonalMode) {
        setPapers(prev => prev.map(p => (p.folder === src ? { ...p, folder: newPath } : (p.folder || "").startsWith(src + '/') ? { ...p, folder: newPath + p.folder.slice(src.length) } : p)));
        updateFolderState();
        return;
      }
      setLoading(true);
      setLoadingMessage("Moving folder...");
      try {
        const targets = papers.filter(p => p.folder === src || (p.folder || "").startsWith(src + '/'));
        for (const p of targets) {
          await updateDoc(doc(db, "papers", p.id), { folder: p.folder === src ? newPath : newPath + p.folder.slice(src.length) });
        }
        updateFolderState();
        await fetchPapers();
      } catch (e) { alert("フォルダの移動に失敗しました: " + e.message); }
      setLoading(false);
    }
  };

  const handleCreateRootFolder = () => {
    const name = window.prompt("新しいフォルダ（タブ）の名前を入力してください：\n（例: Labor Economics）");
    if (!name || !name.trim()) return;
    const clean = name.trim().replace(/\//g, '-');
    setCustomFolders(prev => Array.from(new Set([...prev, clean])));
    setExpandedFolders(prev => ({ ...prev, [clean]: true }));
    setActiveFolder(clean);
  };

  const handleCreateSubFolder = (parentPath) => {
    const sub = window.prompt(`「${parentPath}」の中に作るサブフォルダ名を入力してください：`);
    if (!sub || !sub.trim()) return;
    const full = `${parentPath}/${sub.trim().replace(/\//g, '-')}`;
    setCustomFolders(prev => Array.from(new Set([...prev, full])));
    setExpandedFolders(prev => ({ ...prev, [parentPath]: true, [full]: true }));
    setActiveFolder(full);
  };

  const handleRenameFolder = async (oldPath) => {
    const parts = oldPath.split('/');
    const oldLeaf = parts[parts.length - 1];
    const newLeaf = window.prompt("新しいフォルダ名を入力してください：", oldLeaf);
    if (!newLeaf || !newLeaf.trim() || newLeaf.trim() === oldLeaf) return;
    parts[parts.length - 1] = newLeaf.trim().replace(/\//g, '-');
    const newPath = parts.join('/');

    if (!isPersonalMode) {
      setPapers(prev => prev.map(p => (p.folder === oldPath ? { ...p, folder: newPath } : (p.folder || "").startsWith(oldPath + '/') ? { ...p, folder: newPath + p.folder.slice(oldPath.length) } : p)));
      setCustomFolders(prev => prev.map(f => (f === oldPath ? newPath : f.startsWith(oldPath + '/') ? newPath + f.slice(oldPath.length) : f)));
      return;
    }
    setLoading(true);
    setLoadingMessage("Renaming folder...");
    try {
      const targets = papers.filter(p => p.folder === oldPath || (p.folder || "").startsWith(oldPath + '/'));
      for (const p of targets) await updateDoc(doc(db, "papers", p.id), { folder: p.folder === oldPath ? newPath : newPath + p.folder.slice(oldPath.length) });
      setCustomFolders(prev => prev.map(f => (f === oldPath ? newPath : f.startsWith(oldPath + '/') ? newPath + f.slice(oldPath.length) : f)));
      await fetchPapers();
    } catch (e) { alert("名前の変更に失敗しました: " + e.message); }
    setLoading(false);
  };

  const handleDeleteFolder = async (targetPath) => {
    if (!window.confirm(`フォルダ「${targetPath}」を削除しますか？\n（※中の論文は消えず「Uncategorized」に移動します）`)) return;
    if (!isPersonalMode) {
      setPapers(prev => prev.map(p => (p.folder === targetPath || (p.folder || "").startsWith(targetPath + '/') ? { ...p, folder: "Uncategorized" } : p)));
      setCustomFolders(prev => prev.filter(f => f !== targetPath && !f.startsWith(targetPath + '/')));
      return;
    }
    setLoading(true);
    setLoadingMessage("Deleting folder...");
    try {
      const targets = papers.filter(p => p.folder === targetPath || (p.folder || "").startsWith(targetPath + '/'));
      for (const p of targets) await updateDoc(doc(db, "papers", p.id), { folder: "Uncategorized" });
      setCustomFolders(prev => prev.filter(f => f !== targetPath && !f.startsWith(targetPath + '/')));
      await fetchPapers();
    } catch (e) { alert("削除に失敗しました: " + e.message); }
    setLoading(false);
  };

  const handleRenamePaper = async (paper) => {
    const t = window.prompt("新しい論文タイトルを入力してください：", paper.title);
    if (!t || !t.trim() || t.trim() === paper.title) return;
    if (!isPersonalMode) {
      setPapers(prev => prev.map(p => (p.id === paper.id ? { ...p, title: t.trim() } : p)));
      if (selectedPaper?.id === paper.id) setSelectedPaper({ ...selectedPaper, title: t.trim() });
      return;
    }
    try {
      await updateDoc(doc(db, "papers", paper.id), { title: t.trim() });
      if (selectedPaper?.id === paper.id) setSelectedPaper({ ...selectedPaper, title: t.trim() });
      await fetchPapers();
    } catch (e) { alert("タイトルの変更に失敗しました: " + e.message); }
  };

  const handleMovePaper = async (paper) => {
    const dest = window.prompt("移動先のフォルダ名を入力してください：\n（サブフォルダは / で区切ります）", paper.folder || "Uncategorized");
    if (!dest || !dest.trim()) return;
    if (!isPersonalMode) {
      setPapers(prev => prev.map(p => (p.id === paper.id ? { ...p, folder: dest.trim() } : p)));
      setExpandedFolders(prev => ({ ...prev, [dest.trim()]: true }));
      return;
    }
    try {
      await updateDoc(doc(db, "papers", paper.id), { folder: dest.trim() });
      setExpandedFolders(prev => ({ ...prev, [dest.trim()]: true }));
      await fetchPapers();
    } catch (e) { alert("移動に失敗しました: " + e.message); }
  };

  const handleDeletePaper = async (paper) => {
    if (!window.confirm(`論文「${paper.title}」を完全に削除しますか？`)) return;
    const modeKey = isPersonalMode ? "personal" : "demo";
    if (!isPersonalMode) {
      setPapers(prev => prev.filter(p => p.id !== paper.id));
      if (selectedPaper?.id === paper.id) { setSelectedPaper(null); saveStorage(`pm_lastPaperId_${modeKey}`, null); }
      return;
    }
    try {
      await deleteDoc(doc(db, "papers", paper.id));
      await deletePdfLocally(paper.id);
      if (selectedPaper?.id === paper.id) { setSelectedPaper(null); saveStorage(`pm_lastPaperId_${modeKey}`, null); }
      setChatHistoryMap(prev => { const n = { ...prev }; delete n[paper.id]; return n; });
      await fetchPapers();
    } catch (e) { alert("削除に失敗しました: " + e.message); }
  };

  const runInitialSummary = async (paper) => {
    if (!paper.abstract || !paper.abstract.trim()) {
      await updateChatForPaper(paper.id, [{ role: 'ai', text: "（要約用テキストが未登録です。下のメモ欄に自由にノートを記入できます）" }]);
      return;
    }
    setLoading(true);
    setLoadingMessage("Gemini is summarizing the paper...");
    try {
      const prompt = `Please summarize the following paper in about 3 sentences. Write the summary entirely in ${aiLanguage}. Use clean Markdown formatting (bold, bullets if helpful) and LaTeX wrapped in $$...$$ or $...$ for equations.\nTitle: ${paper.title}\nContent: ${paper.abstract}`;
      const responseText = await generateWithFallback(prompt);
      await updateChatForPaper(paper.id, [{ role: 'ai', text: responseText }]);
    } catch { await updateChatForPaper(paper.id, [{ role: 'ai', text: "Failed to call Gemini API." }]); }
    setLoading(false);
  };

  const handleSelectPaper = async (paper, options = {}) => {
    const modeKey = isPersonalMode ? "personal" : "demo";
    saveStorage(`pm_lastPaperId_${modeKey}`, paper.id);
    isEditingMemoRef.current = false;
    setIsAdding(false); setIsMobileMenuOpen(false); setSelectedPaper(paper);
    setActiveFolder(paper.folder || ""); setCurrentPdfUrl(null);
    setMemoText(paper.memo || ""); setMemoStatus(""); setHighlights(paper.highlights || []);
    let latestPaper = paper;

    if (isPersonalMode) {
      try {
        const snap = await getDoc(doc(db, "papers", paper.id));
        if (snap.exists()) {
          latestPaper = { id: snap.id, ...snap.data() };
          setSelectedPaper(latestPaper); setMemoText(latestPaper.memo || ""); setHighlights(latestPaper.highlights || []);
          setPapers(prev => prev.map(p => (p.id === latestPaper.id ? latestPaper : p)));
        }
      } catch (e) { console.error("Failed to fetch latest paper:", e); }
      try {
        const savedFile = await getPdfLocally(paper.id);
        if (savedFile) setCurrentPdfUrl(URL.createObjectURL(savedFile));
      } catch {}
    }

    if (latestPaper.chat && latestPaper.chat.length > 0 && !options.forceRefresh) {
      setChat(latestPaper.chat);
      setChatHistoryMap(prev => ({ ...prev, [latestPaper.id]: latestPaper.chat }));
      return;
    }
    const localChat = loadStorage("pm_chats", {})[latestPaper.id];
    if (localChat && localChat.length > 0 && !options.forceRefresh) { await updateChatForPaper(latestPaper.id, localChat); return; }
    setChat([]);
    await runInitialSummary(latestPaper);
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !selectedPaper) return;
    const question = inputText;
    const newChat = [...chat, { role: 'user', text: question }];
    await updateChatForPaper(selectedPaper.id, newChat);
    setInputText(""); setLoading(true); setLoadingMessage("Gemini is generating an answer...");
    try {
      const plainMemo = memoText.replace(/<[^>]+>/g, " ").trim();
      const contextText = selectedPaper.abstract || plainMemo || "No abstract provided.";
      const recentHistory = chat.slice(-4).map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`).join("\n");
      const prompt = `This is a question regarding the paper "${selectedPaper.title}". Please answer based on the following content and recent conversation. Write your answer entirely in ${aiLanguage}. Use Markdown for clear structure and LaTeX syntax wrapped in $$...$$ for display equations and $...$ for inline variables/equations.\nContent: ${contextText}\n\nRecent Conversation:\n${recentHistory}\n\nQuestion: ${question}`;
      const responseText = await generateWithFallback(prompt, "pro");
      await updateChatForPaper(selectedPaper.id, [...newChat, { role: 'ai', text: responseText }]);
    } catch { await updateChatForPaper(selectedPaper.id, [...newChat, { role: 'ai', text: "An error occurred." }]); }
    setLoading(false);
  };

  const processPdfFile = async (file) => {
    if (!file) return;
    setLoading(true); setLoadingMessage("Extracting text from PDF...");
    setPendingPdfFile(file); setCurrentPdfUrl(URL.createObjectURL(file));
    try {
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      let extractedText = "";
      for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        extractedText += `\n--- Page ${i} ---\n` + tc.items.map(item => item.str).join(" ");
      }
      setLoadingMessage("Gemini is summarizing...");
      const prompt = `Read the following extracted text from an academic paper and extract the exact "Title" and a structured "Abstract".
Adapt the structure based on the paper's field and methodology. Output everything entirely in ${aiLanguage}.
CRITICAL INSTRUCTION: Be highly concise. Write a maximum of 1 to 2 short sentences per bullet point.

Format:
Title: [Title here]
Abstract:
(If Empirical Analysis / Econometrics)
- Research Question:
- Data Used:
- Main Variables (Dependent & Explanatory):
- Methodology (e.g., FEs, IV):
- Key Identification Assumption:
- Conclusion:
- General Summary:

(If Historical, Qualitative, or Theoretical)
- Core Theme / Research Question:
- Background / Context:
- Analytical Framework / Approach:
- Main Arguments / Findings:
- Conclusion:
- General Summary:

Paper Text:
${extractedText}`;
      const text = await generateWithFallback(prompt);
      setNewTitle(file.name.replace(/\.pdf$/i, ''));
      setNewAbstract(`[Extracted by Gemini]\n\n${text}`);
    } catch (error) { alert("Failed to read PDF: " + error.message); }
    finally { setLoading(false); }
  };

  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await processPdfFile(file);
    e.target.value = '';
  };

  const handleDropPdfFile = async (file, targetFolder = null) => {
    if (!file || (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf"))) {
      alert("PDFファイルをドロップしてください。");
      return;
    }
    const destFolder = targetFolder && targetFolder !== "ROOT" && targetFolder !== "Uncategorized"
      ? targetFolder
      : activeFolder && activeFolder !== "Uncategorized" ? activeFolder : "";
    setIsAdding(true); setIsMobileMenuOpen(false); setSelectedPaper(null);
    setNewTitle(""); setNewAbstract(""); setNewFolder(destFolder);
    await processPdfFile(file);
  };

  const handleViewerPdfLoad = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCurrentPdfUrl(URL.createObjectURL(file));
    if (selectedPaper && isPersonalMode) {
      try { await savePdfLocally(selectedPaper.id, file); setSavedPdfIds(prev => ({ ...prev, [selectedPaper.id]: true })); } catch {}
    }
  };

  const handleAddPaper = async () => {
    if (!newTitle.trim()) return;
    const folderName = newFolder.trim() || "Uncategorized";
    if (!isPersonalMode) {
      setPapers(prev => [...prev, { id: `demo-${Date.now()}`, title: newTitle, abstract: newAbstract, memo: "", folder: folderName, highlights: [] }]);
      setNewTitle(""); setNewAbstract(""); setNewFolder(""); setPendingPdfFile(null); setIsAdding(false);
      setExpandedFolders(prev => ({ ...prev, [folderName]: true }));
      return;
    }
    setLoading(true); setLoadingMessage("Saving to database...");
    try {
      const docRef = await addDoc(collection(db, "papers"), { title: newTitle, abstract: newAbstract, memo: "", folder: folderName, highlights: [], createdAt: new Date() });
      if (pendingPdfFile) await savePdfLocally(docRef.id, pendingPdfFile);
      setNewTitle(""); setNewAbstract(""); setNewFolder(""); setPendingPdfFile(null); setIsAdding(false);
      setExpandedFolders(prev => ({ ...prev, [folderName]: true }));
      await fetchPapers();
    } catch (e) { alert("Failed to save: " + e.message); }
    setLoading(false);
  };

  const renderTreeNodes = (parentPath = "", depth = 0) => {
    const childFolders = allFolderPaths
      .filter(path => (parentPath === "" ? !path.includes('/') : path.startsWith(parentPath + '/') && !path.slice(parentPath.length + 1).includes('/')))
      .sort((a, b) => {
        if (a === "Uncategorized") return 1;
        if (b === "Uncategorized") return -1;
        const ia = folderOrder.indexOf(a);
        const ib = folderOrder.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });

    const directPapers = (parentPath === "" ? [] : papers.filter(p => (p.folder || "Uncategorized") === parentPath))
      .slice()
      .sort((a, b) => {
        const ia = paperOrder.indexOf(a.id);
        const ib = paperOrder.indexOf(b.id);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return 0;
      });

    return (
      <>
        {directPapers.map(paper => {
          const paperMenuKey = `paper-${paper.id}`;
          const isSelected = selectedPaper?.id === paper.id;
          const isOverBefore = dragOverInfo?.type === 'paper' && dragOverInfo?.id === paper.id && dragOverInfo?.pos === 'before';
          const isOverAfter = dragOverInfo?.type === 'paper' && dragOverInfo?.id === paper.id && dragOverInfo?.pos === 'after';

          return (
            <div
              key={paper.id}
              draggable={!isMobile}
              onDragStart={(e) => { e.stopPropagation(); setDraggedItem({ type: 'paper', id: paper.id, currentFolder: paper.folder || "Uncategorized" }); }}
              onDragEnd={() => { setDraggedItem(null); setDragOverInfo(null); }}
              onDragOver={(e) => {
                if (draggedItem?.type !== 'paper' || draggedItem.id === paper.id) return;
                e.preventDefault(); e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
                setDragOverInfo({ type: 'paper', id: paper.id, pos });
              }}
              onDragLeave={() => { if (dragOverInfo?.type === 'paper' && dragOverInfo?.id === paper.id) setDragOverInfo(null); }}
              onDrop={(e) => {
                if (draggedItem?.type !== 'paper') return;
                e.preventDefault(); e.stopPropagation();
                const pos = dragOverInfo?.id === paper.id ? dragOverInfo.pos : 'after';
                handleDropOnPaper(paper, pos);
              }}
              onClick={() => handleSelectPaper(paper)}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: isMobile ? '10px 6px' : '6px', paddingLeft: `${12 + depth * 16}px`, borderRadius: '6px', cursor: 'pointer',
                fontSize: isMobile ? '14px' : '13px', backgroundColor: isSelected ? '#e8f0fe' : 'transparent',
                color: isSelected ? '#1a73e8' : '#333', fontWeight: isSelected ? 'bold' : 'normal', marginBottom: '2px',
                borderTop: isOverBefore ? '2px solid #1a73e8' : '2px solid transparent',
                borderBottom: isOverAfter ? '2px solid #1a73e8' : '2px solid transparent',
                opacity: draggedItem?.type === 'paper' && draggedItem?.id === paper.id ? 0.4 : 1
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', flex: 1 }}>
                <span style={{ fontSize: '12px', flexShrink: 0 }}>{savedPdfIds[paper.id] ? '📄' : '📝'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{paper.title}</span>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === paperMenuKey ? null : paperMenuKey); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', fontSize: '15px', color: '#666', flexShrink: 0 }}>⋮</button>
              {openMenuId === paperMenuKey && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: '8px', top: '30px', zIndex: 100, backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', width: '155px', overflow: 'hidden', fontWeight: 'normal' }}>
                  <div onClick={() => { setOpenMenuId(null); handleRenamePaper(paper); }} style={{ padding: '10px 12px', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid #eee', color: '#333' }}>✏️ Rename Paper</div>
                  <div onClick={() => { setOpenMenuId(null); handleMovePaper(paper); }} style={{ padding: '10px 12px', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid #eee', color: '#333' }}>📁 Move to Folder...</div>
                  <div onClick={() => { setOpenMenuId(null); handleDeletePaper(paper); }} style={{ padding: '10px 12px', fontSize: '13px', cursor: 'pointer', color: '#d9534f' }}>🗑️ Delete Paper</div>
                </div>
              )}
            </div>
          );
        })}

        {childFolders.map(folderPath => {
          const name = folderPath.split('/').pop();
          const isExpanded = expandedFolders[folderPath] !== false;
          const isOverThis = dragOverInfo?.type === 'folder' && dragOverInfo?.id === folderPath;
          const isOverInside = isOverThis && dragOverInfo.pos === 'inside';
          const isOverBefore = isOverThis && dragOverInfo.pos === 'before';
          const isOverAfter = isOverThis && dragOverInfo.pos === 'after';
          const menuKey = `folder-${folderPath}`;
          const totalCount = papers.filter(p => (p.folder || "Uncategorized") === folderPath || (p.folder || "").startsWith(folderPath + '/')).length;

          return (
            <div key={folderPath}>
              <div
                style={{ position: 'relative' }}
                draggable={!isMobile && folderPath !== "Uncategorized"}
                onDragStart={(e) => { e.stopPropagation(); setDraggedItem({ type: 'folder', path: folderPath }); }}
                onDragEnd={() => { setDraggedItem(null); setDragOverInfo(null); }}
                onDragOver={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  if (draggedItem?.type === 'folder' && draggedItem.path !== folderPath && folderPath !== "Uncategorized") {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = (e.clientY - rect.top) / rect.height;
                    const pos = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
                    setDragOverInfo({ type: 'folder', id: folderPath, pos });
                  } else {
                    setDragOverInfo({ type: 'folder', id: folderPath, pos: 'inside' });
                  }
                }}
                onDragLeave={() => { if (dragOverInfo?.type === 'folder' && dragOverInfo?.id === folderPath) setDragOverInfo(null); }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  setIsFileDragging(false);
                  const droppedFile = e.dataTransfer?.files?.[0];
                  if (droppedFile) { setDragOverInfo(null); handleDropPdfFile(droppedFile, folderPath); return; }
                  const pos = isOverThis ? dragOverInfo.pos : 'inside';
                  handleDropOnFolder(folderPath, pos);
                }}
              >
                <div
                  onClick={() => { setActiveFolder(folderPath); setExpandedFolders(prev => ({ ...prev, [folderPath]: !isExpanded })); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: isMobile ? '9px 6px' : '6px', paddingLeft: `${6 + depth * 16}px`, borderRadius: '6px', cursor: 'pointer',
                    fontSize: isMobile ? '14px' : '13px', fontWeight: 'bold',
                    backgroundColor: isOverInside ? '#d2e3fc' : 'transparent',
                    border: isOverInside ? '2px dashed #1a73e8' : '2px solid transparent',
                    borderTop: isOverBefore ? '2px solid #1a73e8' : (isOverInside ? '2px dashed #1a73e8' : '2px solid transparent'),
                    borderBottom: isOverAfter ? '2px solid #1a73e8' : (isOverInside ? '2px dashed #1a73e8' : '2px solid transparent'),
                    color: '#222', marginBottom: '2px',
                    opacity: draggedItem?.type === 'folder' && draggedItem?.path === folderPath ? 0.4 : 1
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', flex: 1 }}>
                    <span style={{ fontSize: '10px', width: '14px', textAlign: 'center', color: '#555', flexShrink: 0 }}>{isExpanded ? '▼' : '▶'}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    <span style={{ fontSize: '11px', color: '#888', fontWeight: 'normal' }}>{totalCount}</span>
                    {folderPath !== "Uncategorized" && (
                      <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === menuKey ? null : menuKey); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', fontSize: '15px', color: '#555' }}>⋮</button>
                    )}
                  </div>
                </div>
                {openMenuId === menuKey && (
                  <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: '8px', top: '32px', zIndex: 100, backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', width: '160px', overflow: 'hidden', fontWeight: 'normal' }}>
                    <div onClick={() => { setOpenMenuId(null); handleCreateSubFolder(folderPath); }} style={{ padding: '10px 12px', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid #eee' }}>＋ Add Sub-folder</div>
                    <div onClick={() => { setOpenMenuId(null); handleRenameFolder(folderPath); }} style={{ padding: '10px 12px', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid #eee' }}>✏️ Rename</div>
                    <div onClick={() => { setOpenMenuId(null); handleDeleteFolder(folderPath); }} style={{ padding: '10px 12px', fontSize: '13px', cursor: 'pointer', color: '#d9534f' }}>🗑️ Delete</div>
                  </div>
                )}
              </div>
              {isExpanded && renderTreeNodes(folderPath, depth + 1)}
            </div>
          );
        })}
      </>
    );
  };

  const themeStyles = {
    light: { bg: '#ffffff', text: '#1f2328', sub: '#656d76', border: '#e1e4e8' },
    sepia: { bg: '#f6efe2', text: '#3b2f23', sub: '#7a6855', border: '#dfd1b8' },
    dark: { bg: '#16181c', text: '#e6e8eb', sub: '#9aa0a6', border: '#2f343d' }
  }[readingTheme] || { bg: '#ffffff', text: '#1f2328', sub: '#656d76', border: '#e1e4e8' };

  const sidebarContent = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', flex: 1 }}>
          <h2 onDoubleClick={handleToggleMode} style={{ fontSize: '17px', margin: 0, color: '#333', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📚 Paper Manager</h2>
          <span onClick={handleToggleMode} style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '10px', backgroundColor: isPersonalMode ? '#e6f4ea' : '#e8f0fe', color: isPersonalMode ? '#137333' : '#1a73e8', fontWeight: 'bold', cursor: 'pointer', flexShrink: 0 }}>
            {isPersonalMode ? "🔓 Personal" : "Demo"}
          </span>
        </div>
        <button onClick={() => (isMobile ? setIsMobileMenuOpen(false) : setSidebarWidth(0))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '4px 8px', color: '#001f3f', flexShrink: 0 }}>
          {isMobile ? "✕" : "◀"}
        </button>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <select value={aiLanguage} onChange={(e) => setAiLanguage(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '4px', border: '1px solid #ccc', color: '#333', backgroundColor: '#fff', fontSize: isMobile ? '16px' : '13px' }}>
          <option value="Japanese">AI Language: Japanese</option>
          <option value="English">AI Language: English</option>
          <option value="Chinese">AI Language: Chinese</option>
        </select>
        <button
          onClick={() => {
            setIsAdding(true); setIsMobileMenuOpen(false); setSelectedPaper(null);
            setNewTitle(""); setNewAbstract(""); setPendingPdfFile(null);
            setNewFolder(activeFolder && activeFolder !== "Uncategorized" ? activeFolder : "");
            setLoading(false); setLoadingMessage(""); setCurrentPdfUrl(null);
          }}
          style={{ width: '100%', padding: '10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
        >＋ Add New Paper</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', borderTop: '1px solid #ddd', paddingTop: '8px' }}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOverInfo({ type: 'folder', id: 'ROOT', pos: 'inside' }); }}
          onDragLeave={() => setDragOverInfo(null)}
          onDrop={(e) => { e.preventDefault(); handleDropOnFolder("ROOT", "inside"); }}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', marginBottom: '6px', borderRadius: '4px', backgroundColor: dragOverInfo?.id === "ROOT" ? '#d2e3fc' : 'transparent', border: dragOverInfo?.id === "ROOT" ? '1px dashed #1a73e8' : '1px solid transparent' }}
        >
          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#666' }}>FOLDERS ({papers.length})</span>
          <button onClick={handleCreateRootFolder} style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>＋ Folder</button>
        </div>
        {allFolderPaths.length === 0 && !loading && <p style={{ fontSize: '13px', color: '#666', textAlign: 'center', marginTop: '20px' }}>No papers yet</p>}
        {renderTreeNodes("", 0)}
      </div>
    </>
  );

  const pdfSection = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#fdfdfd', height: '100%', overflow: 'hidden' }}>
      {(currentPdfUrl || (!isPersonalMode && selectedPaper?.abstract)) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px', padding: '6px 10px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #ddd', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {currentPdfUrl && (
              <>
                <button onClick={() => setIsReadingMode(false)} style={{ padding: '4px 9px', fontSize: '12px', borderRadius: '5px', border: '1px solid #ccc', cursor: 'pointer', fontWeight: !isReadingMode ? 'bold' : 'normal', backgroundColor: !isReadingMode ? '#007bff' : '#fff', color: !isReadingMode ? '#fff' : '#333' }}>📄 PDF</button>
                <button onClick={handleToggleReadingMode} style={{ padding: '4px 9px', fontSize: '12px', borderRadius: '5px', border: '1px solid #ccc', cursor: 'pointer', fontWeight: isReadingMode ? 'bold' : 'normal', backgroundColor: isReadingMode ? '#007bff' : '#fff', color: isReadingMode ? '#fff' : '#333' }}>📖 リーディング</button>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            {isReadingMode && (
              <>
                <span style={{ fontSize: '11px', color: '#666', marginRight: '2px' }}>🖍️</span>
                {HIGHLIGHT_COLORS.map(c => (
                  <button key={c.code} onMouseDown={(e) => e.preventDefault()} onClick={() => handleAddHighlight(c.code)} style={{ width: '24px', height: '24px', borderRadius: '50%', border: '1px solid #999', backgroundColor: c.code, cursor: 'pointer', padding: 0 }} title={`選択したテキストに${c.name}色のマーカーを引く`} />
                ))}
                <span style={{ width: '1px', height: '18px', backgroundColor: '#ddd', margin: '0 2px' }} />
                <button onClick={() => setReadingFontSize(s => Math.max(12, s - 2))} style={{ height: '26px', minWidth: '30px', padding: '0 6px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#fff', color: '#333', fontWeight: 'bold', cursor: 'pointer' }} title="文字を小さく">A-</button>
                <button onClick={() => setReadingFontSize(s => Math.min(26, s + 2))} style={{ height: '26px', minWidth: '30px', padding: '0 6px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#fff', color: '#333', fontWeight: 'bold', cursor: 'pointer' }} title="文字を大きく">A+</button>
                <button onClick={() => setReadingTheme(t => (t === 'light' ? 'sepia' : t === 'sepia' ? 'dark' : 'light'))} style={{ height: '26px', padding: '0 7px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#fff', cursor: 'pointer' }} title="テーマ切替">{readingTheme === 'light' ? '☀️' : readingTheme === 'sepia' ? '📜' : '🌙'}</button>
                <span style={{ width: '1px', height: '18px', backgroundColor: '#ddd', margin: '0 2px' }} />
                <button onMouseDown={(e) => e.preventDefault()} onClick={handleTranslateSelection} style={{ height: '26px', padding: '0 7px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#fff', color: '#333', cursor: 'pointer' }} title="選択したテキストを翻訳">🌐</button>
                <button onMouseDown={(e) => e.preventDefault()} onClick={handleToggleSpeech} style={{ height: '26px', padding: '0 7px', fontSize: '12px', border: isSpeaking ? '1px solid #d9534f' : '1px solid #ccc', borderRadius: '4px', backgroundColor: isSpeaking ? '#fdecea' : '#fff', color: '#333', cursor: 'pointer' }} title={isSpeaking ? "読み上げを停止" : "読み上げ（選択範囲／未選択なら全文）"}>{isSpeaking ? "⏹️" : "🔊"}</button>
              </>
            )}
            <button onClick={handleOpenReadingNewTab} style={{ padding: '4px 9px', fontSize: '12px', borderRadius: '5px', border: '1px solid #007bff', backgroundColor: '#fff', color: '#007bff', fontWeight: 'bold', cursor: 'pointer' }}>↗ 別タブで読む</button>
          </div>
        </div>
      )}

      {currentPdfUrl ? (
        isReadingMode ? (
          <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', backgroundColor: themeStyles.bg, color: themeStyles.text, padding: isMobile ? '18px 16px 60px' : '24px 32px 60px', boxSizing: 'border-box', fontFamily: 'Georgia, "Hiragino Mincho ProN", "Yu Mincho", serif', fontSize: `${readingFontSize}px`, lineHeight: '1.85', textAlign: 'left' }}>
            {readingLoading ? (
              <div style={{ textAlign: 'center', marginTop: '40px', fontFamily: 'sans-serif', fontSize: '14px', color: themeStyles.sub }}>⏳ {readingProgress || "リーディングモードへ変換中..."}</div>
            ) : (
              <div style={{ maxWidth: '720px', margin: '0 auto' }}>
                <div style={{ fontFamily: 'sans-serif', fontSize: '11px', color: themeStyles.sub, marginBottom: '12px' }}>
                  💡 文字を選択して上の 🖍️ マーカー・🌐 翻訳・🔊 読み上げが使えます（マーカーはタップで削除）
                </div>
                <h2 style={{ fontSize: '1.35em', lineHeight: '1.4', marginTop: 0, paddingBottom: '12px', color: themeStyles.text, borderBottom: `1px solid ${themeStyles.border}` }}>{selectedPaper?.title}</h2>
                {readingPages?.map((p) => (
                  <div key={p.pageNum} style={{ marginBottom: '28px' }}>
                    <div style={{ fontFamily: 'sans-serif', fontSize: '11px', fontWeight: 'bold', color: themeStyles.sub, letterSpacing: '0.08em', borderBottom: `1px dashed ${themeStyles.border}`, paddingBottom: '4px', marginBottom: '12px' }}>PAGE {p.pageNum}</div>
                    {p.paragraphs.map((para, idx) => {
                      const paraHls = highlights.filter(h => h.pageNum === p.pageNum && h.paraIdx === idx);
                      return (
                        <p key={idx} data-page={p.pageNum} data-para={idx} style={{ margin: '0 0 1em 0', wordBreak: 'break-word' }}>
                          {splitTextByHighlights(para, paraHls).map((seg, sIdx) =>
                            seg.highlight ? (
                              <mark key={sIdx} onClick={() => handleRemoveHighlight(seg.highlight.id)} title="タップしてマーカーを削除" style={{ backgroundColor: seg.highlight.color, color: '#1f2328', padding: '0 2px', borderRadius: '3px', cursor: 'pointer' }}>{seg.text}</mark>
                            ) : (<span key={sIdx}>{seg.text}</span>)
                          )}
                        </p>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : isIOS ? (
          <PdfCanvasViewer pdfUrl={currentPdfUrl} />
        ) : (
          <div style={{ flex: 1, pointerEvents: (isDraggingSidebar || isDragging || isDraggingVertical) ? 'none' : 'auto' }}>
            <iframe src={currentPdfUrl} style={{ width: '100%', height: '100%', border: 'none' }} title="PDF Viewer" />
          </div>
        )
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center', overflowY: 'auto' }}>
          <div style={{ padding: '24px', border: '2px dashed #ccc', borderRadius: '8px', backgroundColor: '#fff', maxWidth: '480px', width: '100%', boxSizing: 'border-box' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#555' }}>📄 PDF Viewer</h3>
            <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>Select a local PDF file to view it side-by-side with AI & Notes.</p>
            <input type="file" accept="application/pdf" onChange={handleViewerPdfLoad} style={{ color: '#333', maxWidth: '100%' }} />
            {!isPersonalMode && selectedPaper?.abstract && (
              <div style={{ marginTop: '20px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '6px', textAlign: 'left', fontSize: '12px', color: '#444', whiteSpace: 'pre-wrap' }}>
                <strong>[Sample Paper Abstract]</strong><br />{selectedPaper.abstract}
              </div>
            )}
          </div>
        </div>
      )}

      {isReadingMode && translationBox && (
        <div style={{ flexShrink: 0, maxHeight: '35%', overflowY: 'auto', borderTop: '2px solid #007bff', backgroundColor: '#f8fbff', padding: '10px 14px', textAlign: 'left', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#007bff' }}>🌐 翻訳 ({aiLanguage})</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {!translationBox.loading && (
                <button onClick={handleAskAiAboutTranslation} style={{ padding: '2px 6px', fontSize: '14px', borderRadius: '4px', border: '1px solid #007bff', backgroundColor: '#fff', cursor: 'pointer', lineHeight: 1 }} title="この原文と訳をAIチャットに送って質問する">🤖</button>
              )}
              <button onClick={() => setTranslationBox(null)} style={{ background: 'none', border: 'none', fontSize: '15px', cursor: 'pointer', color: '#666', padding: '0 4px' }} title="閉じる">✕</button>
            </div>
          </div>
          <div style={{ fontSize: '13.5px', lineHeight: '1.6', color: '#1f2328', whiteSpace: 'pre-wrap' }}>
            {translationBox.loading ? "⏳ 翻訳中..." : translationBox.translated}
          </div>
        </div>
      )}
    </div>
  );

  const aiSection = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: isMobile ? '10px' : '12px 16px', boxSizing: 'border-box', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: '6px', marginBottom: '6px', gap: '8px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🤖 AI Assistant — {selectedPaper?.title}</h3>
        <button onClick={() => selectedPaper && runInitialSummary(selectedPaper)} disabled={loading} style={{ background: 'none', border: '1px solid #ddd', borderRadius: '4px', padding: '2px 7px', fontSize: '11px', color: '#555', cursor: 'pointer', flexShrink: 0 }}>↻ Reset</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 0' }}>
        {chat.map((msg, i) => (
          <div key={i} style={{ marginBottom: '10px', textAlign: msg.role === 'user' ? 'right' : 'left' }}>
            {msg.role === 'user' ? (
              <div style={{ display: 'inline-block', padding: '9px 13px', borderRadius: '10px', backgroundColor: '#007bff', color: 'white', maxWidth: '90%', fontSize: isMobile ? '14px' : '13px', lineHeight: '1.45', whiteSpace: 'pre-wrap', textAlign: 'left', wordBreak: 'break-word' }}>{msg.text}</div>
            ) : (
              <div style={{ display: 'inline-block', padding: '9px 13px', borderRadius: '10px', backgroundColor: '#f1f3f4', color: '#1f2328', maxWidth: '94%', fontSize: isMobile ? '14px' : '13px', lineHeight: '1.5', textAlign: 'left', wordBreak: 'break-word', letterSpacing: 'normal' }} dangerouslySetInnerHTML={{ __html: renderMarkdownAndMathHtml(msg.text, { preserveColors: false }) }} />
            )}
          </div>
        ))}
        {loading && <div style={{ color: '#666', fontSize: '13px', marginTop: '6px' }}>⏳ {loadingMessage}</div>}
        <div ref={chatEndRef} />
      </div>
      <div style={{ display: 'flex', marginTop: '8px', paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : '0px' }}>
        <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSendMessage()} placeholder={`Ask Gemini (${aiLanguage})...`} style={{ flex: 1, padding: '8px 10px', fontSize: isMobile ? '16px' : '13.5px', borderRadius: '4px 0 0 4px', border: '1px solid #ccc', color: '#333', backgroundColor: '#fff', minWidth: 0 }} />
        <button onClick={handleSendMessage} disabled={loading} style={{ padding: '8px 14px', fontSize: '13px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '0 4px 4px 0', cursor: 'pointer', flexShrink: 0 }}>Send</button>
      </div>
    </div>
  );

  const mdMenuItemStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '7px 8px', border: 'none', backgroundColor: 'transparent', color: '#1f2328', fontSize: '12px', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #f0f0f0', boxSizing: 'border-box' };

  const memoSection = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: isMobile ? '8px 10px' : '8px 12px', backgroundColor: '#fafafa', boxSizing: 'border-box', textAlign: 'left' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', marginRight: '1px' }}>📝</span>
        {MEMO_COLORS.map(c => (
          <button key={c.key} onMouseDown={(e) => e.preventDefault()} onClick={() => handleApplyMemoColor(c.code)} title={`文字色：${c.label}`} style={{ width: '15px', height: '15px', borderRadius: '50%', backgroundColor: c.code, border: activeMemoColor === c.code ? '2px solid #007bff' : '1px solid #bbb', boxShadow: activeMemoColor === c.code ? '0 0 0 1px #fff inset' : 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }} />
        ))}
        <span style={{ width: '1px', height: '13px', backgroundColor: '#ddd', margin: '0 2px' }} />
        <button type="button" role="switch" aria-checked={isMemoPreview} onClick={() => { setIsMdMenuOpen(false); setIsMemoPreview(p => !p); }} title={isMemoPreview ? "表示モード（クリックで編集に戻る）" : "編集モード（クリックで数式・Markdownを表示）"} style={{ position: 'relative', width: '36px', height: '20px', borderRadius: '999px', border: 'none', backgroundColor: isMemoPreview ? '#34c759' : '#cbd5e1', cursor: 'pointer', padding: 0, transition: 'background-color 0.2s ease', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: '2px', left: '2px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', lineHeight: 1, transform: isMemoPreview ? 'translateX(16px)' : 'translateX(0)', transition: 'transform 0.2s ease' }}>
            {isMemoPreview ? "👁️" : "✏️"}
          </span>
        </button>
        <span style={{ width: '1px', height: '13px', backgroundColor: '#ddd', margin: '0 2px' }} />
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => handleInsertDelim("$")} title="文章と同じ行に変数・数式を挿入（$...$）" style={{ height: '21px', padding: '0 5px', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'baseline', gap: '2px', lineHeight: 1 }}>
          <span style={{ fontSize: '9.5px', color: '#888' }}>Aa</span>
          <span style={{ fontSize: '11.5px', color: '#1a73e8', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 'bold' }}>x<sub style={{ fontSize: '7.5px', fontStyle: 'normal' }}>i</sub></span>
        </button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => handleInsertDelim("$$")} title="独立した行に大きな数式を挿入（$$...$$）" style={{ height: '21px', padding: '0 5px', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '2px', lineHeight: 1 }}>
          <span style={{ fontSize: '9.5px', color: '#999' }}>[</span><span style={{ fontSize: '11.5px', color: '#1f2328', fontFamily: 'Georgia, serif', fontWeight: 'bold' }}>∑</span><span style={{ fontSize: '9.5px', color: '#999' }}>]</span>
        </button>
        <div style={{ display: 'inline-flex', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setIsMdMenuOpen(prev => !prev)} title="太字・見出し・箇条書きなどの書式メニュー" style={{ height: '21px', padding: '0 5px', border: isMdMenuOpen ? '1px solid #007bff' : '1px solid #ccc', borderRadius: '4px', backgroundColor: isMdMenuOpen ? '#e8f0fe' : '#fff', color: isMdMenuOpen ? '#1a73e8' : '#333', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '1px', lineHeight: 1 }}>
            <span>Aa</span><span style={{ fontSize: '8px' }}>▾</span>
          </button>
          {isMdMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 200, width: '210px', maxWidth: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.16)', overflow: 'hidden' }}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleApplyRichCommand("bold")} style={{ ...mdMenuItemStyle, borderRight: '1px solid #f0f0f0' }} title="Ctrl+B"><span><strong>B</strong> 太字</span></button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleApplyRichCommand("italic")} style={mdMenuItemStyle} title="Ctrl+I"><span><em>I</em> 斜体</span></button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleApplyRichCommand("underline")} style={{ ...mdMenuItemStyle, borderRight: '1px solid #f0f0f0' }} title="Ctrl+U"><span><u>U</u> 下線</span></button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleApplyRichCommand("strikeThrough")} style={mdMenuItemStyle} title="Alt+Shift+5"><span><del>S</del> 取消</span></button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleInsertPrefix("## ")} style={{ ...mdMenuItemStyle, borderRight: '1px solid #f0f0f0' }} title="## 見出し"><span><strong>H</strong> 見出し</span></button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleInsertPrefix("- ")} style={mdMenuItemStyle} title="Ctrl+Shift+8"><span>・ 箇条書</span></button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleInsertPrefix("> ")} style={{ ...mdMenuItemStyle, borderRight: '1px solid #f0f0f0', borderBottom: 'none' }} title="> 引用"><span>❝ 引用</span></button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleInsertDelim("`")} style={{ ...mdMenuItemStyle, borderBottom: 'none' }} title="`コード`"><span><code>{"</>"}</code> コード</span></button>
            </div>
          )}
        </div>
        <button onClick={() => selectedPaper && handleSaveMemo(selectedPaper.id, memoText)} style={{ height: '21px', padding: '0 7px', fontSize: '11px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, boxSizing: 'border-box' }}>Save</button>
        {memoStatus && <span style={{ fontSize: '11px', color: memoStatus === '✓' ? '#28a745' : '#888', lineHeight: 1 }}>{memoStatus}</span>}
      </div>

      {isMemoPreview ? (
        <div onClick={() => setIsMemoPreview(false)} title="クリックして編集に戻る" style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '8px 10px', fontSize: isMobile ? '14.5px' : '13px', lineHeight: '1.4', letterSpacing: '0', textAlign: 'left', border: '1px solid #007bff', borderRadius: '6px', backgroundColor: '#fff', color: '#1f2328', wordBreak: 'break-word', boxSizing: 'border-box', marginBottom: isMobile ? 'env(safe-area-inset-bottom)' : '0px', cursor: 'text' }} dangerouslySetInnerHTML={{ __html: memoText ? renderMarkdownAndMathHtml(memoText, { preserveColors: true }) : '<span style="color:#999;font-size:12px;">（メモはまだありません）</span>' }} />
      ) : (
        <div
          ref={memoEditorRef}
          contentEditable
          suppressContentEditableWarning
          onFocus={(e) => { if (memoHistoryRef.current.stack.length === 0) pushMemoHistory(e.currentTarget.innerHTML); }}
          onKeyDown={handleMemoKeyDown}
          onInput={(e) => { const html = e.currentTarget.innerHTML; pushMemoHistory(html); setMemoText(html); }}
          onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '8px 10px', fontSize: isMobile ? '16px' : '13px', lineHeight: '1.4', letterSpacing: '0', textAlign: 'left', border: '1px solid #ccc', borderRadius: '6px', backgroundColor: '#fff', color: '#1f2328', wordBreak: 'break-word', boxSizing: 'border-box', outline: 'none', marginBottom: isMobile ? 'env(safe-area-inset-bottom)' : '0px' }}
        />
      )}
    </div>
  );

  const isRightCollapsed = leftWidth >= 100;
  const isAnyDragging = isDraggingSidebar || isDragging || isDraggingVertical;

  return (
    <div
      onMouseMove={(e) => handlePointerMove(e.clientX, e.clientY)}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerUp}
      onTouchMove={(e) => { if ((isDraggingSidebar || isDragging || isDraggingVertical) && e.touches.length > 0) handlePointerMove(e.touches[0].clientX, e.touches[0].clientY); }}
      onTouchEnd={handlePointerUp}
      onDragOver={(e) => { if (!draggedItem && e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); if (!isFileDragging) setIsFileDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setIsFileDragging(false); }}
      onDrop={(e) => { if (!draggedItem && e.dataTransfer?.files?.length > 0) { e.preventDefault(); setIsFileDragging(false); handleDropPdfFile(e.dataTransfer.files[0]); } }}
      style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100dvh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#333', backgroundColor: '#fff', textAlign: 'left', userSelect: isAnyDragging ? 'none' : 'auto', cursor: isDraggingSidebar || isDragging ? 'col-resize' : isDraggingVertical ? 'row-resize' : 'auto', overflow: 'hidden' }}
    >
      <style>{`.katex-display { margin: 2px 0 !important; text-align: left !important; } .katex { font-size: 1.05em; }`}</style>

      {isFileDragging && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(26, 115, 232, 0.14)', border: '4px dashed #1a73e8', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ backgroundColor: '#fff', padding: '18px 28px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', fontSize: '16px', fontWeight: 'bold', color: '#1a73e8' }}>📄 PDFをドロップして新規登録</div>
        </div>
      )}

      {isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #ddd', flexShrink: 0, gap: '8px' }}>
          <button onClick={() => setIsMobileMenuOpen(true)} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '6px', padding: '6px 10px', fontSize: '15px', cursor: 'pointer', color: '#333', flexShrink: 0 }}>☰ 論文一覧</button>
          <div style={{ flex: 1, fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center', color: '#333' }}>{selectedPaper ? selectedPaper.title : "📚 Paper Manager"}</div>
          <span onClick={handleToggleMode} style={{ fontSize: '10px', padding: '3px 7px', borderRadius: '10px', backgroundColor: isPersonalMode ? '#e6f4ea' : '#e8f0fe', color: isPersonalMode ? '#137333' : '#1a73e8', fontWeight: 'bold', flexShrink: 0 }}>{isPersonalMode ? "🔓" : "Demo"}</span>
        </div>
      )}

      {isMobile && isMobileMenuOpen && (
        <div onClick={() => setIsMobileMenuOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '82%', maxWidth: '320px', height: '100%', backgroundColor: '#f8f9fa', padding: '16px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', boxShadow: '2px 0 12px rgba(0,0,0,0.2)' }}>{sidebarContent}</div>
        </div>
      )}

      {!isMobile && !isSidebarOpen && (
        <div style={{ width: '40px', backgroundColor: '#f8f9fa', borderRight: '1px solid #ccc', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '15px', flexShrink: 0 }}>
          <button onClick={() => setSidebarWidth(280)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '10px', color: '#001f3f' }}>▶</button>
        </div>
      )}

      {!isMobile && (
        <div style={{ width: `${sidebarWidth}px`, padding: isSidebarOpen ? '15px' : '0px', backgroundColor: '#f8f9fa', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden', boxSizing: 'border-box' }}>{sidebarContent}</div>
      )}

      {!isMobile && isSidebarOpen && (
        <div onMouseDown={() => setIsDraggingSidebar(true)} onTouchStart={() => setIsDraggingSidebar(true)} onDoubleClick={() => setSidebarWidth(0)} style={{ width: '6px', flexShrink: 0, cursor: 'col-resize', backgroundColor: isDraggingSidebar ? '#007bff' : '#ddd', zIndex: 10, touchAction: 'none' }} />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#fff', overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
        {isAdding ? (
          <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', width: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', boxSizing: 'border-box' }}>
            <h2 style={{ color: '#333' }}>Register New Paper</h2>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Folder / Sub-folder Path (use "/" for nested folders)</label>
              <input type="text" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="e.g., Labor Economics/Gender" style={{ width: '100%', padding: '10px', fontSize: isMobile ? '16px' : '14px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
            </div>
            <div style={{ margin: '20px 0', padding: '20px', backgroundColor: '#f0f7ff', borderRadius: '8px', border: '1px dashed #007bff' }}>
              <h3 style={{ marginTop: 0, fontSize: '16px', color: '#007bff' }}>📄 Auto-extract & Link PDF</h3>
              <p style={{ fontSize: '14px', color: '#555' }}>Select or drop a PDF file. It will be linked to this paper so it opens automatically next time.</p>
              <input type="file" accept="application/pdf" onChange={handlePdfUpload} disabled={loading} style={{ maxWidth: '100%' }} />
              {pendingPdfFile && <p style={{ color: '#28a745', fontSize: '13px', fontWeight: 'bold', marginTop: '8px' }}>✅ PDF linked: {pendingPdfFile.name}</p>}
              {loading && <p style={{ color: '#d9534f', fontWeight: 'bold', marginTop: '10px' }}>⏳ {loadingMessage}</p>}
            </div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Title</label>
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={{ width: '100%', padding: '10px', fontSize: isMobile ? '16px' : '14px', marginBottom: '20px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Extracted Abstract</label>
            <textarea value={newAbstract} onChange={(e) => setNewAbstract(e.target.value)} style={{ width: '100%', height: '200px', padding: '10px', fontSize: isMobile ? '16px' : '14px', marginBottom: '20px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: '10px', paddingBottom: '24px' }}>
              <button onClick={handleAddPaper} disabled={loading} style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>{isPersonalMode ? "Save to Database" : "Add (Demo Mode)"}</button>
              <button onClick={() => { setIsAdding(false); setLoading(false); setLoadingMessage(""); }} style={{ padding: '10px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Cancel</button>
            </div>
          </div>
        ) : selectedPaper ? (
          isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div style={{ display: 'flex', borderBottom: '1px solid #ddd', backgroundColor: '#f8f9fa', flexShrink: 0 }}>
                {[{ id: "pdf", label: "📄 PDF" }, { id: "ai", label: "🤖 AI" }, { id: "memo", label: "📝 Memo" }].map(tab => (
                  <button key={tab.id} onClick={() => setMobileTab(tab.id)} style={{ flex: 1, padding: '10px 6px', border: 'none', borderBottom: mobileTab === tab.id ? '3px solid #007bff' : '3px solid transparent', backgroundColor: mobileTab === tab.id ? '#fff' : 'transparent', color: mobileTab === tab.id ? '#007bff' : '#555', fontWeight: mobileTab === tab.id ? 'bold' : 'normal', fontSize: '14px', cursor: 'pointer' }}>{tab.label}</button>
                ))}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {mobileTab === "pdf" && pdfSection}
                {mobileTab === "ai" && aiSection}
                {mobileTab === "memo" && memoSection}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minWidth: 0 }}>
              <div style={{ width: isRightCollapsed ? 'calc(100% - 6px)' : `${leftWidth}%`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>{pdfSection}</div>
              <div onMouseDown={() => setIsDragging(true)} onTouchStart={() => setIsDragging(true)} onDoubleClick={() => setLeftWidth(prev => (prev >= 100 ? 50 : 100))} style={{ width: '6px', flexShrink: 0, cursor: 'col-resize', backgroundColor: isDragging ? '#007bff' : '#ddd', zIndex: 10, touchAction: 'none' }} />
              <div ref={rightPaneRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#fff', minWidth: 0, overflow: 'hidden' }}>
                <div style={{ height: aiHeightPercent >= 100 ? 'calc(100% - 6px)' : `${aiHeightPercent}%`, flexShrink: 0, minHeight: 0, overflow: 'hidden', display: isRightCollapsed || aiHeightPercent <= 0 ? 'none' : 'block' }}>{aiSection}</div>
                <div onMouseDown={() => setIsDraggingVertical(true)} onTouchStart={() => setIsDraggingVertical(true)} onDoubleClick={() => setAiHeightPercent(prev => (prev <= 0 ? 50 : 0))} style={{ height: '6px', flexShrink: 0, cursor: 'row-resize', backgroundColor: isDraggingVertical ? '#007bff' : '#ddd', zIndex: 10, touchAction: 'none' }} />
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: isRightCollapsed || aiHeightPercent >= 100 ? 'none' : 'block' }}>{memoSection}</div>
              </div>
            </div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', gap: '10px', padding: '20px', textAlign: 'center' }}>
            <h3>{isMobile ? "👆 左上の「☰ 論文一覧」から論文を選択してください" : "👈 Please select a paper from the left menu (or drop a PDF here)"}</h3>
            {!isPersonalMode && <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>Currently in Demo Mode — Select a sample paper to test AI summary, PDF viewer, and Notes.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;