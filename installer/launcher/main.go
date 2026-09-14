// 바탕화면에 놓이는 실행 파일. 일반 프로그램들처럼 검은 콘솔 창 없이,
// 시스템 트레이(작업표시줄 우측 하단) 아이콘으로만 동작한다. 더블클릭하면
// (아직 안 떠 있다면) 서버를 화면에 안 보이게 띄우고, 준비되면 기본
// 브라우저를 연다. 트레이 아이콘을 오른쪽 클릭하면 "대시보드 열기"/"종료"
// 메뉴가 뜬다. 이미 실행 중일 때 다시 더블클릭해도 창이 중복으로 뜨지
// 않고 브라우저만 다시 연다(단일 실행 보장, 아래 acquireSingleInstance 참고).
package main

import (
	_ "embed"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"github.com/getlantern/systray"
)

// 트레이 아이콘 이미지. 빌드 시점에 바이너리 안에 그대로 박아 넣어(go:embed),
// 설치 폴더에 별도 아이콘 파일이 없어도 트레이 아이콘이 항상 뜨게 한다.
//
//go:embed icon.ico
var iconBytes []byte

// 빌드 시 -ldflags "-X main.installDir=..." 로 실제 설치 경로를 주입할 수
// 있다(공백이 있는 경로는 셸 이스케이프가 까다로워, 기본값을 NSIS가 쓰는
// 경로와 동일하게 맞춰두고 보통은 오버라이드 없이 그대로 쓴다).
var installDir = `C:\Program Files\SafetyLawMonitor`

const (
	serverHost = "127.0.0.1"
	serverPort = "8000"
	healthPath = "/api/health"

	// Windows CreateProcess 플래그: 콘솔 창을 아예 만들지 않는다. 서버는
	// pythonw.exe(콘솔 서브시스템이 없는 실행 파일)로 띄우는 데다 이 플래그도
	// 함께 줘서 이중으로 창이 안 뜨게 한다.
	createNoWindow = 0x08000000
	mbIconError    = 0x00000010
	mbIconInfo     = 0x00000040

	errorAlreadyExists = 183 // ERROR_ALREADY_EXISTS
)

var serverCmd *exec.Cmd

func serverURL() string {
	return fmt.Sprintf("http://%s:%s", serverHost, serverPort)
}

func isServerUp() bool {
	client := http.Client{Timeout: 800 * time.Millisecond}
	resp, err := client.Get(serverURL() + healthPath)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// 서버를 화면에 아무 창도 띄우지 않고 백그라운드로 실행한다. 콘솔이
// 없으니 로그는 눈에 안 보이는 대신, 문제 생겼을 때 확인할 수 있게
// 설치 폴더의 server.log 파일에 남긴다.
func startServer() error {
	pythonwExe := filepath.Join(installDir, "python", "pythonw.exe")
	backendDir := filepath.Join(installDir, "app", "backend")
	logPath := filepath.Join(installDir, "server.log")

	logFile, err := os.Create(logPath)
	if err != nil {
		logFile = nil // 로그 파일을 못 만들어도 서버 실행 자체는 막지 않는다.
	}

	cmd := exec.Command(pythonwExe, "-m", "uvicorn", "app.main:app",
		"--host", serverHost, "--port", serverPort)
	cmd.Dir = backendDir
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow, HideWindow: true}
	if logFile != nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	serverCmd = cmd
	return nil
}

func openBrowser(url string) error {
	return exec.Command("cmd", "/c", "start", "", url).Start()
}

func showMessageBox(msg string, icon uintptr) {
	user32 := syscall.NewLazyDLL("user32.dll")
	messageBoxW := user32.NewProc("MessageBoxW")
	title, _ := syscall.UTF16PtrFromString("안전보건 법령·고시 Monitoring")
	text, _ := syscall.UTF16PtrFromString(msg)
	messageBoxW.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), icon)
}

