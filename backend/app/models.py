import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# 검토 상태값
REVIEW_STATUSES = ["미검토", "검토중", "반영완료", "해당없음"]

# 추적 대상 구분 (법령 vs 행정규칙(고시/예규/훈령 등))
SOURCE_TYPES = ["law", "admrul"]

DOC_TYPES = ["절차서", "지침서", "작업표준", "기타"]


def now() -> datetime.datetime:
    return datetime.datetime.utcnow()


class TrackedLaw(Base):
    __tablename__ = "tracked_laws"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_type: Mapped[str] = mapped_column(String(16))  # "law" | "admrul"
    external_id: Mapped[str] = mapped_column(String(64))  # 법령일련번호(MST) - 특정 공포 버전을 가리킴, 개정되면 값이 바뀜
    master_id: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 법령ID/행정규칙ID - 버전이 바뀌어도 고정되는 영구 식별자
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 법률/시행령/시행규칙/고시/예규/훈령 등
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)

    current_promulgation_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    current_promulgation_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    current_enforcement_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    detail_link: Mapped[str | None] = mapped_column(String(512), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=now, onupdate=now)

    revisions: Mapped[list["LawRevision"]] = relationship(
        back_populates="tracked_law", cascade="all, delete-orphan", order_by="desc(LawRevision.detected_at)"
    )
    mappings: Mapped[list["DocumentLawMapping"]] = relationship(
        back_populates="tracked_law", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("source_type", "external_id", name="uq_tracked_law_source_external"),)


class LawRevision(Base):
    __tablename__ = "law_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tracked_law_id: Mapped[int] = mapped_column(ForeignKey("tracked_laws.id"))

    promulgation_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    promulgation_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    enforcement_date: Mapped[str | None] = mapped_column(String(16), nullable=True)

    previous_promulgation_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    previous_promulgation_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    previous_enforcement_date: Mapped[str | None] = mapped_column(String(16), nullable=True)

    detected_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=now)
    review_status: Mapped[str] = mapped_column(String(16), default="미검토")
    reviewer: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_data: Mapped[str | None] = mapped_column(Text, nullable=True)

    tracked_law: Mapped["TrackedLaw"] = relationship(back_populates="revisions")


class CompanyDocument(Base):
    __tablename__ = "company_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doc_type: Mapped[str] = mapped_column(String(16), default="절차서")
    doc_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    revision_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    revision_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(64), nullable=True)
    file_link: Mapped[str | None] = mapped_column(String(512), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 쉼표로 구분된 키워드(해시태그) 목록, "#" 없이 저장(예: "밀폐공간,공기호흡기").
    # 명시적으로 매핑해두지 않은 법령이라도, 이 키워드가 법령명이나 본문
    # 캐시(ScrapedLawContent)에 포함되어 있으면 그 개정을 이 문서의 개정
    # 필요 사항 목록에 자동으로 띄우기 위해 사용한다.
    tags: Mapped[str | None] = mapped_column(String(512), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=now, onupdate=now)

    mappings: Mapped[list["DocumentLawMapping"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class DocumentLawMapping(Base):
    __tablename__ = "document_law_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("company_documents.id"))
    tracked_law_id: Mapped[int] = mapped_column(ForeignKey("tracked_laws.id"))
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=now)

    document: Mapped["CompanyDocument"] = relationship(back_populates="mappings")
    tracked_law: Mapped["TrackedLaw"] = relationship(back_populates="mappings")

    __table_args__ = (UniqueConstraint("document_id", "tracked_law_id", name="uq_mapping_doc_law"),)


class NewAdmrulCandidate(Base):
    """아직 등록하지 않은, 새로 제정된 것으로 보이는 고시/예규/훈령 후보.

    등록해둔 고시가 "개정"되는 게 아니라 매년 새로 "제정"되는 경우가 많아서,
    TrackedLaw의 "등록된 항목이 바뀌었는지" 추적만으로는 이런 신규 제정을
    놓친다. 소관부처(department) + 키워드 이중 필터로 찾은 후보를 여기 저장해
    사용자가 등록/무시를 고르게 한다. 무시한 것도 행이 남아있어야(status만
    변경) 다음 스캔에서 같은 항목이 다시 후보로 뜨지 않는다."""

    __tablename__ = "new_admrul_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_type: Mapped[str] = mapped_column(String(16), default="admrul")
    external_id: Mapped[str] = mapped_column(String(64))
    master_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    promulgation_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    promulgation_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    enforcement_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    detail_link: Mapped[str | None] = mapped_column(String(512), nullable=True)
    matched_keyword: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="신규")  # 신규 | 등록됨 | 무시됨
    first_seen_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=now)

    __table_args__ = (UniqueConstraint("source_type", "external_id", name="uq_new_admrul_source_external"),)


class ScrapedLawContent(Base):
    """법령/행정규칙 본문(조문) 캐시.

    국가법령정보 공동활용 API의 "목록 조회"(lawSearch.do)는 법령명 검색만
    지원하고 본문 전체를 대상으로 한 검색은 제공하지 않는다(본문은 "상세
    조회"로 한 건씩만 받아올 수 있음). 그래서 본문검색 기능과, 사규 태그가
    법령 개정 내용과 겹치는지 판단하는 기능 모두 이 캐시 테이블에 미리
    받아둔 본문 텍스트를 대상으로 로컬 검색한다.

    - 추적 중인(TrackedLaw) 법령/고시는 매 동기화(sync)마다 자동으로
      본문이 갱신된다(태그 매칭이 최신 개정 내용을 반영하도록).
    - 아직 등록하지 않은 법령까지 포함한 더 넓은 범위는 설정 화면의
      "본문 캐시 새로고침"을 눌러야 채워진다(API 호출이 많아 자동으로는
      하지 않음)."""

    __tablename__ = "scraped_law_contents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_type: Mapped[str] = mapped_column(String(16))
    external_id: Mapped[str] = mapped_column(String(64))
    master_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    promulgation_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    promulgation_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    enforcement_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    detail_link: Mapped[str | None] = mapped_column(String(512), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # content 앞부분 중 조문단위에서 나와 조번호 라벨이 붙었을 수 있는
    # 구간의 길이(글자 수). 검색어가 이 구간 밖(별표/서식/부칙 등)에서
    # 매칭되면 조번호를 알 수 없으므로 조문 링크를 만들지 않는다.
    article_content_len: Mapped[int] = mapped_column(Integer, default=0)
    cached_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=now, onupdate=now)

    __table_args__ = (
        UniqueConstraint("source_type", "external_id", name="uq_scraped_content_source_external"),
    )


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
