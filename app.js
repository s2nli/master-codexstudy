(function injectSpinnerCss() {
  if (document.getElementById("cx-spin-css")) return;
  const st = document.createElement("style");
  st.id = "cx-spin-css";
  st.textContent = ".cx-spin-wrap{display:flex;justify-content:center;padding:36px 10px}.cx-spin-wrap.small{padding:14px 10px}.cx-spin{width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.12);border-top-color:var(--brand,#8b7cff);animation:cxspin .8s linear infinite}.cx-spin-wrap.small .cx-spin{width:22px;height:22px;border-width:2px}@keyframes cxspin{to{transform:rotate(360deg)}}";
  document.head.appendChild(st);
})();
const CX_SPINNER = '<div class="cx-spin-wrap" role="status" aria-label="Loading"><div class="cx-spin"></div></div>';
const CX_SPINNER_SMALL = '<div class="cx-spin-wrap small" role="status" aria-label="Loading"><div class="cx-spin"></div></div>';

(function applySavedTheme() {
  const saved = localStorage.getItem("codex-studys-theme");
  if (!saved || saved === "system") return;
  document.documentElement.setAttribute("data-theme", saved);
})();

const FALLBACK_THUMB = "assets/codex-telegram.png";
let allBatches = [];
let activeFilter = "all";
let searchQuery = "";
let sortMode = "relevance";
let langFilter = "all";
let visibleCount = 24;
const PAGE_SIZE = 24;

const $ = (selector) => document.querySelector(selector);
const THUMB_PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
window.__thumbFallback = (img) => { img.outerHTML = THUMB_PLACEHOLDER_SVG; };
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function categoryFor(batch) {
  const text = `${batch.name || ""} ${batch.byName || ""}`.toLowerCase();
  if (/\bjee\b|iit/.test(text)) return "jee";
  if (/neet|medical/.test(text)) return "neet";
  if (/class|cbse|icse|school|commerce|humanities/.test(text)) return "school";
  return "exam";
}

function deepSearchText(batch) {
  if (batch.__searchText) return batch.__searchText;
  const parts = [batch.name, batch.byName, batch.language, batch.type, (batch.slug || "").replace(/-/g, " ")];
  (batch.subBatches || []).forEach((sub) => parts.push(sub.name, sub.byName));
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  Object.defineProperty(batch, "__searchText", { value: text, enumerable: false, writable: true });
  return text;
}

function deepSearchScore(batch, queryWords, rawQuery) {
  const name = (batch.name || "").toLowerCase();
  const text = deepSearchText(batch);
  if (!queryWords.every((word) => text.includes(word))) return 0;
  if (name === rawQuery) return 100;
  if (name.startsWith(rawQuery)) return 80;
  if (name.includes(rawQuery)) return 60;
  if (queryWords.every((word) => name.includes(word))) return 40;
  return 20;
}

