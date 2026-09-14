import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from sqlalchemy.orm import Session

from . import models, settings_store


class EmailNotConfigured(RuntimeError):
    pass


def _smtp_config(db: Session) -> dict:
    values = settings_store.get_all(db)
    return {
        "host": values.get("smtp_host", ""),
        "port": int(values.get("smtp_port") or 587),
        "use_tls": str(values.get("smtp_use_tls", "true")).lower() in ("1", "true", "yes", "on"),
        "user": values.get("smtp_user", ""),
        "password": values.get("smtp_password", ""),
        "from_addr": values.get("smtp_from", "") or values.get("smtp_user", ""),
        "recipients": [e.strip() for e in (values.get("alert_emails") or "").split(",") if e.strip()],
    }


def is_configured(db: Session) -> bool:
    cfg = _smtp_config(db)
    return bool(cfg["host"] and cfg["from_addr"] and cfg["recipients"])


def _send(cfg: dict, subject: str, html_body: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = cfg["from_addr"]
    msg["To"] = ", ".join(cfg["recipients"])
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP(cfg["host"], cfg["port"], timeout=15) as server:
        if cfg["use_tls"]:
            server.starttls()
        if cfg["user"]:
            server.login(cfg["user"], cfg["password"])
        server.sendmail(cfg["from_addr"], cfg["recipients"], msg.as_string())


def send_test_email(db: Session) -> None:
    cfg = _smtp_config(db)
    if not (cfg["host"] and cfg["from_addr"] and cfg["recipients"]):
        raise EmailNotConfigured("SMTP 서버, 발신 주소, 수신자 목록을 먼저 설정하세요.")
    _send(cfg, "[안전보건 법령 추적] 테스트 메일", "<p>테스트 메일입니다. 정상적으로 수신되었다면 알림 설정이 올바르게 구성된 것입니다.</p>")


def send_revision_alert(db: Session, revisions: list[models.LawRevision]) -> bool:
    """Send an alert email listing newly detected revisions and which
    company documents they affect. Returns True if an email was sent."""

    if not revisions or not is_configured(db):
        return False

    cfg = _smtp_config(db)
    rows = []
    for rev in revisions:
        law = rev.tracked_law
        mapped = [m.document.title for m in law.mappings] if law else []
        mapped_html = "".join(f"<li>{title}</li>" for title in mapped) or "<li>(매핑된 문서 없음)</li>"
        rows.append(
            f"""
            <tr>
              <td style="padding:8px;border:1px solid #ddd;">{law.name if law else ''}</td>
              <td style="padding:8px;border:1px solid #ddd;">{law.category or '' if law else ''}</td>
              <td style="padding:8px;border:1px solid #ddd;">{rev.promulgation_date or '-'}</td>
              <td style="padding:8px;border:1px solid #ddd;">{rev.enforcement_date or '-'}</td>
              <td style="padding:8px;border:1px solid #ddd;"><ul style="margin:0;padding-left:16px;">{mapped_html}</ul></td>
            </tr>
            """
        )

    html = f"""
    <h2>안전보건 법령·고시 개정 알림</h2>
    <p>새로 감지된 개정 {len(revisions)}건이 있습니다. 관련 회사 문서(절차서/지침서/작업표준)를 검토해 주세요.</p>
    <table style="border-collapse:collapse;width:100%;">
      <thead>
        <tr>
          <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">법령/고시명</th>
          <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">구분</th>
          <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">공포일자</th>
          <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">시행일자</th>
          <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">영향받는 회사 문서</th>
        </tr>
      </thead>
      <tbody>
        {''.join(rows)}
      </tbody>
    </table>
    """

    _send(cfg, f"[안전보건 법령 추적] 개정 {len(revisions)}건 발생", html)
    return True
