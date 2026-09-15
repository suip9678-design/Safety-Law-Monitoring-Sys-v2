#!/usr/bin/env bash
# 배포용 Windows 설치 파일(SafetyLawMonitorSetup.exe)을 만드는 전체 과정을
# 순서대로 실행한다.
#
# 사용법:
#   installer/build_installer.sh [--db <미리 캐시해둔 safety_law_tracker.db 경로>] [--skip-fetch]
#
#   --db <path>     이미 "전체 법령 자동 캐시"를 한 번 돌려서 다 채워둔
#                   safety_law_tracker.db 파일을 설치 파일 안에 포함시킨다.
#                   생략하면 빈 DB로 시작해서, 설치 후 첫 실행 때부터
#                   캐시를 새로 받아야 한다(대기시간이 길어짐).
#   --skip-fetch    Python 실행환경/wheel을 다시 받지 않고 이미 받아둔
#                   build/payload/python을 그대로 재사용한다(재빌드 반복
#                   시 시간 절약용).
#
# 필요한 도구: bash, curl, unzip, python3(+pip), go, makensis(NSIS).
#   (go-winres는 없으면 이 스크립트가 자동으로 go install 해서 받아온다.)
# 필요한 네트워크: nuget.org(파이썬 실행환경), pypi.org(라이브러리 wheel),
#   proxy.golang.org(Go 모듈 - 트레이 아이콘 라이브러리/아이콘 임베딩 도구).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER_DIR="$REPO_ROOT/installer"
BUILD_DIR="$INSTALLER_DIR/build"
PAYLOAD_PY="$BUILD_DIR/payload/python"
PAYLOAD_APP="$BUILD_DIR/payload/app"

DB_PATH=""
SKIP_FETCH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) DB_PATH="$2"; shift 2 ;;
    --skip-fetch) SKIP_FETCH="1"; shift ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

if [[ -n "$DB_PATH" && ! -f "$DB_PATH" ]]; then
  echo "지정한 DB 파일을 찾을 수 없습니다: $DB_PATH" >&2
  exit 1
fi

echo "[1/5] Python 실행환경 준비"
if [[ -n "$SKIP_FETCH" && -f "$PAYLOAD_PY/python.exe" ]]; then
  echo "  --skip-fetch: 기존 $PAYLOAD_PY 재사용"
else
  bash "$INSTALLER_DIR/scripts/fetch_python_runtime.sh" "$PAYLOAD_PY"
fi

echo "[2/5] 라이브러리(wheel) 준비"
if [[ -n "$SKIP_FETCH" && -d "$PAYLOAD_PY/Lib/site-packages/fastapi" ]]; then
  echo "  --skip-fetch: 기존 site-packages 재사용"
else
  bash "$INSTALLER_DIR/scripts/fetch_wheels.sh" "$INSTALLER_DIR/requirements-windows.txt" "$PAYLOAD_PY"
fi

echo "[3/5] 앱 소스 준비"
bash "$INSTALLER_DIR/scripts/stage_app.sh" "$PAYLOAD_APP"

if [[ -n "$DB_PATH" ]]; then
  echo "  미리 캐시해둔 DB 포함: $DB_PATH"
  cp "$DB_PATH" "$PAYLOAD_APP/backend/safety_law_tracker.db"
fi

echo "[4/6] 바탕화면 실행 파일 아이콘/버전 정보 리소스 준비"
if ! command -v go-winres >/dev/null 2>&1; then
  echo "  go-winres가 없어 설치합니다..."
  GOBIN="$(go env GOPATH)/bin" go install github.com/tc-hib/go-winres@latest
  export PATH="$(go env GOPATH)/bin:$PATH"
fi
( cd "$INSTALLER_DIR/launcher" && go-winres make --arch amd64 )

echo "[5/6] 바탕화면 실행 파일(launcher.exe) 빌드"
( cd "$INSTALLER_DIR/launcher" && \
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-H=windowsgui" -o launcher.exe . )

echo "[6/6] 설치 프로그램(NSIS) 빌드"
( cd "$INSTALLER_DIR" && makensis setup.nsi )

echo
echo "완료: $BUILD_DIR/SafetyLawMonitorSetup.exe"
