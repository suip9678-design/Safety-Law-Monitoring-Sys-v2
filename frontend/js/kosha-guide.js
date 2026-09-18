// "KOSHA 가이드" 탭: 한국산업안전보건공단(KOSHA) 기술지침(KOSHA GUIDE)
// 라이브러리. 법령/고시와 달리 공개 조회 API가 없어(models.KoshaGuide
// 설명 참고) 공공데이터포털 Open API 동기화·직접 입력·붙여넣기(일괄
// 등록) 세 가지 방법으로 채우고, 그 범위 안에서만 도는 키워드 검색을
// 제공한다.

import { state, api, toast, fmtDate, escapeHtml } from "./core.js";
import { highlightSnippet } from "./keyword-search.js";

// 제목을 누르면 원문 링크(file_link)로 바로 이동한다. 링크가 없는
// 항목은 (검색엔진 결과로 대신 보내는 등 엉뚱한 곳으로 보내지 않도록)
// 그냥 클릭할 수 없는 일반 텍스트로 둔다 - 실제로 열어볼 곳이 없다는
// 것을 그대로 보여주는 편이 낫다.
function titleCell(g) {
  return g.file_link
    ? `<a href="${escapeHtml(g.file_link)}" target="_blank" rel="noopener">${escapeHtml(g.title)}</a>`
    : `<span title="원문 링크가 등록되어 있지 않습니다">${escapeHtml(g.title)}</span>`;
}

let koshaGuideFilterText = "";

function openKoshaGuideModal() {
  document.getElementById("koshaGuideModalOverlay").hidden = false;
}

function closeKoshaGuideModal() {
  document.getElementById("koshaGuideModalOverlay").hidden = true;
}

// 서버가 첨부 PDF를 서빙해주는 자기 자신의 URL 패턴 - 이 값과 file_link가
// 같으면 "직접 붙인 URL"이 아니라 "여기서 업로드한 PDF"라는 뜻이라
// "첨부 삭제" 버튼을 보여줄 수 있다.
function servedFileUrl(id) {
  return `/api/kosha-guides/${id}/file`;
}

// 새 가이드는 아직 id가 없어 파일을 올릴 서버 자원이 없으므로, 먼저
// 저장해서 id가 생긴 뒤에만 업로드/삭제 버튼을 쓸 수 있게 한다.
function refreshFileUploadSection(id, fileLink) {
  const hasId = Boolean(id);
  document.getElementById("koshaGuideFileUploadInput").disabled = !hasId;
  document.getElementById("koshaGuideFileUploadBtn").disabled = !hasId;
  document.getElementById("koshaGuideFileUploadHint").textContent = hasId
    ? ""
    : "먼저 저장한 뒤 PDF를 첨부할 수 있습니다.";
  const deleteBtn = document.getElementById("koshaGuideFileDeleteBtn");
  deleteBtn.hidden = !(hasId && fileLink === servedFileUrl(id));
}

function resetKoshaGuideForm() {
  document.getElementById("koshaGuideFormTitle").textContent = "가이드 추가";
  document.getElementById("koshaGuideForm").reset();
  document.getElementById("koshaGuideId").value = "";
  refreshFileUploadSection("", "");
}

export async function loadKoshaGuides() {
  try {
    state.koshaGuides = await api("/api/kosha-guides");
    renderKoshaGuidesTable();
  } catch (e) {
    toast(`KOSHA 가이드 목록 로드 실패: ${e.message}`, true);
  }
}

