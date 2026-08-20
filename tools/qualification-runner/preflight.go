package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

func commandPreflight(args []string) error {
	root, _, err := kitRootFromArgs(args)
	if err != nil {
		return err
	}
	report, err := preflight(root, true)
	if err != nil {
		return err
	}
	b, _ := json.MarshalIndent(report, "", "  ")
	fmt.Println(string(b))
	return nil
}

func preflight(root string, requireWindows bool) (Report, error) {
	rep := Report{FormatVersion: 1, RunnerVersion: runnerVersion, ProductVersion: productVersion, CreatedUTC: time.Now().UTC().Format(time.RFC3339), HostOS: runtime.GOOS, HostArch: runtime.GOARCH, Status: "FAIL", Checks: map[string]any{}}
	if requireWindows && runtime.GOOS != "windows" {
		return rep, errors.New("실기기 자격검증은 Windows x64에서만 실행할 수 있습니다")
	}
	if requireWindows && runtime.GOARCH != "amd64" {
		return rep, errors.New("현재 키트는 Windows x64만 지원합니다")
	}
	cfg, err := readConfig(filepath.Join(root, "seller-config.json"))
	if err != nil {
		return rep, err
	}
	if err := validateConfig(cfg); err != nil {
		return rep, err
	}
	rep.Checks["config"] = "PASS"
	manifest, err := readManifest(filepath.Join(root, "payload-manifest.json"))
	if err != nil {
		return rep, err
	}
	if manifest.RunnerVersion != runnerVersion || manifest.ProductVersion != productVersion {
		return rep, errors.New("payload manifest 버전이 runner와 일치하지 않습니다")
	}
	if err := verifyPayload(root, manifest); err != nil {
		return rep, err
	}
	rep.Checks["payloadIntegrity"] = "PASS"
	if requireWindows {
		upia := findUPIA()
		if upia == "" {
			return rep, errors.New("Adobe UPIA를 찾지 못했습니다. Creative Cloud Desktop을 설치하거나 복구하십시오")
		}
		prem := findPremiere()
		if prem == "" {
			return rep, errors.New("Adobe Premiere Pro 실행 파일을 찾지 못했습니다")
		}
		rep.Checks["upiaPath"] = upia
		rep.Checks["premierePath"] = prem
		if free, err := freeDiskBytes(root); err == nil {
			rep.Checks["freeDiskBytes"] = free
			if free < 6*1024*1024*1024 {
				return rep, errors.New("최소 6GB의 빈 디스크 공간이 필요합니다")
			}
		}
		installDir := filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "PremiereAIHarness")
		if _, err := os.Stat(installDir); err == nil {
			return rep, fmt.Errorf("기존 설치 폴더가 있습니다: %s. 먼저 cleanup을 실행하거나 기존 제품을 제거하십시오", installDir)
		}
	}
	rep.Status = "PASS"
	return rep, nil
}
