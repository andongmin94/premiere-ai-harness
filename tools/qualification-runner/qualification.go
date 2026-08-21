package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

func commandQualify(args []string) error {
	root, _, err := kitRootFromArgs(args)
	if err != nil {
		return err
	}
	rep, err := preflight(root, true)
	if err != nil {
		return err
	}
	fmt.Println("PRECHECK PASS")
	runID := time.Now().Format("20060102-150405")
	runDir := filepath.Join(root, runsDirName, runID)
	installDir := filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "PremiereAIHarness")
	dataDir := filepath.Join(os.Getenv("LOCALAPPDATA"), "PremiereAIHarness")
	st := State{FormatVersion: 1, RunnerVersion: runnerVersion, ProductVersion: productVersion, KitRoot: root, RunID: runID, RunDir: runDir, InstallDir: installDir, DataDir: dataDir, CreatedUTC: time.Now().UTC().Format(time.RFC3339), UpdatedUTC: time.Now().UTC().Format(time.RFC3339)}
	if err := os.MkdirAll(runDir, 0700); err != nil {
		return err
	}
	st.CreatedPaths = append(st.CreatedPaths, runDir)
	if err := saveState(root, st); err != nil {
		return err
	}
	fail := func(e error) error {
		_ = appendRunLog(runDir, "FAILED: "+sanitizeError(e.Error()))
		_ = bestEffortCleanup(root, &st, false)
		return e
	}
	manifest, err := readManifest(filepath.Join(root, "payload-manifest.json"))
	if err != nil {
		return fail(err)
	}
	payloadByRole := map[string]string{}
	for _, f := range manifest.Files {
		payloadByRole[f.Role] = filepath.Join(root, filepath.FromSlash(f.Path))
	}
	nodeZip := payloadByRole["node-runtime"]
	ffmpegZip := payloadByRole["ffmpeg-runtime"]
	sourceZip := payloadByRole["product-source"]
	ccx := payloadByRole["studio-ccx"]
	codex := payloadByRole["codex-runtime"]
	runtimeDir := filepath.Join(runDir, "runtime")
	sourceDir := filepath.Join(runDir, "source")
	if err := safeUnzip(nodeZip, filepath.Join(runtimeDir, "node")); err != nil {
		return fail(fmt.Errorf("Node runtime 압축 해제 실패: %w", err))
	}
	if err := safeUnzip(ffmpegZip, filepath.Join(runtimeDir, "ffmpeg")); err != nil {
		return fail(fmt.Errorf("FFmpeg runtime 압축 해제 실패: %w", err))
	}
	if err := safeUnzip(sourceZip, sourceDir); err != nil {
		return fail(fmt.Errorf("제품 소스 압축 해제 실패: %w", err))
	}
	nodeExe := findFile(runtimeDir, "node.exe")
	ffmpegExe := findFile(runtimeDir, "ffmpeg.exe")
	ffprobeExe := findFile(runtimeDir, "ffprobe.exe")
	helperEntry := findSuffix(sourceDir, filepath.FromSlash("helper/src/server.js"))
	helperRoot := ""
	if helperEntry != "" {
		helperRoot = filepath.Dir(filepath.Dir(helperEntry))
	}
	for label, p := range map[string]string{"node.exe": nodeExe, "ffmpeg.exe": ffmpegExe, "ffprobe.exe": ffprobeExe, "helper/src/server.js": helperEntry} {
		if p == "" {
			return fail(fmt.Errorf("필수 파일을 찾지 못했습니다: %s", label))
		}
	}
	if err := os.MkdirAll(installDir, 0700); err != nil {
		return fail(err)
	}
	st.CreatedPaths = append(st.CreatedPaths, installDir)
	if err := copyDir(helperRoot, filepath.Join(installDir, "helper")); err != nil {
		return fail(err)
	}
	if err := copyDir(filepath.Dir(nodeExe), filepath.Join(installDir, "runtime", "node")); err != nil {
		return fail(err)
	}
	if err := copyDir(filepath.Dir(ffmpegExe), filepath.Join(installDir, "runtime", "ffmpeg")); err != nil {
		return fail(err)
	}
	if codex != "" {
		if err := copyFile(codex, filepath.Join(installDir, "runtime", "codex.exe"), 0755); err != nil {
			return fail(err)
		}
	}
	if err := createLaunchers(installDir, dataDir); err != nil {
		return fail(err)
	}
	st.ProductStaged = true
	st.CCXPath = ccx
	st.UPIAPath = findUPIA()
	st.PremierePath = findPremiere()
	pluginID, err := readPluginID(ccx)
	if err != nil {
		return fail(err)
	}
	st.PluginID = pluginID
	if err := saveState(root, st); err != nil {
		return fail(err)
	}
	if err := installCCX(st.UPIAPath, ccx, pluginID); err != nil {
		return fail(err)
	}
	st.PluginInstalled = true
	if err := saveState(root, st); err != nil {
		return fail(err)
	}
	proc, err := startHelper(installDir, dataDir, runDir)
	if err != nil {
		return fail(err)
	}
	st.Processes = append(st.Processes, proc)
	if err := saveState(root, st); err != nil {
		return fail(err)
	}
	if cfg, _ := readConfig(filepath.Join(root, "seller-config.json")); cfg.Qualification.LaunchPremiere {
		if err := launchPremiere(st.PremierePath); err != nil {
			return fail(err)
		}
	}
	rep.Checks["pluginId"] = pluginID
	rep.Checks["stagedInstallDir"] = installDir
	rep.Checks["runDir"] = runDir
	rep.Status = "WAITING_FOR_PREMIERE_TEST"
	if err := writeJSONAtomic(filepath.Join(runDir, "preflight-result.json"), rep); err != nil {
		return fail(err)
	}

	if os.Getenv("PAI_NONINTERACTIVE") == "1" {
		st.Completed = true
		st.UpdatedUTC = time.Now().UTC().Format(time.RFC3339)
		if err := saveState(root, st); err != nil {
			return fail(err)
		}
		if err := collectResult(root, st); err != nil {
			return fail(err)
		}
		fmt.Println("PRE-PREMIERE QUALIFICATION PASS")
		return nil
	}

	instructions := `Premiere가 열리면 다음을 수행하십시오:
1. Window > UXP Plugins > Premiere AI Harness Studio
2. Host certification 실행
3. Local provider self-test 실행
4. 실제 테스트 프로젝트에서 멀티캠/B-roll/MOGRT/믹싱/내보내기/렌더 QA 실행
5. 저장 후 Premiere를 종료하고 다시 열어 결과 확인
6. 이 창으로 돌아와 Enter를 누르십시오.

실패하거나 중단하려면 창을 닫은 뒤 04-CLEANUP.cmd를 실행하십시오.
`
	fmt.Println(instructions)
	_ = os.WriteFile(filepath.Join(runDir, "NEXT-STEPS-KO.txt"), []byte(instructions), 0600)
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	st.Completed = true
	st.UpdatedUTC = time.Now().UTC().Format(time.RFC3339)
	if err := saveState(root, st); err != nil {
		return err
	}
	if err := collectResult(root, st); err != nil {
		return err
	}
	fmt.Println("결과 수집 완료. results 폴더를 확인하십시오.")
	return nil
}

