$ErrorActionPreference = "Continue"

Set-Location $PSScriptRoot

# run.bat이 이미 이 PowerShell 프로세스 전체를 -ExecutionPolicy Bypass로
# 띄우지만, 사용자가 run.ps1을 직접(.\run.ps1) 실행했을 때도 venv의
# Activate.ps1이 "이 시스템에서 스크립트를 실행할 수 없습니다" 오류로
# 막히지 않도록 이 프로세스 하나에만 한 번 더 걸어둔다. 레지스트리에
# 저장되는 영구 설정이 아니라 이 창을 닫으면 사라지는 임시 허용이다.
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue } catch {}

function Find-Python {
    foreach ($cmd in @("python", "py")) {
        $found = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($found) { return $found.Source }
    }
    return $null
}

# 가상환경이 없으면 만들고, 필요한 패키지가 없으면 설치하고, .env가 없으면
# 예시 파일을 복사해둔다 - 최초 설치를 따로 안 해도 run.bat 더블클릭
# 한 번으로 전부 끝나게 하기 위함. 이미 다 되어 있으면(두 번째 실행부터는
# 거의 항상 이 경우) 아무것도 다시 하지 않아 빠르게 지나간다.
function Ensure-BackendReady {
    $backendPath = Join-Path $PSScriptRoot "backend"
    $venvPath = Join-Path $backendPath ".venv"
    $venvActivate = Join-Path $venvPath "Scripts\Activate.ps1"

    if (-not (Test-Path $venvActivate)) {
        Write-Host "가상환경(.venv)이 없어 새로 만듭니다 (최초 1회만 실행됩니다)..." -ForegroundColor Cyan
        $python = Find-Python
        if (-not $python) {
            Write-Host "`n파이썬을 찾을 수 없습니다. https://www.python.org/downloads/ 에서 설치 후 다시 실행해주세요." -ForegroundColor Red
            Write-Host "설치 화면에서 'Add python.exe to PATH' 옵션을 꼭 체크하세요." -ForegroundColor Yellow
            return $false
        }
        & $python -m venv $venvPath
        if (-not (Test-Path $venvActivate)) {
            Write-Host "`n가상환경 생성에 실패했습니다." -ForegroundColor Red
            return $false
        }
    }

    . $venvActivate

    if (-not (Get-Command uvicorn -ErrorAction SilentlyContinue)) {
        Write-Host "필요한 패키지를 설치합니다 (최초 1회, 몇 분 걸릴 수 있습니다)..." -ForegroundColor Cyan
        Push-Location $backendPath
        pip install -q -r requirements.txt
        if ($LASTEXITCODE -ne 0) {
            # 사내망/백신/VPN이 자체 인증서로 HTTPS를 가로채는 경우
            # "CERTIFICATE_VERIFY_FAILED"로 실패한다 - pypi.org와
            # files.pythonhosted.org만 신뢰하도록 지정해 재시도한다.
            Write-Host "일반 설치가 실패했습니다 (사내망 SSL 인증서 문제일 수 있음). 다시 시도합니다..." -ForegroundColor Yellow
            pip install -q --trusted-host pypi.org --trusted-host files.pythonhosted.org -r requirements.txt
        }
        $installFailed = ($LASTEXITCODE -ne 0)
        Pop-Location
        if ($installFailed) {
            Write-Host "`n패키지 설치에 실패했습니다. 인터넷 연결 또는 사내망 보안 설정을 확인해주세요." -ForegroundColor Red
            return $false
        }
    }

    $envFile = Join-Path $backendPath ".env"
    $envExample = Join-Path $backendPath ".env.example"
    if ((-not (Test-Path $envFile)) -and (Test-Path $envExample)) {
        Copy-Item $envExample $envFile
        Write-Host "backend\.env 파일이 없어 .env.example을 복사해 만들었습니다 (필요하면 나중에 값을 채워넣으세요)." -ForegroundColor Cyan
    }

    return $true
}

