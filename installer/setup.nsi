; 안전보건 법령·고시 Monitoring - Windows 설치 프로그램
;
; C:\Program Files\SafetyLawMonitor\ 안에 (내장된 파이썬 실행환경 +
; 앱 소스 + 미리 채워둔 법령 캐시 DB를) 설치하고, 바탕화면에는 실행용
; exe 파일 하나만 남긴다. 관리자 권한이 필요하다(Program Files 쓰기 때문
; - 실행하면 Windows가 자동으로 권한 요청 창을 띄운다).
;
; 빌드: installer/build_installer.sh 가 이 스크립트를 실행하기 전에
; build/payload/python, build/payload/app, launcher/launcher.exe를
; 먼저 준비해둔다. (makensis installer/setup.nsi 로 직접 빌드해도 됨,
; 단 그 전에 위 파일들이 이미 준비되어 있어야 한다.)

Unicode true

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Name "안전보건 법령·고시 Monitoring"
OutFile "build\SafetyLawMonitorSetup.exe"
InstallDir "$PROGRAMFILES64\SafetyLawMonitor"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!define APP_NAME "안전보건 법령·고시 Monitoring"
!define DESKTOP_EXE_NAME "안전보건 법령 모니터링.exe"
!define UNINSTALL_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SafetyLawMonitor"

Var UninstallerPath   ; 기존 설치의 제거 프로그램 경로(레지스트리에서 읽음, 이미 따옴표 포함)
Var ChoiceDialog
Var RadioInstall
Var RadioReinstall
Var RadioUninstall
Var ChoiceAction      ; "install" | "reinstall" | "uninstall" - 아래 선택 화면에서 정해짐

; ---------- UI 페이지 ----------
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME

; 이미 설치되어 있을 때만 보여주는 선택 화면("설치/재설치/삭제") - 일반
; 사용자는 "프로그램 추가/제거"를 직접 찾아 삭제하는 걸 어려워해서, 이
; 설치 파일 하나로 새로 설치/기존 위에 새 버전 덮어쓰기/삭제만 하기를
; 전부 고를 수 있게 한다. 처음 설치하는 경우엔 이 화면 자체가 나타나지
; 않고 바로 설치가 진행된다(아래 ChoicePageCreate 참고).
Page custom ChoicePageCreate ChoicePageLeave

!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$DESKTOP\${DESKTOP_EXE_NAME}"
!define MUI_FINISHPAGE_RUN_TEXT "지금 바로 실행"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Korean"

Function ChoicePageCreate
  ReadRegStr $UninstallerPath HKLM "${UNINSTALL_REG_KEY}" "UninstallString"
  StrCmp $UninstallerPath "" 0 show_page
    ; 처음 설치하는 경우 - 고를 게 없으니 이 화면은 건너뛰고 바로 설치로 넘어간다.
    StrCpy $ChoiceAction "install"
    Abort
  show_page:

  nsDialogs::Create 1018
  Pop $ChoiceDialog
  ${If} $ChoiceDialog == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "이미 설치되어 있습니다" "어떻게 진행할지 선택해주세요."

  ${NSD_CreateLabel} 0 0u 100% 24u "안전보건 법령·고시 Monitoring이(가) 이 컴퓨터에 이미 설치되어 있습니다."
  Pop $0

  ${NSD_CreateRadioButton} 10u 32u 100% 12u "설치 - 삭제 없이 기존 파일 위에 새 버전을 덮어씁니다"
  Pop $RadioInstall

  ${NSD_CreateRadioButton} 10u 48u 100% 12u "재설치 - 기존 프로그램을 삭제한 뒤 새로 설치합니다 (권장)"
  Pop $RadioReinstall
  ${NSD_Check} $RadioReinstall

  ${NSD_CreateRadioButton} 10u 64u 100% 12u "삭제만 하기 - 새로 설치하지 않고 이 컴퓨터에서 프로그램만 제거합니다"
  Pop $RadioUninstall

  ${NSD_CreateLabel} 10u 88u 100% 24u "어떤 경우를 선택하시든, 그동안 모아둔 법령·고시 데이터(DB 파일)는 삭제되지 않고 그대로 유지됩니다."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function ChoicePageLeave
  ${NSD_GetState} $RadioInstall $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $ChoiceAction "install"
  ${EndIf}
  ${NSD_GetState} $RadioReinstall $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $ChoiceAction "reinstall"
  ${EndIf}
  ${NSD_GetState} $RadioUninstall $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $ChoiceAction "uninstall"
  ${EndIf}

  ; _?= 옵션으로 제거 프로그램을 임시 위치로 복사하지 않고 그 자리에서
  ; 곧바로, 끝날 때까지 기다리며(ExecWait) 실행한다.
  ${If} $ChoiceAction == "uninstall"
    ExecWait '$UninstallerPath /S _?=$INSTDIR'
    MessageBox MB_OK|MB_ICONINFORMATION "프로그램을 제거했습니다.$\r$\n$\r$\n그동안 모아둔 법령·고시 데이터(DB 파일)는 다음 위치에 그대로 남아 있습니다:$\r$\n$INSTDIR\app\backend$\r$\n$\r$\n필요 없으시면 이 폴더를 직접 삭제하셔도 됩니다."
    Quit
  ${ElseIf} $ChoiceAction == "reinstall"
    ExecWait '$UninstallerPath /S _?=$INSTDIR'
  ${EndIf}
  ; "install"(삭제 없이 덮어쓰기)이면 아무것도 안 하고 바로 설치 페이지로 넘어간다.
