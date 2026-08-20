//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

func freeDiskBytes(path string) (uint64, error) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	k := syscall.NewLazyDLL("kernel32.dll")
	proc := k.NewProc("GetDiskFreeSpaceExW")
	var free uint64
	r, _, e := proc.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&free)), 0, 0)
	if r == 0 {
		return 0, e
	}
	return free, nil
}
