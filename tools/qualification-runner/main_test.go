package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestValidateConfig(t *testing.T) {
	var c Config
	c.Seller.Name = "Seller"
	c.Seller.Contact = "support@example.com"
	c.Seller.SupportURL = "https://example.com/support"
	c.Seller.PrivacyURL = "https://example.com/privacy"
	c.Seller.TermsURL = "https://example.com/terms"
	if err := validateConfig(c); err != nil {
		t.Fatal(err)
	}
	c.Seller.PrivacyURL = "http://bad"
	if err := validateConfig(c); err == nil {
		t.Fatal("expected http rejection")
	}
}
func TestSafeUnzipRejectsTraversal(t *testing.T) {
	d := t.TempDir()
	z := filepath.Join(d, "x.zip")
	f, _ := os.Create(z)
	w := zip.NewWriter(f)
	e, _ := w.Create("../evil.txt")
	e.Write([]byte("x"))
	w.Close()
	f.Close()
	if err := safeUnzip(z, filepath.Join(d, "out")); err == nil {
		t.Fatal("expected traversal rejection")
	}
}
func TestOwnedPaths(t *testing.T) {
	root := t.TempDir()
	s := State{}
	if !isOwnedPath(root, filepath.Join(root, runsDirName, "x"), &s) {
		t.Fatal("owned run path rejected")
	}
	if isOwnedPath(root, filepath.Dir(root), &s) {
		t.Fatal("outside path accepted")
	}
}