function deepSearch(batches, query) {
  const rawQuery = query.trim().toLowerCase();
  if (!rawQuery) return batches;
  const queryWords = rawQuery.split(/\s+/).filter(Boolean);
  return batches
    .map((batch) => ({ batch, score: deepSearchScore(batch, queryWords, rawQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.batch);
}

const esc = (value) => escapeHtml(value == null ? "" : String(value));

let currentHls = null;
const cxState = { batch: null, tab: "lectures", subject: null, items: [] };
const CX_ICON_VIDEO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="3"/><path d="m22 8-6 4 6 4V8Z"/></svg>';
const CX_ICON_PDF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
const CX_ICON_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

function cxSafeUrl(value) {
  const url = String(value == null ? "" : value).trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function cxStopVideo() {
  const box = document.getElementById("videoContainer");
  const video = document.getElementById("courseVideo");
  if (video) { try { video.pause(); } catch (e) {} video.removeAttribute("src"); video.load(); }
  if (currentHls) { currentHls.destroy(); currentHls = null; }
  if (box) box.style.display = "none";
}

function closeCourseModal() {
  const modal = document.getElementById("courseModal");
  if (modal) modal.style.display = "none";
  cxStopVideo();
  document.body.style.overflow = "";
  cxState.batch = null; cxState.subject = null;
}

// back arrow / X: step back one screen at a time using browser history
function cxBack() {
  if (window.history.state && window.history.state.cx) window.history.back();
  else closeCourseModal();
}

window.addEventListener("popstate", (event) => {
  const modal = document.getElementById("courseModal");
  if (!modal || modal.style.display === "none") return;
  const level = event.state && event.state.cx;
  if (cxLvOpen() && level !== 3) { cxCloseLecture(true); return; }
  if (level === 2) return; // came back from the lecture player: stay on the chapter list
  if (level === 1) { cxState.subject = null; cxStopVideo(); cxRender(); }
  else closeCourseModal();
});

function cxNormalize(batch) {
  const subjects = Array.isArray(batch.subjects) ? batch.subjects.map((s) => ({
    name: s.name || s.title || "Untitled",
    lectures: Array.isArray(s.lectures) ? s.lectures : [],
    notes: Array.isArray(s.notes) ? s.notes : [],
    loading: !!s.loading,
    failed: !!s.failed,
    loaded: !!s.loaded,
    count: s.count || ""
  })) : [];
  // older flat format: batch.lectures = [{title,url,notesUrl}]
  if (!subjects.length && Array.isArray(batch.lectures) && batch.lectures.length) {
    subjects.push({ name: "Lectures", lectures: batch.lectures, notes: [] });
  }
  const notes = (Array.isArray(batch.notes) ? batch.notes : []).slice();
  subjects.forEach((s) => {
    s.lectures.forEach((l) => { if (l && l.notesUrl) notes.push({ title: (l.title || s.name) + " - Notes", url: l.notesUrl }); });
    s.notes.forEach((n) => notes.push(n));
  });
  return { subjects, notes };
}

/* ---------- Live lectures & notes (Master Sahab API via /api/ms proxy) ----------
   Fast path: chapters list turant (2-3 calls, cached), lectures/notes sirf tab load jab chapter khule (cached). */
const MS_API = "/api/ms";
const MS_STRUCT_TTL = 6 * 60 * 60 * 1000;

function msCacheGet(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
function msCacheSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }

async function msPost(path, payload) {
  const response = await fetch(MS_API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    let detail = "";
    try { const e = await response.json(); detail = e && (e.error || e.detail) ? " - " + (e.error || e.detail) : ""; } catch (x) {}
    throw new Error("HTTP " + response.status + detail);
  }
  const json = await response.json();
  if (json && json.decodedResponse) return json.decodedResponse;
  if (json && json.data && json.data.status !== undefined) return json.data;
  return json;
}

function msIsPdf(item) {
  return item.file_type === "1" || /\.pdf(\?|#|$)/i.test(String(item.file_url || ""));
}
function msIsTest(item) {
  return Boolean(item.test_series_name || item.test_code || item.total_questions);
}
function msItemUrl(item) {
  return item.hls_url || item.video_url || item.file_url || item.url || item.link || "";
}

async function msFetchItems(sb, tile, subject, topic, parentId) {
  const seen = new Set();
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const res = await msPost("/course/get_master_data", {
      course_id: String(sb.id),
      tile_id: String((tile && tile.id) || "0"),
      type: (tile && tile.type) || "content",
      revert_api: (tile && tile.revert_api) || "1#0#0#1",
      topic_id: String(topic.topic_id || topic.id || ""),
      subject_id: String(subject.id || ""),
      layer: 3,
      page,
      parent_id: String(parentId)
    });
    const list = (res && res.data && Array.isArray(res.data.list)) ? res.data.list : [];
    let added = 0;
    list.forEach((item) => {
      const key = String(item.id || item.vdc_id || item.file_url || item.title || Math.random());
      if (seen.has(key)) return;
      seen.add(key); all.push(item); added++;
    });
    if (!added) break; // empty page ya API page 1 repeat kar rahi -> stop
  }
  return all;
}

function msBuildSubjects(batch, subs) {
  batch.subjects = subs.map((x) => {
    const entry = { name: x.name, count: x.count || "", lectures: [], notes: [], loading: false, failed: false, loaded: false };
    Object.defineProperty(entry, "_ref", { value: x, enumerable: false });
    return entry;
  });
  batch.notes = [];
}

async function msFetchStructure(batch) {
  const parentId = String(batch._id || batch.id);
  const combo = await msPost("/course_deprecated/get_combo_course_list", { course_id: parentId, page: 1, search: "" });
  let subBatches = Array.isArray(combo && combo.data) ? combo.data : [];
  if (!subBatches.length) subBatches = [{ id: parentId, title: batch.name }];
  // saare sub-batches ek saath (parallel)
  const details = await Promise.all(subBatches.map((sb) =>
    msPost("/course_deprecated/get_course_detail", { course_id: String(sb.id), parent_id: parentId })
      .then((d) => ({ sb, d }), (e) => { console.error(e); return null; })));
  if (details.every((row) => !row)) throw new Error("Batch details load nahi hue");
  const subs = [];
  details.forEach((row) => {
    const data = row && row.d && row.d.data;
    if (!data) return;
    const tiles = data.tiles || [];
    const tile = tiles.find((t) => t.type === "content") || tiles[0];
    const list = (tile && tile.meta && Array.isArray(tile.meta.list)) ? tile.meta.list : [];
    list.forEach((subject) => subs.push({
      name: subBatches.length > 1 ? `${row.sb.title || "Batch"} · ${subject.title || "Subject"}` : (subject.title || "Subject"),
      count: subject.count || "",
      sb: { id: row.sb.id, title: row.sb.title },
      tile: tile ? { id: tile.id, type: tile.type, revert_api: tile.revert_api } : null,
      subject
    }));
  });
  return { t: Date.now(), subs };
}

// Step 1: sirf chapters/subjects ki list (cached, instant on 2nd open)
async function msLoadBatch(batch, force) {
  if (!batch || batch.source !== "mastersahab") return;
  if (batch._live && (batch._live.status === "loading" || (batch._live.status === "done" && !force))) return;
  const live = { status: "loading", error: "" };
  Object.defineProperty(batch, "_live", { value: live, enumerable: false, writable: true, configurable: true });
  const rerender = () => { if (cxState.batch === batch) cxRender(); };
  const key = "cx-ms-struct-" + String(batch._id || batch.id);

  const cached = force ? null : msCacheGet(key);
  if (cached && Array.isArray(cached.subs) && cached.subs.length && Date.now() - cached.t < MS_STRUCT_TTL) {
    msBuildSubjects(batch, cached.subs);
    live.status = "done";
    rerender();
    return;
  }
  batch.subjects = [];
  rerender();
  try {
    const struct = await msFetchStructure(batch);
    msBuildSubjects(batch, struct.subs);
    if (struct.subs.length) msCacheSet(key, struct);
    live.status = "done";
  } catch (error) {
    console.error(error);
    live.status = "error";
    live.error = String((error && error.message) || error);
  }
  rerender();
}

// Step 2: ek chapter ke lectures + notes (cached data turant dikhta hai, background me refresh)
async function msLoadSubject(batch, index) {
  const entry = batch && batch.subjects && batch.subjects[index];
  if (!entry || !entry._ref || entry._fresh || entry._busy) return;
  entry._busy = true;
  const ref = entry._ref;
  const parentId = String(batch._id || batch.id);
  const key = "cx-ms-items-" + parentId + "-" + ref.sb.id + "-" + (ref.subject.id || index);
  const rerender = () => { if (cxState.batch === batch) cxRender(); };

  if (!entry.loaded) {
    const cached = msCacheGet(key);
    if (cached && Array.isArray(cached.lectures)) {
      entry.lectures = cached.lectures; entry.notes = cached.notes || []; entry.loaded = true;
    }
  }
  entry.loading = !entry.loaded;
  entry.failed = false;
  rerender();

  try {
    const topics = Array.isArray(ref.subject.list) && ref.subject.list.length ? ref.subject.list : [ref.subject];
    // saare topics ek saath (parallel)
    const results = await Promise.all(topics.map((topic) =>
      msFetchItems(ref.sb, ref.tile, ref.subject, topic, parentId)
        .then((items) => ({ topic, items }), (e) => { console.error(e); return null; })));
    if (results.every((r) => !r)) throw new Error("Content load nahi hua");
    const lectures = [];
    const notes = [];
    results.forEach((r) => {
      if (!r) return;
      r.items.forEach((item) => {
        if (msIsTest(item)) return; // tests abhi UI me nahi hain
        const url = msItemUrl(item);
        const title = item.title || item.test_series_name || "Untitled";
        if (msIsPdf(item)) {
          if (url) notes.push({ title, url });
        } else {
          lectures.push({ title, url, topic: (topics.length > 1 || r.topic !== ref.subject) ? (r.topic.title || "") : "", contentId: item.id || item.vdc_id || "" });
        }
      });
    });
    entry.lectures = lectures; entry.notes = notes; entry.loaded = true; entry.failed = false;
    if (!results.some((r) => !r)) { entry._fresh = true; msCacheSet(key, { t: Date.now(), lectures, notes }); }
  } catch (error) {
    console.error(error);
    if (!entry.loaded) entry.failed = true;
  }
  entry.loading = false;
  entry._busy = false;
  rerender();
}

// Notes tab ke liye: baaki saare chapters background me (4 ek saath)
async function msLoadAll(batch) {
  if (!batch || !batch.subjects || batch._allBusy) return;
  const idxs = batch.subjects.map((x, i) => i).filter((i) => !batch.subjects[i]._fresh && !batch.subjects[i]._busy);
  if (!idxs.length) return;
  batch._allBusy = true;
  let next = 0;
  const worker = async () => { while (next < idxs.length) await msLoadSubject(batch, idxs[next++]); };
  await Promise.all([worker(), worker(), worker(), worker()]);
  batch._allBusy = false;
  if (cxState.batch === batch) cxRender();
}

function openBatch(batch) {
  const id = batch && (batch._id || batch.id);
  if (!id) return showToast("Course details not available.");
  addRecentlyViewed(batch);
  try { window.CXProfile && window.CXProfile.trackBatch(batch); } catch (e) {}
  renderRecentlyWatched();

  const modal = document.getElementById("courseModal");
  if (!modal) return;
  cxState.batch = batch; cxState.tab = "lectures"; cxState.subject = null;
  cxStopVideo();
  modal.style.display = "block";
  modal.scrollTop = 0;
  document.body.style.overflow = "hidden";
  window.history.pushState({ cx: 1 }, "");
  cxRender();
  msLoadBatch(batch);
}

function cxEmptyMsg(batch, fallback, tab) {
  const live = batch && batch._live;
  if (live && live.status === "loading") return CX_SPINNER;
  if (live && live.status === "error") return `<div class="cx-empty">Load nahi ho paya (${esc(live.error)}).<br><button type="button" class="cx-tab active" data-retry="1" style="margin-top:12px">Retry</button></div>`;
  if (tab === "notes" && batch._allBusy) return CX_SPINNER;
  if (live && live.status === "done") return tab === "notes" ? '<div class="cx-empty">Is batch me abhi koi notes nahi mile.</div>' : '<div class="cx-empty">Is batch me abhi koi content nahi mila.</div>';
  return `<div class="cx-empty">${fallback}</div>`;
}

function cxRender() {
  const batch = cxState.batch;
  const listEl = document.getElementById("modalContentList");
  const titleEl = document.getElementById("modalBatchTitle");
  if (!batch || !listEl) return;
  const data = cxNormalize(batch);
  const sub = cxState.subject != null ? data.subjects[cxState.subject] : null;

  if (sub) {
    if (titleEl) titleEl.textContent = sub.name;
    cxState.items = sub.lectures;
    const lecRows = sub.lectures.map((lec, i) => {
      const lid = cxLecId(lec, i), done = cxIsDone(lid), pct = cxWatchPct(lid);
      return `
      <button class="cx-row${done ? " done" : ""}" type="button" data-play="${i}" data-lid="${esc(lid)}">
        <span class="cx-ico">${CX_ICON_VIDEO}</span>
        <span class="cx-row-text"><b>${esc(lec.title || "Lecture " + (i + 1))}</b><small>${esc(lec.topic || "Video Lecture")}</small><span class="cx-prog" style="${pct ? "" : "display:none"}"><i style="width:${pct}%"></i></span></span>
        <span class="cx-chk" role="button" tabindex="0" data-chk="${esc(lid)}" aria-pressed="${done ? "true" : "false"}" aria-label="${done ? "Mark as not complete" : "Mark as complete"}">${CX_TICK}</span>
        <span class="cx-chev">${CX_ICON_CHEV}</span>
      </button>`;
    }).join("");
    const noteRows = sub.notes.map((n, i) => {
      const url = cxSafeUrl(n.url);
      return `<a class="cx-row" ${url ? `href="${esc(url)}" target="_blank" rel="noopener"` : ""}>
        <span class="cx-ico">${CX_ICON_PDF}</span>
        <span class="cx-row-text"><b>${esc(n.title || "Notes " + (i + 1))}</b><small>PDF Notes</small></span>
        <span class="cx-chev">${CX_ICON_CHEV}</span>
      </a>`;
    }).join("");
    let status = "";
    if (sub.loading || (!sub.loaded && !sub.failed)) status = CX_SPINNER;
    else if (sub.failed) status = '<div class="cx-empty">Is subject ka content load nahi hua. Wapas jaakar dobara try karein.</div>';
    else if (!lecRows && !noteRows) status = '<div class="cx-empty">Is subject me abhi koi lecture ya notes nahi hain.</div>';
    listEl.innerHTML = lecRows + noteRows + status;
    return;
  }

  if (titleEl) titleEl.textContent = batch.name || "Course Details";
  const chips = [];
  chips.push(batch.mode || "Recorded");
  if (batch.duration) chips.push(batch.duration);
  else if (batch.startDate && batch.endDate) chips.push(batch.startDate + " - " + batch.endDate);
  if (batch.language) chips.push(batch.language);

  const banner = batch.previewImage ? `<img class="cx-banner" src="${esc(batch.previewImage)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : "";
  const tabs = [["lectures", "Lectures"], ["notes", "Notes"], ["about", "About"]].map(([key, label]) =>
    `<button type="button" class="cx-tab${cxState.tab === key ? " active" : ""}" data-tab="${key}">${label}</button>`).join("");

  let body = "";
  if (cxState.tab === "lectures") {
    body = data.subjects.length ? data.subjects.map((s, i) => `
      <button class="cx-row" type="button" data-subject="${i}">
        <span class="cx-ico">${CX_ICON_VIDEO}</span>
        <span class="cx-row-text"><b>${esc(s.name)}</b><small>${s.loaded ? s.lectures.length + " lectures" + (s.notes.length ? " · " + s.notes.length + " notes" : "") : (s.count ? esc(s.count) + " items" : "Tap to open")}</small></span>
        <span class="cx-chev">${CX_ICON_CHEV}</span>
      </button>`).join("") : cxEmptyMsg(batch, "Lectures jald hi add honge.");
  } else if (cxState.tab === "notes") {
    body = data.notes.length ? data.notes.map((n, i) => {
      const url = cxSafeUrl(n.url);
      return `<a class="cx-row" ${url ? `href="${esc(url)}" target="_blank" rel="noopener"` : ""}>
        <span class="cx-ico">${CX_ICON_PDF}</span>
        <span class="cx-row-text"><b>${esc(n.title || "Notes " + (i + 1))}</b><small>PDF Notes</small></span>
        <span class="cx-chev">${CX_ICON_CHEV}</span>
      </a>`;
    }).join("") : cxEmptyMsg(batch, "Notes jald hi add honge.", "notes");
    if (data.notes.length && batch._allBusy) body += CX_SPINNER_SMALL;
  } else {
    body = `<div class="cx-about">
      <p>${esc(batch.about || batch.description || batch.byName || "Is batch ki details jald hi add hongi.")}</p>
      <ul>
        ${batch.byName ? `<li><span>By</span><b>${esc(batch.byName)}</b></li>` : ""}
        ${batch.language ? `<li><span>Language</span><b>${esc(batch.language)}</b></li>` : ""}
        ${batch.startDate ? `<li><span>Start</span><b>${esc(batch.startDate)}</b></li>` : ""}
        ${batch.endDate ? `<li><span>End</span><b>${esc(batch.endDate)}</b></li>` : ""}
      </ul></div>`;
  }

  listEl.innerHTML = `
    <div class="cx-hero">
      ${banner}
      <h2>${esc(batch.name || "Course")}</h2>
      <p>${esc(batch.tagline || batch.byName || "")}</p>
      <div class="cx-chips">${chips.map((c, i) => `<span class="cx-chip${i === 0 ? " main" : ""}">${esc(c)}</span>`).join("")}</div>
    </div>
    <div class="cx-tabs">${tabs}</div>
    <div class="cx-list">${body}</div>`;
}

(function setupCourseModalEvents() {
  document.addEventListener("click", (event) => {
    const modal = document.getElementById("courseModal");
    if (!modal || modal.style.display === "none" || !modal.contains(event.target)) return;
    const chk = event.target.closest("[data-chk]");
    if (chk) { event.stopPropagation(); cxSetDone(chk.getAttribute("data-chk"), !cxIsDone(chk.getAttribute("data-chk"))); return; }
    if (event.target.closest("[data-retry]")) { msLoadBatch(cxState.batch, true); return; }
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      cxState.tab = tab.getAttribute("data-tab");
      if (cxState.tab === "notes") msLoadAll(cxState.batch);
      cxRender();
      return;
    }
    const subj = event.target.closest("[data-subject]");
    if (subj) {
      cxState.subject = Number(subj.getAttribute("data-subject"));
      msLoadSubject(cxState.batch, cxState.subject);
      window.history.pushState({ cx: 2 }, "");
      modal.scrollTop = 0;
      cxRender();
      return;
    }
    const play = event.target.closest("[data-play]");
    if (play) {
      const lec = cxState.items[Number(play.getAttribute("data-play"))] || {};
      cxOpenLecture(Number(play.getAttribute("data-play")));
    }
  });
})();

/* ---------- Premium lecture player (LecturePlayer) + done ticks + recently watched ---------- */
const CX_DONE_KEY = "cx-done";
const CX_RECENT_KEY = "codex-studys-recent-lectures";
const CX_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
function cxLsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function cxReadDone() { const m = cxLsGet(CX_DONE_KEY, {}); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; }
function cxLecId(lec, i) { return String((lec && (lec.contentId || lec.url)) || i); }
function cxBatchId() { return String((cxState.batch && (cxState.batch._id || cxState.batch.id)) || ""); }
function cxKey(lid) { return cxBatchId() + "-" + lid; }
function cxIsDone(lid) { return !!cxReadDone()[cxKey(lid)]; }
function cxWatchPct(lid) {
  if (cxIsDone(lid)) return 100;
  const dur = Number(cxLsGet("lp:dur:" + cxKey(lid), 0)) || 0, pos = Number(cxLsGet("lp:pos:" + cxKey(lid), 0)) || 0;
  return dur && pos > 10 ? Math.min(99, Math.round((pos / dur) * 100)) : 0;
}
function cxRefreshRows() {
  document.querySelectorAll("#modalContentList .cx-row[data-lid]").forEach((row) => {
    const lid = row.getAttribute("data-lid"), done = cxIsDone(lid), pct = cxWatchPct(lid);
    row.classList.toggle("done", done);
    const c = row.querySelector("[data-chk]");
    if (c) { c.setAttribute("aria-pressed", String(done)); c.setAttribute("aria-label", done ? "Mark as not complete" : "Mark as complete"); }
    const w = row.querySelector(".cx-prog");
    if (w) { w.style.display = pct ? "" : "none"; w.firstChild.style.width = pct + "%"; }
  });
}
function cxSetDone(lid, on) {
  const m = cxReadDone(), k = cxKey(lid);
  if (on) m[k] = 1; else delete m[k];
  try { localStorage.setItem(CX_DONE_KEY, JSON.stringify(m)); } catch (e) {}
  cxRefreshRows();
}
function cxTrackLecture(lec, i) {
  try {
    const b = cxState.batch, id = cxBatchId(), lid = cxLecId(lec, i);
    const arr = cxLsGet(CX_RECENT_KEY, []).filter((x) => !(x && x.b === id && String(x.i) === lid));
    arr.unshift({ b: id, i: lid, t: lec.title || "Lecture", bn: b.name || "", th: b.previewImage || "", s: cxState.subject, at: Date.now() });
    localStorage.setItem(CX_RECENT_KEY, JSON.stringify(arr.slice(0, 10)));
  } catch (e) {}
}

let cxLp = null, cxLpSession = 0, cxLpList = [];
const cxLvEl = () => document.getElementById("cxLv");
const cxLvOpen = () => { const el = cxLvEl(); return !!el && el.classList.contains("open"); };
function cxShowAlt(html) {
  if (cxLp) { try { cxLp.v.pause(); } catch (e) {} }
  document.getElementById("cxLvRoot").style.display = "none";
  const a = document.getElementById("cxLvAlt"); a.innerHTML = html; a.classList.add("show");
}
function cxHideAlt() {
  const a = document.getElementById("cxLvAlt"); a.classList.remove("show"); a.innerHTML = "";
  document.getElementById("cxLvRoot").style.display = "";
}
const cxLpOpts = {
  onBack: () => cxCloseLecture(false),
  onNavigate: (n) => { if (n) cxOpenLecture(n.idx); },
  onSelectLecture: (n) => { if (n) cxOpenLecture(n.idx); },
  onEnded: (d) => { if (d && d.lid) cxSetDone(d.lid, true); }
};

function cxOpenLecture(index) {
  const lec = cxState.items[index];
  const url = lec && cxSafeUrl(lec.url || lec.hlsUrl || lec.videoUrl || "");
  if (!url) return showToast("Is lecture ka video link abhi available nahi hai.");
  if (typeof LecturePlayer === "undefined") return playLecture(url, lec.title);
  cxLpList = cxState.items.map((x, i) => ({ id: cxKey(cxLecId(x, i)), lid: cxLecId(x, i), idx: i, title: x.title || "Lecture " + (i + 1), ok: !!cxSafeUrl(x.url || x.hlsUrl || x.videoUrl || "") }));
  const playable = cxLpList.filter((x) => x.ok);
  const pos = playable.findIndex((x) => x.idx === index);
  const lid = cxLecId(lec, index);
  const mine = ++cxLpSession;
  const el = cxLvEl();
  if (!cxLvOpen()) {
    el.classList.add("open");
    document.body.style.overflow = "hidden";
    try { window.history.pushState({ cx: 3 }, ""); } catch (e) {}
  }
  cxTrackLecture(lec, index);
  cxHideAlt();
  const resume = Number(cxLsGet("lp:pos:" + cxKey(lid), 0)) || 0;
  const d = {
    id: cxKey(lid), lid, idx: index, kind: /\.m3u8(\?|#|$)/i.test(url) ? "h" : "v", title: lec.title || "Lecture",
    videoUrl: url, downloadUrl: null, quality: {}, chapters: [],
    attachments: ((cxState.batch.subjects[cxState.subject] || {}).notes || []).map((n) => ({ title: n.title, url: n.url })),
    course: { title: (cxState.batch.subjects[cxState.subject] || {}).name || cxState.batch.name || "Lectures" },
    lectures: playable,
    previousLecture: pos > 0 ? playable[pos - 1] : null,
    nextLecture: pos >= 0 && pos < playable.length - 1 ? playable[pos + 1] : null,
    startAt: resume > 10 ? resume : 0, autoplay: true
  };
  if (!cxLp) {
    cxLp = new LecturePlayer(document.getElementById("cxLvRoot"), d, cxLpOpts);
    try { LecturePlayer.mediaSession(cxLp, "assets/icon-192.png"); } catch (e) {}
  } else cxLp.load(d);
}

function cxCloseLecture(fromPop) {
  if (!cxLvOpen()) return;
  cxLpSession++;
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
  if (cxLp) { try { cxLp.v.pause(); cxLp.save(); } catch (e) {} }
  cxHideAlt();
  cxLvEl().classList.remove("open");
  document.body.style.overflow = cxState.batch ? "hidden" : "";
  cxRefreshRows();
  if (!fromPop && window.history.state && window.history.state.cx === 3) window.history.back();
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !cxLvOpen() || document.fullscreenElement || (cxLp && cxLp.menu)) return;
  cxCloseLecture(false);
});
window.addEventListener("storage", (e) => { if (e.key === CX_DONE_KEY) cxRefreshRows(); });

// "Recently Watched" -> open the batch, jump to the chapter and play that lecture
async function cxResumeLecture(batch, rec) {
  openBatch(batch);
  const wait = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
  if (!(await wait(() => batch._live && (batch._live.status === "done" || batch._live.status === "error"), 20000))) return;
  const si = Number(rec.s);
  if (!batch.subjects || !batch.subjects[si]) return;
  cxState.subject = si;
  try { window.history.pushState({ cx: 2 }, ""); } catch (e) {}
  const modal = document.getElementById("courseModal"); if (modal) modal.scrollTop = 0;
  cxRender();
  await msLoadSubject(batch, si);
  if (!(await wait(() => batch.subjects[si].loaded, 15000))) return;
  const lecs = batch.subjects[si].lectures;
  const idx = lecs.findIndex((x, i) => cxLecId(x, i) === String(rec.i));
  cxRender();
  if (idx >= 0) cxOpenLecture(idx); else showToast("Ye lecture ab nahi mila.");
}

function playLecture(videoUrl, title) {
  const url = cxSafeUrl(videoUrl);
  if (!url) return showToast("Is lecture ka video link abhi available nahi hai.");
  if (/youtube\.com|youtu\.be/i.test(url)) { window.open(url, "_blank", "noopener"); return; }
  const box = document.getElementById("videoContainer");
  const video = document.getElementById("courseVideo");
  if (!box || !video) return;
  cxStopVideo();
  box.style.display = "block";
  const modal = document.getElementById("courseModal");
  if (modal) modal.scrollTop = 0;

  const start = () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); };
  const isHls = /\.m3u8(\?|#|$)/i.test(url);
  if (isHls) {
    if (window.Hls && Hls.isSupported()) {
      currentHls = new Hls();
      currentHls.loadSource(url);
      currentHls.attachMedia(video);
      currentHls.on(Hls.Events.MANIFEST_PARSED, start);
      currentHls.on(Hls.Events.ERROR, (evt, err) => {
        if (err && err.fatal) { showToast("Video load nahi hua. Link check karein."); cxStopVideo(); }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url; start();
    } else {
      showToast("Is browser me HLS video support nahi hai.");
      box.style.display = "none";
    }
  } else {
    video.src = url; start();
  }
}

function getRecentlyViewed() {
  try { return JSON.parse(localStorage.getItem("codex-studys-recent") || "[]"); }
  catch { return []; }
}

function addRecentlyViewed(batch) {
  const id = batch._id || batch.batch_id;
  if (!id) return;
  const entry = { _id: id, name: batch.name || "Untitled course", byName: batch.byName || "", language: batch.language || "", previewImage: batch.previewImage || "" };
  const recent = getRecentlyViewed().filter((item) => item._id !== id);
  recent.unshift(entry);
  localStorage.setItem("codex-studys-recent", JSON.stringify(recent.slice(0, 8)));
}

const RECENT_LECTURES_KEY = "codex-studys-recent-lectures";
const DONE_KEY = "cx-done";
let recentExpanded = false;

function readJson(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}

function getRecentLectures() {
  const list = readJson(RECENT_LECTURES_KEY, []);
  return Array.isArray(list) ? list.filter((x) => x && x.b && x.i != null).slice(0, 10) : [];
}

function getDoneMap() {
  const map = readJson(DONE_KEY, {});
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

function formatHms(total) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function lectureWatchInfo(item) {
  const id = item.b + "-" + item.i;
  const dur = Number(readJson("lp:dur:" + id, 0)) || 0;
  const done = !!getDoneMap()[id];
  let pos = Number(readJson("lp:pos:" + id, 0)) || 0;
  if (done) pos = dur;
  if (dur) pos = Math.min(pos, dur);
  const pct = done ? 100 : dur ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
  return { pos, dur, pct, done };
}

function openRecentLecture(item) {
  const full = allBatches.find((batch) => String(batch._id || batch.batch_id) === String(item.b));
  if (!full) return showToast("This batch is not available right now.");
  try { window.CXProfile && window.CXProfile.trackBatch(full); } catch (e) {}
  cxResumeLecture(full, item);
}

function renderRecentlyWatched() {
  const statRecent = document.getElementById("statRecent");
  if (statRecent) statRecent.textContent = String(getRecentlyViewed().length);
  const section = document.getElementById("recentSection");
  const row = document.getElementById("recentRow");
  if (!section || !row) return;
  const items = getRecentLectures();
  if (!items.length) { section.style.display = "none"; row.innerHTML = ""; recentExpanded = false; return; }
  section.style.display = "block";
  if (items.length < 2) recentExpanded = false;
  const viewAll = document.getElementById("recentViewAll");
  if (viewAll) {
    viewAll.style.display = items.length > 1 ? "" : "none";
    viewAll.textContent = recentExpanded ? "Show Less" : "View All ›";
    viewAll.setAttribute("aria-expanded", recentExpanded ? "true" : "false");
  }
  const shown = recentExpanded ? items : items.slice(0, 1);
  row.innerHTML = shown.map((item, index) => {
    const info = lectureWatchInfo(item);
    return `
    <button class="rw-item${info.done ? " full" : ""}" type="button" data-recent-index="${index}">
      <img class="rw-thumb" src="${escapeHtml(item.th || FALLBACK_THUMB)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${FALLBACK_THUMB}'">
      <span class="rw-info">
        <span class="rw-name">${escapeHtml(item.t || "Lecture")}</span>
        <span class="rw-meta"><span>${formatHms(info.pos)} / ${formatHms(info.dur)}</span><span class="rw-pct">Watched: ${info.pct}%</span></span>
        <span class="rw-bar"><i style="width:${info.pct}%"></i></span>
      </span>
    </button>`;
  }).join("");
  row.querySelectorAll("[data-recent-index]").forEach((button) => {
    button.addEventListener("click", () => openRecentLecture(shown[Number(button.dataset.recentIndex)]));
  });
}

function setupRecentlyWatched() {
  renderRecentlyWatched();
  document.getElementById("recentViewAll")?.addEventListener("click", () => {
    recentExpanded = !recentExpanded;
    renderRecentlyWatched();
  });
  document.getElementById("recentClearBtn")?.addEventListener("click", () => {
    localStorage.removeItem(RECENT_LECTURES_KEY);
    recentExpanded = false;
    renderRecentlyWatched();
    showToast("Recently watched cleared.");
  });
  const refresh = () => renderRecentlyWatched();
  window.addEventListener("pageshow", refresh);
  window.addEventListener("storage", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}

function setupQuickInstall() {
  const button = document.getElementById("installQuickBtn");
  if (!button) return;
  button.addEventListener("click", () => openModal("installModal"));
}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem("codex-studys-favorites") || "[]"); }
  catch { return []; }
}

function isFavorite(id) {
  return getFavorites().includes(id);
}

function toggleFavorite(id) {
  const favorites = getFavorites();
  const index = favorites.indexOf(id);
  if (index === -1) favorites.push(id); else favorites.splice(index, 1);
  localStorage.setItem("codex-studys-favorites", JSON.stringify(favorites));
  return favorites.includes(id);
}

function updateFavoritesCount() {
  const count = getFavorites().length;
  const button = $('.filter-row .filter[data-filter="favorites"]');
  if (button) button.textContent = count ? `❤ Favorite Batches (${count})` : "❤ Favorite Batches";
  const navBadge = $("#favNavBadge");
  if (navBadge) {
    navBadge.textContent = String(count);
    navBadge.style.display = count ? "grid" : "none";
  }
  const statFav = $("#statFav");
  if (statFav) statFav.textContent = count.toLocaleString();
}

function filteredBatches() {
  let batches;
  if (activeFilter === "favorites") {
    const favorites = getFavorites();
    batches = allBatches.filter((batch) => favorites.includes(batch._id || batch.batch_id || ""));
  } else {
    batches = allBatches.filter((batch) => activeFilter === "all" || categoryFor(batch) === activeFilter);
  }
  if (langFilter !== "all") {
    batches = batches.filter((batch) => (batch.language || "").toLowerCase().includes(langFilter));
  }
  if (searchQuery.trim()) {
    batches = deepSearch(batches, searchQuery);
  }
  if (sortMode === "az") {
    batches = [...batches].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  } else if (sortMode === "za") {
    batches = [...batches].sort((a, b) => (b.name || "").localeCompare(a.name || ""));
  } else if (sortMode === "newest") {
    batches = [...batches].sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));
  }
  return batches;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date)) return "";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function isRecent(value) {
  if (!value) return false;
  const date = new Date(value);
  if (isNaN(date)) return false;
  const days = (Date.now() - date.getTime()) / 86400000;
  return days >= 0 && days <= 21;
}

function courseCard(batch) {
  const title = escapeHtml(batch.name || "Untitled course");
  const description = escapeHtml(batch.byName || "Structured learning for your next milestone");
  const language = escapeHtml(batch.language || "Self-paced");
  const category = categoryFor(batch);
  const image = escapeHtml(batch.previewImage || FALLBACK_THUMB);
  const id = escapeHtml(batch._id || batch.batch_id || "");
  const favActive = isFavorite(id);
  const startDate = formatDate(batch.startDate);
  const fresh = isRecent(batch.startDate);
  return `
    <article class="course-card" data-id="${id}" tabindex="0" role="button" aria-label="Open ${title}">
      <div class="course-thumb">
        <div class="thumb-fallback thumb-shimmer"></div>
        <img src="${image}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.add('loaded');this.previousElementSibling.style.display='none'" onerror="this.style.display='none'">
        <span class="course-tag">${escapeHtml(category)}</span>
        ${fresh ? '<span class="course-tag course-tag-new">NEW</span>' : ""}
        <button class="fav-btn${favActive ? " active" : ""}" type="button" data-fav-id="${id}" aria-label="${favActive ? "Remove from favorites" : "Add to favorites"}" aria-pressed="${favActive}">
          <svg viewBox="0 0 24 24" fill="${favActive ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M12 21s-7.2-4.5-9.6-9C.6 8.1 2.4 4.5 6 4.2c2.1-.15 3.6 1.05 6 3.3 2.4-2.25 3.9-3.45 6-3.3 3.6.3 5.4 3.9 3.6 7.8-2.4 4.5-9.6 9-9.6 9Z"/></svg>
        </button>
        <button class="info-btn" type="button" data-info-id="${id}" aria-label="Quick view details">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.6"/></svg>
        </button>
        ${getNote(id) ? '<span class="note-badge">📝 Note</span>' : ""}
      </div>
      <div class="course-chips"><span class="chip">${language}</span><span class="chip chip-accent">${escapeHtml(category)}</span></div>
      <div class="course-body">
        <h3 class="course-title">${title}</h3>
        <p class="course-description">${description}</p>
        <div class="course-meta"><span>${startDate ? `📅 ${startDate}` : language}</span><button class="course-cta" type="button">Let's Study <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></div>
      </div>
    </article>`;
}

function syncUrlParams() {
  const params = new URLSearchParams();
  if (activeFilter !== "all") params.set("filter", activeFilter);
  if (searchQuery.trim()) params.set("q", searchQuery.trim());
  if (sortMode !== "relevance") params.set("sort", sortMode);
  if (langFilter !== "all") params.set("lang", langFilter);
  const query = params.toString();
  const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState(null, "", newUrl);
}

function renderBatches() {
  const grid = $("#batchGrid");
  const loadMoreBtn = $("#loadMoreBtn");
  const batches = filteredBatches();
  const visible = batches.slice(0, visibleCount);
  const filterLabel = activeFilter === "all" ? "courses" : activeFilter === "favorites" ? "favorite courses" : `${activeFilter.toUpperCase()} courses`;
  const noteText = batches.length
    ? `Showing ${visible.length} of ${batches.length.toLocaleString()} ${filterLabel}.`
    : activeFilter === "favorites" ? "No favorites yet. Tap the heart on any course to save it here." : "No courses matched that filter yet.";
  $("#resultsNote").textContent = noteText;
  const announcer = $("#filterAnnouncer");
  if (announcer) announcer.textContent = noteText;
  grid.innerHTML = visible.length ? visible.map(courseCard).join("") : '<div class="empty">Try another category or search the full library.</div>';
  $$(".course-card").forEach((card, index) => {
    card.addEventListener("click", () => openBatch(visible[index]));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openBatch(visible[index]);
      }
    });
  });
  $$(".fav-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const nowActive = toggleFavorite(button.dataset.favId);
      button.classList.toggle("active", nowActive);
      button.setAttribute("aria-pressed", String(nowActive));
      button.querySelector("svg").setAttribute("fill", nowActive ? "currentColor" : "none");
      if (nowActive) {
        button.classList.remove("pop");
        void button.offsetWidth;
        button.classList.add("pop");
      }
      if (activeFilter === "favorites" && !nowActive) renderBatches();
      updateFavoritesCount();
    });
  });
  $$(".info-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const batch = visible.find((item) => (item._id || item.batch_id || "") === button.dataset.infoId);
      if (batch) openDetail(batch);
    });
  });
  if (loadMoreBtn) {
    const remaining = batches.length - visible.length;
    loadMoreBtn.style.display = remaining > 0 ? "inline-flex" : "none";
    loadMoreBtn.textContent = remaining > 0 ? "Loading more courses…" : "";
  }
  const clearBtn = $("#clearFiltersBtn");
  if (clearBtn) clearBtn.style.display = (activeFilter !== "all" || searchQuery.trim()) ? "inline-flex" : "none";
  syncUrlParams();
}

function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem("codex-studys-search-history") || "[]"); }
  catch { return []; }
}

function addSearchHistory(term) {
  const trimmed = term.trim();
  if (!trimmed) return;
  const history = getSearchHistory().filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
  history.unshift(trimmed);
  localStorage.setItem("codex-studys-search-history", JSON.stringify(history.slice(0, 6)));
}

function highlightMatch(text, query) {
  const safe = escapeHtml(text || "");
  if (!query) return safe;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).map((w) => escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return safe;
  return safe.replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>");
}

function renderSearchResults(query = "") {
  const results = $("#searchResults");
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    const history = getSearchHistory();
    const recent = getRecentlyViewed();
    if (!history.length && !recent.length) {
      results.innerHTML = '<div class="search-hint">Start typing to find your next course.</div>';
      return;
    }
    let html = "";
    if (history.length) {
      html += `<div class="search-hint" style="text-align:left;margin-bottom:2px;">Recent searches</div>
        <div class="search-history-row">${history.map((term) => `<button type="button" class="search-history-chip">${escapeHtml(term)}</button>`).join("")}</div>`;
    }
    if (recent.length) {
      html += `<div class="search-hint" style="text-align:left;margin-bottom:2px;">Recently viewed</div>` + recent.map((batch) => `
        <div class="search-result" data-id="${escapeHtml(batch._id)}">
          <div class="search-result-thumb">${batch.previewImage ? `<img src="${escapeHtml(batch.previewImage)}" alt="" referrerpolicy="no-referrer" onerror="window.__thumbFallback(this)">` : THUMB_PLACEHOLDER_SVG}</div>
          <div><strong>${escapeHtml(batch.name)}</strong><small>${escapeHtml(batch.byName || batch.language || "Course")}</small></div>
        </div>`).join("");
    }
    results.innerHTML = html;
    $$(".search-history-chip").forEach((chip, index) => chip.addEventListener("click", () => {
      const input = $("#searchInput");
      if (input) { input.value = history[index]; renderSearchResults(history[index]); }
    }));
    $$(".search-result").forEach((result, index) => result.addEventListener("click", () => {
      openBatch(recent[index]);
      closeModal("searchModal");
    }));
    return;
  }
  const matches = deepSearch(allBatches, normalized).slice(0, 40);
  if (!matches.length) {
    results.innerHTML = '<div class="search-hint">No matches yet. Try a subject, exam or class.</div>';
    return;
  }
  results.innerHTML = `<div class="search-hint" style="text-align:left;margin-bottom:2px;">${matches.length} result${matches.length === 1 ? "" : "s"}</div>` + matches.map((batch) => `
    <div class="search-result" data-id="${escapeHtml(batch._id || batch.batch_id || "")}">
      <div class="search-result-thumb">${batch.previewImage ? `<img src="${escapeHtml(batch.previewImage)}" alt="" referrerpolicy="no-referrer" onerror="window.__thumbFallback(this)">` : THUMB_PLACEHOLDER_SVG}</div>
      <div><strong>${highlightMatch(batch.name || "Untitled course", normalized)}</strong><small>${escapeHtml(batch.byName || batch.language || "Course")}</small></div>
      ${isRecent(batch.startDate) ? '<span class="search-new-badge">new</span>' : ""}
    </div>`).join("");
  $$(".search-result").forEach((result, index) => result.addEventListener("click", () => {
    openBatch(matches[index]);
    closeModal("searchModal");
  }));
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  $$(".overlay.visible").forEach((other) => { if (other.id !== id) other.classList.remove("visible"); });
  modal.classList.add("visible");
  document.body.classList.add("modal-open");
  modal.querySelector("input")?.focus();
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("visible");
  if (!$$(".overlay.visible").length) document.body.classList.remove("modal-open");
}

function showToast(message) {
  const oldToast = $(".toast");
  oldToast?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

const BATCH_CACHE_KEY = "cx-batches-cache-v1";

function readBatchCache() {
  try {
    const raw = sessionStorage.getItem(BATCH_CACHE_KEY);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) && list.length ? list : null;
  } catch (e) { return null; }
}

function restoreScroll() {
  try {
    const y = Number(sessionStorage.getItem("cx-scroll") || 0);
    sessionStorage.removeItem("cx-scroll");
    if (y > 0) window.requestAnimationFrame(() => window.scrollTo(0, y));
  } catch (e) {}
}

async function loadBatches() {
  const cached = readBatchCache();
  let usedCache = false;
  try {
    const grid = $("#batchGrid");
    if (cached) {
      // coming back from a batch: show the list instantly, refresh quietly in the background
      allBatches = cached;
      usedCache = true;
      updateStats();
      renderBatches();
      $("#globalPreloader").classList.add("hidden");
      restoreScroll();
    } else if (grid && !allBatches.length) {
      grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton-card"><div class="skeleton-thumb"></div><div class="skeleton-body"><div class="skeleton-line" style="width:88%"></div><div class="skeleton-line" style="width:60%"></div><div class="skeleton-line" style="width:40%"></div></div></div>').join("");
    }
    const response = await fetch("batches.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Course library unavailable");
    const data = await response.json();
    const fresh = Array.isArray(data.batches) ? data.batches : [];
    const changed = JSON.stringify(fresh) !== JSON.stringify(allBatches);
    allBatches = fresh;
    try { sessionStorage.setItem(BATCH_CACHE_KEY, JSON.stringify(fresh)); sessionStorage.setItem("cx-loaded", "1"); } catch (e) {}
    if (changed || !usedCache) { updateStats(); renderBatches(); }
    setTimeout(() => { allBatches.forEach((b) => { if (b && b.source === "mastersahab") msLoadBatch(b); }); }, 600);
    const updatedNote = $("#dataUpdatedNote");
    if (updatedNote) updatedNote.textContent = `· library refreshed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    console.error(error);
    if (!usedCache) {
      $("#resultsNote").textContent = "The course library could not be loaded.";
      $("#batchGrid").innerHTML = '<div class="empty">Please refresh to reconnect to the course library.</div>';
      showToast("Course library unavailable");
    }
  } finally {
    $("#globalPreloader").classList.add("hidden");
  }
}

function setupNavigation() {
  const menu = $("#navLinks");
  const menuButton = $("#menuBtn");
  menuButton.addEventListener("click", () => {
    const open = menu.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  $$(".nav-link").forEach((link) => link.addEventListener("click", () => {
    menu.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  }));
  const sections = $$("main section[id]");
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) {
      $$(".nav-link").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
    }
  }), { rootMargin: "-35% 0px -55% 0px" });
  sections.forEach((section) => observer.observe(section));
}

function setupHeaderActions() {
  const refreshBtn = $("#refreshBtn");
  refreshBtn?.addEventListener("click", async () => {
    if (refreshBtn.classList.contains("spinning")) return;
    refreshBtn.classList.add("spinning");
    await loadBatches();
    showToast("Course library refreshed.");
    refreshBtn.classList.remove("spinning");
  });
  $("#favNavBtn")?.addEventListener("click", () => {
    activeFilter = "favorites";
    localStorage.setItem("codex-studys-last-filter", "favorites");
    visibleCount = PAGE_SIZE;
    $$(".filter-row .filter").forEach((item) => item.classList.toggle("active", item.dataset.filter === "favorites"));
    renderBatches();
    $("#courses")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function setupModals() {
  $("#searchBtn").addEventListener("click", () => {
    openModal("searchModal");
    renderSearchResults($("#searchInput").value);
  });
  let modalSearchDebounce;
  $("#searchInput").addEventListener("input", (event) => {
    const value = event.target.value;
    clearTimeout(modalSearchDebounce);
    modalSearchDebounce = setTimeout(() => renderSearchResults(value), 120);
  });
  $("#searchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.value.trim()) addSearchHistory(event.target.value);
  });
  $$("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
  $$(".overlay").forEach((overlay) => overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal(overlay.id);
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") $$(".overlay.visible").forEach((modal) => closeModal(modal.id));
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openModal("searchModal");
      renderSearchResults($("#searchInput").value);
    }
  });
}

function setupFilters() {
  updateFavoritesCount();
  const filterKey = "codex-studys-last-filter";
  const urlParams = new URLSearchParams(window.location.search);
  const urlFilter = urlParams.get("filter");
  const urlQuery = urlParams.get("q");
  const urlSort = urlParams.get("sort");
  const savedFilter = urlFilter || localStorage.getItem(filterKey);
  const savedButton = savedFilter && $(`.filter-row .filter[data-filter="${savedFilter}"]`);
  if (savedButton) {
    activeFilter = savedFilter;
    $$(".filter-row .filter").forEach((item) => item.classList.toggle("active", item === savedButton));
  }
  if (urlQuery) {
    searchQuery = urlQuery;
    const inlineSearchEl = $("#inlineSearchInput");
    if (inlineSearchEl) inlineSearchEl.value = urlQuery;
  }
  if (urlSort && ["relevance", "newest", "az", "za"].includes(urlSort)) {
    sortMode = urlSort;
    const sortSelectEl = $("#sortSelect");
    if (sortSelectEl) sortSelectEl.value = urlSort;
  }
  const urlLang = urlParams.get("lang");
  if (urlLang && ["hindi", "english", "hinglish"].includes(urlLang)) {
    langFilter = urlLang;
    const langSelectEl = $("#langSelect");
    if (langSelectEl) langSelectEl.value = urlLang;
  }
  $$(".filter-row .filter").forEach((button) => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    localStorage.setItem(filterKey, activeFilter);
    visibleCount = PAGE_SIZE;
    $$(".filter-row .filter").forEach((item) => item.classList.toggle("active", item === button));
    renderBatches();
  }));
  const inlineSearch = $("#inlineSearchInput");
  let searchDebounce;
  inlineSearch?.addEventListener("input", (event) => {
    const value = event.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = value;
      visibleCount = PAGE_SIZE;
      renderBatches();
    }, 150);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
    const active = document.activeElement;
    const typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    if (typing) return;
    event.preventDefault();
    inlineSearch?.focus();
  });
  $("#sortSelect")?.addEventListener("change", (event) => {
    sortMode = event.target.value;
    visibleCount = PAGE_SIZE;
    renderBatches();
  });
  $("#langSelect")?.addEventListener("change", (event) => {
    langFilter = event.target.value;
    visibleCount = PAGE_SIZE;
    renderBatches();
  });
  $("#copyLinkBtn")?.addEventListener("click", () => {
    syncUrlParams();
    const url = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => showToast("Link copied!")).catch(() => showToast("Could not copy link"));
    } else {
      showToast("Copy not supported on this browser");
    }
  });
  $("#clearFiltersBtn")?.addEventListener("click", () => {
    activeFilter = "all";
    searchQuery = "";
    sortMode = "relevance";
    langFilter = "all";
    const langSelectEl = $("#langSelect");
    if (langSelectEl) langSelectEl.value = "all";
    visibleCount = PAGE_SIZE;
    localStorage.setItem(filterKey, "all");
    if (inlineSearch) inlineSearch.value = "";
    const sortSelectEl = $("#sortSelect");
    if (sortSelectEl) sortSelectEl.value = "relevance";
    $$(".filter-row .filter").forEach((item) => item.classList.toggle("active", item.dataset.filter === "all"));
    renderBatches();
  });
}

