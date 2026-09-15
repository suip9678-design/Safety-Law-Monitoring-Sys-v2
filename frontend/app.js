const state = {
  laws: [],
  documents: [],
  revisionsLawFilter: null, // { id, name } | null
};

// 플랜트건설업에 저촉되는 안전보건 관련 법령·고시 기본 세트.
// 실제 국가법령정보센터에서 이름으로 검색해 첫 번째 결과를 추가하는 방식이라,
// 정확한 공식 명칭과 약간 다르더라도 유사 검색으로 찾아질 수 있습니다.
const DEFAULT_LAW_SET = [
  "산업안전보건법",
  "산업안전보건법 시행령",
  "산업안전보건법 시행규칙",
  "산업안전보건기준에 관한 규칙",
  "중대재해 처벌 등에 관한 법률",
  "중대재해 처벌 등에 관한 법률 시행령",
  "건설산업기본법",
  "건설기술 진흥법",
  "건설기술 진흥법 시행령",
  "시설물의 안전 및 유지관리에 관한 특별법",
  "위험물안전관리법",
  "고압가스 안전관리법",
  "화학물질관리법",
  "화학물질의 등록 및 평가 등에 관한 법률",
  "전기안전관리법",
  "소방시설 설치 및 관리에 관한 법률",
];

const DEFAULT_ADMRUL_SET = [
  "위험성평가 실시규정",
  "유해ㆍ위험방지계획서 제출ㆍ심사 및 확인업무 처리에 관한 규정",
  "건설공사 안전관리 업무수행 지침",
  "관리감독자 안전보건교육 운영지침",
  "크레인 안전작업지침",
  "추락재해방지 표준안전작업지침",
];

// ---------- helpers ----------

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch (_) {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}

function fmtDate(d) {
  if (!d) return "-";
  return String(d).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
}

function fmtDateTime(d) {
  if (!d) return "-";
  return new Date(d).toLocaleString("ko-KR");
}

const STATUS_BADGE_CLASS = { "미검토": "badge-pending", "검토중": "badge-progress", "반영완료": "badge-ok", "해당없음": "badge-warn" };

function statusBadge(status) {
  return `<span class="badge ${STATUS_BADGE_CLASS[status] || ""}">${status}</span>`;
}

function statusSelect(revisionId, status) {
  return `
    <select class="badge-select ${STATUS_BADGE_CLASS[status] || ""}" data-status-select="${revisionId}">
      ${["미검토", "검토중", "반영완료", "해당없음"].map((s) => `<option value="${s}" ${s === status ? "selected" : ""}>${s}</option>`).join("")}
    </select>
  `;
}

// statusSelect()로 그려진 상태 변경 드롭다운 공통 배선. 대시보드, 개정
// 이력 탭, 사규 개정 이력 탭이 모두 같은 드롭다운을 쓰므로 여기서 한 번만
// 구현한다 - 상태를 바꾸면 어디서 바꿨든 화면들을 전부 다시 불러온다
// (statusSelect의 색상은 렌더링 시점의 클래스로 고정되므로, 바꾼 화면
// 자신도 다시 그려야 색이 새 상태에 맞게 바뀐다).
function wireStatusSelects(el) {
  el.querySelectorAll("[data-status-select]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await api(`/api/revisions/${sel.dataset.statusSelect}`, {
          method: "PATCH",
          body: JSON.stringify({ review_status: sel.value }),
        });
        toast("상태를 업데이트했습니다.");
        loadDocRevisions();
        loadDashboard();
        loadRevisions();
      } catch (e) {
        toast(`업데이트 실패: ${e.message}`, true);
      }
    });
  });
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- tabs ----------

function activateTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activateTab(btn.dataset.tab);
      if (btn.dataset.tab === "revisions") state.revisionsLawFilter = null;
      loadTab(btn.dataset.tab);
    });
  });
}

function viewRevisionsForLaw(lawId, lawName) {
  state.revisionsLawFilter = { id: lawId, name: lawName };
  activateTab("revisions");
  loadRevisions();
}

function loadTab(tab) {
  if (tab === "dashboard") loadDashboard();
  if (tab === "laws") loadLaws();
  if (tab === "revisions") loadRevisions();
  if (tab === "documents") loadDocuments();
  if (tab === "doc-revisions") loadDocRevisions();
  if (tab === "settings") loadSettings();
}

// ---------- alarm bell ----------

const ALARM_ACK_KEY = "safety_law_alarm_ack_id";

function getAlarmAckId() {
  try { return Number(localStorage.getItem(ALARM_ACK_KEY) || 0); } catch (_) { return 0; }
}

function setAlarmAckId(id) {
  try { localStorage.setItem(ALARM_ACK_KEY, String(id)); } catch (_) { /* ignore */ }
}

function updateAlarmBell(summary) {
  const bell = document.getElementById("alarmBell");
  const latestId = summary.recent_revisions.length ? Math.max(...summary.recent_revisions.map((r) => r.id)) : 0;
  const active = summary.unreviewed_count > 0 && latestId > getAlarmAckId();
  bell.hidden = summary.unreviewed_count === 0;
  bell.classList.toggle("active", active);
  document.getElementById("alarmBellCount").textContent = summary.unreviewed_count || "";
  bell.dataset.latestId = String(latestId);
}

// ---------- help modal ----------

function openHelpModal() {
  document.getElementById("helpModalOverlay").hidden = false;
}

function closeHelpModal() {
  document.getElementById("helpModalOverlay").hidden = true;
}

function initHelpModal() {
  document.getElementById("helpBtn").addEventListener("click", openHelpModal);
  document.getElementById("helpModalCloseBtn").addEventListener("click", closeHelpModal);
  document.getElementById("helpModalOverlay").addEventListener("click", (ev) => {
    if (ev.target.id === "helpModalOverlay") closeHelpModal();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !document.getElementById("helpModalOverlay").hidden) closeHelpModal();
  });

  // 설치 후 최초 실행 때만 자동으로 도움말을 한 번 보여준다(제작자에게 직접
  // 물어볼 수 없는 배포 환경이라, 버튼을 찾기 전에 먼저 안내함). 브라우저의
  // localStorage가 아니라 서버(DB)에 "한 번이라도 띄운 적 있는지"를 저장해서,
  // 브라우저를 바꾸거나 캐시를 지워도 재실행할 때마다 다시 뜨지 않는다.
  api("/api/settings/help-shown")
    .then((status) => {
      if (status.shown) return;
      openHelpModal();
      return api("/api/settings/help-shown", { method: "POST" });
    })
    .catch(() => { /* 서버가 아직 준비 안 됐어도 앱 초기화를 막지 않는다 */ });
}

function initAlarmBell() {
  document.getElementById("alarmBell").addEventListener("click", (e) => {
    setAlarmAckId(Number(e.currentTarget.dataset.latestId || 0));
    e.currentTarget.classList.remove("active");
    document.getElementById("revisionStatusFilter").value = "미검토";
    state.revisionsLawFilter = null;
    activateTab("revisions");
    loadRevisions();
  });
}

// ---------- dashboard ----------

function renderDashboardRevisionList(containerId, revisions, emptyMessage) {
  const el = document.getElementById(containerId);
  el.innerHTML = revisions.length ? renderRevisionsList(revisions, "quick") : `<div class="empty">${emptyMessage}</div>`;
  wireStatusSelects(el);
}

// 법령이 아니라 "어떤 절차서/지침서를 검토해야 하는가"를 기준으로 보여준다.
// 상태는 개정 이력/법령 개정 리스트와 동일한 드롭다운(statusSelect)을 쓴다.
// 문서명/구분은 rowspan으로 그 문서의 개정 건수만큼 세로로 합쳐서, 법령/
// 시행일/상태가 문서명/구분과 같은 표·같은 헤더 행에 나란히 놓이도록 한다.
function renderDocumentImpactsList(docImpacts) {
  return `
    <table>
      <thead><tr><th>문서명</th><th>구분</th><th>법령</th><th>시행일</th><th>상태</th></tr></thead>
      <tbody>
        ${docImpacts.map((d) => d.revisions.map((r, i) => `
          <tr>
            ${i === 0 ? `
              <td rowspan="${d.revisions.length}">${escapeHtml(d.document_title)}</td>
              <td rowspan="${d.revisions.length}">${escapeHtml(d.doc_type)}</td>
            ` : ""}
            <td>${escapeHtml(r.tracked_law_name)}${r.matched_by === "tag" ? ' <span class="tag-badge" title="근거 법령으로 직접 매핑하지 않았지만, 문서 키워드가 이 법령의 이름/본문과 겹쳐 자동으로 매칭됨">#태그매칭</span>' : ""}</td>
            <td>${fmtDate(r.enforcement_date)}</td>
            <td>${statusSelect(r.id, r.review_status)}</td>
          </tr>
        `).join("")).join("")}
      </tbody>
    </table>
  `;
}

