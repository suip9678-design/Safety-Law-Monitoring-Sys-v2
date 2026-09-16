from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas, settings_store
from ..config import settings as env_settings
from ..database import get_db
from ..email_service import EmailNotConfigured, send_test_email

router = APIRouter(prefix="/api/settings", tags=["settings"])

# 도움말 자동 팝업 여부 - 사용자가 설정 화면에서 바꾸는 값이 아니라 "이 설치본에서
# 도움말을 한 번이라도 띄운 적이 있는지"만 기억하는 내부 마커라, 다른 설정처럼
# settings_store를 거치지 않고 app_settings 테이블에 직접 읽고 쓴다. 브라우저의
# localStorage가 아니라 서버(DB)에 저장해서, 브라우저를 바꾸거나 캐시를 지워도
# "설치 후 최초 실행"에만 한 번 뜨고 그 뒤로는(재실행/재접속 포함) 다시 자동으로
# 뜨지 않는다.
_HELP_SHOWN_KEY = "help_shown_once"


@router.get("", response_model=schemas.SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    values = settings_store.get_all(db)
    smtp_configured = bool(values.get("smtp_host") and values.get("alert_emails"))
    return schemas.SettingsOut(
        demo_mode=not bool(values.get("law_api_oc")),
        law_api_oc_set=bool(values.get("law_api_oc")),
        law_api_oc=values.get("law_api_oc") or None,
        kosha_guide_api_key_set=bool(values.get("kosha_guide_api_key")),
        kosha_guide_api_key=values.get("kosha_guide_api_key") or None,
        kosha_guide_api_url=values.get("kosha_guide_api_url") or None,
        kosha_guide_sync_keywords=values.get("kosha_guide_sync_keywords") or None,
        auto_sync_interval_hours=env_settings.AUTO_SYNC_INTERVAL_HOURS,
        smtp_configured=smtp_configured,
        smtp_host=values.get("smtp_host") or None,
        smtp_port=int(values.get("smtp_port") or 587),
        smtp_use_tls=str(values.get("smtp_use_tls", "true")).lower() in ("1", "true", "yes", "on"),
        smtp_user=values.get("smtp_user") or None,
        smtp_from=values.get("smtp_from") or None,
        alert_emails=values.get("alert_emails") or None,
        new_admrul_keywords=values.get("new_admrul_keywords") or None,
        new_admrul_department=values.get("new_admrul_department") or None,
        new_admrul_since_date=values.get("new_admrul_since_date") or None,
        full_law_cache_enabled=str(values.get("full_law_cache_enabled", "false")).lower() in ("1", "true", "yes", "on"),
        email_feature_enabled=env_settings.FEATURE_EMAIL_ENABLED,
        news_ticker_enabled=str(values.get("news_ticker_enabled", "true")).lower() in ("1", "true", "yes", "on"),
        news_source_moel_url=values.get("news_source_moel_url") or None,
        news_source_kosha_url=values.get("news_source_kosha_url") or None,
        news_source_accident_url=values.get("news_source_accident_url") or None,
        news_max_items_per_category=int(values.get("news_max_items_per_category") or 30),
    )


@router.put("", response_model=schemas.SettingsOut)
def update_settings(payload: schemas.SettingsUpdate, db: Session = Depends(get_db)):
    updates = {}
    if payload.law_api_oc is not None:
        updates["law_api_oc"] = payload.law_api_oc
    if payload.kosha_guide_api_key is not None:
        updates["kosha_guide_api_key"] = payload.kosha_guide_api_key
    if payload.kosha_guide_api_url is not None:
        updates["kosha_guide_api_url"] = payload.kosha_guide_api_url
    if payload.kosha_guide_sync_keywords is not None:
        updates["kosha_guide_sync_keywords"] = payload.kosha_guide_sync_keywords
    if payload.smtp_host is not None:
        updates["smtp_host"] = payload.smtp_host
    if payload.smtp_port is not None:
        updates["smtp_port"] = str(payload.smtp_port)
    if payload.smtp_use_tls is not None:
        updates["smtp_use_tls"] = "true" if payload.smtp_use_tls else "false"
    if payload.smtp_user is not None:
        updates["smtp_user"] = payload.smtp_user
    if payload.smtp_password is not None:
        updates["smtp_password"] = payload.smtp_password
    if payload.smtp_from is not None:
        updates["smtp_from"] = payload.smtp_from
    if payload.alert_emails is not None:
        updates["alert_emails"] = payload.alert_emails
    if payload.new_admrul_keywords is not None:
        updates["new_admrul_keywords"] = payload.new_admrul_keywords
    if payload.new_admrul_department is not None:
        updates["new_admrul_department"] = payload.new_admrul_department
    if payload.new_admrul_since_date is not None:
        updates["new_admrul_since_date"] = payload.new_admrul_since_date
    if payload.full_law_cache_enabled is not None:
        updates["full_law_cache_enabled"] = "true" if payload.full_law_cache_enabled else "false"
    if payload.news_ticker_enabled is not None:
        updates["news_ticker_enabled"] = "true" if payload.news_ticker_enabled else "false"
    if payload.news_source_moel_url is not None:
        updates["news_source_moel_url"] = payload.news_source_moel_url
    if payload.news_source_kosha_url is not None:
        updates["news_source_kosha_url"] = payload.news_source_kosha_url
    if payload.news_source_accident_url is not None:
        updates["news_source_accident_url"] = payload.news_source_accident_url
    if payload.news_max_items_per_category is not None:
        updates["news_max_items_per_category"] = str(payload.news_max_items_per_category)

    settings_store.set_values(db, updates)
    return get_settings(db)


@router.get("/help-shown")
def get_help_shown(db: Session = Depends(get_db)):
    row = db.get(models.AppSetting, _HELP_SHOWN_KEY)
    return {"shown": bool(row and row.value == "1")}


@router.post("/help-shown", status_code=204)
def mark_help_shown(db: Session = Depends(get_db)):
    row = db.get(models.AppSetting, _HELP_SHOWN_KEY)
    if row is None:
        db.add(models.AppSetting(key=_HELP_SHOWN_KEY, value="1"))
    else:
        row.value = "1"
    db.commit()
    return None


@router.post("/test-email", status_code=204)
def test_email(db: Session = Depends(get_db)):
    try:
        send_test_email(db)
    except EmailNotConfigured as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"메일 발송에 실패했습니다: {exc}") from exc
    return None
