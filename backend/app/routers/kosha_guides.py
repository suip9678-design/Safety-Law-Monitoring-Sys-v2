"""KOSHA GUIDE(안전보건공단 기술지침) 라이브러리 - 등록/검색.

법령 키워드 검색(content_cache_service)과 달리 이 데이터셋은 자동으로
받아올 공개 API가 없어(models.KoshaGuide의 설명 참고), 사용자가 직접
입력하거나 붙여넣기(일괄 등록)한 것만 검색 대상이 된다."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/kosha-guides", tags=["kosha-guides"])


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
    return None


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
        code = _clean(item.code)
        existing = (
            db.query(models.KoshaGuide).filter(models.KoshaGuide.code == code).first() if code else None
        )
        if existing:
            existing.field = _clean(item.field)
            existing.title = title
            existing.issued_date = _clean(item.issued_date)
            existing.file_link = _clean(item.file_link)
            if item.content:
                existing.content = item.content
            updated += 1
        else:
            db.add(
                models.KoshaGuide(
                    code=code,
                    field=_clean(item.field),
                    title=title,
                    issued_date=_clean(item.issued_date),
                    file_link=_clean(item.file_link),
                    content=item.content or None,
                )
            )
            added += 1
    db.commit()
    return schemas.KoshaGuideBulkImportResult(added=added, updated=updated, skipped=skipped)
