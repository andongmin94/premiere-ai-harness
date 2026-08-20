package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCommandSmoke(t *testing.T) {
	root := t.TempDir()
	if err := commandSmoke([]string{"-kit", root}); err != nil {
		t.Fatal(err)
	}
	matches, err := filepath.Glob(filepath.Join(root, ".runner-smoke-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("smoke temp directories were not removed: %v", matches)
	}
}

func TestSmokePayloadEntryUsesRelativePath(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "payloads", "x.bin")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("payload"), 0600); err != nil {
		t.Fatal(err)
	}
	entry, err := smokePayloadEntry(root, path, "test-role")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Path != "payloads/x.bin" {
		t.Fatalf("unexpected relative path: %s", entry.Path)
	}
	if entry.Role != "test-role" || !entry.Required || entry.Size != 7 || entry.SHA256 == "" {
		t.Fatalf("unexpected payload entry: %+v", entry)
	}
}
