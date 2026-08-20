package main

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

func commandSmoke(args []string) error {
	root, _, err := kitRootFromArgs(args)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	work, err := os.MkdirTemp(root, ".runner-smoke-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)

	cfg := Config{FormatVersion: 1}
	cfg.Seller = Seller{
		Name:       "CI Smoke Seller",
		Contact:    "ci-smoke@example.com",
		SupportURL: "https://example.com/support",
		PrivacyURL: "https://example.com/privacy",
		TermsURL:   "https://example.com/terms",
	}
	cfg.Qualification.LaunchPremiere = false
	configPath := filepath.Join(work, "seller-config.json")
	if err := writeJSONAtomic(configPath, cfg); err != nil {
		return fmt.Errorf("config write failed: %w", err)
	}
	roundTripConfig, err := readConfig(configPath)
	if err != nil {
		return fmt.Errorf("config read failed: %w", err)
	}
	if err := validateConfig(roundTripConfig); err != nil {
		return fmt.Errorf("config validation failed: %w", err)
	}

	payloadRoot := filepath.Join(work, "payloads")
	if err := os.MkdirAll(payloadRoot, 0700); err != nil {
		return err
	}
	nodeZip := filepath.Join(payloadRoot, "node.zip")
	ffmpegZip := filepath.Join(payloadRoot, "ffmpeg.zip")
	sourceZip := filepath.Join(payloadRoot, "source.zip")
	ccxPath := filepath.Join(payloadRoot, "studio.ccx")
	codexPath := filepath.Join(payloadRoot, "codex.exe")

	if err := writeSmokeZip(nodeZip, map[string][]byte{
		"node-v22/node.exe": []byte("MZ-smoke-node"),
	}); err != nil {
		return err
	}
	if err := writeSmokeZip(ffmpegZip, map[string][]byte{
		"ffmpeg/bin/ffmpeg.exe":  []byte("MZ-smoke-ffmpeg"),
		"ffmpeg/bin/ffprobe.exe": []byte("MZ-smoke-ffprobe"),
	}); err != nil {
		return err
	}
	if err := writeSmokeZip(sourceZip, map[string][]byte{
		"premiere-ai-harness/helper/src/server.js": []byte("console.log('smoke helper');\n"),
		"premiere-ai-harness/helper/package.json":  []byte("{\"name\":\"smoke-helper\",\"private\":true}\n"),
	}); err != nil {
		return err
	}
	manifestJSON, _ := json.Marshal(map[string]any{
		"manifestVersion": 5,
		"id":              "com.openeditharness.premiere-ai.smoke",
		"name":            "Premiere AI Harness Smoke",
		"version":         productVersion,
	})
	if err := writeSmokeZip(ccxPath, map[string][]byte{"manifest.json": manifestJSON}); err != nil {
		return err
	}
	if err := os.WriteFile(codexPath, []byte("MZ-smoke-codex"), 0600); err != nil {
		return err
	}

	manifest := PayloadManifest{
		FormatVersion:  1,
		RunnerVersion:  runnerVersion,
		ProductVersion: productVersion,
		CreatedUTC:     time.Now().UTC().Format(time.RFC3339),
	}
	for _, item := range []struct {
		path string
		role string
	}{
		{nodeZip, "node-runtime"},
		{ffmpegZip, "ffmpeg-runtime"},
		{sourceZip, "product-source"},
		{ccxPath, "studio-ccx"},
		{codexPath, "codex-runtime"},
	} {
		entry, err := smokePayloadEntry(work, item.path, item.role)
		if err != nil {
			return err
		}
		manifest.Files = append(manifest.Files, entry)
	}
	manifestPath := filepath.Join(work, "payload-manifest.json")
	if err := writeJSONAtomic(manifestPath, manifest); err != nil {
		return err
	}
	loadedManifest, err := readManifest(manifestPath)
	if err != nil {
		return err
	}
	if err := verifyPayload(work, loadedManifest); err != nil {
		return fmt.Errorf("payload verification failed: %w", err)
	}

	extractRoot := filepath.Join(work, "extracted")
	if err := safeUnzip(nodeZip, filepath.Join(extractRoot, "node")); err != nil {
		return err
	}
	if err := safeUnzip(ffmpegZip, filepath.Join(extractRoot, "ffmpeg")); err != nil {
		return err
	}
	if err := safeUnzip(sourceZip, filepath.Join(extractRoot, "source")); err != nil {
		return err
	}
	nodeExe := findFile(filepath.Join(extractRoot, "node"), "node.exe")
	ffmpegExe := findFile(filepath.Join(extractRoot, "ffmpeg"), "ffmpeg.exe")
	ffprobeExe := findFile(filepath.Join(extractRoot, "ffmpeg"), "ffprobe.exe")
	helperEntry := findSuffix(filepath.Join(extractRoot, "source"), filepath.FromSlash("helper/src/server.js"))
	if nodeExe == "" || ffmpegExe == "" || ffprobeExe == "" || helperEntry == "" {
		return errors.New("smoke extraction did not produce required runtime files")
	}
	pluginID, err := readPluginID(ccxPath)
	if err != nil {
		return fmt.Errorf("CCX parsing failed: %w", err)
	}
	if pluginID != "com.openeditharness.premiere-ai.smoke" {
		return fmt.Errorf("unexpected smoke plugin id: %s", pluginID)
	}

	installDir := filepath.Join(work, "install")
	dataDir := filepath.Join(work, "data")
	helperRoot := filepath.Dir(filepath.Dir(helperEntry))
	if err := copyDir(helperRoot, filepath.Join(installDir, "helper")); err != nil {
		return err
	}
	if err := copyDir(filepath.Dir(nodeExe), filepath.Join(installDir, "runtime", "node")); err != nil {
		return err
	}
	if err := copyDir(filepath.Dir(ffmpegExe), filepath.Join(installDir, "runtime", "ffmpeg")); err != nil {
		return err
	}
	if err := copyFile(codexPath, filepath.Join(installDir, "runtime", "codex.exe"), 0600); err != nil {
		return err
	}
	if err := createLaunchers(installDir, dataDir); err != nil {
		return err
	}
	for _, required := range []string{
		filepath.Join(installDir, "launch-companion.cmd"),
		filepath.Join(installDir, "run-helper-hidden.vbs"),
		filepath.Join(installDir, "helper", "src", "server.js"),
		filepath.Join(installDir, "runtime", "node", "node.exe"),
		filepath.Join(installDir, "runtime", "ffmpeg", "ffmpeg.exe"),
		filepath.Join(installDir, "runtime", "ffmpeg", "ffprobe.exe"),
		filepath.Join(installDir, "runtime", "codex.exe"),
	} {
		if st, err := os.Stat(required); err != nil || !st.Mode().IsRegular() {
			return fmt.Errorf("staging omitted required file: %s", required)
		}
	}

	evilZip := filepath.Join(work, "evil.zip")
	if err := writeSmokeZip(evilZip, map[string][]byte{"../escape.txt": []byte("escape")}); err != nil {
		return err
	}
	if err := safeUnzip(evilZip, filepath.Join(work, "evil-out")); err == nil {
		return errors.New("path-traversal ZIP was accepted")
	}
	if _, err := os.Stat(filepath.Join(work, "escape.txt")); !errors.Is(err, os.ErrNotExist) {
		return errors.New("path-traversal ZIP wrote outside extraction root")
	}

	fmt.Println("SMOKE PASS")
	return nil
}

func smokePayloadEntry(root, path, role string) (PayloadFile, error) {
	st, err := os.Stat(path)
	if err != nil {
		return PayloadFile{}, err
	}
	digest, err := fileSHA256(path)
	if err != nil {
		return PayloadFile{}, err
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return PayloadFile{}, err
	}
	return PayloadFile{
		Path:     filepath.ToSlash(rel),
		SHA256:   digest,
		Size:     st.Size(),
		Role:     role,
		Required: true,
	}, nil
}

func writeSmokeZip(path string, entries map[string][]byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(f)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			zw.Close()
			f.Close()
			return err
		}
		if _, err := w.Write(content); err != nil {
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
