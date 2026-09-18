from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_columns():
    """Lightweight, no-Alembic migration: add any model columns that are
    missing from an existing DB file (Base.metadata.create_all only creates
    missing tables, it never alters existing ones). Call after create_all()."""
    inspector = inspect(engine)
    if "tracked_laws" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("tracked_laws")}
    if "master_id" not in existing:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE tracked_laws ADD COLUMN master_id VARCHAR(64)"))

    if "company_documents" in inspector.get_table_names():
        doc_columns = {c["name"] for c in inspector.get_columns("company_documents")}
        if "tags" not in doc_columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE company_documents ADD COLUMN tags VARCHAR(512)"))

    if "scraped_law_contents" in inspector.get_table_names():
        cache_columns = {c["name"] for c in inspector.get_columns("scraped_law_contents")}
        if "article_content_len" not in cache_columns:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE scraped_law_contents ADD COLUMN article_content_len INTEGER DEFAULT 0")
                )

    if "news_items" in inspector.get_table_names():
        news_columns = {c["name"] for c in inspector.get_columns("news_items")}
        if "is_archived" not in news_columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE news_items ADD COLUMN is_archived BOOLEAN DEFAULT 0"))

    if "kosha_guides" in inspector.get_table_names():
        guide_columns = {c["name"] for c in inspector.get_columns("kosha_guides")}
        if "content_stale" not in guide_columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE kosha_guides ADD COLUMN content_stale BOOLEAN DEFAULT 1"))
                # 이미 본문이 채워져 있던 기존 항목은 새로 캐시할 필요가
                # 없다고 간주해 stale=0으로 시작한다 - 그래야 이 업데이트
                # 직후 "본문 캐시 채우기"가 이미 캐시해둔 걸 전부 다시
                # 훑지 않는다.
                conn.execute(
                    text("UPDATE kosha_guides SET content_stale = 0 WHERE content IS NOT NULL AND content != ''")
                )