function renderDashboardDocumentImpacts(containerId, docImpacts, emptyMessage) {
  const el = document.getElementById(containerId);
  el.innerHTML = docImpacts.length ? renderDocumentImpactsList(docImpacts) : `<div class="empty">${emptyMessage}</div>`;
  wireStatusSelects(el);
}

// "신규 제정 고시" 후보 - 등록해둔 게 개정된 게 아니라, 아직 등록 안 한
// 고시가 소관부처+키워드 이중 필터를 통과해 새로 발견된 경우.
function renderNewAdmrulCandidates(containerId, candidates, emptyMessage) {
  const el = document.getElementById(containerId);
  if (!candidates.length) {
    el.innerHTML = `<div class="empty">${emptyMessage}</div>`;
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>법령/고시</th><th>구분</th><th>소관부처</th><th>공포일자</th><th>매칭 키워드</th><th></th></tr></thead>
      <tbody>
        ${candidates.map((c) => `
          <tr>
            <td>${c.detail_link
              ? `<a href="${escapeHtml(c.detail_link)}" target="_blank" rel="noopener">${escapeHtml(c.name)}</a>`
              : escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.category || "-")}</td>
            <td>${escapeHtml(c.department || "-")}</td>
            <td>${fmtDate(c.promulgation_date)}</td>
            <td><span class="hint">${escapeHtml(c.matched_keyword || "-")}</span></td>
            <td>
              <button class="btn btn-primary" data-track-candidate="${c.id}">등록</button>
              <button class="link-btn" data-dismiss-candidate="${c.id}">무시</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  el.querySelectorAll("[data-track-candidate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const c = candidates.find((x) => x.id === Number(btn.dataset.trackCandidate));
      if (!c) return;
      btn.disabled = true;
      btn.textContent = "등록 중...";
      try {
        await api("/api/laws", {
          method: "POST",
          body: JSON.stringify({
            source_type: c.source_type,
            external_id: c.external_id,
            master_id: c.master_id,
            name: c.name,
            category: c.category,
            department: c.department,
            promulgation_no: c.promulgation_no,
            promulgation_date: c.promulgation_date,
            enforcement_date: c.enforcement_date,
            detail_link: c.detail_link,
          }),
        });
        await api(`/api/laws/new-admrul-candidates/${c.id}/registered`, { method: "POST" });
        toast(`"${c.name}"을(를) 등록했습니다.`);
        loadDashboard();
        loadLaws();
      } catch (e) {
        toast(`등록 실패: ${e.message}`, true);
        btn.disabled = false;
        btn.textContent = "등록";
      }
    });
  });
  el.querySelectorAll("[data-dismiss-candidate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/laws/new-admrul-candidates/${btn.dataset.dismissCandidate}/dismiss`, { method: "POST" });
        toast("무시했습니다. 다시 후보로 뜨지 않습니다.");
        loadDashboard();
      } catch (e) {
        toast(`처리 실패: ${e.message}`, true);
      }
    });
  });
}

// ---------- 무시한 신규 고시 후보 관리(설정 탭) ----------

let dismissedAdmrulLoaded = false;
let lastLoadedDismissed = [];
let selectedDismissedIds = new Set();

function updateDismissedBulkToolbar() {
  document.getElementById("dismissedAdmrulSelectedCount").textContent = `${selectedDismissedIds.size}건 선택됨`;
  document.getElementById("dismissedAdmrulBulkRestoreBtn").disabled = selectedDismissedIds.size === 0;
  const selectAll = document.getElementById("dismissedAdmrulSelectAllCheckbox");
  if (selectAll) {
    const rowCheckboxes = document.querySelectorAll(".dismissed-row-checkbox");
    const checkedCount = document.querySelectorAll(".dismissed-row-checkbox:checked").length;
    selectAll.checked = rowCheckboxes.length > 0 && checkedCount === rowCheckboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < rowCheckboxes.length;
  }
}

function renderDismissedAdmrulTable() {
  const el = document.getElementById("dismissedAdmrulTable");
  const searchText = document.getElementById("dismissedAdmrulSearchInput").value.trim();
  const candidates = searchText
    ? lastLoadedDismissed.filter((c) => (c.name || "").includes(searchText))
    : lastLoadedDismissed;
  selectedDismissedIds = new Set();
  el.hidden = false;
  document.getElementById("dismissedAdmrulControls").hidden = false;

  if (!candidates.length) {
    el.innerHTML = `<div class="empty">무시한 항목이 없습니다.</div>`;
    updateDismissedBulkToolbar();
    return;
  }

  el.innerHTML = `
    <table>
      <thead><tr>
        <th><input type="checkbox" id="dismissedAdmrulSelectAllCheckbox" title="전체 선택"></th>
        <th>법령/고시</th><th>구분</th><th>소관부처</th><th>공포일자</th><th>매칭 키워드</th><th></th>
      </tr></thead>
      <tbody>
        ${candidates.map((c) => `
          <tr>
            <td><input type="checkbox" class="dismissed-row-checkbox" data-dismissed-id="${c.id}" ${selectedDismissedIds.has(c.id) ? "checked" : ""}></td>
            <td>${c.detail_link
              ? `<a href="${escapeHtml(c.detail_link)}" target="_blank" rel="noopener">${escapeHtml(c.name)}</a>`
              : escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.category || "-")}</td>
            <td>${escapeHtml(c.department || "-")}</td>
            <td>${fmtDate(c.promulgation_date)}</td>
            <td><span class="hint">${escapeHtml(c.matched_keyword || "-")}</span></td>
            <td><button class="btn" data-restore-candidate="${c.id}">복원</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  el.querySelectorAll("[data-restore-candidate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "복원 중...";
      try {
        await api(`/api/laws/new-admrul-candidates/${btn.dataset.restoreCandidate}/restore`, { method: "POST" });
        toast("복원했습니다. 다음 새로고침부터 다시 후보 목록에 나타납니다.");
        loadDismissedAdmrulCandidates();
        loadDashboard();
      } catch (e) {
        toast(`복원 실패: ${e.message}`, true);
        btn.disabled = false;
        btn.textContent = "복원";
      }
    });
  });

  el.querySelectorAll(".dismissed-row-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = Number(cb.dataset.dismissedId);
      if (cb.checked) selectedDismissedIds.add(id);
      else selectedDismissedIds.delete(id);
      updateDismissedBulkToolbar();
    });
  });

  const selectAll = document.getElementById("dismissedAdmrulSelectAllCheckbox");
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      el.querySelectorAll(".dismissed-row-checkbox").forEach((cb) => {
        cb.checked = selectAll.checked;
        const id = Number(cb.dataset.dismissedId);
        if (selectAll.checked) selectedDismissedIds.add(id);
        else selectedDismissedIds.delete(id);
      });
      updateDismissedBulkToolbar();
    });
  }

  updateDismissedBulkToolbar();
}

async function loadDismissedAdmrulCandidates() {
  try {
    lastLoadedDismissed = await api("/api/laws/new-admrul-candidates/dismissed");
    renderDismissedAdmrulTable();
  } catch (e) {
    toast(`무시한 항목 로드 실패: ${e.message}`, true);
  }
}

async function restoreDismissedBulk() {
  if (selectedDismissedIds.size === 0) return;
  const count = selectedDismissedIds.size;
  const btn = document.getElementById("dismissedAdmrulBulkRestoreBtn");
  btn.disabled = true;
  try {
    await api("/api/laws/new-admrul-candidates/bulk-restore", {
      method: "POST",
      body: JSON.stringify({ ids: Array.from(selectedDismissedIds) }),
    });
    toast(`${count}건을 복원했습니다. 다음 새로고침부터 다시 후보 목록에 나타납니다.`);
    loadDismissedAdmrulCandidates();
    loadDashboard();
  } catch (e) {
    toast(`일괄 복원 실패: ${e.message}`, true);
    btn.disabled = false;
  }
}

function initDismissedAdmrulPanel() {
  document.getElementById("loadDismissedBtn").addEventListener("click", () => {
    dismissedAdmrulLoaded = true;
    loadDismissedAdmrulCandidates();
  });
  document.getElementById("dismissedAdmrulSearchInput").addEventListener("input", renderDismissedAdmrulTable);
  document.getElementById("dismissedAdmrulBulkRestoreBtn").addEventListener("click", restoreDismissedBulk);
}