function renderKoshaGuidesTable() {
  const el = document.getElementById("koshaGuidesTable");
  if (!state.koshaGuides.length) {
    el.innerHTML = `<div class="empty">등록된 KOSHA 가이드가 없습니다. 위 "가이드 추가" 또는 "여러 건 한 번에 붙여넣기"로 채워보세요.</div>`;
    return;
  }
  const q = koshaGuideFilterText.trim();
  const filtered = q
    ? state.koshaGuides.filter((g) =>
        (g.title || "").includes(q) || (g.code || "").includes(q) || (g.field || "").includes(q)
      )
    : state.koshaGuides;
  if (!filtered.length) {
    el.innerHTML = `<div class="empty">"${escapeHtml(q)}"와(과) 일치하는 가이드가 없습니다.</div>`;
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>지침번호</th><th>분야</th><th>제목</th><th>제개정일자</th><th></th></tr></thead>
      <tbody>
        ${filtered.map((g) => `
          <tr>
            <td>${escapeHtml(g.code || "-")}</td>
            <td>${escapeHtml(g.field || "-")}</td>
            <td>${titleCell(g)}</td>
            <td>${fmtDate(g.issued_date)}</td>
            <td>
              <button class="link-btn" data-edit-kosha-guide="${g.id}">수정</button>
              <button class="link-btn" data-delete-kosha-guide="${g.id}">삭제</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  el.querySelectorAll("[data-edit-kosha-guide]").forEach((btn) => {
    btn.addEventListener("click", () => startEditKoshaGuide(Number(btn.dataset.editKoshaGuide)));
  });
  el.querySelectorAll("[data-delete-kosha-guide]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("이 가이드를 삭제할까요?")) return;
      try {
        await api(`/api/kosha-guides/${btn.dataset.deleteKoshaGuide}`, { method: "DELETE" });
        toast("삭제했습니다.");
        loadKoshaGuides();
      } catch (e) {
        toast(`삭제 실패: ${e.message}`, true);
      }
    });
  });
}

function startEditKoshaGuide(id) {
  const g = state.koshaGuides.find((x) => x.id === id);
  if (!g) return;
  document.getElementById("koshaGuideFormTitle").textContent = "가이드 수정";
  document.getElementById("koshaGuideId").value = g.id;
  document.getElementById("koshaGuideCode").value = g.code || "";
  document.getElementById("koshaGuideField").value = g.field || "";
  document.getElementById("koshaGuideTitle").value = g.title;
  document.getElementById("koshaGuideIssuedDate").value = g.issued_date || "";
  document.getElementById("koshaGuideFileLink").value = g.file_link || "";
  document.getElementById("koshaGuideContent").value = g.content || "";
  document.getElementById("koshaGuideNote").value = g.note || "";
  refreshFileUploadSection(g.id, g.file_link);
  openKoshaGuideModal();
}

export function initKoshaGuideForm() {
  document.getElementById("koshaGuideForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = document.getElementById("koshaGuideId").value;
    const payload = {
      code: document.getElementById("koshaGuideCode").value || null,
      field: document.getElementById("koshaGuideField").value || null,
      title: document.getElementById("koshaGuideTitle").value,
      issued_date: document.getElementById("koshaGuideIssuedDate").value || null,
      file_link: document.getElementById("koshaGuideFileLink").value || null,
      content: document.getElementById("koshaGuideContent").value || null,
      note: document.getElementById("koshaGuideNote").value || null,
    };
    try {
      if (id) {
        await api(`/api/kosha-guides/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        toast("수정했습니다.");
      } else {
        await api("/api/kosha-guides", { method: "POST", body: JSON.stringify(payload) });
        toast("추가했습니다.");
      }
      resetKoshaGuideForm();
      closeKoshaGuideModal();
      loadKoshaGuides();
    } catch (e) {
      toast(`저장 실패: ${e.message}`, true);
    }
  });
  document.getElementById("koshaGuideCancelBtn").addEventListener("click", () => {
    resetKoshaGuideForm();
    closeKoshaGuideModal();
  });
  document.getElementById("koshaGuideModalCloseBtn").addEventListener("click", () => {
    resetKoshaGuideForm();
    closeKoshaGuideModal();
  });
  document.getElementById("koshaGuideAddBtn").addEventListener("click", () => {
    resetKoshaGuideForm();
    openKoshaGuideModal();
  });
  document.getElementById("koshaGuideModalOverlay").addEventListener("click", (ev) => {
    if (ev.target.id === "koshaGuideModalOverlay") {
      resetKoshaGuideForm();
      closeKoshaGuideModal();
    }
  });
  document.getElementById("koshaGuideFilterInput").addEventListener("input", (e) => {
    koshaGuideFilterText = e.target.value;
    renderKoshaGuidesTable();
  });
  document.getElementById("koshaGuideFileUploadBtn").addEventListener("click", async () => {
    const id = document.getElementById("koshaGuideId").value;
    const input = document.getElementById("koshaGuideFileUploadInput");
    const file = input.files[0];
    if (!id || !file) {
      toast(!id ? "먼저 저장한 뒤 첨부할 수 있습니다." : "첨부할 PDF 파일을 선택하세요.", true);
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    const btn = document.getElementById("koshaGuideFileUploadBtn");
    btn.disabled = true;
    btn.textContent = "업로드 중...";
    try {
      const guide = await api(`/api/kosha-guides/${id}/file`, { method: "POST", headers: {}, body: formData });
      document.getElementById("koshaGuideFileLink").value = guide.file_link || "";
      refreshFileUploadSection(guide.id, guide.file_link);
      input.value = "";
      toast("PDF를 첨부했습니다.");
      loadKoshaGuides();
    } catch (e) {
      toast(`첨부 실패: ${e.message}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "업로드";
    }
  });
  document.getElementById("koshaGuideFileDeleteBtn").addEventListener("click", async () => {
    const id = document.getElementById("koshaGuideId").value;
    if (!id || !confirm("첨부한 PDF를 삭제할까요?")) return;
    try {
      const guide = await api(`/api/kosha-guides/${id}/file`, { method: "DELETE" });
      document.getElementById("koshaGuideFileLink").value = guide.file_link || "";
      refreshFileUploadSection(guide.id, guide.file_link);
      toast("첨부를 삭제했습니다.");
      loadKoshaGuides();
    } catch (e) {
      toast(`삭제 실패: ${e.message}`, true);
    }
  });
}

const KOSHA_GUIDE_MATCHED_IN_LABEL = { code: "지침번호", title: "제목", content: "본문" };

let koshaGuideSearchSeq = 0;

async function searchKoshaGuides() {
  const query = document.getElementById("koshaGuideSearchInput").value.trim();
  const el = document.getElementById("koshaGuideSearchResults");
  if (!query) { el.innerHTML = ""; return; }
  const mySeq = ++koshaGuideSearchSeq;
  el.innerHTML = `<div class="empty">검색 중...</div>`;
  try {
    const results = await api(`/api/kosha-guides/search?query=${encodeURIComponent(query)}`);
    if (mySeq !== koshaGuideSearchSeq) return;
    if (!results.length) {
      el.innerHTML = `<div class="empty">검색 결과가 없습니다. 아직 등록된 KOSHA 가이드가 없거나, 등록해둔 범위에 일치하는 내용이 없습니다.</div>`;
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>지침번호</th><th>분야</th><th>제목</th><th>매칭 위치</th><th>미리보기</th><th>제개정일자</th></tr></thead>
        <tbody>
          ${results.map((r) => `
            <tr>
              <td>${escapeHtml(r.code || "-")}</td>
              <td>${escapeHtml(r.field || "-")}</td>
              <td>${titleCell(r)}</td>
              <td>${KOSHA_GUIDE_MATCHED_IN_LABEL[r.matched_in] || "-"}</td>
              <td class="search-snippet">${r.snippet ? highlightSnippet(r.snippet, query) : '<span class="hint">-</span>'}</td>
              <td>${fmtDate(r.issued_date)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    if (mySeq !== koshaGuideSearchSeq) return;
    el.innerHTML = `<div class="empty">검색 실패: ${escapeHtml(e.message)}</div>`;
  }
}

export function initKoshaGuideSearch() {
  document.getElementById("koshaGuideSearchBtn").addEventListener("click", searchKoshaGuides);
  document.getElementById("koshaGuideSearchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); searchKoshaGuides(); }
  });
}

// 일괄 등록 붙여넣기 한 줄 파싱: 탭이 있으면 탭으로, 없으면 쉼표로
// 나눈다(제목에 쉼표가 섞여도 최대한 안전하도록, 따옴표로 감싼 구간의
// 쉼표는 나누지 않는 간단한 CSV 파서를 쓴다). "지침번호, 분야, 제목,
// 제개정일자, 링크" 순서를 기대하되, 뒤쪽 칸이 비어 있어도(모자라도)
// 최대한 받아준다.
function splitBulkLine(line) {
  if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseKoshaGuideBulkInput(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code, field, title, issued_date, file_link] = splitBulkLine(line);
      return {
        code: code || null,
        field: field || null,
        title: (title || "").trim(),
        issued_date: issued_date || null,
        file_link: file_link || null,
      };
    })
    .filter((item) => item.title);
}

export function initKoshaGuideSync() {
  document.getElementById("koshaGuideSyncBtn").addEventListener("click", async () => {
    const btn = document.getElementById("koshaGuideSyncBtn");
    const statusEl = document.getElementById("koshaGuideSyncStatus");
    btn.disabled = true;
    btn.textContent = "동기화 중...";
    statusEl.textContent = "";
    try {
      const result = await api("/api/kosha-guides/sync", { method: "POST" });
      let msg = `동기화 완료: 키워드 ${result.keywords_checked.length}개 확인, 찾음 ${result.found}건 (추가 ${result.added}건, 갱신 ${result.updated}건)`;
      if (result.errors.length) {
        msg += ` — 오류 ${result.errors.length}건: ${result.errors[0]}`;
      }
      statusEl.textContent = msg;
      toast(result.errors.length ? `동기화 일부 실패 (${result.errors.length}건 오류)` : "동기화 완료했습니다.", result.errors.length > 0);
      loadKoshaGuides();
    } catch (e) {
      statusEl.textContent = `동기화 실패: ${e.message}`;
      toast(`동기화 실패: ${e.message} — 설정 > KOSHA 가이드 Open API에서 인증키/요청 URL을 확인하세요.`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "API로 동기화";
    }
  });
}

export function initKoshaGuideBulkImport() {
  document.getElementById("koshaGuideBulkImportBtn").addEventListener("click", async () => {
    const raw = document.getElementById("koshaGuideBulkInput").value;
    const items = parseKoshaGuideBulkInput(raw);
    const resultEl = document.getElementById("koshaGuideBulkResult");
    if (!items.length) {
      toast("붙여넣은 내용에서 제목이 있는 줄을 찾지 못했습니다.", true);
      return;
    }
    const btn = document.getElementById("koshaGuideBulkImportBtn");
    btn.disabled = true;
    btn.textContent = "등록 중...";
    try {
      const result = await api("/api/kosha-guides/bulk-import", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      resultEl.textContent = `추가 ${result.added}건, 갱신 ${result.updated}건${result.skipped ? `, 건너뜀 ${result.skipped}건(제목 없음)` : ""}`;
      toast(`일괄 등록 완료: 추가 ${result.added}건, 갱신 ${result.updated}건`);
      document.getElementById("koshaGuideBulkInput").value = "";
      loadKoshaGuides();
    } catch (e) {
      toast(`일괄 등록 실패: ${e.message}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "붙여넣은 목록 일괄 등록";
    }
  });
}
