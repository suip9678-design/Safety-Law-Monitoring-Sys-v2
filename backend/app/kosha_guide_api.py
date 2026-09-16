"""Client for the 공공데이터포털(data.go.kr) "한국산업안전보건공단_안전보건법령
스마트검색(smartSearch)" Open API.

국가법령정보센터(law_api.py)와 전혀 다른, 별도의 인증키/엔드포인트를 쓰는
API다. 산업안전보건법령·고시·훈령·예규뿐 아니라 KOSHA GUIDE(안전보건기술
지침)와 안전보건 미디어자료까지 한 번에 검색하는 "스마트검색" 하나만
제공하므로, 여기서는 category=7(KOSHA GUIDE)로 검색 범위 자체를 좁혀서 쓴다.

아래는 사용자가 실제로 받은 공식 "오픈API 활용가이드" 문서(2023-10-26,
버전 1.0)로 확인한 값이다:
  - 요청 URL: `https://apis.data.go.kr/B552468/srch/smartSearch`
    (data.go.kr의 활용신청 상세페이지 "End Point" 칸에는 서비스 URL인
    `.../B552468/srch`만 나와 있어 처음에 이 뒤에 붙는 `/smartSearch`
    오퍼레이션 경로를 빠뜨렸었다 - 활용가이드 문서의 "Call Back URL"/
    "요청메시지 예제"에 전체 경로가 나온다.)
  - 요청 파라미터(모두 필수): serviceKey(인증키), pageNo, numOfRows,
    searchValue(검색어), category(0=전체, 1=산업안전보건법, 2=시행령,
    3=시행규칙, 4=기준에 관한 규칙, 5=고시·훈령·예규, 6=미디어,
    7=KOSHA GUIDE, 8=중대재해처벌법, 9=시행령, 11=유해·위험작업 취업제한
    규칙). category=7로 고정해서 보내면 서버가 KOSHA GUIDE만 걸러주므로,
    응답을 훑어 "이게 KOSHA GUIDE인지" 추측할 필요가 없다(다만 혹시
    모를 응답 변화에 대비해 category 값도 한 번 더 확인은 한다).
  - 응답(JSON 고정, 이 API는 XML을 지원하지 않는다 - 다만 인증키 오류
    등 공공데이터포털 자체 오류는 문서에 "XML로만 출력"된다고 명시되어
    있어 그 경우는 여전히 XML로 온다): `response.body.items.item[]`
    각 항목에 title(제목), content/highlight_content(본문/강조 발췌),
    doc_id(문서 ID - 지침번호 같은 공식 번호가 아니라 내부 식별자지만,
    같은 가이드를 재동기화할 때 upsert 기준으로 쓴다), filepath(원문
    kosha.or.kr 링크), keyword(관련 키워드) 등이 온다. 지침번호(정식
    번호)나 제개정일자는 이 API 응답에 없어 항상 비어 있다.

동기화 후 KoshaGuide 목록이 비어 있거나 이상하면, 설정 화면에서 "동기화"를
누를 때 실패 원인(오류 응답 본문)이 그대로 화면에 표시된다."""

from __future__ import annotations

import re
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any

# 회사 네트워크의 SSL 검사 프록시(Windows/macOS 시스템 인증서 저장소는
# 신뢰하지만 Python 기본 certifi 번들에는 없는 사내 루트 CA를 쓰는 경우)
# 때문에 CERTIFICATE_VERIFY_FAILED로 막히는 걸 피하려고 law_api.py와
# 동일하게 OS 인증서 저장소를 신뢰한다.
import truststore

truststore.inject_into_ssl()

import httpx

_client = httpx.Client(timeout=15.0)

# KOSHA GUIDE 카테고리 코드(활용가이드 문서 기준 고정값). 요청 자체를 이
# 카테고리로 좁혀 보내므로, 응답의 category 필드가 이 값이 아니면(드물게
# API가 필터를 못 지킨 경우에 대비) 안전장치로 걸러낸다.
_KOSHA_GUIDE_CATEGORY = "7"

_CODE_FIELD_CANDIDATES = ["doc_id", "지침번호", "규정번호", "고시번호", "코드", "guideNo", "docNo", "code", "no"]
_TITLE_FIELD_CANDIDATES = ["title", "제목", "규정명", "자료명", "법령명", "name", "subject"]
_FIELD_FIELD_CANDIDATES = ["분야", "field", "category2", "classNm", "분류"]
_DATE_FIELD_CANDIDATES = ["제개정일자", "개정일자", "등록일자", "게시일자", "date", "regDate", "pblDate", "regDt"]
_LINK_FIELD_CANDIDATES = ["filepath", "다운로드링크", "첨부파일경로", "원문링크", "링크", "link", "url", "fileUrl", "downloadUrl", "fileDownUrl"]
# 본문/발췌 - highlight_content는 검색어 주변에 <em class='smart'> 태그가
# 섞인 HTML이라, 태그를 벗겨낸 뒤 content가 비어 있을 때의 대체용으로만 쓴다.
_CONTENT_FIELD_CANDIDATES = ["content", "highlight_content"]