function Start-Server {
    Set-Location $PSScriptRoot

    Write-Host "`n[1/3] 최신 코드 받는 중 (git pull)..." -ForegroundColor Cyan
    git pull

    Write-Host "`n[2/3] 실행 환경 준비 중 (가상환경/패키지 확인)..." -ForegroundColor Cyan
    if (-not (Ensure-BackendReady)) {
        Set-Location $PSScriptRoot
        return
    }

    $backendPath = Join-Path $PSScriptRoot "backend"
    Set-Location $backendPath

    $uvicorn = Get-Command uvicorn -ErrorAction SilentlyContinue
    if (-not $uvicorn) {
        Write-Host "`n가상환경에서 uvicorn을 찾을 수 없습니다." -ForegroundColor Red
        Set-Location $PSScriptRoot
        return
    }

    Write-Host "`n[3/3] 서버 실행 중... (작업을 일시중지하고 메뉴로 가려면 Ctrl+C를 누르세요)" -ForegroundColor Cyan
    Write-Host "브라우저에서 http://localhost:8000 접속하세요.`n" -ForegroundColor Green

    # 1. PowerShell이 Ctrl+C를 맞고 죽는 것을 방지
    [Console]::TreatControlCAsInput = $true

    # 2. 서버를 실행하고 해당 프로세스 정보를 $process 변수에 담음 (PassThru)
    $process = Start-Process -FilePath $uvicorn.Source -ArgumentList @("app.main:app", "--reload", "--port", "8000") -NoNewWindow -PassThru

    # 3. 서버가 살아있는 동안 반복해서 키 입력을 감시
    try {
        while (-not $process.HasExited) {
            if ([Console]::KeyAvailable) {
                $key = [Console]::ReadKey($true)
                
                # Ctrl + C 가 눌렸는지 확인
                if ($key.Key -eq [ConsoleKey]::C -and $key.Modifiers -match 'Control') {
                    Write-Host "`n[알림] Ctrl+C 감지됨. 서버 프로세스를 중지합니다..." -ForegroundColor Yellow
                    # uvicorn --reload는 내부적으로 실제 앱을 돌리는 별도의 자식
                    # 프로세스를 새로 띄운다. Stop-Process는 우리가 잡고 있는
                    # $process.Id(리로더/감독 프로세스)만 죽이고 그 자식은 그대로
                    # 남겨둔다 - 그러면 화면에는 멈춘 것처럼 보여도 실제 서버는
                    # 포트 8000에서 계속 살아서 요청을 처리한다(전체 법령 캐시처럼
                    # 오래 도는 작업의 진행 건수가 Ctrl+C 이후에도 계속 올라가는
                    # 증상으로 나타남). taskkill /T로 자식 프로세스까지 함께
                    # 종료해야 한다.
                    & taskkill /PID $process.Id /T /F 2>$null | Out-Null
                    break
                }
            }
            # CPU 점유율이 치솟지 않도록 0.2초 대기
            Start-Sleep -Milliseconds 200
        }
    } finally {
        # 4. 루프를 빠져나오면 다시 일반적인 입력 상태로 되돌림 (Read-Host 작동을 위해)
        [Console]::TreatControlCAsInput = $false
    }

    Set-Location $PSScriptRoot
}

function Clear-PendingKeys {
    # 버퍼에 남아있는 불필요한 키 입력 제거
    while ([Console]::KeyAvailable) { [Console]::ReadKey($true) | Out-Null }
}

# --- 메인 실행부 ---
# 아래 전체를 try/catch로 감싸서, 예상 못한 오류(예: git이 설치 안 됨,
# 잘못된 폴더에서 실행함 등)로 스크립트가 중간에 죽어도 오류 메시지를
# 볼 수 있게 창을 붙잡아둡니다. run.bat에 -NoExit도 같이 있어서 이중으로
# 창이 안 닫히게 되어 있지만, 이 스크립트를 PowerShell에서 직접(.\run.ps1)
# 실행했을 때도 똑같이 오류가 안 보이고 사라지는 걸 막아줍니다.
try {
    Start-Server
    Clear-PendingKeys

    # 서버가 중지되면 여기서 무한 대기하며 명령어 대기
    while ($true) {
        Write-Host "`n=================================================" -ForegroundColor DarkGray
        Write-Host "서버가 중지되었습니다." -ForegroundColor Yellow
        $cmd = (Read-Host "▶ 다시 시작(git pull 포함)하려면 run(또는 start), 종료하려면 exit 입력").Trim().ToLower()

        if ($cmd -eq "run" -or $cmd -eq "start") {
            Start-Server
            Clear-PendingKeys
        } elseif ($cmd -eq "exit" -or $cmd -eq "quit") {
            break
        } else {
            Write-Host "run, start, exit 중 하나를 입력해주세요." -ForegroundColor Red
        }
    }
} catch {
    Write-Host "`n[오류] 예상치 못한 문제가 발생해서 중단됐습니다:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor DarkGray
    Write-Host "`n이 화면을 캡처해서 알려주시면 원인을 확인할 수 있습니다." -ForegroundColor Yellow
    Write-Host "아무 키나 누르면 계속합니다..." -ForegroundColor DarkGray
    [Console]::ReadKey($true) | Out-Null
}
