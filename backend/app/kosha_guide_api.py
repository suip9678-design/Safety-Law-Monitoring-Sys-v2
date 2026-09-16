"""Client for the 공공데이터포털(data.go.kr) "한국산업안전보건공단_안전보건법령
스마트검색(smartSearch)" Open API.

국가법령정보센터(law_api.py)와 전혀 다른, 별도의 인증키/엔드포인트를 쓰는
API다. 산업안전보건법령·고시·훈령·예규뿐 아니라 KOSHA GUIDE(안전보건기술
지침)와 안전보건 미디어자료까지 한 번에 검색하는 "스마트검색" 하나만
제공하므로, 여기서는 그 결과 중 KOSHA GUIDE로 분류되는 항목만 골라낸다.

IMPORTANT - 이 세션은 data.go.kr에 직접 접근할 수 없어(조직 프록시 정책으로
차단됨) 아래 내용을 실제 응답으로 검증하지 못했다:
  - 요청 URL(BASE_URL): 같은 제공기관(한국산업안전보건공단, 공공데이터포털
    기관코드 B552468)의 다른 서비스가 쓰는 것으로 확인된 패턴
    (`https://apis.data.go.kr/B552468/{서비스ID}/{오퍼레이션}`)과, 사용자가
    실제로 승인받은 "상세기능" 이름이 "스마트검색(smartSearch) /smartSearch"
    인 것에 근거한 추정치다. 틀렸다면 설정 화면의 "요청 URL"을 사용자의
    data.go.kr 마이페이지 > 활용신청 상세보기 페이지에 나온 실제 "Service
    URL"/"참고문서"의 값으로 바꿔주면 코드 수정 없이 바로 고쳐진다.
  - 요청 파라미터: serviceKey/pageNo/numOfRows는 공공데이터포털 전체가
    공통으로 쓰는 이름이라 확실하다. 검색어 파라미터 이름만은 확인할
    방법이 없어 후보 이름 여러 개를 한 요청에 함께 보낸다(정부 REST API는
    보통 모르는 파라미터를 조용히 무시하므로 안전한 방어책이다 - 그래도
    실제 요청메시지명세를 확인하면 _SEARCH_KEYWORD_PARAMS를 하나로 정리할 것).
  - 응답 형식/필드명: JSON과 XML 둘 다 시도해서 해석하고, 각 필드도 흔히
    쓰이는 여러 이름 후보 중 첫 번째로 값이 있는 것을 쓴다(law_api.py의
    _FIELD_CANDIDATES와 같은 전략). "이 결과가 KOSHA GUIDE인지"는 구분류
    필드 후보에서 "KOSHA"/"가이드"/"GUIDE"/"기술지침" 문구를 찾아 판단하고,
    그런 필드를 못 찾으면 행 전체 값을 훑어 같은 문구가 있는지로 대신
    판단한다.

동기화 후 KoshaGuide 목록이 비어 있거나 이상하면, 실제 응답 구조를 확인해
위 후보 목록들을 조정할 것 (설정 화면에서 "동기화"를 누르면 실패 시 원본
오류 메시지가 그대로 화면에 표시된다)."""

from __future__ import annotations

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

# "이 행이 KOSHA GUIDE인지"를 판단할 구분류 필드 후보와, 거기 담길 만한 값 마커.
_CATEGORY_FIELD_CANDIDATES = ["자료구분", "구분", "데이터구분", "dataGubun", "category", "srchType", "gubun", "type"]
_CATEGORY_VALUE_MARKERS = ["kosha", "코샤", "가이드", "guide", "기술지침"]

_CODE_FIELD_CANDIDATES = ["지침번호", "규정번호", "고시번호", "코드", "guideNo", "docNo", "code", "no"]
_TITLE_FIELD_CANDIDATES = ["제목", "규정명", "자료명", "법령명", "title", "name", "subject"]
_FIELD_FIELD_CANDIDATES = ["분야", "field", "category2", "classNm", "분류"]
_DATE_FIELD_CANDIDATES = ["제개정일자", "개정일자", "등록일자", "게시일자", "date", "regDate", "pblDate", "regDt"]
_LINK_FIELD_CANDIDATES = ["다운로드링크", "첨부파일경로", "원문링크", "링크", "link", "url", "fileUrl", "downloadUrl", "fileDownUrl"]

# 검색어 파라미터 이름 후보 - 실제 이름을 확인하면 하나로 정리할 것.
_SEARCH_KEYWORD_PARAMS = ["keyword", "searchKeyword", "srchWrd", "searchWrd", "query"]


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


def _looks_like_kosha_guide(row: dict) -> bool:
    category = _first_str(row, _CATEGORY_FIELD_CANDIDATES)
    haystack = category
    if not haystack:
        # 구분류 필드를 못 찾으면 행 전체 값을 훑어 마커가 있는지로 대신 판단한다.
        haystack = " ".join(str(v) for v in row.values() if isinstance(v, (str, int, float)))
    haystack = (haystack or "").lower()
    return any(marker in haystack for marker in _CATEGORY_VALUE_MARKERS)


def _normalize_row(row: dict) -> dict | None:
    title = _first_str(row, _TITLE_FIELD_CANDIDATES)
    if not title:
        return None
    return {
        "code": _first_str(row, _CODE_FIELD_CANDIDATES),
        "field": _first_str(row, _FIELD_FIELD_CANDIDATES),
        "title": title,
        "issued_date": _first_str(row, _DATE_FIELD_CANDIDATES),
        "file_link": _first_str(row, _LINK_FIELD_CANDIDATES),
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
        """keyword로 스마트검색을 호출해, 결과 중 KOSHA GUIDE로 분류되는
        것만 정규화(code/field/title/issued_date/file_link)해서 돌려준다."""
        params: dict[str, Any] = {
            "serviceKey": self.service_key,
            "pageNo": page,
            "numOfRows": num_of_rows,
            "type": "json",
        }
        for name in _SEARCH_KEYWORD_PARAMS:
            params[name] = keyword

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
                rows = _rows_from_json(resp.json())
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
