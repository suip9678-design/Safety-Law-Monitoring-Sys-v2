#!/usr/bin/env python3
"""뉴스 중복 제거(news_service._story_groups / sync_news) 최소 동작 확인.
pytest 없이 assert만으로 돈다.

실행: python scripts/check_news_dedupe.py
"""

import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models, news_service  # noqa: E402

NOW = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

# 실제 대시보드에서 한 사건이 언론사 수만큼 도배되던 제목들(문구가 전부 다름).
HYUNDAI = [
    "현대건설, 반포 ‘디에이치 클래스트’서 작업자 사망… 이달 두 번째 중대재해 - 조선비즈",
    "현대건설, 디에이치 클래스트 현장 노동자 사망 - edaily.co.kr",
    "서초 현대건설 디에이치 클래스트 건설 현장서 근로자 1명 사망 - 연합인포맥스",
    "서초구 아파트 건설 현장서 사망사고... 중대재해법 조사 - 시장경제신문",
    "서초구 아파트 현장 노동자 사망…중대재해법 위반 수사 - 포쓰저널",
    "서초 아파트 붕괴 사망... 현대건설, '중대재해법' 수사 : 사회 - 재경일보",
    # "현대건설"과 "서초구"를 함께 언급해 위 두 표현 계열을 이어주는 기사들
    "현대건설, 사망사고 발생 한달 만에 또...서초구 건설 현장서 천장 붕괴돼 사망자 발생 - 생생비즈플러스",
    "현대건설 서초 현장서 천장 콘크리트 무너져 1명 사망…중대재해 발생 - 브릿지경제",
]
SENTENCING = [
    "‘산업재해로 사망하면 최대 징역 15년’…중대재해처벌법 첫 양형기준 - 한겨레",
    "중대재해 사망사고 최대 징역 15년 권고…양형기준 신설 - 연합뉴스TV",
    "중대재해법 첫 양형기준안…근로자 사망 시 최대 징역 15년 권고 - 뉴스1",
]
# 형식만 비슷하고 서로 다른 사건 - 합쳐지면 안 된다.
DIFFERENT = [
    "오뚜기SF 고성공장 로봇 끼임 40대 사망…중대재해 수사 - 노컷뉴스",
    "고려아연 온산제련소서 근로자 추락 중대재해 발생 - 조선비즈",
    "신규화학물질 63종 유해성·위험성 공표…안전조치 통보 - 연합뉴스",
    "캄보디아 건설안전 감독관 16명 방한…한국 재해조사·현장점검 배운다 - 데일리안",
    "대구·경북 제조업 중대재해 5년간 121명 사망…끼임사고 최다 - 경북일보",
    "한수원, 협력사 중대재해 예방 지원 확대…원·하청 안전 상생 - newscj.com",
    "안성시 건설현장 추락사고 예방 합동 홍보 - 시사안성",
    "HL만도 평택공장 2차 압수수색…중대재해법 위반 여부 수사 - 비즈트리뉴스",
    "KOSHA 옴부즈만 제도개선 이행상황 점검 - 안전신문",
    "배달라이더 교통사고 사망도 중대재해 조사 대상 포함해야 - 4th-infra",
]


def _group_sizes(titles, hours_apart=1):
    items = [(t, NOW - datetime.timedelta(hours=hours_apart * i)) for i, t in enumerate(titles)]
    return sorted(len(g) for g in news_service._story_groups(items))


def check_reworded_headlines_collapse_but_different_events_never_mix():
    events = [("현대건설", HYUNDAI), ("양형기준", SENTENCING)] + [(f"별개{i}", [t]) for i, t in enumerate(DIFFERENT)]
    labels = [name for name, titles in events for _ in titles]
    items = [(t, NOW - datetime.timedelta(hours=i)) for i, t in enumerate(t for _, titles in events for t in titles)]
    groups = news_service._story_groups(items)
    for g in groups:
        assert len({labels[i] for i in g}) == 1, [items[i][0] for i in g]  # 서로 다른 사건은 절대 섞이지 않는다
    by_event = {}
    for g in groups:
        by_event[labels[g[0]]] = by_event.get(labels[g[0]], 0) + 1
    assert by_event["양형기준"] == 1, by_event
    assert by_event["현대건설"] <= 3, by_event  # 표현이 제각각인 6~8건이 많아야 3건으로


