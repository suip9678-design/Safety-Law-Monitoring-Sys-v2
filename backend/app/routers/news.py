from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, news_service, schemas, settings_store
from ..database import get_db

router = APIRouter(prefix="/api/news", tags=["news"])


def _is_enabled(db: Session) -> bool:
    return settings_store.get(db, "news_ticker_enabled").strip().lower() in ("1", "true", "yes", "on")


@router.get("", response_model=list[schemas.NewsItemOut])
def list_news(category: str | None = None, limit: int = 40, db: Session = Depends(get_db)):
    if not _is_enabled(db):
        return []
    # 발행일(published_at)이 없는 항목(일부 피드는 안 줄 수 있음)은 가져온
    # 시각(fetched_at)을 대신 써서 정렬한다 - 둘 다 최신순이라는 목적은 같다.
    order_col = func.coalesce(models.NewsItem.published_at, models.NewsItem.fetched_at).desc()
    query = db.query(models.NewsItem)
    if category:
        query = query.filter(models.NewsItem.category == category)
    rows = query.order_by(order_col).limit(min(max(limit, 1), 200)).all()
    return rows


@router.post("/sync")
def sync_now(db: Session = Depends(get_db)):
    values = settings_store.get_all(db)
    max_items = int(values.get("news_max_items_per_category") or 30)
    added = news_service.sync_news(db, news_service.configured_sources(db), max_items)
    return {"added": added}
