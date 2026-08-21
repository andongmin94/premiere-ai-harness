package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type options struct {
	Runner     string
	RunnerArgs []string
	Kit        string
	PassFile   string
	FailFile   string
	StdoutFile string
	StderrFile string
	Timeout    time.Duration
	Env        []string
}

func main() {
	var o options
	flag.StringVar(&o.Runner, "runner", "", "qualification runner executable")
	flag.StringVar(&o.Kit, "kit", "", "offline qualification kit root")
	flag.StringVar(&o.PassFile, "pass", "", "PASS signal file")
	flag.StringVar(&o.FailFile, "fail", "", "FAIL signal file")
	flag.StringVar(&o.StdoutFile, "stdout", "", "child stdout log")
	flag.StringVar(&o.StderrFile, "stderr", "", "child stderr log")
	flag.DurationVar(&o.Timeout, "timeout", 90*time.Minute, "maximum wait time")
	flag.Parse()
	o.RunnerArgs = []string{"qualify", "-kit", o.Kit}
	o.Env = os.Environ()
	if err := validateOptions(o); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(2)
	}
	if err := runGate(o); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
	fmt.Println("HOST QUALIFICATION GATE PASS")
}

func validateOptions(o options) error {
	for label, value := range map[string]string{
		"runner": o.Runner,
		"kit": o.Kit,
		"pass": o.PassFile,
		"fail": o.FailFile,
		"stdout": o.StdoutFile,
		"stderr": o.StderrFile,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("-%s is required", label)
		}
	}
	if o.Timeout < time.Minute || o.Timeout > 3*time.Hour {
		return errors.New("timeout must be between 1 minute and 3 hours")
	}
	if st, err := os.Stat(o.Runner); err != nil || !st.Mode().IsRegular() {
		return fmt.Errorf("runner executable is not a regular file: %s", o.Runner)
	}
	if st, err := os.Stat(o.Kit); err != nil || !st.IsDir() {
		return fmt.Errorf("kit root is not a directory: %s", o.Kit)
	}
	return nil
}

func runGate(o options) error {
	for _, p := range []string{o.PassFile, o.FailFile} {
		_ = os.Remove(p)
	}
	if err := os.MkdirAll(filepath.Dir(o.StdoutFile), 0700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(o.StderrFile), 0700); err != nil {
		return err
	}
	stdout, err := os.OpenFile(o.StdoutFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer stdout.Close()
	stderr, err := os.OpenFile(o.StderrFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer stderr.Close()

	cmd := exec.Command(o.Runner, o.RunnerArgs...)
	cmd.Dir = o.Kit
	cmd.Env = o.Env
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	prepareChild(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}

	waitCh := make(chan error, 1)
	go func() { waitCh <- cmd.Wait() }()
	deadline := time.NewTimer(o.Timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case err := <-waitCh:
			if err == nil {
				return errors.New("qualification runner exited before PASS signal")
			}
			return fmt.Errorf("qualification runner exited before PASS signal: %w", err)
		case <-deadline.C:
			_ = killTree(cmd)
			return fmt.Errorf("timed out after %s waiting for operator result", o.Timeout)
		case <-ticker.C:
			if fileExists(o.FailFile) {
				_ = killTree(cmd)
				return errors.New("operator marked the Premiere host qualification as failed")
			}
			if !fileExists(o.PassFile) {
				continue
			}
			if _, err := io.WriteString(stdin, "\n"); err != nil {
				_ = killTree(cmd)
				return fmt.Errorf("failed to release qualification runner stdin: %w", err)
			}
			_ = stdin.Close()
			finish := time.NewTimer(5 * time.Minute)
			defer finish.Stop()
			select {
			case err := <-waitCh:
				if err != nil {
					return fmt.Errorf("qualification runner failed after PASS signal: %w", err)
				}
				return nil
			case <-finish.C:
				_ = killTree(cmd)
				return errors.New("qualification runner did not finish within 5 minutes after PASS signal")
			}
		}
	}
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.Mode().IsRegular()
}