func commandCollect(args []string) error {
	root, _, err := kitRootFromArgs(args)
	if err != nil {
		return err
	}
	st, err := loadState(root)
	if err != nil {
		return err
	}
	return collectResult(root, st)
}

func commandCleanup(args []string) error {
	root, _, err := kitRootFromArgs(args)
	if err != nil {
		return err
	}
	st, err := loadState(root)
	if err != nil {
		return conservativeCleanup(root)
	}
	return bestEffortCleanup(root, &st, true)
}

func commandStatus(args []string) error {
	root, _, err := kitRootFromArgs(args)
	if err != nil {
		return err
	}
	st, err := loadState(root)
	if err != nil {
		return err
	}
	b, _ := json.MarshalIndent(st, "", "  ")
	fmt.Println(string(b))
	return nil
}

func commandSelftest(args []string) error {
	root, _, err := kitRootFromArgs(args)
	if err != nil {
		return err
	}
	manifest, err := readManifest(filepath.Join(root, "payload-manifest.json"))
	if err != nil {
		return err
	}
	if err := verifyPayload(root, manifest); err != nil {
		return err
	}
	tmp, err := os.MkdirTemp("", "pai-qf-selftest-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	roles := map[string]string{}
	for _, f := range manifest.Files {
		roles[f.Role] = filepath.Join(root, filepath.FromSlash(f.Path))
	}
	for _, role := range []string{"node-runtime", "ffmpeg-runtime", "product-source"} {
		if err := safeUnzip(roles[role], filepath.Join(tmp, role)); err != nil {
			return fmt.Errorf("%s extraction failed: %w", role, err)
		}
	}
	if findFile(filepath.Join(tmp, "node-runtime"), "node.exe") == "" {
		return errors.New("bundled Node archive has no node.exe")
	}
	if findFile(filepath.Join(tmp, "ffmpeg-runtime"), "ffmpeg.exe") == "" || findFile(filepath.Join(tmp, "ffmpeg-runtime"), "ffprobe.exe") == "" {
		return errors.New("bundled FFmpeg archive has no ffmpeg.exe/ffprobe.exe")
	}
	if findSuffix(filepath.Join(tmp, "product-source"), filepath.FromSlash("helper/src/server.js")) == "" {
		return errors.New("product source has no helper/src/server.js")
	}
	if _, err := readPluginID(roles["studio-ccx"]); err != nil {
		return err
	}
	fmt.Println("SELFTEST PASS")
	return nil
}
