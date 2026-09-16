import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict


def _as_utc(v: datetime.datetime | None) -> datetime.datetime | None:
    # DB에는 항상 naive UTC로 저장되므로(datetime.utcnow()), 여기서 tzinfo를
    # 명시적으로 붙여줘야 JSON에 UTC 오프셋이 포함된다. 그래야 브라우저가
    # 이 값을 "이미 로컬 시간"으로 잘못 해석해 시:분/날짜가 어긋나는 문제
    # (예: KST에서 9시간 차이나게 표시됨)가 생기지 않는다.
    if v is not None and v.tzinfo is None:
        return v.replace(tzinfo=datetime.timezone.utc)
    return v


UtcDateTime = Annotated[datetime.datetime, AfterValidator(_as_utc)]
UtcDateTimeOpt = Annotated[datetime.datetime | None, AfterValidator(_as_utc)]


class LawSearchResult(BaseModel):
    source_type: str
    external_id: str
    master_id: str | None = None
    name: str
    category: str | None = None
    department: str | None = None
    promulgation_no: str | None = None
    promulgation_date: str | None = None
    enforcement_date: str | None = None
    detail_link: str | None = None


class KeywordSearchResult(BaseModel):
    source_type: str
    external_id: str
    master_id: str | None = None
    name: str
    category: str | None = None
    department: str | None = None
    promulgation_no: str | None = None
    promulgation_date: str | None = None
    enforcement_date: str | None = None
    detail_link: str | None = None
    # 검색어가 법령명(name)과 본문(content) 중 어디에서 매칭됐는지.
    matched_in: str = "name"
    # matched_in이 "content"일 때, 검색어 주변 발췌문(앞뒤 40자 정도).
    snippet: str = ""
    # snippet이 속한 조문으로 바로 이동하는 법제처 링크. 조번호를 못 찾으면 None.
    article_link: str | None = None


class TrackedLawCreate(BaseModel):
    source_type: str
    external_id: str
    master_id: str | None = None
    name: str
    category: str | None = None
    department: str | None = None
    promulgation_no: str | None = None
    promulgation_date: str | None = None
    enforcement_date: str | None = None
    detail_link: str | None = None


class TrackedLawOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_type: str
    external_id: str
    master_id: str | None = None
    name: str
    category: str | None
    department: str | None
    current_promulgation_no: str | None
    current_promulgation_date: str | None
    current_enforcement_date: str | None
    detail_link: str | None
    is_active: bool
    last_synced_at: UtcDateTimeOpt
    mapped_document_count: int = 0
    unreviewed_revision_count: int = 0


class LawRevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tracked_law_id: int
    tracked_law_name: str = ""
    tracked_law_category: str | None = None
    promulgation_no: str | None
    promulgation_date: str | None
    enforcement_date: str | None
    previous_promulgation_no: str | None
    previous_promulgation_date: str | None
    previous_enforcement_date: str | None
    detected_at: UtcDateTime
    review_status: str
    reviewer: str | None
    reviewed_at: UtcDateTimeOpt
    note: str | None
    mapped_documents: list[str] = []
    # 이 항목이 문서 개정 필요 사항 목록에 왜 떴는지: "mapping"(수동으로
    # 매핑해둔 법령) | "tag"(사규 태그가 법령명/본문 캐시와 겹쳐 자동 매칭).
    # 문서-개정 이력 화면(DocumentImpactOut)에서만 의미가 있고, 그 외
    # 목록(개정 이력 탭 등)에서는 기본값 그대로 무시하면 된다.
    matched_by: str = "mapping"


class RevisionUpdate(BaseModel):
    review_status: str | None = None
    reviewer: str | None = None
    note: str | None = None


class BulkRevisionStatusUpdate(BaseModel):
    ids: list[int]
    review_status: str


class BulkRevisionDelete(BaseModel):
    ids: list[int]


class BulkNewAdmrulCandidateIds(BaseModel):
    ids: list[int]


class CompanyDocumentCreate(BaseModel):
    doc_type: str = "절차서"
    doc_number: str | None = None
    title: str
    revision_no: str | None = None
    revision_date: str | None = None
    owner: str | None = None
    file_link: str | None = None
    note: str | None = None
    tags: str | None = None


