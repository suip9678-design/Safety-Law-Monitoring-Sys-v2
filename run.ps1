$ErrorActionPreference = "Continue"

Set-Location $PSScriptRoot

function Start-Server {
    Set-Location $PSScriptRoot

    Write-Host "`n[1/3] 최신 코드 받는 중 (git pull)..." -ForegroundColor Cyan
    git pull

    $backendPath = Join-Path $PSScriptRoot "backend"
    $venvActivate = Join-Path $backendPath ".venv\Scripts\Activate.ps1"

    if (-not (Test-Path $venvActivate)) {
        Write-Host "`n가상환경(.venv)을 찾을 수 없습니다. README.md를 확인해주세요." -ForegroundColor Red
        return
    }

    Set-Location $backendPath

    Write-Host "`n[2/3] 가상환경 활성화 중..." -ForegroundColor Cyan
    . $venvActivate

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
