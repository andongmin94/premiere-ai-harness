package main

import (
	"bufio"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func commandConfig(args []string) error {
	root, _, err := kitRootFromArgs(args)
	if err != nil {
		return err
	}
	path := filepath.Join(root, "seller-config.json")
	r := bufio.NewReader(os.Stdin)
	fmt.Println("판매자 설정을 생성합니다. 기술 검증 단계에서는 URL을 Enter로 건너뛸 수 있습니다.")
	name := promptRequired(r, "판매자 또는 회사명")
	contact := promptRequired(r, "지원 이메일")
	support := promptOptional(r, "지원 페이지 URL (선택)")
	privacy := promptOptional(r, "개인정보처리방침 URL (선택)")
	terms := promptOptional(r, "이용약관 URL (선택)")
	cfg := Config{FormatVersion: 1, Seller: Seller{Name: name, Contact: contact, SupportURL: support, PrivacyURL: privacy, TermsURL: terms}}
	cfg.Qualification.LaunchPremiere = true
	if err := validateConfig(cfg); err != nil {
		return err
	}
	if err := writeJSONAtomic(path, cfg); err != nil {
		return err
	}
	fmt.Println("생성 완료:", path)
	return nil
}

func promptOptional(r *bufio.Reader, label string) string {
	fmt.Printf("%s: ", label)
	s, _ := r.ReadString('\n')
	return strings.TrimSpace(s)
}

func promptRequired(r *bufio.Reader, label string) string {
	for {
		fmt.Printf("%s: ", label)
		s, _ := r.ReadString('\n')
		s = strings.TrimSpace(s)
		if s != "" {
			return s
		}
		fmt.Println("빈 값은 사용할 수 없습니다.")
	}
}

func validateHTTPS(label, raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%s URL이 잘못되었습니다", label)
	}
	if u.Scheme != "https" || u.Host == "" {
		return fmt.Errorf("%s는 공개된 https:// URL이어야 합니다", label)
	}
	if u.User != nil || u.Fragment != "" {
		return fmt.Errorf("%s URL에 사용자정보나 fragment를 넣을 수 없습니다", label)
	}
	return nil
}

func validateConfig(c Config) error {
	if strings.TrimSpace(c.Seller.Name) == "" {
		return errors.New("seller.name이 비어 있습니다")
	}
	if !strings.Contains(c.Seller.Contact, "@") {
		return errors.New("seller.contact에 유효한 지원 이메일을 입력하십시오")
	}
	if err := validateHTTPS("supportUrl", c.Seller.SupportURL); err != nil {
		return err
	}
	if err := validateHTTPS("privacyUrl", c.Seller.PrivacyURL); err != nil {
		return err
	}
	if err := validateHTTPS("termsUrl", c.Seller.TermsURL); err != nil {
		return err
	}
	return nil
}
