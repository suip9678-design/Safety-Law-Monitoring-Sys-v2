"""KOSHA GUIDE(안전보건공단 기술지침) 라이브러리 - 등록/검색.

법령 키워드 검색(content_cache_service)과 달리 이 데이터셋은 자동으로
받아올 공개 API가 없어(models.KoshaGuide의 설명 참고), 사용자가 직접
입력하거나 붙여넣기(일괄 등록)한 것만 검색 대상이 된다."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models, schemas, settings_store
from ..config import settings
from ..database import get_db
from ..kosha_guide_api import KoshaGuideApiError, build_client

router = APIRouter(prefix="/api/kosha-guides", tags=["kosha-guides"])

_FILE_SERVE_URL_PREFIX = "/api/kosha-guides/"
_FILE_SERVE_URL_SUFFIX = "/file"


def _uploaded_file_path(guide_id: int) -> Path:
    return settings.KOSHA_GUIDE_FILES_DIR / f"{guide_id}.pdf"


def _served_file_url(guide_id: int) -> str:
    return f"{_FILE_SERVE_URL_PREFIX}{guide_id}{_FILE_SERVE_URL_SUFFIX}"


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _check_code_conflict(db: Session, code: str | None, exclude_id: int | None = None) -> None:
    if not code:
        return
    q = db.query(models.KoshaGuide).filter(models.KoshaGuide.code == code)
    if exclude_id is not None:
        q = q.filter(models.KoshaGuide.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=409, detail=f"이미 등록된 지침번호입니다: {code}")


@router.get("", response_model=list[schemas.KoshaGuideOut])
def list_guides(field: str | None = None, db: Session = Depends(get_db)):
    q = db.query(models.KoshaGuide)
    if field:
        q = q.filter(models.KoshaGuide.field == field)
    return q.order_by(models.KoshaGuide.title).all()


def _snippet(content: str, idx: int, needle_len: int, radius: int = 40) -> str:
    start = max(0, idx - radius)
    end = min(len(content), idx + needle_len + radius)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(content) else ""
    return f"{prefix}{content[start:end].strip()}{suffix}"


@router.get("/search", response_model=list[schemas.KoshaGuideSearchResult])
def search_guides(query: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    needle = query.strip()
    results: list[schemas.KoshaGuideSearchResult] = []
    for row in db.query(models.KoshaGuide).all():
        content = row.content or ""
        title = row.title or ""
        code = row.code or ""
        idx = content.find(needle)
        if idx != -1:
            matched_in = "content"
            snippet = _snippet(content, idx, len(needle))
        elif needle in title:
            matched_in = "title"
            snippet = ""
        elif needle in code:
            matched_in = "code"
            snippet = ""
        else:
            continue
        results.append(
            schemas.KoshaGuideSearchResult(
                id=row.id,
                code=row.code,
                field=row.field,
                title=row.title,
                issued_date=row.issued_date,
                file_link=row.file_link,
                matched_in=matched_in,
                snippet=snippet,
            )
        )
    return results


@router.post("", response_model=schemas.KoshaGuideOut, status_code=201)
def create_guide(payload: schemas.KoshaGuideCreate, db: Session = Depends(get_db)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="제목은 비워둘 수 없습니다.")
    code = _clean(payload.code)
    _check_code_conflict(db, code)
    guide = models.KoshaGuide(
        code=code,
        field=_clean(payload.field),
        title=title,
        issued_date=_clean(payload.issued_date),
        file_link=_clean(payload.file_link),
        content=payload.content or None,
        note=payload.note or None,
    )
    db.add(guide)
    db.commit()
    db.refresh(guide)
    return guide


@router.put("/{guide_id}", response_model=schemas.KoshaGuideOut)
def update_guide(guide_id: int, payload: schemas.KoshaGuideCreate, db: Session = Depends(get_db)):
    guide = db.get(models.KoshaGuide, guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="가이드를 찾을 수 없습니다.")
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="제목은 비워둘 수 없습니다.")
    code = _clean(payload.code)
    _check_code_conflict(db, code, exclude_id=guide_id)
    guide.code = code
    guide.field = _clean(payload.field)
    guide.title = title
    guide.issued_date = _clean(payload.issued_date)
    guide.file_link = _clean(payload.file_link)
    guide.content = payload.content or None
    guide.note = payload.note or None
    db.commit()
    db.refresh(guide)
    return guide


@router.delete("/{guide_id}", status_code=204)
def delete_guide(guide_id: int, db: Session = Depends(get_db)):
    guide = db.get(models.KoshaGuide, guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="가이드를 찾을 수 없습니다.")
    db.delete(guide)
    db.commit()
    _uploaded_file_path(guide_id).unlink(missing_ok=True)
    return None


@router.post("/{guide_id}/file", response_model=schemas.KoshaGuideOut)
def upload_guide_file(guide_id: int, file: UploadFile, db: Session = Depends(get_db)):
    """API 동기화가 원문 링크를 못 채워온 가이드에, 사용자가 PDF를 직접
    올려 첨부한다. 파일은 이 서버(사내 PC/서버)의 로컬 폴더에만 저장되고
    외부로 전송되지 않으며, 이후 이 가이드의 "원문 링크"는 그 파일을
    서빙하는 이 서버 자신의 주소(/api/kosha-guides/{id}/file)가 된다."""
    guide = db.get(models.KoshaGuide, guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="가이드를 찾을 수 없습니다.")
    filename = (file.filename or "").lower()
    if file.content_type not in ("application/pdf", "application/x-pdf") and not filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 첨부할 수 있습니다.")
    dest = _uploaded_file_path(guide_id)
    with dest.open("wb") as out:
        while chunk := file.file.read(1024 * 1024):
            out.write(chunk)
    guide.file_link = _served_file_url(guide_id)
    db.commit()
    db.refresh(guide)
    return guide


@router.get("/{guide_id}/file")
def download_guide_file(guide_id: int, db: Session = Depends(get_db)):
    guide = db.get(models.KoshaGuide, guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="가이드를 찾을 수 없습니다.")
    path = _uploaded_file_path(guide_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="첨부된 파일이 없습니다.")
    return FileResponse(path, media_type="application/pdf", filename=f"{guide.title}.pdf")


@router.delete("/{guide_id}/file", response_model=schemas.KoshaGuideOut)
def delete_guide_file(guide_id: int, db: Session = Depends(get_db)):
    guide = db.get(models.KoshaGuide, guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="가이드를 찾을 수 없습니다.")
    _uploaded_file_path(guide_id).unlink(missing_ok=True)
    if guide.file_link == _served_file_url(guide_id):
        guide.file_link = None
        db.commit()
        db.refresh(guide)
    return guide


@router.post("/bulk-delete", status_code=204)
def bulk_delete_guides(payload: schemas.KoshaGuideBulkDelete, db: Session = Depends(get_db)):
    if not payload.ids:
        raise HTTPException(status_code=400, detail="선택된 항목이 없습니다.")
    db.query(models.KoshaGuide).filter(models.KoshaGuide.id.in_(payload.ids)).delete(synchronize_session=False)
    db.commit()
    for guide_id in payload.ids:
        _uploaded_file_path(guide_id).unlink(missing_ok=True)
    return None


def _upsert(db: Session, code: str | None, field: str | None, title: str, issued_date: str | None,
            file_link: str | None, content: str | None = None) -> str:
    """지침번호(code)가 있고 이미 등록된 것과 같으면 덮어쓰고("updated"),
    아니면 새로 추가한다("added"). bulk-import와 sync가 함께 쓴다.

    code가 없으면 제목(title)으로 대신 매칭한다 - 공공데이터포털 스마트검색
    API는 지침번호를 거의 항상 비워서 응답하는데(kosha_guide_api.py 상단
    설명 참고), code로만 매칭하면 "이미 등록된 것과 같은지"를 절대 알 수
    없어 동기화를 누를 때마다 같은 가이드가 계속 새로 쌓이는 문제가 있었다.
    사용자가 수동으로 첨부해둔 file_link(PDF 첨부)는 API 재동기화로 다시
    비워지지 않도록, 새 값이 없을 때는 기존 값을 그대로 유지한다."""
    q = db.query(models.KoshaGuide).filter(models.KoshaGuide.code == code) if code \
        else db.query(models.KoshaGuide).filter(models.KoshaGuide.code.is_(None), models.KoshaGuide.title == title)
    existing = q.first()
    if existing:
        existing.field = field
        existing.title = title
        existing.issued_date = issued_date
        if file_link:
            existing.file_link = file_link
        if content:
            existing.content = content
        return "updated"
    db.add(
        models.KoshaGuide(
            code=code, field=field, title=title, issued_date=issued_date, file_link=file_link,
            content=content,
        )
    )
    return "added"


@router.post("/bulk-import", response_model=schemas.KoshaGuideBulkImportResult)
def bulk_import(payload: schemas.KoshaGuideBulkImportItems, db: Session = Depends(get_db)):
    """붙여넣기로 여러 건을 한 번에 등록한다. 지침번호(code)가 있고 이미
    등록된 것과 같으면 그 항목을 덮어쓰고(같은 목록을 다시 붙여넣어도
    중복 생성되지 않게), 지침번호가 없거나 새 값이면 새로 추가한다."""
    added = updated = skipped = 0
    for item in payload.items:
        title = (item.title or "").strip()
        if not title:
            skipped += 1
            continue
        outcome = _upsert(
            db, _clean(item.code), _clean(item.field), title, _clean(item.issued_date),
            _clean(item.file_link), item.content or None,
        )
        if outcome == "updated":
            updated += 1
        else:
            added += 1
    db.commit()
    return schemas.KoshaGuideBulkImportResult(added=added, updated=updated, skipped=skipped)


@router.post("/sync", response_model=schemas.KoshaGuideSyncResult)
def sync_from_api(db: Session = Depends(get_db)):
    """설정에 저장해둔 공공데이터포털 인증키로, 설정에 등록한 키워드들을
    차례로 스마트검색해서 KOSHA GUIDE로 분류되는 결과만 등록/갱신한다.

    이 API의 정확한 엔드포인트/응답 구조를 이 개발 환경에서 검증하지
    못했으므로(kosha_guide_api.py 상단 설명 참고), 실패하면 원인을 그대로
    반환한다 - 화면에서 "요청 URL이 맞는지 확인"하라는 안내와 함께 보인다."""
    values = settings_store.get_all(db)
    service_key = values.get("kosha_guide_api_key", "").strip()
    if not service_key:
        raise HTTPException(status_code=400, detail="설정에서 KOSHA 가이드 Open API 인증키를 먼저 저장하세요.")
    base_url = values.get("kosha_guide_api_url", "").strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="설정에서 KOSHA 가이드 Open API 요청 URL을 먼저 저장하세요.")
    keywords = [k.strip() for k in values.get("kosha_guide_sync_keywords", "").split(",") if k.strip()]
    if not keywords:
        raise HTTPException(status_code=400, detail="설정에서 검색 키워드를 하나 이상 등록하세요.")

    client = build_client(service_key, base_url)
    found = added = updated = 0
    errors: list[str] = []
    seen_in_this_run: set[tuple[str | None, str]] = set()

    for keyword in keywords:
        try:
            results = client.search(keyword)
        except KoshaGuideApiError as exc:
            errors.append(f"'{keyword}': {exc}")
            continue
        for item in results:
            title = (item.get("title") or "").strip()
            if not title:
                continue
            code = _clean(item.get("code"))
            # 같은 실행 안에서 여러 키워드가 같은 가이드를 함께 찾아내는
            # 경우가 흔한데(예: "안전보건"과 "위험성평가" 둘 다 걸리는
            # 지침), (코드, 제목) 기준으로 한 번만 세도록 한다 - 지침번호가
            # 없는 항목은 제목만으로 가려낸다.
            dedup_key = (code, title)
            if dedup_key in seen_in_this_run:
                continue
            seen_in_this_run.add(dedup_key)
            found += 1
            outcome = _upsert(
                db, code, _clean(item.get("field")), title,
                _clean(item.get("issued_date")), _clean(item.get("file_link")),
                item.get("content") or None,
            )
            if outcome == "updated":
                updated += 1
            else:
                added += 1
    db.commit()
    return schemas.KoshaGuideSyncResult(
        keywords_checked=keywords, found=found, added=added, updated=updated, errors=errors,
    )
