// 상단 알림 종(🔔) - 미검토 개정이 있고, 마지막으로 확인(ack)한 것보다
// 새 개정이 있으면 활성화된다. ack 상태는 브라우저 localStorage에 저장.

import { state } from "./core.js";
import { activateTab } from "./tabs.js";
import { loadRevisions } from "./revisions.js";

const ALARM_ACK_KEY = "safety_alert_alarm_ack_id";
const LEGACY_ALARM_ACK_KEY = "safety_law_alarm_ack_id"; // 이름 변경 전 키 - 읽기만 하고 새 키로 옮긴다

function getAlarmAckId() {
  try {
    let raw = localStorage.getItem(ALARM_ACK_KEY);
    if (raw === null) {
      raw = localStorage.getItem(LEGACY_ALARM_ACK_KEY);
      if (raw !== null) {
        localStorage.setItem(ALARM_ACK_KEY, raw);
        localStorage.removeItem(LEGACY_ALARM_ACK_KEY);
      }
    }
    return Number(raw || 0);
  } catch (_) { return 0; }
}

function setAlarmAckId(id) {
  try { localStorage.setItem(ALARM_ACK_KEY, String(id)); } catch (_) { /* ignore */ }
}

export function updateAlarmBell(summary) {
  const bell = document.getElementById("alarmBell");
  const latestId = summary.recent_revisions.length ? Math.max(...summary.recent_revisions.map((r) => r.id)) : 0;
  const active = summary.unreviewed_count > 0 && latestId > getAlarmAckId();
  bell.hidden = summary.unreviewed_count === 0;
  bell.classList.toggle("active", active);
  document.getElementById("alarmBellCount").textContent = summary.unreviewed_count || "";
  bell.dataset.latestId = String(latestId);
}

export function initAlarmBell() {
  document.getElementById("alarmBell").addEventListener("click", (e) => {
    setAlarmAckId(Number(e.currentTarget.dataset.latestId || 0));
    e.currentTarget.classList.remove("active");
    document.getElementById("revisionStatusFilter").value = "미검토";
    state.revisionsLawFilter = null;
    activateTab("revisions");
    loadRevisions();
  });
}