async function loadDashboard() {
  try {
    const s = await api("/api/dashboard/summary");
    document.getElementById("summaryCards").innerHTML = `
      <div class="card"><div class="value">${s.tracked_law_count}</div><div class="label">관리중인 법령</div></div>
      <div class="card"><div class="value">${s.unreviewed_count}</div><div class="label">미검토 개정</div></div>
      <div class="card"><div class="value">${s.in_review_count}</div><div class="label">검토중</div></div>
      <div class="card"><div class="value">${s.reflected_count}</div><div class="label">반영완료</div></div>
      <div class="card"><div class="value">${s.document_count}</div><div class="label">등록된 사규</div></div>
    `;
    document.getElementById("lastSyncInfo").textContent = `마지막 동기화: ${fmtDateTime(s.last_sync_at)}`;
    renderDashboardRevisionList("recentLawRevisions", s.recent_revisions, `아직 감지된 개정이 없습니다. "새로고침"을 눌러 확인해보세요.`);
    renderNewAdmrulCandidates("newAdmrulCandidates", s.new_admrul_candidates, `현재 발견된 신규 제정 고시 후보가 없습니다.`);
    renderDashboardDocumentImpacts("recentDocImpacts", s.recent_document_impacts, `현재 개정 검토가 필요한 문서가 없습니다.`);
    updateAlarmBell(s);
  } catch (e) {
    toast(`대시보드 로드 실패: ${e.message}`, true);
  }
  loadNewsBoard();
  refreshNewsBoardInBackground();
}

// ---------- 안전보건 뉴스 게시판 ----------

const NEWS_CATEGORY_LABEL = { moel: "고용노동부", kosha: "안전보건공단", accident: "중대재해 뉴스" };

const newsBoardState = { category: "", scrollTimer: null, paused: false };

function fmtNewsDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

function renderNewsBoard(items) {
  const track = document.getElementById("newsBoardTrack");
  document.getElementById("newsDemoBadge").hidden = !items.some((n) => n.is_demo);
  if (!items.length) {
    track.innerHTML = `<div class="news-board-empty">표시할 뉴스가 없습니다. 설정 &gt; 안전보건 뉴스 게시판에서 "지금 새로고침"을 눌러보세요.</div>`;
    return;
  }
  track.innerHTML = items
    .map(
      (n) => `
        <a class="news-board-item" href="${escapeHtml(n.link)}" target="_blank" rel="noopener" title="${escapeHtml(n.title)}">
          <span class="news-board-source news-src-${n.category}">${escapeHtml(n.source_name)}</span>
          <span class="news-board-title">${escapeHtml(n.title)}</span>
          <span class="news-board-date">${fmtNewsDate(n.published_at || n.fetched_at)}</span>
        </a>
      `
    )
    .join("");
}

async function loadNewsBoard() {
  try {
    const params = newsBoardState.category ? `?category=${encodeURIComponent(newsBoardState.category)}` : "";
    const items = await api(`/api/news${params}`);
    renderNewsBoard(items);
  } catch (e) {
    // 뉴스 게시판은 부가 기능이라, 실패해도 토스트로 화면 전체를 방해하지 않는다.
    document.getElementById("newsBoardTrack").innerHTML = "";
  }
}

// 뉴스 게시판은 주기 수집(기본 3시간)에 맞춰서만 갱신되므로, 대시보드에 들어올
// 때마다(최초 진입, F5, 다른 브라우저 탭을 보다가 돌아오는 경우) 화면은 일단
// 캐시된 목록으로 먼저 채우고 뒤에서 조용히 재스크랩한 뒤 목록만 다시 채운다.
// 실패해도(네트워크 차단 등) 캐시된 내용을 그대로 보여주면 되므로 토스트 없이
// 무시한다. 짧은 시간에 탭을 여러 번 들락거려도 매번 스크랩하지 않도록
// 최소 간격을 둔다.
const NEWS_BG_SYNC_MIN_INTERVAL_MS = 60_000;
let newsBackgroundSyncing = false;
let lastNewsBgSyncAt = 0;

async function refreshNewsBoardInBackground() {
  const now = Date.now();
  if (newsBackgroundSyncing || now - lastNewsBgSyncAt < NEWS_BG_SYNC_MIN_INTERVAL_MS) return;
  newsBackgroundSyncing = true;
  lastNewsBgSyncAt = now;
  try {
    await api("/api/news/sync", { method: "POST" });
    await loadNewsBoard();
  } catch (e) {
    /* 무시 - 다음 주기 수집이나 수동 새로고침으로 대체된다. */
  } finally {
    newsBackgroundSyncing = false;
  }
}

// CSS 애니메이션 대신 scrollTop을 일정 간격으로 올려 "게시판처럼" 계속
// 흐르게 한다 - 항목 개수가 바뀌어도(내용 높이가 매번 달라짐) 별도 계산
// 없이 항상 자연스럽게 동작한다. 끝까지 스크롤되면 처음으로 되돌아간다.
function startNewsAutoScroll() {
  const el = document.getElementById("newsBoard");
  if (!el || newsBoardState.scrollTimer) return;
  newsBoardState.scrollTimer = setInterval(() => {
    if (newsBoardState.paused) return;
    if (el.scrollHeight <= el.clientHeight) return;
    el.scrollTop += 1;
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) {
      el.scrollTop = 0;
    }
  }, 45);
  el.addEventListener("mouseenter", () => { newsBoardState.paused = true; });
  el.addEventListener("mouseleave", () => { newsBoardState.paused = false; });
  el.addEventListener("focusin", () => { newsBoardState.paused = true; });
  el.addEventListener("focusout", () => { newsBoardState.paused = false; });
}

function initNewsBoard() {
  document.querySelectorAll("#newsCategoryFilters .news-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#newsCategoryFilters .news-filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
      newsBoardState.category = btn.dataset.cat || "";
      document.getElementById("newsBoard").scrollTop = 0;
      loadNewsBoard();
    });
  });
  startNewsAutoScroll();
}

// ---------- laws ----------

function lawCategoryRank(category) {
  // 법 -> 시행령 -> 시행규칙 -> 고시/예규/훈령 순으로 묶어서 정렬하기 위한 순위
  if (category === "법률") return 0;
  if (category === "대통령령") return 1;
  if (category && category.endsWith("부령")) return 2; // ...부령 = 시행규칙류
  return 3; // 고시/예규/훈령 등 행정규칙
}

function sortLaws(laws) {
  return [...laws].sort((a, b) => {
    const rankDiff = lawCategoryRank(a.category) - lawCategoryRank(b.category);
    if (rankDiff !== 0) return rankDiff;
    return (a.name || "").localeCompare(b.name || "", "ko");
  });
}

const LAW_CATEGORY_GROUP_LABEL = ["법률", "대통령령(시행령)", "부령(시행규칙)", "고시·예규·훈령 등(행정규칙)"];

let lawsFilterText = "";

async function loadLaws() {
  try {
    state.laws = sortLaws(await api("/api/laws"));
    renderLawsTable();
  } catch (e) {
    toast(`법령 목록 로드 실패: ${e.message}`, true);
  }
}

// law.go.kr에서 확인된 URL 패턴이라 행정규칙(admrul)에는 적용하지 않음.
function lawReasonDocUrl(l) {
  // 공포일자 클릭 -> "제정·개정이유" 탭
  if (l.source_type !== "law" || !l.external_id || !l.current_enforcement_date) return null;
  const params = new URLSearchParams({
    lsiSeq: l.external_id,
    lsId: "",
    efYd: l.current_enforcement_date,
    chrClsCd: "010202",
    urlMode: "lsEfInfoR",
    viewCls: "lsRvsDocInfoR",
    ancYnChk: "0",
  });
  return `https://www.law.go.kr/lsInfoP.do?${params.toString()}#`;
}

function renderLawsTable() {
  const el = document.getElementById("lawsTable");
  if (!state.laws.length) {
    el.innerHTML = `<div class="empty">관리중인 법령이 없습니다. 위에서 검색해 등록하세요.</div>`;
    return;
  }

  const q = lawsFilterText.trim();
  const filtered = q
    ? state.laws.filter((l) => (l.name || "").includes(q) || (l.department || "").includes(q))
    : state.laws;
  if (!filtered.length) {
    el.innerHTML = `<div class="empty">"${escapeHtml(q)}"와(과) 일치하는 법령이 없습니다.</div>`;
    return;
  }

  // state.laws는 loadLaws()에서 이미 법 -> 시행령 -> 시행규칙 -> 고시 순으로
  // 정렬되어 있으므로(sortLaws), 여기서는 그 순서를 그대로 이용해 구간마다
  // 그룹 제목행을 끼워넣기만 하면 됨.
  const rows = [];
  let lastRank = null;
  for (const l of filtered) {
    const rank = lawCategoryRank(l.category);
    if (rank !== lastRank) {
      const count = filtered.filter((x) => lawCategoryRank(x.category) === rank).length;
      rows.push(`<tr class="law-group-row"><td colspan="8">${LAW_CATEGORY_GROUP_LABEL[rank]} <span class="hint">${count}건</span></td></tr>`);
      lastRank = rank;
    }
    const reasonUrl = lawReasonDocUrl(l);
    const promCell = reasonUrl
      ? `<a href="${escapeHtml(reasonUrl)}" target="_blank" rel="noopener" title="법령정보센터: 제정·개정이유 보기">${fmtDate(l.current_promulgation_date)}</a>`
      : fmtDate(l.current_promulgation_date);
    rows.push(`
          <tr class="${l.unreviewed_revision_count ? "law-row-alert" : ""}">
            <td>${l.detail_link
              ? `<a href="${escapeHtml(l.detail_link)}" target="_blank" rel="noopener">${escapeHtml(l.name)}</a>`
              : escapeHtml(l.name)}</td>
            <td>${escapeHtml(l.category || "-")}</td>
            <td>${l.unreviewed_revision_count
              ? `<button class="link-btn" data-view-revisions="${l.id}" data-law-name="${escapeHtml(l.name)}" title="이 법령의 개정 이력 보기">${statusBadge("미검토")} ${l.unreviewed_revision_count}</button>`
              : "-"}</td>
            <td>${promCell}</td>
            <td>${fmtDate(l.current_enforcement_date)}</td>
            <td>${l.mapped_document_count}</td>
            <td>${fmtDateTime(l.last_synced_at)}</td>
            <td><button class="link-btn" data-remove-law="${l.id}">취소</button></td>
          </tr>
        `);
  }

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>법령/고시</th><th>구분</th><th>미검토 개정</th><th>공포일자</th><th>시행일자</th><th>매핑 문서</th><th>마지막 확인</th><th></th>
      </tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
  el.querySelectorAll("[data-remove-law]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("취소할까요? (개정 이력은 유지됩니다)")) return;
      try {
        await api(`/api/laws/${btn.dataset.removeLaw}`, { method: "DELETE" });
        toast("취소했습니다.");
        loadLaws();
      } catch (e) {
        toast(`실패: ${e.message}`, true);
      }
    });
  });
  el.querySelectorAll("[data-view-revisions]").forEach((btn) => {
    btn.addEventListener("click", () => {
      viewRevisionsForLaw(Number(btn.dataset.viewRevisions), btn.dataset.lawName);
    });
  });
}

