package main

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

func safeUnzip(src, dst string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()
	if err := os.MkdirAll(dst, 0700); err != nil {
		return err
	}
	base, err := filepath.Abs(dst)
	if err != nil {
		return err
	}
	for _, f := range r.File {
		name := filepath.Clean(filepath.FromSlash(f.Name))
		if name == "." {
			continue
		}
		if filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, ".."+string(os.PathSeparator)) {
			return fmt.Errorf("zip path traversal: %s", f.Name)
		}
		target := filepath.Join(base, name)
		rel, err := filepath.Rel(base, target)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			return fmt.Errorf("zip path escape: %s", f.Name)
		}
		if f.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("zip symlink is not allowed: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
		if err != nil {
			rc.Close()
			return err
		}
		written, cpErr := io.Copy(out, io.LimitReader(rc, int64(f.UncompressedSize64)+1))
		closeErr := out.Close()
		rc.Close()
		if cpErr != nil {
			return cpErr
		}
		if closeErr != nil {
			return closeErr
		}
		if written != int64(f.UncompressedSize64) {
			return fmt.Errorf("zip entry size mismatch: %s", f.Name)
		}
	}
	return nil
}
func findFile(root, name string) string {
	var found string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() && strings.EqualFold(d.Name(), name) {
			found = path
			return fs.SkipAll
		}
		return nil
	})
	return found
}
func findSuffix(root, suffix string) string {
	suffix = filepath.Clean(suffix)
	var found string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			rel, _ := filepath.Rel(root, path)
			if strings.HasSuffix(strings.ToLower(filepath.Clean(rel)), strings.ToLower(suffix)) {
				found = path
				return fs.SkipAll
			}
		}
		return nil
	})
	return found
}
func copyFile(src, dst string, mode fs.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0700); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, e := io.Copy(out, in)
	c := out.Close()
	if e != nil {
		return e
	}
	return c
}
func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		return copyFile(path, target, info.Mode().Perm())
	})
}
func createLaunchers(installDir, dataDir string) error {
	node := filepath.Join(installDir, "runtime", "node", "node.exe")
	helper := filepath.Join(installDir, "helper", "src", "server.js")
	ffmpeg := filepath.Join(installDir, "runtime", "ffmpeg", "ffmpeg.exe")
	ffprobe := filepath.Join(installDir, "runtime", "ffmpeg", "ffprobe.exe")
	codex := filepath.Join(installDir, "runtime", "codex.exe")
	log := filepath.Join(dataDir, "logs", "companion-launch.log")
	cmd := fmt.Sprintf("@echo off\r\nsetlocal\r\nset PAI_DATA_DIR=%s\r\nset PAI_FFMPEG_PATH=%s\r\nset PAI_FFPROBE_PATH=%s\r\nset PAI_CODEX_PATH=%s\r\nif not exist \"%s\" exit /b 2\r\nstart \"\" /b \"%s\" \"%s\" 1>>\"%s\" 2>>&1\r\n", quoteEnv(dataDir), quoteEnv(ffmpeg), quoteEnv(ffprobe), quoteEnv(codex), node, node, helper, log)
	for _, name := range []string{"launch-companion.cmd", "start-helper.cmd", "start-companion.cmd"} {
		if err := os.WriteFile(filepath.Join(installDir, name), []byte(cmd), 0600); err != nil {
			return err
		}
	}
	vbs := fmt.Sprintf("Set s=CreateObject(\"WScript.Shell\")\r\ns.Run Chr(34) & \"%s\" & Chr(34),0,False\r\n", filepath.Join(installDir, "launch-companion.cmd"))
	for _, name := range []string{"run-helper-hidden.vbs", "start-helper-hidden.vbs"} {
		if err := os.WriteFile(filepath.Join(installDir, name), []byte(vbs), 0600); err != nil {
			return err
		}
	}
	return nil
}
func quoteEnv(s string) string { return strings.ReplaceAll(s, "%", "%%") }

func readPluginID(ccx string) (string, error) {
	r, err := zip.OpenReader(ccx)
	if err != nil {
		return "", err
	}
	defer r.Close()
	for _, f := range r.File {
		if strings.EqualFold(filepath.Base(f.Name), "manifest.json") {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			b, err := io.ReadAll(io.LimitReader(rc, 2<<20))
			rc.Close()
			if err != nil {
				return "", err
			}
			var m map[string]any
			if err := json.Unmarshal(b, &m); err != nil {
				return "", err
			}
			if id, ok := m["id"].(string); ok && strings.TrimSpace(id) != "" {
				return id, nil
			}
			if id, ok := m["manifestVersion"].(string); ok {
				_ = id
			}
			return "", errors.New("CCX manifest에 plugin id가 없습니다")
		}
	}
	return "", errors.New("CCX에 manifest.json이 없습니다")
}
