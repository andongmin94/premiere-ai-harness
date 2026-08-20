//go:build !windows

package main

func freeDiskBytes(path string) (uint64, error) { return ^uint64(0), nil }