const SOURCE_TYPE_LABEL = { law: "법령", admrul: "행정규칙" };

async function fetchLawSearch(sourceType, query) {
  return api(`/api/laws/search?source_type=${sourceType}&query=${encodeURIComponent(query)}`);
}

function isAlreadyTracked(r) {
  return state.laws.some((l) =>
    (r.master_id && l.master_id && l.master_id === r.master_id) ||
    (l.source_type === r.source_type && l.external_id === r.external_id) ||
    (l.source_type === r.source_type && l.name === r.name)
  );
}

let searchLawsSeq = 0;

async function searchLaws() {
  const sourceType = document.getElementById("searchSourceType").value;
  const query = document.getElementById("searchQuery").value.trim();
  if (!query) {
    document.getElementById("searchResults").innerHTML = "";
    return;
  }
  const mySeq = ++searchLawsSeq;
  const el = document.getElementById("searchResults");
  el.innerHTML = `<div class="empty">검색 중...</div>`;
  try {
    const results = sourceType === "all"
      ? (await Promise.all([fetchLawSearch("law", query), fetchLawSearch("admrul", query)])).flat()
      : await fetchLawSearch(sourceType, query);

    if (mySeq !== searchLawsSeq) return; // 더 최근 검색이 이미 진행 중이면 이 결과는 버림

    if (!results.length) {
      el.innerHTML = `<div class="empty">검색 결과가 없습니다.</div>`;
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>법령/고시</th><th>출처</th><th>구분</th><th>소관부처</th><th>공포일자</th><th>시행일자</th><th></th></tr></thead>
        <tbody>
          ${results.map((r, i) => {
            const tracked = isAlreadyTracked(r);
            return `
            <tr>
              <td>${escapeHtml(r.name || "-")}</td>
              <td>${SOURCE_TYPE_LABEL[r.source_type] || escapeHtml(r.source_type)}</td>
              <td>${escapeHtml(r.category || "-")}</td>
              <td>${escapeHtml(r.department || "-")}</td>
              <td>${fmtDate(r.promulgation_date)}</td>
              <td>${fmtDate(r.enforcement_date)}</td>
              <td>${tracked
                ? `<button class="btn" disabled title="이미 관리중인 법령입니다">등록됨</button>`
                : `<button class="btn" data-add-result="${i}">등록</button>`}</td>
            </tr>
          `;
          }).join("")}
        </tbody>
      </table>
    `;
    el.querySelectorAll("[data-add-result]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = results[Number(btn.dataset.addResult)];
        btn.disabled = true;
        btn.textContent = "등록 중...";
        try {
          await api("/api/laws", {
            method: "POST",
            body: JSON.stringify({
              source_type: r.source_type,
              external_id: r.external_id,
              master_id: r.master_id,
              name: r.name,
              category: r.category,
              department: r.department,
              promulgation_no: r.promulgation_no,
              promulgation_date: r.promulgation_date,
              enforcement_date: r.enforcement_date,
              detail_link: r.detail_link,
            }),
          });
          toast(`"${r.name}" 추적을 시작했습니다.`);
          // 여러 건을 연달아 등록할 때 어디까지 눌렀는지 헷갈리지 않도록,
          // 재검색 없이도 이 버튼 자체를 바로 "등록 완료"로 바꿔준다.
          btn.textContent = "등록 완료";
          loadLaws();
        } catch (e) {
          toast(`추가 실패: ${e.message}`, true);
          btn.disabled = false;
          btn.textContent = "등록";
        }
      });
    });
  } catch (e) {
    if (mySeq !== searchLawsSeq) return;
    el.innerHTML = `<div class="empty">검색 실패: ${escapeHtml(e.message)}</div>`;
  }
}

// ---------- keyword search (본문 캐시 대상 키워드/문장 검색) ----------

const MATCHED_IN_LABEL = { name: "법령명", content: "본문" };

function highlightSnippet(snippet, query) {
  const escaped = escapeHtml(snippet);
  const q = escapeHtml(query);
  if (!q) return escaped;
  return escaped.split(q).join(`<mark>${q}</mark>`);
}

// 크롬/엣지 등이 지원하는 "텍스트 조각 링크"(Scroll To Text Fragment,
// #:~:text=...) - 대상 페이지에 아무 코드가 없어도 브라우저가 그 문구를
// 찾아 스크롤하고 노란색으로 하이라이트해준다(Ctrl+F로 찾은 것과 비슷한
// 효과). 법제처 페이지 코드를 건드릴 수 없으니 이 방법으로 검색어를
// 눈에 띄게 한다. 파이어폭스/사파리는 아직 지원하지 않아 그런 브라우저는
// 그냥 평범한 이동 링크로만 동작한다.
function withTextHighlight(url, query) {
  if (!url || !query) return url;
  return `${url}#:~:text=${encodeURIComponent(query)}`;
}

let keywordSearchSeq = 0;

async function searchKeywords() {
  const sourceType = document.getElementById("keywordSearchSourceType").value;
  const query = document.getElementById("keywordSearchInput").value.trim();
  const el = document.getElementById("keywordSearchResults");
  if (!query) { el.innerHTML = ""; return; }
  const mySeq = ++keywordSearchSeq;
  el.innerHTML = `<div class="empty">검색 중...</div>`;
  try {
    const results = await api(`/api/content-cache/search?source_type=${sourceType}&query=${encodeURIComponent(query)}`);
    if (mySeq !== keywordSearchSeq) return;
    if (!results.length) {
      el.innerHTML = `<div class="empty">검색 결과가 없습니다. 설정 &gt; 법령 본문 캐시를 먼저 새로고침해보세요.</div>`;
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>법령/고시</th><th>출처</th><th>구분</th><th>소관부처</th><th>매칭 위치</th><th>미리보기</th><th>시행일자</th></tr></thead>
        <tbody>
          ${results.map((r) => `
            <tr>
              <td>${r.detail_link
                ? `<a href="${escapeHtml(withTextHighlight(r.detail_link, query))}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a>`
                : escapeHtml(r.name)}</td>
              <td>${SOURCE_TYPE_LABEL[r.source_type] || escapeHtml(r.source_type)}</td>
              <td>${escapeHtml(r.category || "-")}</td>
              <td>${escapeHtml(r.department || "-")}</td>
              <td>${MATCHED_IN_LABEL[r.matched_in] || "-"}</td>
              <td class="search-snippet">${(() => {
                if (!r.snippet) return '<span class="hint">-</span>';
                const href = withTextHighlight(r.article_link || r.detail_link, query);
                const title = r.article_link ? "해당 조문으로 이동" : "법령 상세 페이지로 이동";
                return href
                  ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${title}">${highlightSnippet(r.snippet, query)}</a>`
                  : highlightSnippet(r.snippet, query);
              })()}</td>
              <td>${fmtDate(r.enforcement_date)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    if (mySeq !== keywordSearchSeq) return;
    el.innerHTML = `<div class="empty">검색 실패: ${escapeHtml(e.message)}</div>`;
  }
}

function initKeywordSearch() {
  document.getElementById("keywordSearchBtn").addEventListener("click", searchKeywords);
  document.getElementById("keywordSearchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); searchKeywords(); }
  });
  document.getElementById("keywordSearchSourceType").addEventListener("change", () => {
    if (document.getElementById("keywordSearchInput").value.trim()) searchKeywords();
  });
  document.getElementById("dashboardKeywordSearchForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const query = document.getElementById("dashboardKeywordSearchInput").value.trim();
    if (!query) return;
    document.getElementById("keywordSearchInput").value = query;
    activateTab("keyword-search");
    searchKeywords();
  });
}

async function seedDefaultLaws() {
  const btn = document.getElementById("seedDefaultsBtn");
  const el = document.getElementById("seedResults");
  btn.disabled = true;
  btn.textContent = "추가 중...";
  const rows = [];

  const runSet = async (sourceType, names) => {
    for (const name of names) {
      try {
        const results = await fetchLawSearch(sourceType, name);
        if (!results.length) {
          rows.push({ name, status: "검색 결과 없음" });
          continue;
        }
        const match = results[0];
        try {
          await api("/api/laws", {
            method: "POST",
            body: JSON.stringify({
              source_type: match.source_type,
              external_id: match.external_id,
              master_id: match.master_id,
              name: match.name,
              category: match.category,
              department: match.department,
              promulgation_no: match.promulgation_no,
              promulgation_date: match.promulgation_date,
              enforcement_date: match.enforcement_date,
              detail_link: match.detail_link,
            }),
          });
          rows.push({ name: match.name, status: "추가됨" });
        } catch (e) {
          rows.push({ name: match.name, status: e.message.includes("이미") ? "이미 추적 중" : `실패: ${e.message}` });
        }
      } catch (e) {
        rows.push({ name, status: `검색 실패: ${e.message}` });
      }
    }
  };

  await runSet("law", DEFAULT_LAW_SET);
  await runSet("admrul", DEFAULT_ADMRUL_SET);

  el.innerHTML = `
    <table>
      <thead><tr><th>법령/고시</th><th>결과</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.status)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
  const addedCount = rows.filter((r) => r.status === "추가됨").length;
  toast(`기본 법령 세트 처리 완료: ${addedCount}건 추가 (총 ${rows.length}건 시도)`);
  btn.disabled = false;
  btn.textContent = "기본 법령 세트 추가";
  loadLaws();
}

// ---------- revisions ----------

// mode: "full"(개정 이력 탭) | "quick"(대시보드 "법령 개정 리스트")
// 상태 변경 드롭다운(statusSelect)은 두 모드 다 동일하게 사용한다 -
// 대시보드에서 바로 상태를 바꿔도 개정 이력 탭과 똑같이 동작해야 하고,
// 반영완료/해당없음으로 바뀐 건 대시보드 목록에서 빠져야 하기 때문.
// 개정 이력 탭(full)에서 체크된 개정 이력 id들 - 여러 건을 한 번에 상태
// 변경하기 위한 선택 상태. 목록을 새로 불러올 때마다 초기화됨.
let selectedRevisionIds = new Set();

function renderRevisionsList(revisions, mode = "full") {
  const showFullActions = mode === "full";
  // "사규" 열은 개정 이력 탭(full)에서만 보여준다 - 대시보드(quick)에는
  // 문서 기준으로 재구성한 별도 섹션("사내 절차서·지침서 개정 필요 사항")이
  // 있어 여기서 또 보여주면 중복이라 뺐다.
  const showMappedDocs = showFullActions;
  const showCheckbox = showFullActions;
  return `
    <table>
      <thead><tr>
        ${showCheckbox ? `<th><input type="checkbox" id="revisionsSelectAllCheckbox" title="전체 선택"></th>` : ""}
        <th>법령/고시</th><th>구분</th><th>공포일자</th><th>시행일자</th><th>감지 시각</th>${showMappedDocs ? "<th>사규</th>" : ""}<th>상태</th>
      </tr></thead>
      <tbody>
        ${revisions.map((r) => {
          // 이전 값이 전혀 없으면(previous_*가 모두 비어있으면) 실제 개정이 아니라
          // 법령을 처음 등록할 때 자동 생성된 "최초 확인" 항목임.
          const isInitial = !r.previous_promulgation_date && !r.previous_enforcement_date;
          return `
          <tr>
            ${showCheckbox ? `<td><input type="checkbox" class="revision-row-checkbox" data-revision-id="${r.id}" ${selectedRevisionIds.has(r.id) ? "checked" : ""}></td>` : ""}
            <td>${escapeHtml(r.tracked_law_name)}${isInitial ? ` <span class="hint">(신규 등록)</span>` : ""}</td>
            <td>${escapeHtml(r.tracked_law_category || "-")}</td>
            <td>${fmtDate(r.promulgation_date)}${r.previous_promulgation_date && r.previous_promulgation_date !== r.promulgation_date ? `<br><span class="hint">이전: ${fmtDate(r.previous_promulgation_date)}</span>` : ""}</td>
            <td>${fmtDate(r.enforcement_date)}</td>
            <td>${fmtDateTime(r.detected_at)}</td>
            ${showMappedDocs ? `<td>${r.mapped_documents.length ? r.mapped_documents.map(escapeHtml).join(", ") : '<span class="hint">해당 없음</span>'}</td>` : ""}
            <td>${statusSelect(r.id, r.review_status)}</td>
          </tr>
        `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderRevisionLawFilterChip() {
  const chip = document.getElementById("revisionLawFilterChip");
  if (!state.revisionsLawFilter) {
    chip.hidden = true;
    chip.innerHTML = "";
    return;
  }
  chip.hidden = false;
  chip.innerHTML = `법령 필터: <strong>${escapeHtml(state.revisionsLawFilter.name)}</strong> · <button class="link-btn" id="clearLawFilterBtn">전체 보기</button>`;
  document.getElementById("clearLawFilterBtn").addEventListener("click", () => {
    state.revisionsLawFilter = null;
    loadRevisions();
  });
}

function updateRevisionsBulkToolbar() {
  document.getElementById("revisionsSelectedCount").textContent = `${selectedRevisionIds.size}건 선택됨`;
  document.getElementById("revisionsBulkApplyBtn").disabled = selectedRevisionIds.size === 0;
  document.getElementById("revisionsBulkDeleteBtn").disabled = selectedRevisionIds.size === 0;
  const selectAll = document.getElementById("revisionsSelectAllCheckbox");
  if (selectAll) {
    const rowCheckboxes = document.querySelectorAll(".revision-row-checkbox");
    const checkedCount = document.querySelectorAll(".revision-row-checkbox:checked").length;
    selectAll.checked = rowCheckboxes.length > 0 && checkedCount === rowCheckboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < rowCheckboxes.length;
  }
}

// 서버에서 마지막으로 받아온 전체 목록(상태/법령 필터 적용됨) - 법령명
// 검색창은 이걸 다시 불러오지 않고 클라이언트에서만 걸러서 다시 그린다.
let lastLoadedRevisions = [];

function renderRevisionsTable() {
  const el = document.getElementById("revisionsTable");
  const searchText = document.getElementById("revisionsSearchInput").value.trim();
  const revisions = searchText
    ? lastLoadedRevisions.filter((r) => r.tracked_law_name.includes(searchText))
    : lastLoadedRevisions;
  selectedRevisionIds = new Set();
  el.innerHTML = revisions.length
    ? renderRevisionsList(revisions, "full")
    : `<div class="empty">${searchText ? `"${escapeHtml(searchText)}"와(과) 일치하는 개정 이력이 없습니다.` : "개정 이력이 없습니다."}</div>`;
  wireStatusSelects(el);
  el.querySelectorAll(".revision-row-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = Number(cb.dataset.revisionId);
      if (cb.checked) selectedRevisionIds.add(id);
      else selectedRevisionIds.delete(id);
      updateRevisionsBulkToolbar();
    });
  });
  const selectAll = document.getElementById("revisionsSelectAllCheckbox");
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      el.querySelectorAll(".revision-row-checkbox").forEach((cb) => {
        cb.checked = selectAll.checked;
        const id = Number(cb.dataset.revisionId);
        if (selectAll.checked) selectedRevisionIds.add(id);
        else selectedRevisionIds.delete(id);
      });
      updateRevisionsBulkToolbar();
    });
  }
  updateRevisionsBulkToolbar();
}

async function loadRevisions() {
  const status = document.getElementById("revisionStatusFilter").value;
  renderRevisionLawFilterChip();
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (state.revisionsLawFilter) params.set("tracked_law_id", state.revisionsLawFilter.id);
  try {
    lastLoadedRevisions = await api(`/api/revisions${params.toString() ? `?${params.toString()}` : ""}`);
    renderRevisionsTable();
  } catch (e) {
    toast(`개정 이력 로드 실패: ${e.message}`, true);
  }
}

// ---------- 사규 개정 이력 ----------
// 대시보드의 "사내 절차서·지침서 개정 필요 사항"과 같은 형식(문서가 맨
// 앞, 그 문서와 관련된 법령 개정을 안에 나열)을 그대로 쓰되, 대시보드는
// 미검토/검토중 + 최대 10건만 보여주는 반면 여기는 상태 필터/검색을 걸어
// 처리 완료된 것까지 포함한 전체 이력을 다 보여준다.

let lastLoadedDocRevisions = [];

async function loadDocRevisions() {
  const status = document.getElementById("docRevisionStatusFilter").value;
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  try {
    lastLoadedDocRevisions = await api(`/api/documents/impacts${params.toString() ? `?${params.toString()}` : ""}`);
    renderDocRevisionsTable();
  } catch (e) {
    toast(`사규 개정 이력 로드 실패: ${e.message}`, true);
  }
}

function renderDocRevisionsTable() {
  const el = document.getElementById("docRevisionsTable");
  const searchText = document.getElementById("docRevisionsSearchInput").value.trim();
  const docImpacts = searchText
    ? lastLoadedDocRevisions.filter((d) =>
        d.document_title.includes(searchText) || d.revisions.some((r) => r.tracked_law_name.includes(searchText))
      )
    : lastLoadedDocRevisions;
  el.innerHTML = docImpacts.length
    ? renderDocumentImpactsList(docImpacts)
    : `<div class="empty">${searchText ? `"${escapeHtml(searchText)}"와(과) 일치하는 사규 개정 이력이 없습니다.` : "사규와 매핑된 법령의 개정 이력이 없습니다. 사규 추가/수정 화면에서 근거 법령을 연결해보세요."}</div>`;
  wireStatusSelects(el);
}

async function applyRevisionsBulkStatus() {
  if (selectedRevisionIds.size === 0) return;
  const status = document.getElementById("revisionsBulkStatus").value;
  const btn = document.getElementById("revisionsBulkApplyBtn");
  btn.disabled = true;
  try {
    await api("/api/revisions/bulk-status", {
      method: "PATCH",
      body: JSON.stringify({ ids: Array.from(selectedRevisionIds), review_status: status }),
    });
    toast(`${selectedRevisionIds.size}건을 "${status}"(으)로 변경했습니다.`);
    loadRevisions();
    loadDashboard();
  } catch (e) {
    toast(`일괄 변경 실패: ${e.message}`, true);
    btn.disabled = false;
  }
}

async function deleteRevisionsBulk() {
  if (selectedRevisionIds.size === 0) return;
  const count = selectedRevisionIds.size;
  if (!confirm(`선택한 개정 이력 ${count}건을 삭제할까요? 되돌릴 수 없습니다.`)) return;
  const btn = document.getElementById("revisionsBulkDeleteBtn");
  btn.disabled = true;
  try {
    await api("/api/revisions/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids: Array.from(selectedRevisionIds) }),
    });
    toast(`${count}건을 삭제했습니다.`);
    loadRevisions();
    loadDashboard();
  } catch (e) {
    toast(`삭제 실패: ${e.message}`, true);
    btn.disabled = false;
  }
}

