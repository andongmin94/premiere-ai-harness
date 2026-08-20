package main

import "testing"

func TestTechnicalQualificationAllowsUnpublishedLegalURLs(t *testing.T) {
	cfg := Config{FormatVersion: 1, Seller: Seller{Name: "Test Seller", Contact: "support@example.com"}}
	if err := validateConfig(cfg); err != nil {
		t.Fatalf("technical qualification should allow empty publication URLs: %v", err)
	}
}

func TestConfigRejectsNonHTTPSPublicationURLs(t *testing.T) {
	cfg := Config{FormatVersion: 1, Seller: Seller{
		Name: "Test Seller", Contact: "support@example.com",
		SupportURL: "http://example.com/support",
	}}
	if err := validateConfig(cfg); err == nil {
		t.Fatal("expected non-HTTPS publication URL to be rejected")
	}
}
