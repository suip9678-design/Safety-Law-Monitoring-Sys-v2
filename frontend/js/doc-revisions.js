// "사규 개정 이력" 탭: 대시보드의 "사내 절차서·지침서 개정 필요 사항"과
// 같은 형식(document-impacts.js)을 쓰되, 대시보드는 미검토/검토중 + 최대
// 몇 건만 보여주는 반면 여기는 상태 필터/검색을 걸어 처리 완료된 것까지
// 포함한 전체 이력을 다 보여준다.

import { api, toast, escapeHtml } from "./core.js";
import { renderDocumentImpactsList } from "./document-impacts.js";
import { wireStatusSelects } from "./status-actions.js";
import { loadDashboard } from "./dashboard.js";
import { loadRevisions } from "./revisions.js";

let lastLoadedDocRevisions = [];
// 체크된 개정 id들 - 일괄 상태 변경용. 표를 다시 그릴 때마다 초기화됨.
let selectedDocRevisionIds = new Set();

export async function loadDocRevisions() {
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

function updateDocRevisionsBulkToolbar() {
  document.getElementById("docRevisionsSelectedCount").textContent = `${selectedDocRevisionIds.size}건 선택됨`;
  document.getElementById("docRevisionsBulkApplyBtn").disabled = selectedDocRevisionIds.size === 0;
  const selectAll = document.getElementById("docRevisionsSelectAllCheckbox");
  if (selectAll) {
    const rowCheckboxes = document.querySelectorAll(".doc-revision-row-checkbox");
    const checkedCount = document.querySelectorAll(".doc-revision-row-checkbox:checked").length;
    selectAll.checked = rowCheckboxes.length > 0 && checkedCount === rowCheckboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < rowCheckboxes.length;
  }
}

export function renderDocRevisionsTable() {
  const el = document.getElementById("docRevisionsTable");
  const searchText = document.getElementById("docRevisionsSearchInput").value.trim();
  const docImpacts = searchText
    ? lastLoadedDocRevisions.filter((d) =>
        d.document_title.includes(searchText) || d.revisions.some((r) => r.tracked_law_name.includes(searchText))
      )
    : lastLoadedDocRevisions;
  selectedDocRevisionIds = new Set();
  el.innerHTML = docImpacts.length
    ? renderDocumentImpactsList(docImpacts, selectedDocRevisionIds)
    : `<div class="empty">${searchText ? `"${escapeHtml(searchText)}"와(과) 일치하는 사규 개정 이력이 없습니다.` : "사규와 매핑된 법령의 개정 이력이 없습니다. 사규 추가/수정 화면에서 근거 법령을 연결해보세요."}</div>`;
  wireStatusSelects(el);

  const rowCheckboxes = () => el.querySelectorAll(".doc-revision-row-checkbox");
  // 같은 개정 건이 여러 문서 아래 나오면 체크박스도 여러 개라, 하나를 바꾸면
  // 같은 id의 나머지도 같이 맞춘다.
  const setChecked = (id, checked) => {
    if (checked) selectedDocRevisionIds.add(id);
    else selectedDocRevisionIds.delete(id);
    rowCheckboxes().forEach((cb) => {
      if (Number(cb.dataset.revisionId) === id) cb.checked = checked;
    });
  };
  rowCheckboxes().forEach((cb) => {
    cb.addEventListener("change", () => {
      setChecked(Number(cb.dataset.revisionId), cb.checked);
      updateDocRevisionsBulkToolbar();
    });
  });
  const selectAll = document.getElementById("docRevisionsSelectAllCheckbox");
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      rowCheckboxes().forEach((cb) => setChecked(Number(cb.dataset.revisionId), selectAll.checked));
      updateDocRevisionsBulkToolbar();
    });
  }
  updateDocRevisionsBulkToolbar();
}

async function applyDocRevisionsBulkStatus() {
  if (selectedDocRevisionIds.size === 0) return;
  const status = document.getElementById("docRevisionsBulkStatus").value;
  const count = selectedDocRevisionIds.size;
  const btn = document.getElementById("docRevisionsBulkApplyBtn");
  btn.disabled = true;
  try {
    await api("/api/revisions/bulk-status", {
      method: "PATCH",
      body: JSON.stringify({ ids: Array.from(selectedDocRevisionIds), review_status: status }),
    });
    toast(`${count}건을 "${status}"(으)로 변경했습니다.`);
    loadDocRevisions();
    loadRevisions();
    loadDashboard();
  } catch (e) {
    toast(`일괄 변경 실패: ${e.message}`, true);
    btn.disabled = false;
  }
}

export function initDocRevisionsTab() {
  document.getElementById("docRevisionStatusFilter").addEventListener("change", loadDocRevisions);
  document.getElementById("docRevisionsSearchInput").addEventListener("input", renderDocRevisionsTable);
  document.getElementById("docRevisionsBulkApplyBtn").addEventListener("click", applyDocRevisionsBulkStatus);
}