// ---------- documents ----------

// 근거 법령 체크박스 목록은 구분 필터/검색어에 따라 계속 다시 그려지므로,
// 어떤 법령이 선택됐는지는 화면의 :checked 상태가 아니라 이 Set으로 따로
// 추적한다(필터링으로 화면에서 안 보이는 항목도 선택은 유지되어야 함).
let selectedDocLawIds = new Set();

async function loadDocuments() {
  try {
    const [documents, laws] = await Promise.all([api("/api/documents"), api("/api/laws")]);
    state.documents = documents;
    state.laws = laws;
    renderDocumentsTable();
  } catch (e) {
    toast(`문서 목록 로드 실패: ${e.message}`, true);
  }
}

function renderDocLawCheckboxes() {
  const el = document.getElementById("docLawCheckboxes");
  if (!state.laws.length) {
    el.innerHTML = `<span class="hint">먼저 "법령 마스터" 탭에서 법령을 등록하세요.</span>`;
    return;
  }
  const categoryFilter = document.getElementById("docLawCategoryFilter").value;
  const searchText = document.getElementById("docLawSearchInput").value.trim();
  const filtered = sortLaws(state.laws).filter((l) => {
    if (categoryFilter !== "" && String(lawCategoryRank(l.category)) !== categoryFilter) return false;
    if (searchText && !l.name.includes(searchText)) return false;
    return true;
  });
  if (!filtered.length) {
    el.innerHTML = `<span class="hint">조건에 맞는 법령이 없습니다.</span>`;
    return;
  }
  el.innerHTML = filtered
    .map(
      (l) => `
    <label>
      <input type="checkbox" class="doc-law-checkbox" value="${l.id}" ${selectedDocLawIds.has(l.id) ? "checked" : ""}>
      ${escapeHtml(l.name)} <span class="hint">(${escapeHtml(l.category || "-")})</span>
    </label>
  `
    )
    .join("");
  el.querySelectorAll(".doc-law-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = Number(cb.value);
      if (cb.checked) selectedDocLawIds.add(id);
      else selectedDocLawIds.delete(id);
    });
  });
}