function setupLoadMore() {
  const loadMoreBtn = $("#loadMoreBtn");
  if (!loadMoreBtn) return;
  const loadNext = () => {
    visibleCount += PAGE_SIZE;
    renderBatches();
  };
  loadMoreBtn.addEventListener("click", loadNext);
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && loadMoreBtn.style.display !== "none") loadNext();
    });
  }, { rootMargin: "600px" });
  observer.observe(loadMoreBtn);
}

function setupAnnouncements() {
  const key = "codex-studys-announce-seen";
  const badge = document.querySelector("#announceBtn .icon-badge");
  if (localStorage.getItem(key) === "true") badge?.remove();
  $("#announceBtn")?.addEventListener("click", () => {
    openModal("announceModal");
    localStorage.setItem(key, "true");
    badge?.remove();
  });
  $("#announceCopyLink")?.addEventListener("click", () => {
    const url = window.location.origin + window.location.pathname;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => showToast("Link copied!")).catch(() => showToast("Could not copy link"));
    } else {
      showToast("Copy not supported on this browser");
    }
  });
}

const THEME_COLORS = {
  light: "#f4f5f9", dark: "#090b10", sandalwood: "#1c130c", "forest-emerald": "#06140f",
  "ocean-deep": "#050e17", "sakura-blossom": "#fff3f6", "dracula-midnight": "#14121f",
  "lavender-mist": "#f5f2fc", "cyberpunk-neon": "#05020a"
};

