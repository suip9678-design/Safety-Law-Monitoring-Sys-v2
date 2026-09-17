// 공통 상태 + 어디서나 쓰는 기본 헬퍼(API 호출, 토스트, 문자열/날짜 포맷,
// 상태 배지). 다른 모든 모듈이 이 모듈을 가져다 쓰므로, 이 파일은 반대로
// 다른 화면별 모듈을 가져오지 않는다(순환 참조의 뿌리가 되지 않게).

export const state = {
  laws: [],
  documents: [],
  koshaGuides: [],
  revisionsLawFilter: null, // { id, name } | null
};

export const SOURCE_TYPE_LABEL = { law: "법령", admrul: "행정규칙" };

export async function api(path, options = {}) {
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

export function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}

export function fmtDate(d) {
  if (!d) return "-";
  return String(d).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
}

export function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR");
}

export function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const STATUS_BADGE_CLASS = { "미검토": "badge-pending", "검토중": "badge-progress", "반영완료": "badge-ok", "해당없음": "badge-warn" };

export function statusBadge(status) {
  return `<span class="badge ${STATUS_BADGE_CLASS[status] || ""}">${status}</span>`;
}

export function statusSelect(revisionId, status) {
  return `
    <select class="badge-select ${STATUS_BADGE_CLASS[status] || ""}" data-status-select="${revisionId}">
      ${["미검토", "검토중", "반영완료", "해당없음"].map((s) => `<option value="${s}" ${s === status ? "selected" : ""}>${s}</option>`).join("")}
    </select>
  `;
}