// "#밀폐공간 #공기호흡기" 같은 입력을 저장용 CSV("밀폐공간,공기호흡기")로,
// 그 반대로도 변환한다. 공백/콤마 어느 쪽으로 구분해도 되고 "#"은 있어도
// 없어도 된다.
function normalizeTagsInput(raw) {
  return (raw || "")
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean)
    .join(",");
}

function formatTagsForInput(tagsCsv) {
  return (tagsCsv || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(" ");
}

function renderTagChips(tagsCsv) {
  const tags = (tagsCsv || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!tags.length) return '<span class="hint">없음</span>';
  return tags.map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join(" ");
}

function openDocumentModal() {
  document.getElementById("documentModalOverlay").hidden = false;
}

function closeDocumentModal() {
  document.getElementById("documentModalOverlay").hidden = true;
}

function renderDocumentsTable() {
  const el = document.getElementById("documentsTable");
  if (!state.documents.length) {
    el.innerHTML = `<div class="empty">등록된 사규가 없습니다.</div>`;
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>구분</th><th>문서번호</th><th>제목</th><th>개정번호</th><th>개정일자</th><th>담당자</th><th>키워드</th><th>근거 법령</th><th></th></tr></thead>
      <tbody>
        ${state.documents.map((d) => `
          <tr>
            <td>${escapeHtml(d.doc_type)}</td>
            <td>${escapeHtml(d.doc_number || "-")}</td>
            <td>${escapeHtml(d.title)}</td>
            <td>${escapeHtml(d.revision_no || "-")}</td>
            <td>${fmtDate(d.revision_date)}</td>
            <td>${escapeHtml(d.owner || "-")}</td>
            <td>${renderTagChips(d.tags)}</td>
            <td>${d.mapped_laws.length ? d.mapped_laws.map(escapeHtml).join(", ") : '<span class="hint">없음</span>'}</td>
            <td>
              <button class="link-btn" data-edit-doc="${d.id}">수정</button>
              <button class="link-btn" data-delete-doc="${d.id}">삭제</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  el.querySelectorAll("[data-edit-doc]").forEach((btn) => {
    btn.addEventListener("click", () => startEditDocument(Number(btn.dataset.editDoc)));
  });
  el.querySelectorAll("[data-delete-doc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("이 문서를 삭제할까요? (관련 매핑도 함께 삭제됩니다)")) return;
      try {
        await api(`/api/documents/${btn.dataset.deleteDoc}`, { method: "DELETE" });
        toast("삭제했습니다.");
        loadDocuments();
      } catch (e) {
        toast(`삭제 실패: ${e.message}`, true);
      }
    });
  });
}

async function startEditDocument(id) {
  const d = state.documents.find((x) => x.id === id);
  if (!d) return;
  document.getElementById("documentFormTitle").textContent = "사규 수정";
  document.getElementById("docId").value = d.id;
  document.getElementById("docType").value = d.doc_type;
  document.getElementById("docNumber").value = d.doc_number || "";
  document.getElementById("docTitle").value = d.title;
  document.getElementById("docRevisionNo").value = d.revision_no || "";
  document.getElementById("docRevisionDate").value = d.revision_date || "";
  document.getElementById("docOwner").value = d.owner || "";
  document.getElementById("docFileLink").value = d.file_link || "";
  document.getElementById("docTags").value = formatTagsForInput(d.tags);
  document.getElementById("docNote").value = d.note || "";
  document.getElementById("docLawCategoryFilter").value = "";
  document.getElementById("docLawSearchInput").value = "";
  try {
    const mappings = await api(`/api/mappings?document_id=${id}`);
    selectedDocLawIds = new Set(mappings.map((m) => m.tracked_law_id));
    renderDocLawCheckboxes();
  } catch (e) {
    toast(`매핑된 법령 로드 실패: ${e.message}`, true);
  }
  openDocumentModal();
}

function resetDocumentForm() {
  document.getElementById("documentFormTitle").textContent = "사규 추가";
  document.getElementById("documentForm").reset();
  document.getElementById("docId").value = "";
  document.getElementById("docLawCategoryFilter").value = "";
  document.getElementById("docLawSearchInput").value = "";
  selectedDocLawIds = new Set();
  renderDocLawCheckboxes();
}

// 문서를 저장한 뒤, 체크박스로 고른 법령 목록과 실제 DB에 저장된 매핑을
// 비교해서 새로 추가된 건 등록하고 해제된 건 삭제한다.
async function syncDocumentLawMappings(documentId) {
  const selectedLawIds = Array.from(selectedDocLawIds);
  let existing = [];
  try {
    existing = await api(`/api/mappings?document_id=${documentId}`);
  } catch (e) {
    toast(`기존 매핑 조회 실패: ${e.message}`, true);
    return;
  }
  const existingLawIds = new Set(existing.map((m) => m.tracked_law_id));
  const toAdd = selectedLawIds.filter((lawId) => !existingLawIds.has(lawId));
  const toRemove = existing.filter((m) => !selectedLawIds.includes(m.tracked_law_id));

  const results = await Promise.allSettled([
    ...toAdd.map((lawId) =>
      api("/api/mappings", { method: "POST", body: JSON.stringify({ document_id: documentId, tracked_law_id: lawId }) })
    ),
    ...toRemove.map((m) => api(`/api/mappings/${m.id}`, { method: "DELETE" })),
  ]);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    toast(`근거 법령 연결 중 일부 실패 (${failed.length}건)`, true);
  }
}

function initDocumentForm() {
  document.getElementById("documentForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = document.getElementById("docId").value;
    const payload = {
      doc_type: document.getElementById("docType").value,
      doc_number: document.getElementById("docNumber").value || null,
      title: document.getElementById("docTitle").value,
      revision_no: document.getElementById("docRevisionNo").value || null,
      revision_date: document.getElementById("docRevisionDate").value || null,
      owner: document.getElementById("docOwner").value || null,
      file_link: document.getElementById("docFileLink").value || null,
      tags: normalizeTagsInput(document.getElementById("docTags").value) || null,
      note: document.getElementById("docNote").value || null,
    };
    try {
      let doc;
      if (id) {
        doc = await api(`/api/documents/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        toast("수정했습니다.");
      } else {
        doc = await api("/api/documents", { method: "POST", body: JSON.stringify(payload) });
        toast("추가했습니다.");
      }
      await syncDocumentLawMappings(doc.id);
      resetDocumentForm();
      closeDocumentModal();
      loadDocuments();
      loadDashboard();
    } catch (e) {
      toast(`저장 실패: ${e.message}`, true);
    }
  });
  document.getElementById("docCancelBtn").addEventListener("click", () => {
    resetDocumentForm();
    closeDocumentModal();
  });
  document.getElementById("docModalCloseBtn").addEventListener("click", () => {
    resetDocumentForm();
    closeDocumentModal();
  });
  document.getElementById("docAddBtn").addEventListener("click", () => {
    resetDocumentForm();
    openDocumentModal();
  });
  document.getElementById("documentModalOverlay").addEventListener("click", (ev) => {
    if (ev.target.id === "documentModalOverlay") {
      resetDocumentForm();
      closeDocumentModal();
    }
  });
  document.getElementById("docLawCategoryFilter").addEventListener("change", renderDocLawCheckboxes);
  document.getElementById("docLawSearchInput").addEventListener("input", renderDocLawCheckboxes);
}