class KoshaGuideApiError(RuntimeError):
    pass


def _first_str(row: dict, candidates: list[str]) -> str | None:
    for key in candidates:
        value = row.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(text: str | None) -> str | None:
    if not text:
        return None
    return _HTML_TAG_RE.sub("", text).strip() or None


def _looks_like_kosha_guide(row: dict) -> bool:
    # 요청 자체를 category=7로 보내 서버가 이미 걸러주지만, 혹시 다른
    # 카테고리가 섞여 오는 경우에 대비한 안전장치. category 필드가 아예
    # 없는(예상 밖의) 응답이면 걸러내지 않고 통과시킨다 - 없는 필드를
    # 이유로 정상 결과까지 버리지 않기 위함.
    category = row.get("category")
    if category is None:
        return True
    return str(category).strip() == _KOSHA_GUIDE_CATEGORY


def _normalize_row(row: dict) -> dict | None:
    title = _first_str(row, _TITLE_FIELD_CANDIDATES)
    if not title:
        return None
    content = _strip_html(_first_str(row, _CONTENT_FIELD_CANDIDATES))
    return {
        "code": _first_str(row, _CODE_FIELD_CANDIDATES),
        "field": _first_str(row, _FIELD_FIELD_CANDIDATES),
        "title": title,
        "issued_date": _first_str(row, _DATE_FIELD_CANDIDATES),
        "file_link": _first_str(row, _LINK_FIELD_CANDIDATES),
        "content": content,
    }


def _find_list_of_dicts(node: Any) -> list[dict] | None:
    """흔한 공공데이터포털 JSON 뼈대는
    {"response": {"body": {"items": {"item": [...]}}}} 형태지만, 제공기관마다
    껍데기가 조금씩 달라(response 생략, item이 바로 리스트/딕셔너리 하나뿐인
    경우 등) 재귀로 "딕셔너리로만 이뤄진 리스트"를 찾아낸다."""
    if isinstance(node, list) and node and all(isinstance(x, dict) for x in node):
        return node
    if isinstance(node, dict):
        # item이 결과가 1건뿐일 때 리스트가 아니라 딕셔너리 하나로 오는
        # 경우가 흔해서, 그런 경우 1건짜리 리스트로 감싸 통일한다.
        if "item" in node and isinstance(node["item"], dict):
            return [node["item"]]
        for value in node.values():
            found = _find_list_of_dicts(value)
            if found:
                return found
    return None


def _rows_from_json(data: Any) -> list[dict]:
    return _find_list_of_dicts(data) or []


def _rows_from_xml(root: ET.Element) -> list[dict]:
    items = root.findall(".//item")
    if not items:
        # "item"이 아닌 다른 반복 태그를 쓸 수도 있어, 자식이 있으면서
        # 2번 이상 반복되는 첫 태그를 대신 후보로 삼는다.
        tag_groups: dict[str, list[ET.Element]] = {}
        for el in root.iter():
            tag_groups.setdefault(el.tag, []).append(el)
        for els in tag_groups.values():
            if len(els) >= 2 and len(list(els[0])) > 0:
                items = els
                break
    rows = []
    for item in items:
        row = {child.tag: (child.text or "").strip() for child in item}
        if row:
            rows.append(row)
    return rows