class CompanyDocumentOut(CompanyDocumentCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: UtcDateTime
    updated_at: UtcDateTime
    mapped_law_count: int = 0
    mapped_laws: list[str] = []


class MappingCreate(BaseModel):
    document_id: int
    tracked_law_id: int
    note: str | None = None


class MappingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    document_id: int
    document_title: str = ""
    tracked_law_id: int
    tracked_law_name: str = ""
    note: str | None


class KoshaGuideCreate(BaseModel):
    code: str | None = None
    field: str | None = None
    title: str
    issued_date: str | None = None
    file_link: str | None = None
    content: str | None = None
    note: str | None = None


class KoshaGuideOut(KoshaGuideCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: UtcDateTime
    updated_at: UtcDateTime


class KoshaGuideSearchResult(BaseModel):
    id: int
    code: str | None = None
    field: str | None = None
    title: str
    issued_date: str | None = None
    file_link: str | None = None
    # 검색어가 지침번호/제목/본문 중 어디서 매칭됐는지. 본문이 있으면(더
    # 구체적인 정보라) 제목/지침번호보다 우선한다.
    matched_in: str = "title"
    # matched_in이 "content"일 때 검색어 주변 발췌문.
    snippet: str = ""


class KoshaGuideBulkImportItems(BaseModel):
    items: list[KoshaGuideCreate]


class KoshaGuideBulkImportResult(BaseModel):
    added: int
    updated: int
    skipped: int


class SettingsOut(BaseModel):
    demo_mode: bool
    law_api_oc_set: bool
    law_api_oc: str | None = None
    auto_sync_interval_hours: int
    smtp_configured: bool
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_use_tls: bool | None = None
    smtp_user: str | None = None
    smtp_from: str | None = None
    alert_emails: str | None = None
    new_admrul_keywords: str | None = None
    new_admrul_department: str | None = None
    new_admrul_since_date: str | None = None
    full_law_cache_enabled: bool = False
    email_feature_enabled: bool = True
    news_ticker_enabled: bool = True
    news_source_moel_url: str | None = None
    news_source_kosha_url: str | None = None
    news_source_accident_url: str | None = None
    news_max_items_per_category: int = 30


class SettingsUpdate(BaseModel):
    law_api_oc: str | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_use_tls: bool | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    alert_emails: str | None = None
    new_admrul_keywords: str | None = None
    new_admrul_department: str | None = None
    new_admrul_since_date: str | None = None
    full_law_cache_enabled: bool | None = None
    news_ticker_enabled: bool | None = None
    news_source_moel_url: str | None = None
    news_source_kosha_url: str | None = None
    news_source_accident_url: str | None = None
    news_max_items_per_category: int | None = None


class SyncResult(BaseModel):
    checked: int
    new_revisions: int
    new_admrul_candidates: int = 0
    errors: list[str] = []


class NewAdmrulCandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_type: str
    external_id: str
    master_id: str | None = None
    name: str
    category: str | None = None
    department: str | None = None
    promulgation_no: str | None = None
    promulgation_date: str | None = None
    enforcement_date: str | None = None
    detail_link: str | None = None
    matched_keyword: str | None = None
    first_seen_at: UtcDateTime


class NewsItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: str
    source_name: str
    title: str
    link: str
    published_at: UtcDateTimeOpt = None
    fetched_at: UtcDateTime
    is_demo: bool = False


class DocumentImpactOut(BaseModel):
    document_id: int
    document_title: str
    doc_type: str
    # 이 문서와 매핑된 법령들 중 아직 처리되지 않은(미검토/검토중) 개정 이력.
    # 최신순, 문서당 최대 5건.
    revisions: list[LawRevisionOut]


class DashboardSummary(BaseModel):
    tracked_law_count: int
    unreviewed_count: int
    in_review_count: int
    reflected_count: int
    document_count: int
    unmapped_law_count: int
    last_sync_at: UtcDateTimeOpt
    recent_revisions: list[LawRevisionOut]
    # 회사 문서 기준으로 재구성한 목록 - "이 법이 바뀌었으니 이 절차서/지침서를
    # 검토하라"는 2차 확장 기능(문서-법령 매핑) 전용 뷰. 1차 핵심 기능(법령
    # 개정 자체를 훑어보는 목록)과 대시보드에서 구분해서 보여줌.
    recent_document_impacts: list[DocumentImpactOut] = []
    # 아직 등록 안 했지만 소관부처+키워드 이중 필터를 통과한 "신규 제정
    # 고시" 후보. 등록된 고시가 개정된 게 아니라 완전히 새로 생긴 것들이라
    # recent_revisions(개정 감지)와는 별도로 보여준다.
    new_admrul_candidates: list[NewAdmrulCandidateOut] = []
