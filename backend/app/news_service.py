"""고용노동부/안전보건공단 안전보건 이슈, 중대재해 뉴스를 RSS/Atom 피드로
가져와 대시보드 자동 스크롤 게시판에 채워 넣는 서비스.

law_api.py가 국가법령정보센터 API를 다루는 것과 같은 사정으로, 이 세션은
고용노동부(moel.go.kr)/안전보건공단(kosha.or.kr) 공식 사이트에도 접근할 수
없어 두 기관의 공식 RSS 주소를 실제로 검증하지는 못했다. 기본 설정값은
어떤 네트워크 환경에서도 별도 승인 없이 동작하는 구글 뉴스 RSS 검색
(news.google.com/rss/search)으로 채워두었으니, 두 기관의 공식 RSS 주소를
확인하면 설정 탭에서 그 주소로 바꿔 끼우면 된다 - 표준 RSS 2.0(<item>)과
Atom(<entry>) 두 형식을 모두 지원하므로 형식만 맞으면 어떤 피드 URL이든
동작한다.
"""

from __future__ import annotations

import datetime
import email.utils
import logging
import math
import re
import threading
import xml.etree.ElementTree as ET
from collections import Counter

import httpx
from sqlalchemy import func

from . import fixtures, models

logger = logging.getLogger("safety_law_tracker.news")

# 일부 뉴스 사이트는 브라우저가 아닌 요청(기본 User-Agent 없음)을 차단하므로
# 일반적인 브라우저처럼 보이는 User-Agent를 붙인다.
_client = httpx.Client(
    timeout=10.0,
    headers={"User-Agent": "Mozilla/5.0 (compatible; SafetyAlert/1.0; NewsBoard)"},
)

_ATOM_NS = "{http://www.w3.org/2005/Atom}"

CATEGORY_LABELS: dict[str, str] = {
    "moel": "고용노동부",
    "kosha": "안전보건공단",
    "accident": "중대재해 뉴스",
}


def _parse_pubdate(value: str | None) -> datetime.datetime | None:
    if not value:
        return None
    try:
        dt = email.utils.parsedate_to_datetime(value)  # RSS 2.0 (RFC 822류)
        if dt is not None:
            return dt
    except (TypeError, ValueError):
        pass
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))  # Atom (ISO 8601)
    except ValueError:
        return None


def fetch_feed(url: str) -> list[dict]:
    """표준 RSS 2.0(<item>) 또는 Atom(<entry>) 피드를 읽어 [{title, link,
    guid, published_at}, ...]를 돌려준다. 실패해도 예외를 던지지 않고 빈
    목록을 돌려준다 - 뉴스 피드 하나가 막혀도 법령 동기화 같은 핵심 기능에
    영향을 주면 안 된다."""
    if not url:
        return []
    try:
        resp = _client.get(url)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
    except (httpx.HTTPError, ET.ParseError) as exc:
        logger.warning("뉴스 피드를 가져오지 못했습니다 (%s): %s", url, exc)
        return []

    items: list[dict] = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        guid = (item.findtext("guid") or link).strip()
        items.append({"title": title, "link": link, "guid": guid, "published_at": _parse_pubdate(item.findtext("pubDate"))})

    if not items:
        for entry in root.iter(f"{_ATOM_NS}entry"):
            title = (entry.findtext(f"{_ATOM_NS}title") or "").strip()
            link_el = entry.find(f"{_ATOM_NS}link")
            link = (link_el.get("href") if link_el is not None else "") or ""
            if not title or not link:
                continue
            guid = (entry.findtext(f"{_ATOM_NS}id") or link).strip()
            published = _parse_pubdate(entry.findtext(f"{_ATOM_NS}updated") or entry.findtext(f"{_ATOM_NS}published"))
            items.append({"title": title, "link": link, "guid": guid, "published_at": published})

    return items


# 같은 사건을 여러 언론사가 각자 다른 문구의 제목으로 보도하면(구글 뉴스 RSS
# 특성) 글자 그대로는 안 맞아 한 페이지가 한두 사건으로 가득 찬다. 제목을 글자
# 2개 단위(bigram)로 쪼개고, 전체 기사 중 드물게 나오는 조각(사건 고유 명사
# 등)일수록 크게 쳐서(IDF) 코사인 유사도로 비교한다. 같은 사건은 며칠 안에
# 몰려 보도되므로 발행 시각이 _DUP_WINDOW 안인 것끼리만 비교해, 문구가 비슷한
# 정례 기사(지사별 추석 나눔 등)가 합쳐지는 걸 줄인다.
# ponytail: 형태소 분석 없는 휴리스틱이라 드물게 다른 사건을 합치거나 같은
# 사건을 놓칠 수 있다. 자주 눈에 띄면 _DUP_THRESHOLD를 조절하거나 형태소
# 분석기 도입을 검토할 것(실제 기사 600여 건으로 0.35를 골랐다).
_DUP_THRESHOLD = 0.35
_DUP_WINDOW = datetime.timedelta(days=3)
# 평소 동기화는 이 기간 안의 기사끼리만 다시 비교한다 - 그보다 오래된 건 이미
# 이전 동기화에서 정리됐고, 매번 전부 비교하면 기사가 쌓일수록 느려진다.
# 다만 서버를 켠 뒤 첫 동기화는 전부 비교한다(예전 버전이 남긴 오래된 중복
# 정리용).
_DUP_HORIZON = datetime.timedelta(days=14)
_full_dedupe_done = False


