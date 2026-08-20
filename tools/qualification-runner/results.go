package main

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

func collectResult(root string, st State) error {
	resDir := filepath.Join(root, resultsDirName)
	if err := os.MkdirAll(resDir, 0700); err != nil {
		return err
	}
	stamp := time.Now().Format("20060102-150405")
	out := filepath.Join(resDir, "PremiereAIHarness-Qualification-Result-"+stamp+".zip")
	files := map[string]string{}
	for _, p := range []string{filepath.Join(st.RunDir, "preflight-result.json"), filepath.Join(st.RunDir, "runner.log"), filepath.Join(st.RunDir, "companion.log"), filepath.Join(st.RunDir, "NEXT-STEPS-KO.txt"), filepath.Join(root, stateDirName, "state.json")} {
		if info, err := os.Stat(p); err == nil && info.Mode().IsRegular() {
			files[filepath.Base(p)] = p
		}
	}
	for _, base := range []string{st.DataDir, filepath.Join(st.DataDir, "logs"), filepath.Join(st.DataDir, "reports")} {
		_ = filepath.WalkDir(base, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			info, e := d.Info()
			if e == nil && info.Size() <= 10<<20 {
				rel, _ := filepath.Rel(st.DataDir, path)
				files[filepath.Join("product-data", rel)] = path
			}
			return nil
		})
	}
	rep := Report{FormatVersion: 1, RunnerVersion: runnerVersion, ProductVersion: productVersion, CreatedUTC: time.Now().UTC().Format(time.RFC3339), HostOS: runtime.GOOS, HostArch: runtime.GOARCH, Status: "COLLECTED", Checks: map[string]any{"pluginInstalled": st.PluginInstalled, "productStaged": st.ProductStaged, "completed": st.Completed}, Notes: []string{"실제 Premiere 작업 성공 여부는 product-data와 수동 증거를 함께 검토해야 합니다."}}
	repPath := filepath.Join(st.RunDir, "qualification-summary.json")
	if err := writeJSONAtomic(repPath, rep); err != nil {
		return err
	}
	files["qualification-summary.json"] = repPath
	if err := zipFiles(out, files); err != nil {
		return err
	}
	fmt.Println("결과:", out)
	return nil
}
func zipFiles(out string, files map[string]string) error {
	f, err := os.Create(out)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(f)
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		src := files[name]
		in, err := os.Open(src)
		if err != nil {
			zw.Close()
			f.Close()
			return err
		}
		hdr := &zip.FileHeader{Name: filepath.ToSlash(name), Method: zip.Deflate}
		hdr.SetModTime(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC))
		w, err := zw.CreateHeader(hdr)
		if err == nil {
			_, err = io.Copy(w, in)
		}
		in.Close()
		if err != nil {
			zw.Close()
			f.Close()
			return err
		}
	}
	if err := zw.Close(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func bestEffortCleanup(root string, st *State, removeAll bool) error {
	var errs []string
	for _, p := range st.Processes {
		if p.PID > 0 {
			if err := terminateRecordedProcess(p); err != nil {
				errs = append(errs, err.Error())
			}
		}
	}
	if st.PluginInstalled {
		if err := uninstallCCX(st.UPIAPath, st.PluginID); err != nil {
			errs = append(errs, err.Error())
		}
	}
	targets := []string{st.InstallDir, st.DataDir}
	if removeAll {
		targets = append(targets, filepath.Join(root, runsDirName), filepath.Join(root, stateDirName))
	}
	for _, p := range targets {
		if p == "" {
			continue
		}
		if !isOwnedPath(root, p, st) {
			errs = append(errs, "삭제 거부(소유 경계 밖): "+p)
			continue
		}
		if err := os.RemoveAll(p); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	fmt.Println("Premiere AI Harness 자격검증 관련 항목 정리 완료.")
	return nil
}
func conservativeCleanup(root string) error {
	for _, p := range []string{filepath.Join(root, runsDirName), filepath.Join(root, stateDirName)} {
		_ = os.RemoveAll(p)
	}
	fmt.Println("상태 파일이 없어 키트 내부 작업 폴더만 정리했습니다.")
	return nil
}
func isOwnedPath(root, p string, st *State) bool {
	a, _ := filepath.Abs(p)
	allowed := []string{filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "PremiereAIHarness"), filepath.Join(os.Getenv("LOCALAPPDATA"), "PremiereAIHarness"), filepath.Join(root, runsDirName), filepath.Join(root, stateDirName)}
	for _, x := range allowed {
		b, _ := filepath.Abs(x)
		if strings.EqualFold(a, b) || strings.HasPrefix(strings.ToLower(a), strings.ToLower(b)+string(os.PathSeparator)) {
			return true
		}
	}
	return false
}
func terminateRecordedProcess(p ProcessRecord) error {
	if runtime.GOOS != "windows" {
		return nil
	}
	if p.PID <= 0 {
		return nil
	}
	cmd := exec.Command("taskkill", "/PID", strconv.Itoa(p.PID), "/T", "/F")
	cmd.SysProcAttr = hiddenProcessAttrs()
	out, err := cmd.CombinedOutput()
	if err != nil && !strings.Contains(strings.ToLower(string(out)), "not found") {
		return fmt.Errorf("프로세스 종료 실패 PID %d: %s", p.PID, sanitizeError(string(out)))
	}
	return nil
}
func sanitizeError(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 800 {
		s = s[:800] + "..."
	}
	return strings.TrimSpace(s)
}