FunctionEnd

; ---------- 설치 ----------
Section "Install"
  SetOutPath "$INSTDIR\python"
  File /r "build\payload\python\*.*"

  SetOutPath "$INSTDIR\app"
  File /r "build\payload\app\*.*"

  SetOutPath "$INSTDIR"
  File "launcher\launcher.exe"

  ; 바탕화면에는 실제 실행 파일을 그대로 하나 복사한다 (바로가기가 아님).
  SetOutPath "$DESKTOP"
  File "/oname=${DESKTOP_EXE_NAME}" "launcher\launcher.exe"
  SetOutPath "$INSTDIR"

  ; 프로그램 추가/제거에 표시될 제거 항목 등록
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegDWORD HKLM "${UNINSTALL_REG_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_REG_KEY}" "NoRepair" 1
SectionEnd

; ---------- 제거 ----------
; 법령 데이터(SQLite DB)는 사용자 데이터라, 여기서는 프로그램 파일(파이썬
; 실행환경 + 앱 소스코드)만 지우고 DB/설정(.env)은 그대로 남겨둔다 -
; 나중에 다시 설치해도 데이터가 유지되고, 실수로 지웠다가 법령 이력이
; 통째로 날아가는 일을 막기 위함이다.
Section "Uninstall"
  Delete "$DESKTOP\${DESKTOP_EXE_NAME}"
  Delete "$INSTDIR\launcher.exe"
  Delete "$INSTDIR\uninstall.exe"

  RMDir /r "$INSTDIR\python"
  RMDir /r "$INSTDIR\app\frontend"
  RMDir /r "$INSTDIR\app\backend\app"
  Delete "$INSTDIR\app\backend\requirements.txt"
  Delete "$INSTDIR\app\backend\.env.example"
  ; $INSTDIR\app\backend\*.db 와 .env는 일부러 지우지 않는다.

  DeleteRegKey HKLM "${UNINSTALL_REG_KEY}"

  ; /S(조용히 실행) 모드일 때는 안내창을 띄우지 않는다 - 재설치 과정에서
  ; 설치 파일이 기존 버전을 미리 지울 때도 이 제거 코드가 그대로 쓰이는데,
  ; 그때는 뒤이어 새 설치가 곧바로 진행되니 중간에 안내창이 뜨면 오히려
  ; 헷갈린다.
  IfSilent skip_uninstall_msg
    MessageBox MB_OK|MB_ICONINFORMATION "프로그램을 제거했습니다.$\r$\n$\r$\n그동안 모아둔 법령·고시 데이터(DB 파일)는 다음 위치에 그대로 남아 있습니다:$\r$\n$INSTDIR\app\backend$\r$\n$\r$\n필요 없으시면 이 폴더를 직접 삭제하셔도 됩니다."
  skip_uninstall_msg:
SectionEnd
