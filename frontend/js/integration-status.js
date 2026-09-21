// 헤더의 "연동 확인 필요" 배지.
//
// 국가법령정보센터/KOSHA 가이드 Open API, 안전보건 뉴스 피드 3종처럼 이
// 앱이 의존하는 외부 연동 중 설정이 안 됐거나 안 먹히는 항목 수를 세어
// 배지에 보여주고, 누르면 값을 고칠 수 있는 설정 탭으로 이동한다.
//
// demo-mode.js가 다루는 "#demoBadge"(백엔드 자체가 없는 완전 오프라인
// 데모 여부)와는 별개의 개념이다 - 이 모듈은 백엔드는 정상 동작 중이되
// 그 안의 특정 외부 연동 하나가 설정이 안 됐거나 안 먹히는 경우를 다룬다.

import { api } from "./core.js";
import { activateTab, loadTab } from "./tabs.js";

function computeIssueCount(s) {
  let count = 0;
  if (!s.law_api_oc_set) count++;
  if (!s.kosha_guide_api_key_set) count++;
  if (s.news_moel_showing_demo === true) count++;
  if (s.news_kosha_showing_demo === true) count++;
  if (s.news_accident_showing_demo === true) count++;
  return count;
}

export async function loadIntegrationStatus() {
  try {
    const issueCount = computeIssueCount(await api("/api/settings"));
    const btn = document.getElementById("integrationAlertBtn");
    btn.hidden = issueCount === 0;
    btn.textContent = `⚠ 연동 확인 필요 (${issueCount})`;
  } catch (e) {
    // 이 배지는 부가 기능이라, 조회 실패는 조용히 무시하고 화면 전체를 막지 않는다.
  }
}

export function initIntegrationAlert() {
  document.getElementById("integrationAlertBtn").addEventListener("click", () => {
    activateTab("settings");
    loadTab("settings");
  });
}
