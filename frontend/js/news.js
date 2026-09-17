// 대시보드 상단 안전보건 뉴스 자동 스크롤 게시판.

import { api, escapeHtml } from "./core.js";

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

export async function loadNewsBoard() {
  try {
    const params = newsBoardState.category ? `?category=${encodeURIComponent(newsBoardState.category)}` : "";
    const items = await api(`/api/news${params}`);
    renderNewsBoard(items);
  } catch (e) {
    // 뉴스 게시판은 부가 기능이라, 실패해도 토스트로 화면 전체를 방해하지 않는다.
    document.getElementById("newsBoardTrack").innerHTML = "";
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

export function initNewsBoard() {
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