function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const current = document.documentElement.getAttribute("data-theme");
  meta.setAttribute("content", THEME_COLORS[current] || THEME_COLORS.dark);
}

function setupThemePicker() {
  syncThemeColor();
  const key = "codex-studys-theme";
  const markActive = () => {
    const current = localStorage.getItem(key) || "system";
    $$(".theme-option").forEach((option) => option.classList.toggle("active", option.dataset.theme === current));
  };
  $("#themeBtn")?.addEventListener("click", () => {
    markActive();
    openModal("themeModal");
  });
  $$(".theme-option").forEach((option) => option.addEventListener("click", () => {
    const theme = option.dataset.theme;
    localStorage.setItem(key, theme);
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
      if (prefersLight) document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    syncThemeColor();
    markActive();
  }));
}

/* ================= Animation Effects ================= */
function setupFxEngine() {
  const ENABLED_KEY = "codex-studys-fx-enabled";
  const EFFECT_KEY = "codex-studys-fx-effect";
  const INTENSITY_KEY = "codex-studys-fx-intensity";
  const SCALE = [0.55, 1, 1.85];

  const enableToggle = $("#fxEnableToggle");
  const grid = $("#effectsGrid");
  const intensityInput = $("#fxIntensity");
  const fxBtn = $("#fxBtn");
  if (!grid) return;

  let canvas = null, ctx = null, rafId = null, dpr = 1, running = false, last = 0;
  let particles = [], bolts = [], flash = 0, burstTimer = 0, boltTimer = 0;
  let effect = localStorage.getItem(EFFECT_KEY) || "rain";
  let intensity = Number(localStorage.getItem(INTENSITY_KEY));
  if (!Number.isInteger(intensity) || intensity < 0 || intensity > 2) intensity = 1;
  let enabled = localStorage.getItem(ENABLED_KEY) === "true";

  const reducedMotion = () =>
    document.documentElement.getAttribute("data-reduced-motion") === "true" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "fxCanvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
  }

  function resizeCanvas() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function density(base) {
    const w = window.innerWidth;
    const dscale = w < 480 ? 0.5 : w < 900 ? 0.75 : 1;
    return Math.max(6, Math.round(base * dscale * SCALE[intensity]));
  }

  function seed() {
    const w = window.innerWidth, h = window.innerHeight;
    particles = []; bolts = []; flash = 0; burstTimer = 0; boltTimer = 0;
    if (effect === "rain" || effect === "storm") {
      const n = density(effect === "storm" ? 100 : 75);
      for (let i = 0; i < n; i++) particles.push({
        x: Math.random() * w, y: Math.random() * h - h,
        len: 14 + Math.random() * 16, speed: 7 + Math.random() * 7,
        drift: effect === "storm" ? 2.6 : 0.7
      });
    } else if (effect === "snow") {
      const n = density(70);
      for (let i = 0; i < n; i++) particles.push({
        x: Math.random() * w, y: Math.random() * h,
        r: 1.5 + Math.random() * 2.6, speed: 0.6 + Math.random() * 1.3,
        phase: Math.random() * Math.PI * 2, amp: 10 + Math.random() * 20
      });
    } else if (effect === "hail") {
      const n = density(55);
      for (let i = 0; i < n; i++) particles.push({
        x: Math.random() * w, y: Math.random() * h - h,
        r: 2 + Math.random() * 2, speed: 10 + Math.random() * 6, drift: 1.4
      });
    } else if (effect === "fireball") {
      const n = density(40);
      for (let i = 0; i < n; i++) particles.push({
        x: Math.random() * w, y: h + Math.random() * 100,
        r: 2 + Math.random() * 3.2, speed: 0.7 + Math.random() * 1.3,
        drift: Math.random() * 1.2 - 0.6, flick: Math.random() * Math.PI * 2
      });
    }
  }

  function spawnBurst(w, h) {
    const cx = 40 + Math.random() * (w - 80);
    const cy = 60 + Math.random() * (h * 0.45);
    const hue = Math.floor(Math.random() * 360);
    const count = density(26);
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const sp = 1.6 + Math.random() * 2.2;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue });
    }
  }

  function spawnBolt(w, h) {
    const points = [];
    let x = 60 + Math.random() * Math.max(w - 120, 20), y = 0;
    points.push({ x, y });
    while (y < h * 0.7) {
      y += 18 + Math.random() * 22;
      x += (Math.random() - 0.5) * 40;
      points.push({ x, y });
    }
    bolts.push({ points, life: 1 });
    flash = 0.35;
  }

  function step(dt, w, h) {
    ctx.clearRect(0, 0, w, h);
    if (effect === "rain" || effect === "storm") {
      ctx.strokeStyle = "rgba(160,200,255,.55)";
      ctx.lineWidth = 1.3;
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.drift * 3, p.y + p.len);
        ctx.stroke();
        p.y += p.speed * dt * 60; p.x += p.drift * dt * 60;
        if (p.y > h) { p.y = -p.len; p.x = Math.random() * w; }
      });
      if (effect === "storm") {
        boltTimer -= dt;
        if (boltTimer <= 0) { spawnBolt(w, h); boltTimer = 2.5 + Math.random() * 4; }
      }
    } else if (effect === "snow") {
      ctx.fillStyle = "rgba(255,255,255,.85)";
      particles.forEach((p) => {
        p.phase += dt;
        const x = p.x + Math.sin(p.phase) * p.amp * 0.02;
        ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        p.y += p.speed * dt * 60;
        if (p.y > h) { p.y = -4; p.x = Math.random() * w; }
      });
    } else if (effect === "hail") {
      ctx.fillStyle = "rgba(220,235,255,.9)";
      particles.forEach((p) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        p.y += p.speed * dt * 60; p.x += p.drift * dt * 60;
        if (p.y > h) { p.y = -6; p.x = Math.random() * w; }
      });
    } else if (effect === "fireball") {
      particles.forEach((p) => {
        p.flick += dt * 6;
        const alpha = 0.5 + Math.sin(p.flick) * 0.3;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        grad.addColorStop(0, `rgba(255,180,80,${alpha})`);
        grad.addColorStop(1, "rgba(255,80,20,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill();
        p.y -= p.speed * dt * 60; p.x += p.drift * dt * 30;
        if (p.y < -10) { p.y = h + Math.random() * 40; p.x = Math.random() * w; }
      });
    } else if (effect === "firecracker") {
      burstTimer -= dt;
      if (burstTimer <= 0) { spawnBurst(w, h); burstTimer = 1.1 + Math.random() * (2.6 - intensity * 0.7); }
      particles = particles.filter((p) => p.life > 0);
      particles.forEach((p) => {
        p.vy += dt * 1.6; p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.life -= dt * 0.9;
        ctx.fillStyle = `hsla(${p.hue},95%,65%,${Math.max(p.life, 0)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill();
      });
    } else if (effect === "lightning") {
      boltTimer -= dt;
      if (boltTimer <= 0) { spawnBolt(w, h); boltTimer = 2.6 + Math.random() * (5 - intensity); }
    }

    if (effect === "storm" || effect === "lightning") {
      bolts = bolts.filter((b) => b.life > 0);
      bolts.forEach((b) => {
        ctx.strokeStyle = `rgba(220,235,255,${b.life})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        b.points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        ctx.stroke();
        b.life -= dt * 1.8;
      });
      if (flash > 0) {
        ctx.fillStyle = `rgba(210,225,255,${flash})`;
        ctx.fillRect(0, 0, w, h);
        flash -= dt * 0.9;
      }
    }
  }

  function loop(ts) {
    if (!running) return;
    const dt = Math.min((ts - last) / 1000 || 0, 0.05);
    last = ts;
    step(dt, window.innerWidth, window.innerHeight);
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    ensureCanvas();
    seed();
    running = true;
    last = 0;
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  function apply() {
    if (enabled && !reducedMotion() && !document.hidden) start(); else stop();
  }

  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else apply(); });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", apply);
  window.__codexFxApply = apply;

  function markActive() {
    $$(".effect-option").forEach((btn) => btn.classList.toggle("active", btn.dataset.effect === effect));
  }
  enableToggle?.setAttribute("aria-checked", String(enabled));
  if (intensityInput) intensityInput.value = String(intensity);
  markActive();

  enableToggle?.addEventListener("click", () => {
    enabled = enableToggle.getAttribute("aria-checked") !== "true";
    enableToggle.setAttribute("aria-checked", String(enabled));
    localStorage.setItem(ENABLED_KEY, String(enabled));
    apply();
  });

  grid.addEventListener("click", (event) => {
    const btn = event.target.closest(".effect-option");
    if (!btn) return;
    effect = btn.dataset.effect;
    localStorage.setItem(EFFECT_KEY, effect);
    markActive();
    if (running) { stop(); apply(); }
  });

  intensityInput?.addEventListener("input", () => {
    intensity = Number(intensityInput.value);
    localStorage.setItem(INTENSITY_KEY, String(intensity));
    if (running) seed();
  });

  fxBtn?.addEventListener("click", () => openModal("effectsModal"));

  if (enabled) apply();
}

