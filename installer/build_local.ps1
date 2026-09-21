# 설치 파일(SafetyLawMonitorSetup.exe)을 이 PC에서 한 번에 만든다.
# 하는 일: (1) Go/NSIS가 없으면 winget으로 설치 (2) 현재 DB에서 법령 마스터를 뺀
# 배포용 DB 생성 (3) installer/build_installer.sh 실행.
# 사내 보안 프록시 때문에 필요한 우회(curl 인증서 해지 확인, pip 신뢰 호스트)는
# 이번 실행에만 환경변수로 적용하고 PC 전역 설정은 건드리지 않는다.
param([switch]$SkipFetch)   # 파이썬/wheel을 이미 받아둔 경우 재사용(재빌드용)
$ErrorActionPreference = "Stop"
$installer = $PSScriptRoot
$root = Split-Path -Parent $installer
$build = Join-Path $installer "build"
New-Item -Force -ItemType Directory $build | Out-Null

function Add-ToolDirs {
    foreach ($d in "C:\Program Files\Go\bin", "C:\Program Files (x86)\NSIS", "C:\Program Files\NSIS") {
        if ((Test-Path $d) -and ($env:Path -notlike "*$d*")) { $env:Path += ";$d" }
    }
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    Add-ToolDirs
}

Add-ToolDirs
foreach ($t in @(@{ cmd = "go"; id = "GoLang.Go" }, @{ cmd = "makensis"; id = "NSIS.NSIS" })) {
    if (Get-Command $t.cmd -ErrorAction SilentlyContinue) { continue }
    Write-Host "[준비] $($t.id) 설치 중... (관리자 권한 확인 창이 뜨면 허용해주세요)"
    winget install --id $t.id --exact --silent --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Get-Command $t.cmd -ErrorAction SilentlyContinue)) {
        throw "$($t.id) 설치 후에도 $($t.cmd) 를 찾을 수 없습니다. 이 창을 닫고 다시 실행해보세요."
    }
}

$git = (Get-Command git -ErrorAction Stop).Source
$bash = Join-Path (Split-Path (Split-Path $git)) "bin\bash.exe"
if (-not (Test-Path $bash)) { throw "Git Bash를 찾을 수 없습니다: $bash" }

$py = Join-Path $root "backend\.venv\Scripts\python.exe"
$srcDb = Join-Path $root "backend\safety_law_tracker.db"
$distDb = Join-Path $build "dist.db"
Write-Host "[1/2] 배포용 DB 만드는 중 (법령 마스터 제외)"
Remove-Item $distDb -ErrorAction SilentlyContinue
& $py (Join-Path $installer "scripts\make_dist_db.py") $srcDb $distDb
if ($LASTEXITCODE -ne 0) { throw "배포용 DB 생성 실패" }
Write-Host "  ※ 이 DB에는 OC/KOSHA 인증키가 들어 있어 설치 파일을 받는 사람 모두 같은 키를 쓰게 됩니다."

$curlHome = Join-Path $build "curlhome"
New-Item -Force -ItemType Directory $curlHome | Out-Null
Set-Content (Join-Path $curlHome ".curlrc") "ssl-no-revoke" -Encoding ascii
$env:CURL_HOME = $curlHome
$env:PIP_TRUSTED_HOST = "pypi.org files.pythonhosted.org"
$env:PYTHONUTF8 = "1"   # pip이 UTF-8 한글 주석이 든 requirements를 cp949로 읽다 실패하는 것을 막는다

Write-Host "[2/2] 설치 파일 빌드 (10~20분 걸릴 수 있습니다)"
Set-Location $root
$args = @("installer/build_installer.sh", "--db", "installer/build/dist.db")
if ($SkipFetch) { $args += "--skip-fetch" }
& $bash @args
if ($LASTEXITCODE -ne 0) { throw "빌드 실패 (위 로그 확인)" }

$exe = Join-Path $build "SafetyLawMonitorSetup.exe"
Write-Host ("`n완료: {0} ({1:N0} MB)" -f $exe, ((Get-Item $exe).Length / 1MB))
explorer.exe $build