def check_same_headline_in_two_categories_is_one_story():
    # 같은 기사가 고용노동부/안전보건공단 검색에 동시에 잡히는 경우.
    titles = DIFFERENT + ["HD현대중공업, 고용부·안전공단과 출근길 '안전캠페인' - 뉴시스"] * 2
    assert _group_sizes(titles)[-1] == 2, _group_sizes(titles)


def check_far_apart_reports_are_not_merged():
    # 같은 제목이라도 사흘 넘게 떨어져 있으면 별개 보도(정례 기사)로 본다.
    titles = DIFFERENT + [HYUNDAI[1], HYUNDAI[1]]
    items = [(t, NOW - datetime.timedelta(days=10 * i)) for i, t in enumerate(titles)]
    assert max(len(g) for g in news_service._story_groups(items)) == 1


def _fresh_session():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _feed(titles, prefix="g"):
    return [
        {"title": t, "link": f"https://x/{prefix}{i}", "guid": f"{prefix}{i}", "published_at": None}
        for i, t in enumerate(titles)
    ]


def check_sync_keeps_one_per_story_across_categories_and_is_idempotent():
    db = _fresh_session()
    feeds = {
        "http://moel": _feed(HYUNDAI[:3] + DIFFERENT[:4], "m"),
        "http://kosha": _feed(HYUNDAI[3:] + DIFFERENT[4:], "k"),
        "http://acc": _feed(SENTENCING + HYUNDAI[:2], "a"),
    }
    sources = [("moel", "고용노동부", "http://moel"), ("kosha", "안전보건공단", "http://kosha"), ("accident", "중대재해 뉴스", "http://acc")]
    original = news_service.fetch_feed
    news_service.fetch_feed = lambda url: feeds[url]
    try:
        added = news_service.sync_news(db, sources, retention_days=180)
        total = db.query(models.NewsItem).count()
        assert added == total
        # 서로 다른 사건 10건 + 양형기준 1건은 그대로, 현대건설 8건은 많아야 3건.
        assert len(DIFFERENT) + 2 <= total <= len(DIFFERENT) + 4, total
        # 같은 피드로 다시 돌려도 더 늘거나 줄지 않는다.
        assert news_service.sync_news(db, sources, retention_days=180) == 0
        assert db.query(models.NewsItem).count() == total
    finally:
        news_service.fetch_feed = original


def check_sync_cleans_existing_duplicates_but_spares_archived():
    db = _fresh_session()
    for i, t in enumerate(HYUNDAI):
        db.add(models.NewsItem(
            category="accident", source_name="x", title=t, link=f"https://x/{i}", guid=f"old{i}",
            published_at=NOW - datetime.timedelta(hours=i), is_archived=(i == 5),
        ))
    db.commit()
    original = news_service.fetch_feed
    news_service.fetch_feed = lambda url: _feed(DIFFERENT, "n")
    try:
        news_service.sync_news(db, [("accident", "중대재해 뉴스", "http://acc")], retention_days=180)
    finally:
        news_service.fetch_feed = original
    left = {r.guid for r in db.query(models.NewsItem).filter(models.NewsItem.guid.like("old%"))}
    assert "old5" in left, left  # 보관 처리한 것은 반드시 남는다
    assert len(left) <= 3, left  # 8건이던 중복이 크게 정리됨


if __name__ == "__main__":
    check_reworded_headlines_collapse_but_different_events_never_mix()
    check_same_headline_in_two_categories_is_one_story()
    check_far_apart_reports_are_not_merged()
    check_sync_keeps_one_per_story_across_categories_and_is_idempotent()
    check_sync_cleans_existing_duplicates_but_spares_archived()
    print("OK: news dedupe checks passed")