/* ================= Network Status ================= */
function setupNetworkStatus() {
  const netBtn = $("#netBtn");
  const typeEl = $("#netType");
  const pingEl = $("#netPing");
  const latencyEl = $("#netLatency");
  const bwEl = $("#netBandwidth");
  const statusEl = $("#netStatus");
  const refreshBtn = $("#netRefreshBtn");
  if (!netBtn || !typeEl) return;

  let pollTimer = null;
  const PING_ASSET = "assets/icon-192.png";

  function connInfo() {
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  }
  function typeLabel() {
    const c = connInfo();
    if (c) {
      const t = c.type && c.type !== "unknown" ? c.type : c.effectiveType;
      if (t) return t === "wifi" ? "Wi-Fi" : t.toUpperCase();
    }
    return "Unknown";
  }
  function bandwidthLabel() {
    const c = connInfo();
    return c && typeof c.downlink === "number" ? `${c.downlink} Mbps` : "—";
  }
  function setStatus(online) {
    statusEl.innerHTML = `<span class="net-status-dot${online ? "" : " offline"}"></span>${online ? "Online" : "Offline"}`;
  }

  async function measure() {
    if (!navigator.onLine) {
      typeEl.textContent = "Offline"; pingEl.textContent = "—"; latencyEl.textContent = "—";
      bwEl.textContent = "—"; setStatus(false);
      return;
    }
    typeEl.textContent = typeLabel();
    bwEl.textContent = bandwidthLabel();
    setStatus(true);
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      try {
        await fetch(`${PING_ASSET}?_=${Date.now()}_${i}`, { method: "HEAD", cache: "no-store" });
        samples.push(performance.now() - t0);
      } catch (error) { /* ignore a single dropped sample */ }
    }
    if (samples.length) {
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      pingEl.textContent = `${Math.round(avg)} ms`;
      const entries = performance.getEntriesByType("resource").filter((r) => r.name.includes(PING_ASSET));
      const lastEntry = entries[entries.length - 1];
      const ttfb = lastEntry ? Math.max(0, lastEntry.responseStart - lastEntry.requestStart) : avg * 0.4;
      latencyEl.textContent = `${Math.round(ttfb || avg * 0.4)} ms`;
    } else {
      pingEl.textContent = "Timeout"; latencyEl.textContent = "—"; setStatus(false);
    }
  }

  function startPolling() {
    measure();
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => {
      const modal = document.getElementById("networkModal");
      if (!modal || !modal.classList.contains("visible")) {
        window.clearInterval(pollTimer); pollTimer = null; return;
      }
      measure();
    }, 8000);
  }

  netBtn.addEventListener("click", () => { openModal("networkModal"); startPolling(); });
  refreshBtn?.addEventListener("click", measure);
}

