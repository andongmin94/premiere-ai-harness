package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHostGateHelperProcess(t *testing.T) {
	if os.Getenv("PAI_HOST_GATE_HELPER") != "1" {
		return
	}
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	os.Exit(0)
}

func helperOptions(t *testing.T) options {
	t.Helper()
	root := t.TempDir()
	return options{
		Runner: os.Args[0],
		RunnerArgs: []string{"-test.run=TestHostGateHelperProcess", "--"},
		Kit: root,
		PassFile: filepath.Join(root, "pass.signal"),
		FailFile: filepath.Join(root, "fail.signal"),
		StdoutFile: filepath.Join(root, "stdout.txt"),
		StderrFile: filepath.Join(root, "stderr.txt"),
		Timeout: 10 * time.Second,
		Env: append(os.Environ(), "PAI_HOST_GATE_HELPER=1"),
	}
}

func TestRunGatePass(t *testing.T) {
	o := helperOptions(t)
	go func() {
		time.Sleep(400 * time.Millisecond)
		_ = os.WriteFile(o.PassFile, []byte("PASS\n"), 0600)
	}()
	if err := runGate(o); err != nil {
		t.Fatal(err)
	}
}

func TestRunGateFail(t *testing.T) {
	o := helperOptions(t)
	go func() {
		time.Sleep(400 * time.Millisecond)
		_ = os.WriteFile(o.FailFile, []byte("FAIL\n"), 0600)
	}()
	err := runGate(o)
	if err == nil || !strings.Contains(err.Error(), "marked") {
		t.Fatalf("expected operator failure, got %v", err)
	}
}

func TestValidateOptionsRejectsShortTimeout(t *testing.T) {
	o := helperOptions(t)
	o.Timeout = time.Second
	if err := validateOptions(o); err == nil {
		t.Fatal("expected timeout validation error")
	}
}
