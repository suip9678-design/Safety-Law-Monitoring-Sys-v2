/**
 * 오프라인 데모 모드.
 *
 * Python 백엔드(FastAPI)가 없는 환경에서도 이 화면을 확인할 수 있도록, 아무
 * 정적 파일 서버로 frontend/ 를 띄웠을 때(Node의 `npx serve`, 표준 라이브러리만
 * 쓰는 `python3 -m http.server`, VS Code Live Server 등 - FastAPI 등 이
 * 프로젝트의 파이썬 의존성 설치가 전혀 필요 없음) "/api/..." 요청을 가로채
 * 브라우저 메모리 안의 가짜 데이터로 응답해준다. (index.html을 file://로
 * 직접 여는 것은 지원하지 않는다 - 화면이 ES 모듈로 나뉘어 있어 브라우저가
 * file://에서는 모듈 간 import를 막기 때문. 반드시 http(s):// 로 접속해야 함.)
 *
 * 동작 방식:
 * 1) 페이지가 열리자마자 실제 백엔드가 있는지 GET /api/health 한 번으로
 *    확인한다(JSON으로 정상 응답하면 "있음"). 백엔드가 있으면 이 스크립트는
 *    이후 아무 일도 하지 않고 모든 요청을 그대로 통과시킨다 - 평소처럼
 *    `run.bat`으로 서버를 띄운 경우엔 완전히 무해하다.
 * 2) 백엔드가 없다고 판단되면(네트워크 오류, 404, HTML 응답 등) 그 뒤로는
 *    모든 "/api/..." 요청을 아래 ROUTES로 처리한다. js/main.js와 그 하위
 *    모듈들은 fetch가 가로채진 사실을 전혀 모른 채 평소와 똑같이 동작한다.
 *
 * 데이터는 이 브라우저 탭의 메모리에만 있고 새로고침하면 초기 상태로
 * 되돌아간다 - "확인해보기" 용도이지, 실제 운영 데이터를 다루는 게
 * 아니므로 의도적으로 저장하지 않는다.
 */
