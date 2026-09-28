#!/usr/bin/env python3
"""뉴스 중복 제거(news_service._title_tokens / _is_same_story /
_dedupe_existing / sync_news 삽입 dedup) 최소 동작 확인. pytest 없이
assert만으로 돈다.

실행: python scripts/check_news_dedupe.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models, news_service  # noqa: E402


def _fresh_session():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def check_same_story_merges_differently_worded_headlines():
    # 실제로 대시보드에서 관찰된 사례: 같은 대법원 양형기준 발표를 8개
    # 언론사가 전부 다른 문구의 제목으로 보도.
    a = news_service._title_tokens("위험보고 묵살 땐 가중…중대재해 사망사고 최대 징역 15년 - 서울경제")
    b = news_service._title_tokens("중대재해 사망사고 최대 징역 15년 권고…양형기준 신설 - 연합뉴스TV")
    assert news_service._is_same_story(a, b)


def check_same_story_does_not_merge_similar_format_different_content():
    # 같은 "안전보건공단 OO본부, ..." 형식이지만 서로 다른 지역/내용인
    # 실제 기사들 - 형식만 비슷하다고 합쳐지면 안 된다.
    a = news_service._title_tokens("안전보건공단 전북본부, 지역아동센터 안전점검 나서 - 전북도민일보")
    b = news_service._title_tokens("안전보건공단 울산지역본부, 추석 전후 산업재해 예방 당부 - 국토일보")
    assert not news_service._is_same_story(a, b)


def check_dedupe_existing_keeps_latest_and_spares_archived():
    db = _fresh_session()
    import datetime

    old = models.NewsItem(
        category="accident", source_name="A사", title="위험보고 묵살 땐 가중…중대재해 사망사고 최대 징역 15년 - A사",
        link="https://a", guid="g1", published_at=datetime.datetime(2024, 1, 1),
    )
    new = models.NewsItem(
        category="accident", source_name="B사", title="중대재해 사망사고 최대 징역 15년 권고…양형기준 신설 - B사",
        link="https://b", guid="g2", published_at=datetime.datetime(2024, 1, 2),
    )
    unrelated = models.NewsItem(
        category="accident", source_name="C사", title="안전보건공단 전북본부, 지역아동센터 안전점검 나서 - C사",
        link="https://c", guid="g3", published_at=datetime.datetime(2024, 1, 1), is_archived=True,
    )
    db.add_all([old, new, unrelated])
    db.commit()

    news_service._dedupe_existing(db, "accident")
    db.commit()

    remaining = {row.guid for row in db.query(models.NewsItem).all()}
    assert remaining == {"g2", "g3"}, remaining  # 최신(new)만 남고 old는 삭제, 무관한 기사는 보존


def check_sync_news_skips_reworded_cross_source_duplicates():
    db = _fresh_session()
    same_story = [
        {"title": "위험보고 묵살 땐 가중…중대재해 사망사고 최대 징역 15년 - 서울경제", "link": "https://a", "guid": "g1", "published_at": None},
        {"title": "중대재해 사망사고 처벌…사업주 최대 징역 15년 - 한국경제", "link": "https://b", "guid": "g2", "published_at": None},
        {"title": "중대재해 사망사고 최대 징역 15년 권고…양형기준 신설 - 연합뉴스TV", "link": "https://c", "guid": "g3", "published_at": None},
    ]
    original_fetch_feed = news_service.fetch_feed
    news_service.fetch_feed = lambda url: same_story
    try:
        added = news_service.sync_news(db, [("accident", "중대재해 뉴스", "http://example.com/rss")], retention_days=180)
    finally:
        news_service.fetch_feed = original_fetch_feed

    assert added == 1, added
    assert db.query(models.NewsItem).filter(models.NewsItem.category == "accident").count() == 1


if __name__ == "__main__":
    check_same_story_merges_differently_worded_headlines()
    check_same_story_does_not_merge_similar_format_different_content()
    check_dedupe_existing_keeps_latest_and_spares_archived()
    check_sync_news_skips_reworded_cross_source_duplicates()
    print("OK: news dedupe checks passed")