// 이미 이 프로그램이 실행 중인지 이름 붙은 뮤텍스로 확인한다. 바탕화면
// 아이콘을 또 더블클릭했을 때 트레이 아이콘이 두 개 뜨거나 서버가 중복
// 실행되는 걸 막기 위함 - 이미 떠 있으면 브라우저만 다시 열고 조용히
// 종료한다.
func acquireSingleInstance() bool {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	createMutexW := kernel32.NewProc("CreateMutexW")
	name, _ := syscall.UTF16PtrFromString(`Global\SafetyLawMonitorLauncherMutex`)
	ret, _, lastErr := createMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if ret == 0 {
		// 뮤텍스 생성 자체가 실패한 경우(드묾) - 안전하게 "새 인스턴스"로 취급한다.
		return true
	}
	if errno, ok := lastErr.(syscall.Errno); ok && uintptr(errno) == errorAlreadyExists {
		return false
	}
	return true
}

// 서버 실행 + 브라우저 열기 - 앱의 핵심 기능. 트레이 아이콘 등록 성공
// 여부와 상관없이 항상 먼저 끝내둔다. (한 번은 systray 라이브러리가 특정
// 환경에서 트레이 등록에 실패해 onReady()가 아예 호출되지 않는 걸 확인한
// 적이 있다 - 그 경우에도 최소한 "더블클릭하면 대시보드가 열린다"는
// 핵심 기능은 항상 보장되어야 한다. 트레이 아이콘/종료 메뉴는 그 위에
// 얹히는 부가 기능으로 다룬다.)
func ensureRunningAndOpen() {
	if !isServerUp() {
		if err := startServer(); err != nil {
			showMessageBox(fmt.Sprintf(
				"서버를 시작하지 못했습니다.\n\n%v\n\n설치 경로: %s\n\n프로그램을 다시 설치하거나, 이 경로에 파일이 있는지 확인해주세요.",
				err, installDir,
			), mbIconError)
			return
		}
		deadline := time.Now().Add(60 * time.Second)
		for time.Now().Before(deadline) && !isServerUp() {
			time.Sleep(500 * time.Millisecond)
		}
	}

	if isServerUp() {
		openBrowser(serverURL())
	} else {
		showMessageBox(
			"서버가 아직 준비되지 않았습니다. 설치 폴더의 server.log 파일에서 오류 메시지를 확인해주시거나, 잠시 후 아이콘을 다시 실행해보세요.",
			mbIconError,
		)
	}
}

func main() {
	if !acquireSingleInstance() {
		// 이미 실행 중 - 서버가 응답할 때까지 잠깐 기다렸다가 브라우저만 연다.
		for i := 0; i < 10 && !isServerUp(); i++ {
			time.Sleep(300 * time.Millisecond)
		}
		openBrowser(serverURL())
		return
	}

	ensureRunningAndOpen()

	// 트레이 아이콘(종료 메뉴 등)은 부가 기능이라 여기서부터 시작한다 -
	// 위에서 이미 서버 실행/브라우저 열기는 끝났으므로, 이 라이브러리가
	// 특정 환경에서 등록에 실패하더라도 앱의 핵심 기능에는 영향이 없다.
	systray.Run(onReady, onExit)
}

func onReady() {
	systray.SetIcon(iconBytes)
	systray.SetTitle("")
	systray.SetTooltip("안전보건 법령·고시 Monitoring")

	mOpen := systray.AddMenuItem("대시보드 열기", "브라우저에서 대시보드를 엽니다")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("종료", "프로그램을 종료합니다")

	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				if isServerUp() {
					openBrowser(serverURL())
				} else {
					showMessageBox("서버가 아직 응답하지 않습니다. 잠시 후 다시 시도해주세요.", mbIconInfo)
				}
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func onExit() {
	if serverCmd != nil && serverCmd.Process != nil {
		_ = serverCmd.Process.Kill()
	}
}
