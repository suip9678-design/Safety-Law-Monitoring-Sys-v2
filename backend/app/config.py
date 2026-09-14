import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _normalize_db_url(url: str) -> str:
    # Render/Neon/Heroku-style Postgres URLs use the "postgres://" scheme,
    # but SQLAlchemy 2.x requires "postgresql://".
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


class Settings:
    DATABASE_URL: str = _normalize_db_url(
        os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'safety_law_tracker.db'}")
    )

    LAW_API_OC: str = os.getenv("LAW_API_OC", "").strip()
    DEMO_MODE: bool = LAW_API_OC == ""

    AUTO_SYNC_INTERVAL_HOURS: int = int(os.getenv("AUTO_SYNC_INTERVAL_HOURS", "24") or "0")

    # 신규 제정 고시 자동 탐지: 아직 등록 안 한 고시/예규/훈령 중, 소관부처가
    # NEW_ADMRUL_DEPARTMENT와 일치하면서 이름에 NEW_ADMRUL_KEYWORDS 중
    # 하나라도 포함된 것만 후보로 찾아낸다(이중 필터). 등록해둔 고시가
    # "개정"되는게 아니라 매년 새로 "제정"되는 경우가 많아, 기존의
    # "등록된 항목이 바뀌었는지" 추적만으로는 놓치는 부분을 보완한다.
    NEW_ADMRUL_KEYWORDS: str = os.getenv(
        "NEW_ADMRUL_KEYWORDS",
        "안전보건,산업안전,중대재해,위험성평가,유해위험,보건관리,안전관리",
    ).strip()
    NEW_ADMRUL_DEPARTMENT: str = os.getenv("NEW_ADMRUL_DEPARTMENT", "고용노동부").strip()
    # 이 날짜(YYYYMMDD) 이전에 공포된 고시/예규/훈령은 "신규 제정" 후보에서
    # 제외한다. 비어있으면 필터 없이 전부 대상. 여러 사용자에게 배포될 때
    # 설치 시점마다 이 값을 다르게 잡을 수 있도록 설정 화면에서 바꿀 수 있다.
    NEW_ADMRUL_SINCE_DATE: str = os.getenv("NEW_ADMRUL_SINCE_DATE", "").strip()

    # 전체 법령(법률/시행령/시행규칙) 본문 자동 캐시 - 매일 새벽 1시(KST)에
    # 목록 조회 API를 끝까지 페이지 넘겨가며 훑어 등록 여부와 무관하게
    # 모든 법령의 본문을 캐시한다. 키워드 검색이 "안전보건 관련 키워드"
    # 범위를 벗어난 법령(예: 도로교통법)도 찾을 수 있게 하기 위함. 기본은
    # 꺼짐(수천 건 상세조회를 매일 자동으로 도는 건 부담이 커서, 사용자가
    # 설정에서 명시적으로 켜야 동작).
    FULL_LAW_CACHE_ENABLED: bool = _bool(os.getenv("FULL_LAW_CACHE_ENABLED"), False)

    # 배포 시 대시보드 보호용 (둘 다 설정해야 로그인 요구가 활성화됨)
    DASHBOARD_USERNAME: str = os.getenv("DASHBOARD_USERNAME", "").strip()
    DASHBOARD_PASSWORD: str = os.getenv("DASHBOARD_PASSWORD", "").strip()

    # 이메일 알림 기능을 화면에 노출할지 여부. 배포판(설치파일 버전)에서는
    # 일단 이메일 기능을 빼고 배포하기로 해 기본값을 꺼짐으로 두되, 코드
    # 자체는 남겨둬서 나중에 .env에서 다시 켜기만 하면 되게 한다.
    FEATURE_EMAIL_ENABLED: bool = _bool(os.getenv("FEATURE_EMAIL_ENABLED"), True)

    SMTP_HOST: str = os.getenv("SMTP_HOST", "").strip()
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587") or "587")
    SMTP_USE_TLS: bool = _bool(os.getenv("SMTP_USE_TLS"), True)
    SMTP_USER: str = os.getenv("SMTP_USER", "").strip()
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "").strip()
    SMTP_FROM: str = os.getenv("SMTP_FROM", "").strip()
    ALERT_EMAILS: str = os.getenv("ALERT_EMAILS", "").strip()

    FRONTEND_DIR: Path = BASE_DIR.parent / "frontend"


settings = Settings()