(function () {
  "use strict";

  const REAL_FETCH = window.fetch.bind(window);

  function urlOf(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return String(input);
  }

  function isApiUrl(urlStr) {
    try {
      return new URL(urlStr, location.href).pathname.startsWith("/api/");
    } catch (e) {
      return false;
    }
  }

  async function detectRealBackend() {
    try {
      const res = await REAL_FETCH("/api/health", { cache: "no-store" });
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) return false;
      const data = await res.json();
      return !!data && typeof data.status === "string";
    } catch (e) {
      return false;
    }
  }

  const backendAvailable = detectRealBackend();

  // ---------------------------------------------------------------------
  // 데모 데이터 (backend/app/fixtures.py의 DEMO_LAWS/DEMO_NEWS와 같은 내용을
  // 그대로 옮겨와, 서버 데모 모드(OC 키 없음)와 최대한 비슷하게 보이도록 함)
  // ---------------------------------------------------------------------

  const ids = { law: 0, revision: 0, document: 0, mapping: 0, candidate: 0, news: 0, koshaGuide: 0 };
  const nextId = (key) => ++ids[key];

  function isoDaysAgo(days, hours) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (days || 0));
    if (hours) d.setUTCHours(d.getUTCHours() - hours);
    return d.toISOString();
  }

  // law.go.kr 검색 결과 흉내 - "법령 마스터" 탭 검색창에서 찾을 수 있는
  // 전체 풀. 이 중 일부를 아래에서 "이미 등록됨(store.laws)" 상태로 옮겨
  // 놓는다(실제로는 law.go.kr이 등록 여부와 무관하게 이름 검색 결과를
  // 돌려주는 것과 동일하게, 이미 등록된 것도 계속 검색에 나온다).
  const SEARCH_POOL = [
    { source_type: "law", external_id: "demo-law-001", name: "산업안전보건법", category: "법률", department: "고용노동부", promulgation_no: "제19591호", promulgation_date: "20230816", enforcement_date: "20240517", detail_link: "https://www.law.go.kr/법령/산업안전보건법" },
    { source_type: "law", external_id: "demo-law-002", name: "산업안전보건법 시행령", category: "대통령령", department: "고용노동부", promulgation_no: "제34603호", promulgation_date: "20240618", enforcement_date: "20240618", detail_link: "https://www.law.go.kr/법령/산업안전보건법시행령" },
    { source_type: "law", external_id: "demo-law-003", name: "산업안전보건법 시행규칙", category: "고용노동부령", department: "고용노동부", promulgation_no: "제417호", promulgation_date: "20240101", enforcement_date: "20240101", detail_link: "https://www.law.go.kr/법령/산업안전보건법시행규칙" },
    { source_type: "law", external_id: "demo-law-004", name: "산업안전보건기준에 관한 규칙", category: "고용노동부령", department: "고용노동부", promulgation_no: "제402호", promulgation_date: "20231128", enforcement_date: "20231128", detail_link: "https://www.law.go.kr/법령/산업안전보건기준에관한규칙",
      content: "제241조(화재위험 작업 시의 준수사항) 사업주는 통풍이나 환기가 충분하지 않은 장소에서 화재위험작업(용접·용단 등 불꽃이나 화기를 사용하는 작업)을 하는 경우 화재감시자를 배치하여야 한다." },
    { source_type: "law", external_id: "demo-law-005", name: "중대재해 처벌 등에 관한 법률", category: "법률", department: "법무부", promulgation_no: "제18627호", promulgation_date: "20220126", enforcement_date: "20220127", detail_link: "https://www.law.go.kr/법령/중대재해처벌등에관한법률" },
    { source_type: "admrul", external_id: "demo-admrul-001", name: "유해위험방지계획서 제출·심사 및 확인에 관한 규칙", category: "고시", department: "고용노동부", promulgation_no: "고용노동부고시 제2023-31호", promulgation_date: "20230630", enforcement_date: "20230701", detail_link: "https://www.law.go.kr/행정규칙/유해위험방지계획서",
      content: "제6조(유해위험방지계획서의 내용) 탱크·배관 등의 설비를 해체하거나 정비·보수 작업을 하는 경우로서 화기작업을 수반하는 경우에는 유해위험방지계획서에 화재·폭발 예방대책을 포함하여야 한다." },
    { source_type: "admrul", external_id: "demo-admrul-002", name: "관리감독자 안전보건교육 운영지침", category: "예규", department: "고용노동부", promulgation_no: "고용노동부예규 제220호", promulgation_date: "20220310", enforcement_date: "20220310", detail_link: "https://www.law.go.kr/행정규칙/관리감독자안전보건교육운영지침" },
    { source_type: "admrul", external_id: "demo-admrul-003", name: "위험성평가 실시규정", category: "고시", department: "고용노동부", promulgation_no: "고용노동부고시 제2023-19호", promulgation_date: "20230501", enforcement_date: "20230501", detail_link: "https://www.law.go.kr/행정규칙/위험성평가실시규정" },
    { source_type: "admrul", external_id: "demo-admrul-004", name: "밀폐공간 작업 유해위험 방지에 관한 고시", category: "고시", department: "고용노동부", promulgation_no: "고용노동부고시 제2026-4호", promulgation_date: "20260115", enforcement_date: "20260115", detail_link: "https://www.law.go.kr/행정규칙/밀폐공간작업유해위험방지에관한고시",
      content: "제9조(밀폐공간 화기작업) 밀폐공간에서 화기작업을 실시하는 경우 사전에 가스농도를 측정하고, 화기작업 중에는 지속적으로 환기를 실시하여야 한다." },
    { source_type: "admrul", external_id: "demo-admrul-005", name: "중대재해 예방을 위한 안전보건관리체계 구축 지침", category: "예규", department: "고용노동부", promulgation_no: "고용노동부예규 제245호", promulgation_date: "20260302", enforcement_date: "20260302", detail_link: "https://www.law.go.kr/행정규칙/중대재해예방을위한안전보건관리체계구축지침" },
    { source_type: "admrul", external_id: "demo-admrul-006", name: "화학물질 취급시설 안전관리에 관한 고시", category: "고시", department: "환경부", promulgation_no: "환경부고시 제2026-11호", promulgation_date: "20260210", enforcement_date: "20260210", detail_link: "https://www.law.go.kr/행정규칙/화학물질취급시설안전관리에관한고시" },
  ];

  const NEWS_SEED = {
    moel: [
      "고용노동부, 중대재해 예방을 위한 산업안전보건 감독 강화 계획 발표",
      "고용노동부, 밀폐공간 질식재해 예방 집중 점검 실시",
      "산업안전보건법 시행규칙 개정안 행정예고",
    ],
    kosha: [
      "안전보건공단, 여름철 온열질환 예방 안전보건 가이드 배포",
      "안전보건공단, 건설현장 추락재해 예방 특별 캠페인 실시",
      "안전보건공단, 위험성평가 우수사례 공모전 접수",
    ],
    accident: [
      "제조업 사업장 끼임 사고로 중대재해 발생, 관계기관 조사 착수",
      "건설현장 추락사고 중대재해 판단, 원청 안전보건관리체계 점검",
      "화학물질 누출사고로 인한 중대산업재해 조사 진행",
    ],
  };
  const NEWS_SOURCE_NAME = { moel: "고용노동부", kosha: "안전보건공단", accident: "중대재해 뉴스" };
  const NEWS_SOURCE_LINK = { moel: "https://www.moel.go.kr", kosha: "https://www.kosha.or.kr", accident: "https://www.moel.go.kr" };

  function buildStore() {
    const laws = [];
    const revisions = [];
    const documents = [];
    const mappings = [];
    const candidates = [];
    const newsItems = [];
    const scrapedContent = [];

    function trackFromPool(externalId, overrides) {
      const base = SEARCH_POOL.find((l) => l.external_id === externalId);
      const law = Object.assign(
        {
          id: nextId("law"),
          source_type: base.source_type,
          external_id: base.external_id,
          master_id: null,
          name: base.name,
          category: base.category,
          department: base.department,
          current_promulgation_no: base.promulgation_no,
          current_promulgation_date: base.promulgation_date,
          current_enforcement_date: base.enforcement_date,
          detail_link: base.detail_link,
          is_active: true,
          last_synced_at: isoDaysAgo(0, 2),
        },
        overrides || {}
      );
      laws.push(law);
      if (base.content) {
        scrapedContent.push({
          source_type: base.source_type,
          external_id: base.external_id,
          name: base.name,
          category: base.category,
          department: base.department,
          detail_link: base.detail_link,
          content: base.content,
        });
      }
      return law;
    }

    // ---- 법령 마스터: 5건을 등록된 상태로 시작 ----
    const lawSpb = trackFromPool("demo-law-001");
    const lawSihaengryeong = trackFromPool("demo-law-002");
    trackFromPool("demo-law-003");
    const lawGijun = trackFromPool("demo-law-004");
    trackFromPool("demo-admrul-003");

    // ---- 개정 이력: 미검토 1건 + 검토중 1건 + 반영완료 1건 ----
    function addRevision(law, opts) {
      const rev = Object.assign(
        {
          id: nextId("revision"),
          tracked_law_id: law.id,
          promulgation_no: law.current_promulgation_no,
          promulgation_date: law.current_promulgation_date,
          enforcement_date: law.current_enforcement_date,
          previous_promulgation_no: null,
          previous_promulgation_date: null,
          previous_enforcement_date: null,
          detected_at: isoDaysAgo(1),
          review_status: "미검토",
          reviewer: null,
          reviewed_at: null,
          note: null,
        },
        opts || {}
      );
      revisions.push(rev);
      return rev;
    }
    addRevision(lawSpb, {
      previous_promulgation_no: "제19010호",
      previous_promulgation_date: "20221011",
      previous_enforcement_date: "20221011",
      detected_at: isoDaysAgo(2),
      review_status: "미검토",
    });
    addRevision(lawSihaengryeong, {
      previous_promulgation_no: "제34200호",
      previous_promulgation_date: "20240101",
      previous_enforcement_date: "20240101",
      detected_at: isoDaysAgo(10),
      review_status: "검토중",
      reviewer: "홍길동",
    });
    addRevision(lawGijun, {
      previous_promulgation_no: "제380호",
      previous_promulgation_date: "20220501",
      previous_enforcement_date: "20220501",
      detected_at: isoDaysAgo(40),
      review_status: "반영완료",
      reviewer: "홍길동",
      reviewed_at: isoDaysAgo(35),
      note: "절차서 3건 개정 완료",
    });

    // ---- 사규 2건: 하나는 근거 법령 직접 매핑, 하나는 키워드(해시태그) 자동 매칭 ----
    function addDocument(opts) {
      const doc = Object.assign(
        {
          id: nextId("document"),
          doc_type: "절차서",
          doc_number: null,
          title: "제목 없음",
          revision_no: null,
          revision_date: null,
          owner: null,
          file_link: null,
          note: null,
          tags: null,
          created_at: isoDaysAgo(60),
          updated_at: isoDaysAgo(60),
        },
        opts || {}
      );
      documents.push(doc);
      return doc;
    }
    const docGihwa = addDocument({
      doc_type: "작업표준",
      doc_number: "SP-014",
      title: "화기작업 안전작업표준",
      revision_no: "3",
      revision_date: "20230101",
      owner: "안전보건팀",
      tags: "화기작업",
    });
    const docMilpye = addDocument({
      doc_type: "지침서",
      doc_number: "GD-007",
      title: "밀폐공간 작업 안전보건지침",
      revision_no: "2",
      revision_date: "20220601",
      owner: "안전보건팀",
    });
    mappings.push({ id: nextId("mapping"), document_id: docMilpye.id, tracked_law_id: lawGijun.id, note: null });

    // ---- 신규 제정 고시 후보 2건 (아직 등록 안 한 상태로 남겨둠) ----
    function addCandidate(externalId) {
      const base = SEARCH_POOL.find((l) => l.external_id === externalId);
      candidates.push({
        id: nextId("candidate"),
        source_type: base.source_type,
        external_id: base.external_id,
        master_id: null,
        name: base.name,
        category: base.category,
        department: base.department,
        promulgation_no: base.promulgation_no,
        promulgation_date: base.promulgation_date,
        enforcement_date: base.enforcement_date,
        detail_link: base.detail_link,
        matched_keyword: "안전보건",
        status: "신규",
        first_seen_at: isoDaysAgo(3),
      });
    }
    addCandidate("demo-admrul-004");
    addCandidate("demo-admrul-005");
    // 소관부처가 달라 이중 필터(부처+키워드)에서 걸러져야 하는 디코이라
    // 후보로 넣지 않는다 (demo-admrul-006, 환경부).

    // ---- 안전보건 뉴스: 카테고리별 3건, 그중 1건은 보관 처리된 상태로 시작 ----
    Object.keys(NEWS_SEED).forEach((category) => {
      NEWS_SEED[category].forEach((title, idx) => {
        newsItems.push({
          id: nextId("news"),
          category,
          source_name: NEWS_SOURCE_NAME[category],
          title: `[데모] ${title}`,
          link: NEWS_SOURCE_LINK[category],
          guid: `demo-news-${category}-${idx + 1}`,
          published_at: isoDaysAgo(idx * 2, idx),
          fetched_at: isoDaysAgo(idx * 2, idx),
          is_demo: true,
          is_archived: idx === 0,
        });
      });
    });

    // ---- KOSHA 가이드 2건 (직접 등록한 상태로 시작 - 실제로도 API 동기화
    // 없이 직접 입력/붙여넣기만으로 채워지는 경우가 많은 데이터셋이라) ----
    const koshaGuides = [
      {
        id: nextId("koshaGuide"),
        code: "G-68-2022",
        field: "안전분야",
        title: "밀폐공간 작업 안전보건에 관한 기술지침",
        issued_date: "20220401",
        file_link: null,
        content: "밀폐공간에서 작업하기 전 산소농도 및 유해가스 농도를 측정하고, 환기설비를 가동하여야 한다.",
        note: null,
        created_at: isoDaysAgo(90),
        updated_at: isoDaysAgo(90),
      },
      {
        id: nextId("koshaGuide"),
        code: "G-184-2021",
        field: "안전분야",
        title: "화기작업 시 화재감시자 배치에 관한 기술지침",
        issued_date: "20210715",
        file_link: null,
        content: "화기작업 중에는 화재감시자를 배치하고, 소화기 등 진화 설비를 비치하여야 한다.",
        note: null,
        created_at: isoDaysAgo(60),
        updated_at: isoDaysAgo(60),
      },
    ];

    return {
      laws,
      revisions,
      documents,
      mappings,
      candidates,
      newsItems,
      scrapedContent,
      koshaGuides,
      settings: {
        law_api_oc: "",
        kosha_guide_api_key: "",
        kosha_guide_api_url: "https://apis.data.go.kr/B552468/srch/smartSearch",
        kosha_guide_sync_keywords: "안전보건,산업안전,중대재해,위험성평가,유해위험,보건관리,안전관리",
        new_admrul_keywords: "안전보건,산업안전,중대재해,위험성평가,유해위험,보건관리,안전관리",
        new_admrul_department: "고용노동부",
        new_admrul_since_date: "",
        full_law_cache_enabled: false,
        news_ticker_enabled: true,
        news_source_moel_url: "",
        news_source_kosha_url: "",
        news_source_accident_url: "",
        news_retention_days: 180,
      },
      helpShown: false,
    };
  }

  const store = buildStore();

  // ---------------------------------------------------------------------
  // 실제 API 응답 형태(schemas.py)에 맞춘 변환 함수
  // ---------------------------------------------------------------------

  function lawOut(law) {
    return Object.assign({}, law, {
      mapped_document_count: store.mappings.filter((m) => m.tracked_law_id === law.id).length,
      unreviewed_revision_count: store.revisions.filter((r) => r.tracked_law_id === law.id && r.review_status === "미검토").length,
    });
  }

  function revisionOut(rev) {
    const law = store.laws.find((l) => l.id === rev.tracked_law_id);
    return Object.assign({}, rev, {
      tracked_law_name: law ? law.name : "",
      tracked_law_category: law ? law.category : null,
      mapped_documents: law
        ? store.mappings.filter((m) => m.tracked_law_id === law.id).map((m) => {
            const doc = store.documents.find((d) => d.id === m.document_id);
            return doc ? doc.title : "";
          })
        : [],
      matched_by: "mapping",
    });
  }

  function documentOut(doc) {
    const docMappings = store.mappings.filter((m) => m.document_id === doc.id);
    return Object.assign({}, doc, {
      mapped_law_count: docMappings.length,
      mapped_laws: docMappings.map((m) => {
        const law = store.laws.find((l) => l.id === m.tracked_law_id);
        return law ? law.name : "";
      }),
    });
  }

  function mappingOut(m) {
    const doc = store.documents.find((d) => d.id === m.document_id);
    const law = store.laws.find((l) => l.id === m.tracked_law_id);
    return Object.assign({}, m, {
      document_title: doc ? doc.title : "",
      tracked_law_name: law ? law.name : "",
    });
  }

  function docTags(doc) {
    if (!doc.tags) return [];
    return doc.tags.split(",").map((t) => t.trim()).filter(Boolean);
  }

  function computeDocumentImpacts(statuses) {
    const impacts = [];
    store.documents.forEach((doc) => {
      const lawMatchedBy = new Map();
      store.mappings
        .filter((m) => m.document_id === doc.id)
        .forEach((m) => {
          const law = store.laws.find((l) => l.id === m.tracked_law_id && l.is_active);
          if (law) lawMatchedBy.set(law.id, "mapping");
        });
      const tags = docTags(doc);
      if (tags.length) {
        store.laws
          .filter((l) => l.is_active && !lawMatchedBy.has(l.id))
          .forEach((law) => {
            const haystack = law.name + "\n" + (store.scrapedContent.find((c) => c.source_type === law.source_type && c.external_id === law.external_id) || {}).content || "";
            if (tags.some((tag) => haystack.includes(tag))) lawMatchedBy.set(law.id, "tag");
          });
      }
      if (!lawMatchedBy.size) return;

      let pairs = [];
      lawMatchedBy.forEach((matchedBy, lawId) => {
        store.revisions
          .filter((r) => r.tracked_law_id === lawId && (!statuses || statuses.includes(r.review_status)))
          .forEach((r) => pairs.push([r, matchedBy]));
      });
      if (!pairs.length) return;
      pairs.sort((a, b) => new Date(b[0].detected_at) - new Date(a[0].detected_at));
      pairs = pairs.slice(0, 5);

      impacts.push({
        document_id: doc.id,
        document_title: doc.title,
        doc_type: doc.doc_type,
        revisions: pairs.map(([r, matchedBy]) => Object.assign(revisionOut(r), { matched_by: matchedBy })),
      });
    });
    impacts.sort((a, b) => new Date(b.revisions[0].detected_at) - new Date(a.revisions[0].detected_at));
    return impacts;
  }

  function dashboardSummary() {
    const activeLaws = store.laws.filter((l) => l.is_active);
    const activeRevisions = store.revisions.filter((r) => activeLaws.some((l) => l.id === r.tracked_law_id));
    const countBy = (status) => activeRevisions.filter((r) => r.review_status === status).length;
    const mappedLawIds = new Set(store.mappings.map((m) => m.tracked_law_id));
    const lastSync = activeLaws.reduce((max, l) => (l.last_synced_at && (!max || l.last_synced_at > max) ? l.last_synced_at : max), null);
    return {
      tracked_law_count: activeLaws.length,
      unreviewed_count: countBy("미검토"),
      in_review_count: countBy("검토중"),
      reflected_count: countBy("반영완료"),
      document_count: store.documents.length,
      unmapped_law_count: activeLaws.filter((l) => !mappedLawIds.has(l.id)).length,
      last_sync_at: lastSync,
      recent_revisions: activeRevisions
        .filter((r) => r.review_status === "미검토" || r.review_status === "검토중")
        .sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at))
        .map(revisionOut),
      recent_document_impacts: computeDocumentImpacts(["미검토", "검토중"]),
      new_admrul_candidates: store.candidates.filter((c) => c.status === "신규"),
    };
  }

  function keywordSearch(sourceType, query) {
    const needle = (query || "").trim();
    if (!needle) return [];
    const results = [];
    store.scrapedContent
      .filter((row) => sourceType === "all" || row.source_type === sourceType)
      .forEach((row) => {
        const idx = (row.content || "").indexOf(needle);
        if (idx !== -1) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(row.content.length, idx + needle.length + 40);
          results.push({
            source_type: row.source_type,
            external_id: row.external_id,
            name: row.name,
            category: row.category,
            department: row.department,
            detail_link: row.detail_link,
            matched_in: "content",
            snippet: (start > 0 ? "…" : "") + row.content.slice(start, end).trim() + (end < row.content.length ? "…" : ""),
            article_link: null,
          });
        } else if (row.name.includes(needle)) {
          results.push({
            source_type: row.source_type,
            external_id: row.external_id,
            name: row.name,
            category: row.category,
            department: row.department,
            detail_link: row.detail_link,
            matched_in: "name",
            snippet: "",
            article_link: null,
          });
        }
      });
    return results;
  }

  // ---------------------------------------------------------------------
  // 라우팅
  // ---------------------------------------------------------------------

  function jsonResponse(status, body) {
    if (body === undefined || body === null) return new Response(null, { status });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }
  function errorResponse(status, detail) {
    return jsonResponse(status, { detail });
  }

  const ROUTES = [
    { method: "GET", re: /^\/api\/health$/, handler: () => jsonResponse(200, { status: "ok", demo_mode: true }) },

    { method: "GET", re: /^\/api\/dashboard\/summary$/, handler: () => jsonResponse(200, dashboardSummary()) },

    {
      method: "GET",
      re: /^\/api\/laws$/,
      handler: (m, sp) => {
        let laws = store.laws;
        if (sp.get("active_only") !== "false") laws = laws.filter((l) => l.is_active);
        const sourceType = sp.get("source_type");
        if (sourceType) laws = laws.filter((l) => l.source_type === sourceType);
        return jsonResponse(200, laws.slice().sort((a, b) => a.name.localeCompare(b.name, "ko")).map(lawOut));
      },
    },
    {
      method: "GET",
      re: /^\/api\/laws\/search$/,
      handler: (m, sp) => {
        const sourceType = sp.get("source_type");
        const query = (sp.get("query") || "").trim();
        let pool = SEARCH_POOL.filter((l) => l.source_type === sourceType);
        if (query) pool = pool.filter((l) => l.name.includes(query));
        return jsonResponse(200, pool.map((l) => ({
          source_type: l.source_type, external_id: l.external_id, master_id: null, name: l.name,
          category: l.category, department: l.department, promulgation_no: l.promulgation_no,
          promulgation_date: l.promulgation_date, enforcement_date: l.enforcement_date, detail_link: l.detail_link,
        })));
      },
    },
    {
      method: "GET",
      re: /^\/api\/laws\/new-admrul-candidates\/dismissed$/,
      handler: () => jsonResponse(200, store.candidates.filter((c) => c.status === "무시됨")),
    },
    {
      method: "POST",
      re: /^\/api\/laws\/new-admrul-candidates\/bulk-restore$/,
      handler: (m, sp, body) => {
        (body.ids || []).forEach((id) => {
          const c = store.candidates.find((c) => c.id === id && c.status === "무시됨");
          if (c) c.status = "신규";
        });
        return jsonResponse(204);
      },
    },
    {
      method: "POST",
      re: /^\/api\/laws\/new-admrul-candidates\/(\d+)\/dismiss$/,
      handler: (m) => {
        const c = store.candidates.find((c) => c.id === Number(m[1]));
        if (!c) return errorResponse(404, "후보를 찾을 수 없습니다.");
        c.status = "무시됨";
        return jsonResponse(204);
      },
    },
    {
      method: "POST",
      re: /^\/api\/laws\/new-admrul-candidates\/(\d+)\/restore$/,
      handler: (m) => {
        const c = store.candidates.find((c) => c.id === Number(m[1]));
        if (!c) return errorResponse(404, "후보를 찾을 수 없습니다.");
        c.status = "신규";
        return jsonResponse(204);
      },
    },
    {
      method: "POST",
      re: /^\/api\/laws\/new-admrul-candidates\/(\d+)\/registered$/,
      handler: (m) => {
        const c = store.candidates.find((c) => c.id === Number(m[1]));
        if (!c) return errorResponse(404, "후보를 찾을 수 없습니다.");
        c.status = "등록됨";
        return jsonResponse(204);
      },
    },
    {
      method: "POST",
      re: /^\/api\/laws$/,
      handler: (m, sp, body) => {
        const existing = store.laws.find((l) => l.source_type === body.source_type && l.external_id === body.external_id);
        if (existing && existing.is_active) return errorResponse(409, "이미 추적 중인 법령/고시입니다.");
        const law = existing || { id: nextId("law"), source_type: body.source_type, external_id: body.external_id };
        Object.assign(law, {
          master_id: body.master_id || null,
          name: body.name,
          category: body.category || null,
          department: body.department || null,
          current_promulgation_no: body.promulgation_no || null,
          current_promulgation_date: body.promulgation_date || null,
          current_enforcement_date: body.enforcement_date || null,
          detail_link: body.detail_link || null,
          is_active: true,
          last_synced_at: new Date().toISOString(),
        });
        if (!existing) store.laws.push(law);
        return jsonResponse(201, lawOut(law));
      },
    },
    {
      method: "GET",
      re: /^\/api\/laws\/(\d+)$/,
      handler: (m) => {
        const law = store.laws.find((l) => l.id === Number(m[1]));
        if (!law) return errorResponse(404, "추적 중인 법령을 찾을 수 없습니다.");
        return jsonResponse(200, lawOut(law));
      },
    },
    {
      method: "DELETE",
      re: /^\/api\/laws\/(\d+)$/,
      handler: (m) => {
        const law = store.laws.find((l) => l.id === Number(m[1]));
        if (!law) return errorResponse(404, "추적 중인 법령을 찾을 수 없습니다.");
        law.is_active = false;
        return jsonResponse(204);
      },
    },

    {
      method: "GET",
      re: /^\/api\/revisions$/,
      handler: (m, sp) => {
        let rows = store.revisions;
        if (sp.get("status")) rows = rows.filter((r) => r.review_status === sp.get("status"));
        if (sp.get("tracked_law_id")) rows = rows.filter((r) => r.tracked_law_id === Number(sp.get("tracked_law_id")));
        if (sp.get("has_mapped_documents") === "true") {
          const mappedLawIds = new Set(store.mappings.map((mm) => mm.tracked_law_id));
          rows = rows.filter((r) => mappedLawIds.has(r.tracked_law_id));
        }
        rows = rows.slice().sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at));
        return jsonResponse(200, rows.map(revisionOut));
      },
    },
    {
      method: "PATCH",
      re: /^\/api\/revisions\/bulk-status$/,
      handler: (m, sp, body) => {
        if (!body.ids || !body.ids.length) return errorResponse(400, "선택된 항목이 없습니다.");
        const now = new Date().toISOString();
        const touched = [];
        body.ids.forEach((id) => {
          const r = store.revisions.find((r) => r.id === id);
          if (r) {
            r.review_status = body.review_status;
            r.reviewed_at = now;
            touched.push(r);
          }
        });
        return jsonResponse(200, touched.map(revisionOut));
      },
    },
    {
      method: "POST",
      re: /^\/api\/revisions\/bulk-delete$/,
      handler: (m, sp, body) => {
        if (!body.ids || !body.ids.length) return errorResponse(400, "선택된 항목이 없습니다.");
        const idSet = new Set(body.ids);
        for (let i = store.revisions.length - 1; i >= 0; i--) {
          if (idSet.has(store.revisions[i].id)) store.revisions.splice(i, 1);
        }
        return jsonResponse(204);
      },
    },
    {
      method: "PATCH",
      re: /^\/api\/revisions\/(\d+)$/,
      handler: (m, sp, body) => {
        const rev = store.revisions.find((r) => r.id === Number(m[1]));
        if (!rev) return errorResponse(404, "개정 이력을 찾을 수 없습니다.");
        if (body.review_status !== undefined && body.review_status !== null) {
          rev.review_status = body.review_status;
          rev.reviewed_at = new Date().toISOString();
        }
        if (body.reviewer !== undefined && body.reviewer !== null) rev.reviewer = body.reviewer;
        if (body.note !== undefined && body.note !== null) rev.note = body.note;
        return jsonResponse(200, revisionOut(rev));
      },
    },

    {
      method: "GET",
      re: /^\/api\/documents\/impacts$/,
      handler: (m, sp) => jsonResponse(200, computeDocumentImpacts(sp.get("status") ? [sp.get("status")] : null)),
    },
    { method: "GET", re: /^\/api\/documents$/, handler: () => jsonResponse(200, store.documents.slice().sort((a, b) => a.title.localeCompare(b.title, "ko")).map(documentOut)) },
    {
      method: "POST",
      re: /^\/api\/documents$/,
      handler: (m, sp, body) => {
        const now = new Date().toISOString();
        const doc = Object.assign({ id: nextId("document"), created_at: now, updated_at: now }, body);
        store.documents.push(doc);
        return jsonResponse(201, documentOut(doc));
      },
    },
    {
      method: "GET",
      re: /^\/api\/documents\/(\d+)$/,
      handler: (m) => {
        const doc = store.documents.find((d) => d.id === Number(m[1]));
        if (!doc) return errorResponse(404, "문서를 찾을 수 없습니다.");
        return jsonResponse(200, documentOut(doc));
      },
    },
    {
      method: "PUT",
      re: /^\/api\/documents\/(\d+)$/,
      handler: (m, sp, body) => {
        const doc = store.documents.find((d) => d.id === Number(m[1]));
        if (!doc) return errorResponse(404, "문서를 찾을 수 없습니다.");
        Object.assign(doc, body, { updated_at: new Date().toISOString() });
        return jsonResponse(200, documentOut(doc));
      },
    },
    {
      method: "DELETE",
      re: /^\/api\/documents\/(\d+)$/,
      handler: (m) => {
        const idx = store.documents.findIndex((d) => d.id === Number(m[1]));
        if (idx === -1) return errorResponse(404, "문서를 찾을 수 없습니다.");
        store.documents.splice(idx, 1);
        for (let i = store.mappings.length - 1; i >= 0; i--) {
          if (store.mappings[i].document_id === Number(m[1])) store.mappings.splice(i, 1);
        }
        return jsonResponse(204);
      },
    },

    {
      method: "GET",
      re: /^\/api\/mappings$/,
      handler: (m, sp) => {
        let rows = store.mappings;
        if (sp.get("document_id")) rows = rows.filter((mm) => mm.document_id === Number(sp.get("document_id")));
        if (sp.get("tracked_law_id")) rows = rows.filter((mm) => mm.tracked_law_id === Number(sp.get("tracked_law_id")));
        return jsonResponse(200, rows.map(mappingOut));
      },
    },
    {
      method: "POST",
      re: /^\/api\/mappings$/,
      handler: (m, sp, body) => {
        if (!store.documents.some((d) => d.id === body.document_id)) return errorResponse(404, "문서를 찾을 수 없습니다.");
        if (!store.laws.some((l) => l.id === body.tracked_law_id)) return errorResponse(404, "추적 중인 법령을 찾을 수 없습니다.");
        if (store.mappings.some((mm) => mm.document_id === body.document_id && mm.tracked_law_id === body.tracked_law_id)) {
          return errorResponse(409, "이미 매핑되어 있습니다.");
        }
        const mapping = { id: nextId("mapping"), document_id: body.document_id, tracked_law_id: body.tracked_law_id, note: body.note || null };
        store.mappings.push(mapping);
        return jsonResponse(201, mappingOut(mapping));
      },
    },
    {
      method: "DELETE",
      re: /^\/api\/mappings\/(\d+)$/,
      handler: (m) => {
        const idx = store.mappings.findIndex((mm) => mm.id === Number(m[1]));
        if (idx === -1) return errorResponse(404, "매핑을 찾을 수 없습니다.");
        store.mappings.splice(idx, 1);
        return jsonResponse(204);
      },
    },

    {
      method: "GET",
      re: /^\/api\/news\/search$/,
      handler: (m, sp) => {
        let rows = store.newsItems;
        if (sp.get("category")) rows = rows.filter((n) => n.category === sp.get("category"));
        if (sp.get("q") && sp.get("q").trim()) rows = rows.filter((n) => n.title.includes(sp.get("q").trim()));
        if (sp.get("archived") !== null) rows = rows.filter((n) => n.is_archived === (sp.get("archived") === "true"));
        const dateFrom = sp.get("date_from");
        const dateTo = sp.get("date_to");
        const at = (n) => new Date(n.published_at || n.fetched_at);
        if (dateFrom) rows = rows.filter((n) => at(n) >= new Date(dateFrom + "T00:00:00Z"));
        if (dateTo) rows = rows.filter((n) => at(n) < new Date(new Date(dateTo + "T00:00:00Z").getTime() + 86400000));
        rows = rows.slice().sort((a, b) => at(b) - at(a));
        const limit = Math.min(Math.max(Number(sp.get("limit")) || 200, 1), 300);
        return jsonResponse(200, { items: rows.slice(0, limit), total: rows.length });
      },
    },
    {
      method: "GET",
      re: /^\/api\/news$/,
      handler: (m, sp) => {
        if (!store.settings.news_ticker_enabled) return jsonResponse(200, []);
        let rows = store.newsItems;
        if (sp.get("category")) rows = rows.filter((n) => n.category === sp.get("category"));
        const at = (n) => new Date(n.published_at || n.fetched_at);
        rows = rows.slice().sort((a, b) => at(b) - at(a));
        const limit = Math.min(Math.max(Number(sp.get("limit")) || 40, 1), 200);
        return jsonResponse(200, rows.slice(0, limit));
      },
    },
    {
      method: "PATCH",
      re: /^\/api\/news\/(\d+)\/archive$/,
      handler: (m, sp, body) => {
        const item = store.newsItems.find((n) => n.id === Number(m[1]));
        if (!item) return errorResponse(404, "해당 뉴스를 찾을 수 없습니다.");
        item.is_archived = !!body.is_archived;
        return jsonResponse(200, item);
      },
    },
    { method: "POST", re: /^\/api\/news\/sync$/, handler: () => jsonResponse(200, { added: 0 }) },

    { method: "GET", re: /^\/api\/content-cache\/status$/, handler: () => jsonResponse(200, { cached_count: store.scrapedContent.length, last_cached_at: new Date().toISOString() }) },
    { method: "GET", re: /^\/api\/content-cache\/full-refresh-status$/, handler: () => jsonResponse(200, { running: false, processed: 0, skipped: 0, total: null, started_at: null, finished_at: null, error: null }) },
    { method: "POST", re: /^\/api\/content-cache\/full-refresh$/, handler: () => jsonResponse(200, { started: true }) },
    { method: "POST", re: /^\/api\/content-cache\/refresh$/, handler: () => jsonResponse(200, { cached_count: store.scrapedContent.length, last_cached_at: new Date().toISOString(), refreshed: 0 }) },
    {
      method: "GET",
      re: /^\/api\/content-cache\/search$/,
      handler: (m, sp) => jsonResponse(200, keywordSearch(sp.get("source_type") || "all", sp.get("query") || "")),
    },

    {
      method: "GET",
      re: /^\/api\/settings$/,
      handler: () => {
        const s = store.settings;
        return jsonResponse(200, {
          demo_mode: true,
          law_api_oc_set: !!s.law_api_oc,
          law_api_oc: s.law_api_oc || null,
          kosha_guide_api_key_set: !!s.kosha_guide_api_key,
          kosha_guide_api_key: s.kosha_guide_api_key || null,
          kosha_guide_api_url: s.kosha_guide_api_url || null,
          kosha_guide_sync_keywords: s.kosha_guide_sync_keywords || null,
          auto_sync_interval_hours: 24,
          new_admrul_keywords: s.new_admrul_keywords,
          new_admrul_department: s.new_admrul_department,
          new_admrul_since_date: s.new_admrul_since_date || null,
          full_law_cache_enabled: s.full_law_cache_enabled,
          news_ticker_enabled: s.news_ticker_enabled,
          news_source_moel_url: s.news_source_moel_url || null,
          news_source_kosha_url: s.news_source_kosha_url || null,
          news_source_accident_url: s.news_source_accident_url || null,
          news_retention_days: s.news_retention_days,
        });
      },
    },
    {
      method: "PUT",
      re: /^\/api\/settings$/,
      handler: (m, sp, body) => {
        Object.keys(body).forEach((key) => {
          if (body[key] !== undefined && body[key] !== null && Object.prototype.hasOwnProperty.call(store.settings, key)) {
            store.settings[key] = body[key];
          }
        });
        return ROUTES.find((r) => r.method === "GET" && r.re.test("/api/settings")).handler(null, new URLSearchParams());
      },
    },
    { method: "GET", re: /^\/api\/settings\/help-shown$/, handler: () => jsonResponse(200, { shown: store.helpShown }) },
    { method: "POST", re: /^\/api\/settings\/help-shown$/, handler: () => { store.helpShown = true; return jsonResponse(204); } },

    { method: "POST", re: /^\/api\/sync$/, handler: () => jsonResponse(200, { checked: store.laws.filter((l) => l.is_active).length, new_revisions: 0, new_admrul_candidates: 0, errors: [] }) },

    // ---- KOSHA 가이드 ----
    {
      method: "GET",
      re: /^\/api\/kosha-guides$/,
      handler: () => jsonResponse(200, store.koshaGuides.slice().sort((a, b) => a.title.localeCompare(b.title, "ko"))),
    },
    {
      method: "GET",
      re: /^\/api\/kosha-guides\/search$/,
      handler: (m, sp) => {
        const needle = (sp.get("query") || "").trim();
        if (!needle) return jsonResponse(200, []);
        const results = [];
        store.koshaGuides.forEach((g) => {
          const content = g.content || "";
          const idx = content.indexOf(needle);
          if (idx !== -1) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(content.length, idx + needle.length + 40);
            results.push(Object.assign({}, g, {
              matched_in: "content",
              snippet: (start > 0 ? "…" : "") + content.slice(start, end).trim() + (end < content.length ? "…" : ""),
            }));
          } else if ((g.title || "").includes(needle)) {
            results.push(Object.assign({}, g, { matched_in: "title", snippet: "" }));
          } else if ((g.code || "").includes(needle)) {
            results.push(Object.assign({}, g, { matched_in: "code", snippet: "" }));
          }
        });
        return jsonResponse(200, results);
      },
    },
    {
      method: "POST",
      re: /^\/api\/kosha-guides$/,
      handler: (m, sp, body) => {
        if (!body.title || !body.title.trim()) return errorResponse(400, "제목은 비워둘 수 없습니다.");
        if (body.code && store.koshaGuides.some((g) => g.code === body.code)) {
          return errorResponse(409, `이미 등록된 지침번호입니다: ${body.code}`);
        }
        const now = new Date().toISOString();
        const guide = {
          id: nextId("koshaGuide"),
          code: body.code || null,
          field: body.field || null,
          title: body.title.trim(),
          issued_date: body.issued_date || null,
          file_link: body.file_link || null,
          content: body.content || null,
          note: body.note || null,
          created_at: now,
          updated_at: now,
        };
        store.koshaGuides.push(guide);
        return jsonResponse(201, guide);
      },
    },
    {
      method: "PUT",
      re: /^\/api\/kosha-guides\/(\d+)$/,
      handler: (m, sp, body) => {
        const guide = store.koshaGuides.find((g) => g.id === Number(m[1]));
        if (!guide) return errorResponse(404, "가이드를 찾을 수 없습니다.");
        if (!body.title || !body.title.trim()) return errorResponse(400, "제목은 비워둘 수 없습니다.");
        if (body.code && store.koshaGuides.some((g) => g.code === body.code && g.id !== guide.id)) {
          return errorResponse(409, `이미 등록된 지침번호입니다: ${body.code}`);
        }
        Object.assign(guide, {
          code: body.code || null,
          field: body.field || null,
          title: body.title.trim(),
          issued_date: body.issued_date || null,
          file_link: body.file_link || null,
          content: body.content || null,
          note: body.note || null,
          updated_at: new Date().toISOString(),
        });
        return jsonResponse(200, guide);
      },
    },
    {
      method: "DELETE",
      re: /^\/api\/kosha-guides\/(\d+)$/,
      handler: (m) => {
        const idx = store.koshaGuides.findIndex((g) => g.id === Number(m[1]));
        if (idx === -1) return errorResponse(404, "가이드를 찾을 수 없습니다.");
        store.koshaGuides.splice(idx, 1);
        return jsonResponse(204);
      },
    },
    {
      method: "POST",
      re: /^\/api\/kosha-guides\/bulk-import$/,
      handler: (m, sp, body) => {
        let added = 0, updated = 0, skipped = 0;
        (body.items || []).forEach((item) => {
          const title = (item.title || "").trim();
          if (!title) { skipped++; return; }
          const existing = item.code ? store.koshaGuides.find((g) => g.code === item.code) : null;
          const now = new Date().toISOString();
          if (existing) {
            Object.assign(existing, { field: item.field || null, title, issued_date: item.issued_date || null, file_link: item.file_link || null, updated_at: now });
            updated++;
          } else {
            store.koshaGuides.push({
              id: nextId("koshaGuide"), code: item.code || null, field: item.field || null, title,
              issued_date: item.issued_date || null, file_link: item.file_link || null, content: null, note: null,
              created_at: now, updated_at: now,
            });
            added++;
          }
        });
        return jsonResponse(200, { added, updated, skipped });
      },
    },
    {
      method: "POST",
      re: /^\/api\/kosha-guides\/sync$/,
      handler: () => {
        if (!store.settings.kosha_guide_api_key) {
          return errorResponse(400, "설정에서 KOSHA 가이드 Open API 인증키를 먼저 저장하세요.");
        }
        const keywords = (store.settings.kosha_guide_sync_keywords || "").split(",").map((k) => k.trim()).filter(Boolean);
        return jsonResponse(200, { keywords_checked: keywords, found: 0, added: 0, updated: 0, errors: ["오프라인 데모 모드에서는 실제 공공데이터포털 API를 호출할 수 없습니다."] });
      },
    },
  ];

  async function mockFetch(urlStr, init) {
    const url = new URL(urlStr, location.href);
    const method = ((init && init.method) || "GET").toUpperCase();
    let body = {};
    if (init && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch (e) {
        body = {};
      }
    }
    for (const route of ROUTES) {
      if (route.method !== method) continue;
      const match = route.re.exec(url.pathname);
      if (match) return route.handler(match, url.searchParams, body);
    }
    return errorResponse(404, `데모 모드에서 아직 지원하지 않는 요청입니다: ${method} ${url.pathname}`);
  }

  window.fetch = async function (input, init) {
    const urlStr = urlOf(input);
    if (!isApiUrl(urlStr)) return REAL_FETCH(input, init);
    const available = await backendAvailable;
    if (available) return REAL_FETCH(input, init);
    return mockFetch(urlStr, init);
  };

  document.addEventListener("DOMContentLoaded", () => {
    backendAvailable.then((available) => {
      if (available) return;
      console.info(
        "[안전보건 법령 모니터링] 백엔드 서버 없이 오프라인 데모 모드로 동작 중입니다. " +
          "모든 데이터는 이 브라우저 탭의 메모리에만 있으며 새로고침하면 초기 상태로 되돌아갑니다."
      );
      const badge = document.getElementById("demoBadge");
      if (badge) {
        badge.textContent = "데모 모드 (오프라인)";
        badge.title = "백엔드 서버 없이 브라우저에서만 동작하는 오프라인 데모입니다. 데이터는 저장되지 않고 새로고침하면 초기화됩니다.";
      }
    });
  });
})();
