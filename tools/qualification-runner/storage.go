package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func readConfig(path string) (Config, error) {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		return c, fmt.Errorf("seller-config.json을 찾지 못했습니다. 01-CREATE-CONFIG.cmd를 먼저 실행하십시오")
	}
	if err := json.Unmarshal(stripUTF8BOM(b), &c); err != nil {
		return c, fmt.Errorf("seller-config.json JSON 문법 오류: %w", err)
	}
	return c, nil
}
func readManifest(path string) (PayloadManifest, error) {
	var m PayloadManifest
	b, err := os.ReadFile(path)
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(stripUTF8BOM(b), &m); err != nil {
		return m, err
	}
	if len(m.Files) == 0 {
		return m, errors.New("payload manifest가 비어 있습니다")
	}
	return m, nil
}
func stripUTF8BOM(b []byte) []byte { return bytes.TrimPrefix(b, []byte{0xEF, 0xBB, 0xBF}) }
func verifyPayload(root string, m PayloadManifest) error {
	seen := map[string]bool{}
	for _, f := range m.Files {
		if f.Path == "" || f.SHA256 == "" {
			return errors.New("payload manifest entry가 불완전합니다")
		}
		clean := filepath.Clean(filepath.FromSlash(f.Path))
		if filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
			return errors.New("payload manifest 경로 탈출이 감지되었습니다")
		}
		if seen[strings.ToLower(clean)] {
			return errors.New("payload manifest 중복 경로")
		}
		seen[strings.ToLower(clean)] = true
		p := filepath.Join(root, clean)
		st, err := os.Stat(p)
		if err != nil {
			if f.Required {
				return fmt.Errorf("필수 payload 누락: %s", f.Path)
			}
			continue
		}
		if !st.Mode().IsRegular() {
			return fmt.Errorf("payload가 일반 파일이 아닙니다: %s", f.Path)
		}
		if st.Size() != f.Size {
			return fmt.Errorf("payload 크기 불일치: %s", f.Path)
		}
		h, err := fileSHA256(p)
		if err != nil {
			return err
		}
		if !strings.EqualFold(h, f.SHA256) {
			return fmt.Errorf("payload SHA-256 불일치: %s", f.Path)
		}
	}
	return nil
}
func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func writeJSONAtomic(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
func saveState(root string, s State) error {
	s.UpdatedUTC = time.Now().UTC().Format(time.RFC3339)
	return writeJSONAtomic(filepath.Join(root, stateDirName, "state.json"), s)
}
func loadState(root string) (State, error) {
	var s State
	b, err := os.ReadFile(filepath.Join(root, stateDirName, "state.json"))
	if err != nil {
		return s, errors.New("실행 상태가 없습니다")
	}
	err = json.Unmarshal(b, &s)
	return s, err
}
func appendRunLog(dir, msg string) error {
	f, err := os.OpenFile(filepath.Join(dir, "runner.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = fmt.Fprintf(f, "%s %s\n", time.Now().UTC().Format(time.RFC3339), msg)
	return err
}