const POPUP_SNOOZE_KEY = "codex-studys-popups-snooze";
const POPUP_SNOOZE_MS = 24 * 60 * 60 * 1000;

function popupsSnoozed() {
  try {
    const until = Number(localStorage.getItem(POPUP_SNOOZE_KEY) || 0);
    return until > Date.now();
  } catch (e) { return false; }
}

function setupTelegramPopup() {
  document.querySelectorAll("[data-snooze-popups]").forEach((btn) => {
    btn.addEventListener("click", () => {
      try { localStorage.setItem(POPUP_SNOOZE_KEY, String(Date.now() + POPUP_SNOOZE_MS)); } catch (e) {}
      closeModal("telegramModal");
      closeModal("installModal");
      showToast("Popups 24 ghante ke liye band");
    });
  });
  return; // Auto popup disabled (remove this line to re-enable the auto popups)
  if (popupsSnoozed()) return;
  let seen = false;
  try { seen = sessionStorage.getItem("cx-popups-shown") === "1"; } catch (e) {}
  if (seen) return; // already shown this session (e.g. coming back from a batch)
  window.setTimeout(() => {
    try { sessionStorage.setItem("cx-popups-shown", "1"); } catch (e) {}
    openModal("telegramModal");
    const modal = document.getElementById("telegramModal");
    if (!modal) return;
    const watcher = window.setInterval(() => {
      if (!modal.classList.contains("visible")) {
        window.clearInterval(watcher);
        window.setTimeout(() => { if (!isStandaloneApp() && !popupsSnoozed()) openModal("installModal"); }, 200);
      }
    }, 150);
  }, 700);
}

