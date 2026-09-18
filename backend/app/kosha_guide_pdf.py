"""KOSHA 가이드 PDF에서 본문 텍스트를 추출해 "본문 검색"이 실제 내용까지
찾아 미리보기를 보여줄 수 있게 한다.

동기화(API)나 일괄 등록은 지침번호/제목/링크 같은 메타데이터만 주고 본문은
주지 않는다 - 실제 내용은 file_link가 가리키는 PDF 안에만 있다. 이 모듈은
그 PDF를 받아(또는 로컬에 업로드해둔 파일이면 디스크에서 바로 읽어) 텍스트를
뽑아내, KoshaGuide.content에 저장할 수 있는 형태로 돌려준다.

정부기관이 배포하는 PDF 중에는 스캔 이미지만 있고 텍스트 레이어가 없는
것도 있어(그런 경우 추출 결과가 빈 문자열), 그런 파일은 조용히 건너뛴다 -
검색이 안 되는 것뿐이지 오류는 아니다."""

from __future__ import annotations

import io

import httpx
import truststore
from pypdf import PdfReader
from pypdf.errors import PdfReadError

truststore.inject_into_ssl()

_client = httpx.Client(timeout=30.0)

# 본문 검색 미리보기 용도라 문서 전체를 다 저장할 필요는 없다 - 너무 길면
# DB만 커지고 검색 속도에도 도움이 안 된다. 넉넉히 앞부분 위주로만 담는다.
_MAX_CHARS = 20000
_MAX_PAGES = 50


def extract_pdf_text(data: bytes, max_chars: int = _MAX_CHARS) -> str | None:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            # 암호가 걸린 PDF는 빈 문자열로 열려도 내용을 못 읽으므로 포기.
            return None
        parts: list[str] = []
        total = 0
        for page in reader.pages[:_MAX_PAGES]:
            text = (page.extract_text() or "").strip()
            if text:
                parts.append(text)
                total += len(text)
            if total >= max_chars:
                break
        joined = "\n\n".join(parts).strip()
        return joined[:max_chars] or None
    except (PdfReadError, ValueError, KeyError):
        # 손상되었거나 PDF가 아닌 파일 - 조용히 실패 처리(호출한 쪽에서
        # "이 항목은 건너뜀"으로 다룬다).
        return None


def download_and_extract(url: str, max_chars: int = _MAX_CHARS) -> str | None:
    try:
        resp = _client.get(url, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError:
        return None
    return extract_pdf_text(resp.content, max_chars)