// ---------- settings ----------

async function loadSettings() {
  try {
    const s = await api("/api/settings");
    document.getElementById("demoBadge").hidden = !s.demo_mode;
    document.getElementById("settingOc").value = s.law_api_oc || "";
    document.getElementById("settingOc").placeholder = "OC 키";
    document.getElementById("ocStatus").textContent = s.demo_mode
      ? "OC 키가 설정되지 않아 데모 데이터로 동작 중입니다."
      : `현재 동기화된 OC 키: ${s.law_api_oc} (실제 국가법령정보센터 API로 동작 중)`;

    document.getElementById("smtpPanel").hidden = !s.email_feature_enabled;
    if (s.email_feature_enabled) {
      document.getElementById("smtpHost").value = s.smtp_host || "";
      document.getElementById("smtpPort").value = s.smtp_port || 587;
      document.getElementById("smtpTls").checked = !!s.smtp_use_tls;
      document.getElementById("smtpUser").value = s.smtp_user || "";
      document.getElementById("smtpFrom").value = s.smtp_from || "";
      document.getElementById("alertEmails").value = s.alert_emails || "";
      document.getElementById("smtpStatus").textContent = s.smtp_configured
        ? "이메일 알림이 설정되어 있습니다."
        : "SMTP 정보와 수신자를 입력하면 개정 감지 시 이메일 알림을 받을 수 있습니다.";
    }

    document.getElementById("autoSyncHint").textContent = s.auto_sync_interval_hours > 0
      ? `서버가 실행 중인 동안 ${s.auto_sync_interval_hours}시간마다 자동으로 동기화합니다. (.env의 AUTO_SYNC_INTERVAL_HOURS)`
      : "자동 동기화가 꺼져 있습니다. (.env의 AUTO_SYNC_INTERVAL_HOURS=0)";

    document.getElementById("newAdmrulDepartment").value = s.new_admrul_department || "";
    document.getElementById("newAdmrulKeywords").value = s.new_admrul_keywords || "";
    document.getElementById("newAdmrulSinceDate").value = yyyymmddToDateInput(s.new_admrul_since_date);
    document.getElementById("fullLawCacheEnabled").checked = !!s.full_law_cache_enabled;

    document.getElementById("newsTickerEnabled").checked = !!s.news_ticker_enabled;
    document.getElementById("newsSourceMoelUrl").value = s.news_source_moel_url || "";
    document.getElementById("newsSourceKoshaUrl").value = s.news_source_kosha_url || "";
    document.getElementById("newsSourceAccidentUrl").value = s.news_source_accident_url || "";
    document.getElementById("newsMaxItems").value = s.news_max_items_per_category || 30;
  } catch (e) {
    toast(`설정 로드 실패: ${e.message}`, true);
  }
  loadContentCacheStatus();
  loadFullLawCacheStatus();
  if (dismissedAdmrulLoaded) loadDismissedAdmrulCandidates();
}

// 저장 형식(YYYYMMDD)과 <input type="date">가 쓰는 형식(YYYY-MM-DD) 사이 변환.
function yyyymmddToDateInput(v) {
  if (!v || v.length !== 8) return "";
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

function dateInputToYyyymmdd(v) {
  return v ? v.replaceAll("-", "") : "";
}

function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR");
}

async function loadContentCacheStatus() {
  try {
    const status = await api("/api/content-cache/status");
    document.getElementById("contentCacheStatus").textContent =
      status.cached_count > 0
        ? `현재 ${status.cached_count}건 캐시됨 (마지막 갱신: ${fmtDateTime(status.last_cached_at)})`
        : "아직 캐시된 본문이 없습니다. 새로고침을 눌러 채워주세요.";
  } catch (e) {
    document.getElementById("contentCacheStatus").textContent = "";
  }
}

let fullLawCachePollTimer = null;

function renderFullLawCacheStatus(status) {
  const el = document.getElementById("fullLawCacheStatus");
  // processed(새로 받음) + skipped(공포번호 그대로라 건너뜀)를 합친 게
  // total(전체 목록 건수)에 가까워야 정상적으로 끝까지 돈 것이다.
  const handled = status.processed + status.skipped;
  const progress = status.total ? `${handled} / ${status.total}건` : `${handled}건`;
  const detail = `(새로 받음 ${status.processed}건, 변경 없어 건너뜀 ${status.skipped}건)`;
  if (status.running) {
    el.textContent = `진행 중... 지금까지 ${progress} 확인 ${detail}`;
  } else if (status.error) {
    el.textContent = `마지막 실행 중 오류 발생 (${progress}까지 확인 ${detail}): ${status.error}`;
  } else if (status.finished_at) {
    el.textContent = `마지막 완료: ${fmtDateTime(status.finished_at)} (총 ${progress} 확인 ${detail})`;
  } else {
    el.textContent = "아직 실행한 적 없습니다.";
  }
}

// 진행 중일 때만 몇 초 간격으로 상태를 다시 물어본다 - 서버가 백그라운드로
// 계속 도는 작업이라 완료될 때까지 화면에서 진행 상황을 보여주기 위함.
async function loadFullLawCacheStatus() {
  try {
    const status = await api("/api/content-cache/full-refresh-status");
    renderFullLawCacheStatus(status);
    if (status.running && !fullLawCachePollTimer) {
      fullLawCachePollTimer = setInterval(async () => {
        try {
          const s = await api("/api/content-cache/full-refresh-status");
          renderFullLawCacheStatus(s);
          if (!s.running) {
            clearInterval(fullLawCachePollTimer);
            fullLawCachePollTimer = null;
            loadContentCacheStatus();
          }
        } catch (_) { /* 다음 주기에 다시 시도 */ }
      }, 3000);
    }
  } catch (e) {
    document.getElementById("fullLawCacheStatus").textContent = "";
  }
}