let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function setupInstallPrompt() {
  if (isStandaloneApp()) return;
  const installBtn = $("#installActionBtn");
  const iosSteps = $("#iosInstallSteps");
  const body = $("#installBody");

  const showForIOS = () => {
    if (installBtn) installBtn.style.display = "none";
    if (iosSteps) iosSteps.style.display = "grid";
    if (body) body.textContent = "Add CODEX STUDYS to your home screen for a faster, app-like experience.";
  };

  installBtn?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    closeModal("installModal");
    if (outcome === "accepted") showToast("Installing CODEX STUDYS…");
  });

  window.addEventListener("appinstalled", () => {
    closeModal("installModal");
    showToast("CODEX STUDYS installed!");
  });

  if (isIOSDevice()) showForIOS();
}

function setupOfflineBanner() {
  const banner = $("#offlineBanner");
  if (!banner) return;
  const update = () => banner.classList.toggle("visible", !navigator.onLine);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

function setupViewToggle() {
  const key = "codex-studys-view";
  const grid = $("#batchGrid");
  const gridBtn = $("#gridViewBtn");
  const listBtn = $("#listViewBtn");
  if (!grid || !gridBtn || !listBtn) return;
  const apply = (mode) => {
    grid.classList.toggle("list-view", mode === "list");
    gridBtn.classList.toggle("active", mode !== "list");
    gridBtn.setAttribute("aria-pressed", String(mode !== "list"));
    listBtn.classList.toggle("active", mode === "list");
    listBtn.setAttribute("aria-pressed", String(mode === "list"));
  };
  apply(localStorage.getItem(key) || "grid");
  gridBtn.addEventListener("click", () => { localStorage.setItem(key, "grid"); apply("grid"); });
  listBtn.addEventListener("click", () => { localStorage.setItem(key, "list"); apply("list"); });
}

function setupPreferences() {
  const contrastToggle = $("#contrastToggle");
  const motionToggle = $("#motionToggle");

  const applyContrast = (on) => {
    document.documentElement.setAttribute("data-contrast", on ? "high" : "normal");
    contrastToggle?.setAttribute("aria-checked", String(on));
  };
  const applyMotion = (on) => {
    document.documentElement.setAttribute("data-reduced-motion", String(on));
    motionToggle?.setAttribute("aria-checked", String(on));
  };
  applyContrast(localStorage.getItem("codex-studys-contrast") === "true");
  applyMotion(localStorage.getItem("codex-studys-reduced-motion") === "true");

  contrastToggle?.addEventListener("click", () => {
    const on = contrastToggle.getAttribute("aria-checked") !== "true";
    localStorage.setItem("codex-studys-contrast", String(on));
    applyContrast(on);
  });
  motionToggle?.addEventListener("click", () => {
    const on = motionToggle.getAttribute("aria-checked") !== "true";
    localStorage.setItem("codex-studys-reduced-motion", String(on));
    applyMotion(on);
    window.__codexFxApply?.();
  });

  $("#exportFavBtn")?.addEventListener("click", () => {
    const favorites = getFavorites();
    if (!favorites.length) return showToast("No favorites to export yet.");
    const details = allBatches.filter((batch) => favorites.includes(batch._id || batch.batch_id || ""));
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), favorites: details }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "codex-studys-favorites.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Favorites exported.");
  });

  const importInput = $("#importFavFile");
  $("#importFavBtn")?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const ids = (data.favorites || []).map((batch) => batch._id || batch.batch_id).filter(Boolean);
        const current = getFavorites();
        const merged = [...new Set([...current, ...ids])];
        localStorage.setItem("codex-studys-favorites", JSON.stringify(merged));
        updateFavoritesCount();
        renderBatches();
        showToast(`Imported ${ids.length} favorite${ids.length === 1 ? "" : "s"}.`);
      } catch {
        showToast("That file could not be read.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  });

  $("#clearDataBtn")?.addEventListener("click", () => {
    if (!confirm("This clears favorites, theme, search history and all saved preferences on this device. Continue?")) return;
    Object.keys(localStorage).filter((key) => key.startsWith("codex-studys")).forEach((key) => localStorage.removeItem(key));
    showToast("App data cleared. Reloading…");
    setTimeout(() => window.location.reload(), 900);
  });
}

function animateCount(element, target) {
  if (!element) return;
  if (target <= 0) { element.textContent = "0"; return; }
  const duration = 700;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(target * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function updateStats() {
  const strip = $("#statsStrip");
  if (!strip) return;
  strip.style.display = "grid";
  const freshCount = allBatches.filter((batch) => isRecent(batch.startDate)).length;
  animateCount($("#statTotal"), allBatches.length);
  animateCount($("#statNew"), freshCount);
  const statFav = $("#statFav");
  if (statFav) statFav.textContent = getFavorites().length.toLocaleString();
  const statRecent = $("#statRecent");
  if (statRecent) statRecent.textContent = String(getRecentlyViewed().length);
}

function setupBackToTop() {
  const button = $("#backToTopBtn");
  if (!button) return;
  const onScroll = () => button.classList.toggle("visible", window.scrollY > 480);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}


/* ---------- Personal notes ---------- */
function getNotes() {
  try { return JSON.parse(localStorage.getItem("codex-studys-notes") || "{}"); }
  catch { return {}; }
}

function getNote(id) {
  return getNotes()[id] || "";
}

function setNote(id, text) {
  const notes = getNotes();
  if (text.trim()) notes[id] = text.trim(); else delete notes[id];
  localStorage.setItem("codex-studys-notes", JSON.stringify(notes));
}

/* ---------- Quick view ---------- */
let detailBatch = null;

function openDetail(batch) {
  detailBatch = batch;
  const id = batch._id || batch.batch_id || "";
  const hero = document.getElementById("detailHero");
  if (hero) {
    hero.src = batch.previewImage || FALLBACK_THUMB;
    hero.onerror = () => { hero.onerror = null; hero.src = FALLBACK_THUMB; };
  }
  const titleEl = document.getElementById("detailTitle");
  if (titleEl) titleEl.textContent = batch.name || "Untitled course";
  const subEl = document.getElementById("detailSub");
  if (subEl) subEl.textContent = batch.byName || "Structured learning for your next milestone";
  const facts = [
    ["Category", categoryFor(batch).toUpperCase()],
    ["Language", batch.language || "Self-paced"],
    ["Starts", formatDate(batch.startDate) || "Anytime"],
    ["Subjects", String((batch.subBatches || []).length || "—")]
  ];
  const factsEl = document.getElementById("detailFacts");
  if (factsEl) factsEl.innerHTML = facts.map(([k, v]) => `<div class="detail-fact"><span>${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>`).join("");
  const noteEl = document.getElementById("detailNote");
  if (noteEl) noteEl.value = getNote(id);
  syncDetailFavButton(id);
  openModal("detailModal");
}

function syncDetailFavButton(id) {
  const favBtn = document.getElementById("detailFavBtn");
  if (favBtn) favBtn.textContent = isFavorite(id) ? "❤ Saved" : "❤ Save";
}

function setupDetailModal() {
  document.getElementById("detailFavBtn")?.addEventListener("click", () => {
    if (!detailBatch) return;
    const id = detailBatch._id || detailBatch.batch_id || "";
    const active = toggleFavorite(id);
    syncDetailFavButton(id);
    updateFavoritesCount();
    renderBatches();
    showToast(active ? "Added to favorites." : "Removed from favorites.");
  });
  document.getElementById("detailOpenBtn")?.addEventListener("click", () => {
    if (detailBatch) openBatch(detailBatch);
  });
  const noteEl = document.getElementById("detailNote");
  let noteTimer;
  noteEl?.addEventListener("input", () => {
    if (!detailBatch) return;
    const id = detailBatch._id || detailBatch.batch_id || "";
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      setNote(id, noteEl.value);
      renderBatches();
    }, 400);
  });
}

/* ---------- Reading progress ---------- */
function setupScrollProgress() {
  const bar = document.getElementById("scrollProgress");
  if (!bar) return;
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = `${max > 0 ? Math.min((window.scrollY / max) * 100, 100) : 0}%`;
  };
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}