class KoshaGuideApiClient:
    def __init__(self, service_key: str, base_url: str, timeout: float = 15.0):
        # 공공데이터포털은 인증키를 "Encoding"(이미 URL 퍼센트 인코딩된
        # 형태, 예: 슬래시가 %2F로 표시됨)과 "Decoding"(원본 그대로) 두
        # 가지로 제공한다. httpx는 params에 넣은 값을 URL에 실을 때 항상
        # 다시 인코딩하므로, 사용자가 Encoding 키를 그대로 붙여넣으면
        # "%2F" 안의 "%"까지 또 인코딩돼 "%252F"처럼 이중 인코딩되어
        # 완전히 다른(무효한) 키로 서버에 전달된다 - 이게 실제로 "400
        # Bad Request"의 원인이었다. 여기서 한 번 디코딩해두면, Encoding
        # 키를 붙여넣든 Decoding 키를 붙여넣든 httpx가 그 원본을 정확히
        # 한 번만 인코딩해서 보내므로 어느 쪽을 넣어도 항상 올바르게 동작한다.
        self.service_key = urllib.parse.unquote(service_key)
        self.base_url = base_url
        self.timeout = timeout

    def search(self, keyword: str, page: int = 1, num_of_rows: int = 100) -> list[dict]:
        """keyword로 스마트검색을 category=7(KOSHA GUIDE)로 좁혀 호출해,
        결과를 정규화(code/field/title/issued_date/file_link/content)해서
        돌려준다."""
        params: dict[str, Any] = {
            "serviceKey": self.service_key,
            "pageNo": page,
            "numOfRows": num_of_rows,
            "searchValue": keyword,
            "category": _KOSHA_GUIDE_CATEGORY,
        }

        try:
            resp = _client.get(self.base_url, params=params, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise KoshaGuideApiError(
                f"KOSHA 가이드 검색 API 호출에 실패했습니다: {exc} "
                f"(요청 URL이 맞는지 설정 화면에서 확인해보세요 — 현재: {self.base_url})"
            ) from exc

        if resp.status_code >= 400:
            # raise_for_status()만 쓰면 상태 코드만 보이고 응답 본문(공공데이터
            # 포털의 표준 오류 코드 - 예: SERVICE_KEY_IS_NOT_REGISTERED_ERROR는
            # 인증키가 틀렸다는 뜻, NO_OPENAPI_SERVICE_ERROR는 요청 URL/서비스
            # ID가 틀렸다는 뜻 - 은 사라진다. 이 본문이 원인을 정확히 알려주는
            # 경우가 대부분이라 그대로 잘라서 보여준다.
            body_preview = resp.text.strip()
            if len(body_preview) > 500:
                body_preview = body_preview[:500] + "…"
            raise KoshaGuideApiError(
                f"KOSHA 가이드 검색 API가 {resp.status_code} 오류를 반환했습니다: {body_preview or '(응답 본문 없음)'} "
                f"(요청 URL이 맞는지, 인증키가 맞는지 설정 화면에서 확인해보세요 — 현재 요청 URL: {self.base_url})"
            )

        content = resp.content
        stripped = content.lstrip()
        try:
            if stripped.startswith(b"{") or stripped.startswith(b"["):
                data = resp.json()
                # 공공데이터포털 자체 오류(인증키 등)는 XML로만 온다고
                # 문서에 명시되어 있지만, 제공기관(KOSHA) 쪽 오류(예:
                # PAGE_NO_ZERO)는 정상 응답과 같은 JSON 틀 안의
                # header.resultCode로 올 수도 있어 함께 확인한다.
                header = data.get("response", {}).get("header", {}) if isinstance(data, dict) else {}
                result_code = header.get("resultCode")
                if result_code and result_code != "00":
                    raise KoshaGuideApiError(
                        f"KOSHA 가이드 검색 API가 오류를 반환했습니다: {header.get('resultMsg') or '(메시지 없음)'} (코드 {result_code})"
                    )
                rows = _rows_from_json(data)
            else:
                root = ET.fromstring(content)
                # OpenAPI_ServiceResponse 표준 오류 포맷(인증키 오류, 활용신청
                # 안 된 서비스 등)인지 먼저 확인해, 그럴 땐 원인을 그대로 보여준다.
                err_msg = (
                    root.findtext(".//returnAuthMsg")
                    or root.findtext(".//errMsg")
                    or root.findtext(".//resultMsg")
                )
                result_code = root.findtext(".//returnReasonCode") or root.findtext(".//resultCode")
                if err_msg and result_code and result_code not in ("00", "0", "NORMAL SERVICE", "NORMAL_CODE"):
                    raise KoshaGuideApiError(f"KOSHA 가이드 검색 API가 오류를 반환했습니다: {err_msg} (코드 {result_code})")
                rows = _rows_from_xml(root)
        except KoshaGuideApiError:
            raise
        except (ValueError, ET.ParseError) as exc:
            raise KoshaGuideApiError(f"KOSHA 가이드 검색 API 응답을 해석할 수 없습니다: {exc}") from exc

        results = []
        for row in rows:
            if not _looks_like_kosha_guide(row):
                continue
            normalized = _normalize_row(row)
            if normalized:
                results.append(normalized)
        return results


def build_client(service_key: str, base_url: str) -> KoshaGuideApiClient:
    return KoshaGuideApiClient(service_key, base_url)
