package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func regularFileFromEnv(name string) string {
	p := strings.TrimSpace(os.Getenv(name))
	if p == "" {
		return ""
	}
	p = filepath.Clean(p)
	if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
		return p
	}
	return ""
}

func findUPIA() string {
	if p := regularFileFromEnv("PAI_UPIA_PATH"); p != "" {
		return p
	}
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles"), "Common Files", "Adobe", "Adobe Desktop Common", "RemoteComponents", "UPI", "UnifiedPluginInstallerAgent", "UnifiedPluginInstallerAgent.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Common Files", "Adobe", "Adobe Desktop Common", "RemoteComponents", "UPI", "UnifiedPluginInstallerAgent", "UnifiedPluginInstallerAgent.exe"),
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
			return p
		}
	}
	return ""
}

func findPremiere() string {
	if p := regularFileFromEnv("PAI_PREMIERE_PATH"); p != "" {
		return p
	}
	roots := []string{filepath.Join(os.Getenv("ProgramFiles"), "Adobe")}
	var cands []string
	for _, root := range roots {
		matches, _ := filepath.Glob(filepath.Join(root, "Adobe Premiere Pro *", "Adobe Premiere Pro.exe"))
		cands = append(cands, matches...)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(cands)))
	for _, p := range cands {
		if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
			return p
		}
	}
	return ""
}

func installCCX(upia, ccx, pluginID string) error {
	if upia == "" {
		return errors.New("UPIA path is empty")
	}
	cmd := exec.Command(upia, "/install", ccx)
	cmd.SysProcAttr = hiddenProcessAttrs()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("CCX 설치 실패: %s", sanitizeError(string(out)))
	}
	list := exec.Command(upia, "/list", "all")
	list.SysProcAttr = hiddenProcessAttrs()
	b, _ := list.CombinedOutput()
	if !strings.Contains(strings.ToLower(string(b)), strings.ToLower(pluginID)) {
		return errors.New("UPIA 설치 후 plugin id를 확인하지 못했습니다")
	}
	return nil
}

func uninstallCCX(upia, pluginID string) error {
	if upia == "" || pluginID == "" {
		return nil
	}
	cmd := exec.Command(upia, "/remove", pluginID)
	cmd.SysProcAttr = hiddenProcessAttrs()
	out, err := cmd.CombinedOutput()
	if err != nil && !strings.Contains(strings.ToLower(string(out)), "not installed") {
		return fmt.Errorf("CCX 제거 실패: %s", sanitizeError(string(out)))
	}
	return nil
}

func startHelper(installDir, dataDir, runDir string) (ProcessRecord, error) {
	node := filepath.Join(installDir, "runtime", "node", "node.exe")
	entry := filepath.Join(installDir, "helper", "src", "server.js")
	logPath := filepath.Join(runDir, "companion.log")
	log, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return ProcessRecord{}, err
	}
	cmd := exec.Command(node, entry)
	cmd.Dir = filepath.Join(installDir, "helper")
	cmd.Stdout = log
	cmd.Stderr = log
	cmd.SysProcAttr = hiddenProcessAttrs()
	env := minimalEnv()
	env = append(env,
		"PAI_DATA_DIR="+dataDir,
		"PAI_FFMPEG_PATH="+filepath.Join(installDir, "runtime", "ffmpeg", "ffmpeg.exe"),
		"PAI_FFPROBE_PATH="+filepath.Join(installDir, "runtime", "ffmpeg", "ffprobe.exe"),
		"PAI_CODEX_PATH="+filepath.Join(installDir, "runtime", "codex.exe"),
	)
	cmd.Env = env
	if err := cmd.Start(); err != nil {
		_ = log.Close()
		return ProcessRecord{}, err
	}
	go func() { _ = cmd.Wait(); _ = log.Close() }()
	time.Sleep(2 * time.Second)
	if err := cmd.Process.Signal(os.Signal(nil)); err != nil {
		return ProcessRecord{}, errors.New("Companion이 시작 직후 종료되었습니다. companion.log를 확인하십시오")
	}
	return ProcessRecord{PID: cmd.Process.Pid, Executable: node, StartedUTC: time.Now().UTC().Format(time.RFC3339), Kind: "companion"}, nil
}

func launchPremiere(path string) error {
	cmd := exec.Command(path)
	cmd.SysProcAttr = hiddenProcessAttrs()
	return cmd.Start()
}

func minimalEnv() []string {
	keys := []string{"SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramFiles", "ProgramFiles(x86)", "PROGRAMDATA"}
	var out []string
	for _, k := range keys {
		if v := os.Getenv(k); v != "" {
			out = append(out, k+"="+v)
		}
	}
	return out
}
