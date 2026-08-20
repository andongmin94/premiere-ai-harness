package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	cmd := strings.ToLower(os.Args[1])
	var err error
	switch cmd {
	case "config":
		err = commandConfig(os.Args[2:])
	case "preflight":
		err = commandPreflight(os.Args[2:])
	case "qualify":
		err = commandQualify(os.Args[2:])
	case "collect":
		err = commandCollect(os.Args[2:])
	case "cleanup":
		err = commandCleanup(os.Args[2:])
	case "status":
		err = commandStatus(os.Args[2:])
	case "selftest":
		err = commandSelftest(os.Args[2:])
	case "version", "--version", "-v":
		fmt.Printf("Premiere AI Harness Qualification Runner %s (product %s)\n", runnerVersion, productVersion)
		return
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", sanitizeError(err.Error()))
		os.Exit(1)
	}
}

func usage() {
	fmt.Println("Premiere AI Harness Qualification Runner")
	fmt.Println("Commands: config, preflight, qualify, collect, cleanup, status, selftest")
}

func kitRootFromArgs(args []string) (string, []string, error) {
	fs := flag.NewFlagSet("common", flag.ContinueOnError)
	kit := fs.String("kit", "", "kit root")
	if err := fs.Parse(args); err != nil {
		return "", nil, err
	}
	root := strings.TrimSpace(*kit)
	if root == "" {
		exe, err := os.Executable()
		if err != nil {
			return "", nil, err
		}
		root = filepath.Dir(exe)
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return "", nil, err
	}
	return filepath.Clean(root), fs.Args(), nil
}