/* ---------- Shortcuts ---------- */
function setupShortcuts() {
  document.getElementById("shortcutsBtn")?.addEventListener("click", () => openModal("shortcutsModal"));
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
    const key = event.key.toLowerCase();
    if (event.key === "?") { event.preventDefault(); openModal("shortcutsModal"); }
    else if (key === "f") { event.preventDefault(); document.getElementById("favNavBtn")?.click(); }
    else if (key === "t") { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupDetailModal();
  setupScrollProgress();
  setupShortcuts();
  setupNavigation();
  setupModals();
  setupFilters();
  setupLoadMore();
  setupViewToggle();
  setupThemePicker();
  setupPreferences();
  setupFxEngine();
  setupNetworkStatus();
  setupAnnouncements();
  setupHeaderActions();
  setupTelegramPopup();
  setupInstallPrompt();
  setupQuickInstall();
  setupRecentlyWatched();
  setupBackToTop();
  setupOfflineBanner();
  registerServiceWorker();
  loadBatches();
});


/* Disable page zoom (pinch, double-tap, ctrl+wheel, ctrl +/-) */
(() => {
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) =>
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener("touchmove", (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  let lastTouch = 0;
  document.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouch < 300) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
  document.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["+", "=", "-", "_", "0"].includes(e.key)) e.preventDefault();
  });
})();