function initSettingsForms() {
  document.getElementById("saveOcBtn").addEventListener("click", async () => {
    const value = document.getElementById("settingOc").value;
    if (!value) { toast("OC 키를 입력하세요.", true); return; }
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ law_api_oc: value }) });
      toast("OC 키를 저장했습니다.");
      loadSettings();
    } catch (e) {
      toast(`저장 실패: ${e.message}`, true);
    }
  });

  document.getElementById("smtpForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const payload = {
      smtp_host: document.getElementById("smtpHost").value,
      smtp_port: Number(document.getElementById("smtpPort").value) || 587,
      smtp_use_tls: document.getElementById("smtpTls").checked,
      smtp_user: document.getElementById("smtpUser").value,
      smtp_from: document.getElementById("smtpFrom").value,
      alert_emails: document.getElementById("alertEmails").value,
    };
    const pw = document.getElementById("smtpPassword").value;
    if (pw) payload.smtp_password = pw;
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
      document.getElementById("smtpPassword").value = "";
      toast("이메일 설정을 저장했습니다.");
      loadSettings();
    } catch (e) {
      toast(`저장 실패: ${e.message}`, true);
    }
  });

  document.getElementById("testEmailBtn").addEventListener("click", async () => {
    try {
      await api("/api/settings/test-email", { method: "POST" });
      toast("테스트 메일을 발송했습니다.");
    } catch (e) {
      toast(`발송 실패: ${e.message}`, true);
    }
  });

  document.getElementById("refreshContentCacheBtn").addEventListener("click", async () => {
    const btn = document.getElementById("refreshContentCacheBtn");
    btn.disabled = true;
    btn.textContent = "캐시 새로고침 중... (다소 시간이 걸릴 수 있습니다)";
    try {
      const result = await api("/api/content-cache/refresh", { method: "POST" });
      toast(`본문 캐시 새로고침 완료: 총 ${result.cached_count}건`);
      loadContentCacheStatus();
    } catch (e) {
      toast(`본문 캐시 새로고침 실패: ${e.message}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "본문 캐시 새로고침";
    }
  });

  document.getElementById("saveFullLawCacheBtn").addEventListener("click", async () => {
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ full_law_cache_enabled: document.getElementById("fullLawCacheEnabled").checked }),
      });
      toast("저장했습니다.");
    } catch (e) {
      toast(`저장 실패: ${e.message}`, true);
    }
  });

  document.getElementById("startFullLawCacheBtn").addEventListener("click", async () => {
    const btn = document.getElementById("startFullLawCacheBtn");
    btn.disabled = true;
    try {
      await api("/api/content-cache/full-refresh", { method: "POST" });
      toast("전체 법령 캐시를 백그라운드에서 시작했습니다. 완료까지 시간이 걸릴 수 있습니다.");
      loadFullLawCacheStatus();
    } catch (e) {
      toast(`시작 실패: ${e.message}`, true);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("newAdmrulForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const payload = {
      new_admrul_department: document.getElementById("newAdmrulDepartment").value,
      new_admrul_keywords: document.getElementById("newAdmrulKeywords").value,
      new_admrul_since_date: dateInputToYyyymmdd(document.getElementById("newAdmrulSinceDate").value),
    };
    const btn = ev.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "저장 중...";
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
      await loadSettings();
      // 저장만 하고 끝나면 "설정을 바꿨는데 왜 목록이 그대로냐"는 오해가
      // 생기기 쉬워서(실제로 사용자가 그렇게 겪었다), 저장에 성공하면
      // 곧바로 새로고침(동기화)까지 이어서 실행한다.
      btn.textContent = "저장 후 새로고침 중...";
      await runSync();
    } catch (e) {
      toast(`저장 실패: ${e.message}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "저장";
    }
  });

  document.getElementById("newsSettingsForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const payload = {
      news_ticker_enabled: document.getElementById("newsTickerEnabled").checked,
      news_source_moel_url: document.getElementById("newsSourceMoelUrl").value,
      news_source_kosha_url: document.getElementById("newsSourceKoshaUrl").value,
      news_source_accident_url: document.getElementById("newsSourceAccidentUrl").value,
      news_max_items_per_category: Number(document.getElementById("newsMaxItems").value) || 30,
    };
    const btn = ev.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
      document.getElementById("newsSettingsStatus").textContent = "저장했습니다.";
      loadNewsBoard();
    } catch (e) {
      toast(`저장 실패: ${e.message}`, true);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("newsSyncNowBtn").addEventListener("click", async () => {
    const btn = document.getElementById("newsSyncNowBtn");
    btn.disabled = true;
    btn.textContent = "새로고침 중...";
    try {
      const result = await api("/api/news/sync", { method: "POST" });
      document.getElementById("newsSettingsStatus").textContent = `새로고침 완료: 신규 ${result.added}건`;
      loadNewsBoard();
    } catch (e) {
      toast(`새로고침 실패: ${e.message}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "지금 새로고침";
    }
  });
}

// ---------- sync ----------

// 새로고침(동기화) 실행 - 상단 "새로고침" 버튼과 "신규 제정 고시 자동
// 탐지" 설정 저장 둘 다 여기를 거친다. 버튼 로딩 상태 표시가 필요할 때만
// btn을 넘기면 된다(설정 폼 저장은 자체적으로 다른 문구를 보여주므로
// 넘기지 않음).
async function runSync(btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = "새로고침 중...";
  }
  try {
    const result = await api("/api/sync", { method: "POST" });
    let msg = `동기화 완료: ${result.checked}건 확인, 신규 개정 ${result.new_revisions}건, 신규 고시 후보 ${result.new_admrul_candidates}건`;
    if (result.errors.length) msg += ` (오류 ${result.errors.length}건)`;
    toast(msg, result.errors.length > 0);
    loadDashboard();
    const activeTab = document.querySelector(".tab-btn.active").dataset.tab;
    loadTab(activeTab);
  } catch (e) {
    toast(`동기화 실패: ${e.message}`, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "새로고침";
    }
  }
}

function initSyncButton() {
  document.getElementById("syncNowBtn").addEventListener("click", () => {
    runSync(document.getElementById("syncNowBtn"));
  });
}

// ---------- init ----------

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initDocumentForm();
  initSettingsForms();
  initDismissedAdmrulPanel();
  initSyncButton();
  initAlarmBell();
  initHelpModal();
  initKeywordSearch();
  initNewsBoard();
  document.getElementById("searchBtn").addEventListener("click", searchLaws);
  document.getElementById("searchQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchLaws(); } });
  let searchDebounceTimer = null;
  document.getElementById("searchQuery").addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    const query = document.getElementById("searchQuery").value.trim();
    if (query.length < 2) { document.getElementById("searchResults").innerHTML = ""; return; }
    searchDebounceTimer = setTimeout(searchLaws, 400);
  });
  document.getElementById("searchSourceType").addEventListener("change", () => {
    if (document.getElementById("searchQuery").value.trim().length >= 2) searchLaws();
  });
  document.getElementById("seedDefaultsBtn").addEventListener("click", seedDefaultLaws);
  document.getElementById("lawsFilterInput").addEventListener("input", (e) => {
    lawsFilterText = e.target.value;
    renderLawsTable();
  });
  document.getElementById("revisionStatusFilter").addEventListener("change", loadRevisions);
  document.getElementById("revisionsSearchInput").addEventListener("input", renderRevisionsTable);
  document.getElementById("revisionsBulkApplyBtn").addEventListener("click", applyRevisionsBulkStatus);
  document.getElementById("revisionsBulkDeleteBtn").addEventListener("click", deleteRevisionsBulk);
  document.getElementById("docRevisionStatusFilter").addEventListener("change", loadDocRevisions);
  document.getElementById("docRevisionsSearchInput").addEventListener("input", renderDocRevisionsTable);
  loadDashboard();
  api("/api/health").then((h) => { document.getElementById("demoBadge").hidden = !h.demo_mode; }).catch(() => {});

  // 다른 브라우저 탭/창을 보다가 이 화면으로 돌아왔을 때 자동으로 최신
  // 내용을 다시 불러온다. 설정을 저장하면 자동으로 새로고침(동기화)까지
  // 되긴 하지만, 그건 저장한 그 브라우저 탭 안에서만 반영되고 다른 탭에
  // 이미 열어둔 화면(예: 대시보드를 한쪽 탭에 띄워두고 다른 탭에서 설정을
  // 바꾼 경우)에는 전달되지 않아, 결국 F5를 눌러야 하는 불편함이 있었다.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const activeTab = document.querySelector(".tab-btn.active").dataset.tab;
    loadTab(activeTab);
    if (activeTab !== "dashboard") loadDashboard();
  });
});