def _bigrams(title: str) -> set[str]:
    core = title.rsplit(" - ", 1)[0].lower()  # 끝의 " - 언론사명" 제거
    return {tok[i : i + 2] for tok in re.split(r"[^0-9a-z가-힣]+", core) if len(tok) > 1 for i in range(len(tok) - 1)}


def _naive_utc(dt: datetime.datetime | None) -> datetime.datetime:
    if dt is None:
        return datetime.datetime.utcnow()
    return dt.astimezone(datetime.timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _story_groups(items: list[tuple[str, datetime.datetime]]) -> list[list[int]]:
    """(제목, 발행시각) 목록을 같은 사건끼리 묶어 인덱스 묶음으로 돌려준다.
    A와 B, B와 C가 각각 같은 사건이면 A·B·C 모두 한 묶음이다(같은 사건이
    "디에이치 클래스트"/"서초구 아파트"처럼 다른 표현으로 갈라져 보도되는 걸
    잇기 위함)."""
    n = len(items)
    feats = [_bigrams(title) for title, _ in items]
    df = Counter(b for f in feats for b in f)
    vecs = []
    for f in feats:
        weights = {b: math.log((n + 1) / (df[b] + 1)) for b in f}
        vecs.append((weights, sum(w * w for w in weights.values())))

    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    order = sorted(range(n), key=lambda i: items[i][1])
    for a in range(n):
        i = order[a]
        wi, ni = vecs[i]
        for b in range(a + 1, n):
            j = order[b]
            if items[j][1] - items[i][1] > _DUP_WINDOW:
                break
            wj, nj = vecs[j]
            if ni and nj and sum(wi[k] ** 2 for k in wi.keys() & wj.keys()) / math.sqrt(ni * nj) >= _DUP_THRESHOLD:
                parent[find(j)] = find(i)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def configured_sources(db) -> list[tuple[str, str, str]]:
    """(category, source_name, feed_url) 목록을 설정값에서 구성한다."""
    from . import settings_store

    values = settings_store.get_all(db)
    return [
        ("moel", CATEGORY_LABELS["moel"], values.get("news_source_moel_url", "")),
        ("kosha", CATEGORY_LABELS["kosha"], values.get("news_source_kosha_url", "")),
        ("accident", CATEGORY_LABELS["accident"], values.get("news_source_accident_url", "")),
    ]


# 보관(is_archived) 처리를 해두지 않아도, RSS 주소를 잘못 설정해 한 카테고리에
# 비정상적으로 많은 항목이 몰리는 경우까지 대비한 안전장치. 사용자가 직접
# 조절하는 값이 아니라(보관 기간 설정과는 별개), 디스크가 무한정 커지는 걸
# 막기 위한 최후의 상한선이라 넉넉하게 잡아둔다.
_HARD_CAP_PER_CATEGORY = 5000

# sync_news()는 "이미 있는지 확인 후 없으면 삽입"하는 방식이라, 서버 시작
# 20초 뒤에 자동으로 도는 예약 작업(main.py의 _scheduled_news_sync)과
# 사용자가 대시보드에 들어올 때 트리거되는 백그라운드 재동기화, "지금
# 새로고침" 버튼이 거의 동시에 겹치면 둘 다 "아직 없다"고 확인한 뒤 같은
# guid로 동시에 삽입을 시도해 두 번째 커밋이 UNIQUE 제약 위반(500 에러)으로
# 실패할 수 있었다. 이 앱은 단일 프로세스로 도는 걸 전제하므로(README/여러
# 스크립트 주석 참고), 프로세스 안에서 겹쳐 부르는 것만 막아주면 충분해
# 락으로 직렬화한다 - 그러면 뒤에 들어온 호출은 앞선 호출이 이미 커밋한
# 결과를 보고 "이미 있음"으로 정상적으로 건너뛴다.
_sync_lock = threading.Lock()


def sync_news(db, sources: list[tuple[str, str, str]], retention_days: int) -> int:
    """각 소스를 가져와 새 항목만 저장한다. 돌려주는 값은 신규 저장 건수.

    실제 피드가 비어 있으면(네트워크 차단, 주소 미설정 등) 화면이 텅 비어
    보이지 않도록 fixtures.demo_news()로 채운다. 반대로 실제 데이터가 들어
    오기 시작하면 그 카테고리의 예시 항목은 정리한다."""
    with _sync_lock:
        return _sync_news_locked(db, sources, retention_days)


def _sync_news_locked(db, sources: list[tuple[str, str, str]], retention_days: int) -> int:
    feeds = []
    for category, source_name, url in sources:
        fetched = fetch_feed(url)
        is_demo = not fetched
        if is_demo:
            fetched = fixtures.demo_news(category)
        else:
            db.query(models.NewsItem).filter(
                models.NewsItem.category == category, models.NewsItem.is_demo.is_(True)
            ).delete(synchronize_session=False)
        feeds.append((category, source_name, fetched, is_demo))

    # 이미 저장된 최근 기사와 이번에 받은 새 기사를 한꺼번에 같은 사건끼리
    # 묶는다(카테고리 상관없이 - 같은 기사가 고용노동부/안전보건공단 검색에
    # 동시에 잡히기도 한다). 묶음마다 한 건만 남기는데, 이미 저장된 게 있으면
    # 그중 제일 먼저 나온 것(보관 처리한 건은 전부)을 남기고 새 기사는 버린다.
    # 이미 쌓여 있던 중복은 이 과정에서 같이 정리된다.
    global _full_dedupe_done
    existing_keys = {(c, g) for c, g in db.query(models.NewsItem.category, models.NewsItem.guid)}
    existing_q = db.query(models.NewsItem)
    if _full_dedupe_done:
        horizon = datetime.datetime.utcnow() - _DUP_HORIZON
        existing_q = existing_q.filter(func.coalesce(models.NewsItem.published_at, models.NewsItem.fetched_at) >= horizon)
    existing_rows = existing_q.all()
    _full_dedupe_done = True
    new_entries = []  # (category, source_name, entry, is_demo)
    for category, source_name, fetched, is_demo in feeds:
        for entry in fetched:
            key = (category, entry["guid"][:512])
            if key in existing_keys:
                continue
            existing_keys.add(key)
            new_entries.append((category, source_name, entry, is_demo))

    items = [(r.title, r.published_at or r.fetched_at) for r in existing_rows]
    items += [(e["title"], _naive_utc(e.get("published_at"))) for _c, _s, e, _d in new_entries]
    n_existing = len(existing_rows)

    added = 0
    delete_ids: list[int] = []
    for group in _story_groups(items):
        stored = [i for i in group if i < n_existing]
        if stored:
            keep = {i for i in stored if existing_rows[i].is_archived} or {min(stored, key=lambda i: items[i][1])}
            delete_ids += [existing_rows[i].id for i in stored if i not in keep]
            continue
        category, source_name, entry, is_demo = new_entries[min(group, key=lambda i: items[i][1]) - n_existing]
        db.add(
            models.NewsItem(
                category=category,
                source_name=source_name,
                title=entry["title"][:512],
                link=entry["link"][:1024],
                guid=entry["guid"][:512],
                published_at=entry.get("published_at"),
                is_demo=is_demo,
            )
        )
        added += 1
    if delete_ids:
        db.query(models.NewsItem).filter(models.NewsItem.id.in_(delete_ids)).delete(synchronize_session=False)
    db.commit()

    # 발행일(published_at, 없으면 fetched_at) 기준으로 보관 기간이 지난
    # 항목은 삭제한다 - 단, "보관" 처리(is_archived)해둔 항목은 기간이
    # 지나도 남겨둔다.
    order_col = func.coalesce(models.NewsItem.published_at, models.NewsItem.fetched_at)
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=max(retention_days, 1))
    for category, _source_name, _url in sources:
        stale_ids = [
            row.id
            for row in db.query(models.NewsItem.id)
            .filter(
                models.NewsItem.category == category,
                models.NewsItem.is_archived.is_(False),
                order_col < cutoff,
            )
            .all()
        ]
        if stale_ids:
            db.query(models.NewsItem).filter(models.NewsItem.id.in_(stale_ids)).delete(synchronize_session=False)

        # 안전장치: 보관 기간 안에 있어도 비정상적으로 많이 쌓였다면 오래된 것부터 정리.
        overflow_ids = [
            row.id
            for row in db.query(models.NewsItem.id)
            .filter(models.NewsItem.category == category, models.NewsItem.is_archived.is_(False))
            .order_by(order_col.desc())
            .offset(_HARD_CAP_PER_CATEGORY)
            .all()
        ]
        if overflow_ids:
            db.query(models.NewsItem).filter(models.NewsItem.id.in_(overflow_ids)).delete(synchronize_session=False)
    db.commit()
    return added
