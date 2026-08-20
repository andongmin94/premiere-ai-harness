package main

const (
	runnerVersion  = "1.0.0"
	productVersion = "3.3.0"
	stateDirName   = "_state"
	runsDirName    = "_runs"
	resultsDirName = "results"
)

type PayloadFile struct {
	Path     string `json:"path"`
	SHA256   string `json:"sha256"`
	Size     int64  `json:"size"`
	Role     string `json:"role"`
	Required bool   `json:"required"`
}

type PayloadManifest struct {
	FormatVersion  int           `json:"formatVersion"`
	RunnerVersion  string        `json:"runnerVersion"`
	ProductVersion string        `json:"productVersion"`
	CreatedUTC     string        `json:"createdUtc"`
	Files          []PayloadFile `json:"files"`
}

type Seller struct {
	Name       string `json:"name"`
	Contact    string `json:"contact"`
	SupportURL string `json:"supportUrl"`
	PrivacyURL string `json:"privacyUrl"`
	TermsURL   string `json:"termsUrl"`
}

type Config struct {
	FormatVersion int    `json:"formatVersion"`
	Seller        Seller `json:"seller"`
	Qualification struct {
		KeepProductInstalled bool `json:"keepProductInstalled"`
		LaunchPremiere       bool `json:"launchPremiere"`
		PreserveAllEvidence  bool `json:"preserveAllEvidence"`
	} `json:"qualification"`
}

type ProcessRecord struct {
	PID        int    `json:"pid"`
	Executable string `json:"executable"`
	StartedUTC string `json:"startedUtc"`
	Kind       string `json:"kind"`
}

type State struct {
	FormatVersion   int             `json:"formatVersion"`
	RunnerVersion   string          `json:"runnerVersion"`
	ProductVersion  string          `json:"productVersion"`
	KitRoot         string          `json:"kitRoot"`
	RunID           string          `json:"runId"`
	RunDir          string          `json:"runDir"`
	InstallDir      string          `json:"installDir"`
	DataDir         string          `json:"dataDir"`
	PluginID        string          `json:"pluginId"`
	CCXPath         string          `json:"ccxPath"`
	UPIAPath        string          `json:"upiaPath"`
	PremierePath    string          `json:"premierePath"`
	CreatedPaths    []string        `json:"createdPaths"`
	Processes       []ProcessRecord `json:"processes"`
	PluginInstalled bool            `json:"pluginInstalled"`
	ProductStaged   bool            `json:"productStaged"`
	Completed       bool            `json:"completed"`
	CreatedUTC      string          `json:"createdUtc"`
	UpdatedUTC      string          `json:"updatedUtc"`
}

type Report struct {
	FormatVersion  int            `json:"formatVersion"`
	RunnerVersion  string         `json:"runnerVersion"`
	ProductVersion string         `json:"productVersion"`
	CreatedUTC     string         `json:"createdUtc"`
	HostOS         string         `json:"hostOs"`
	HostArch       string         `json:"hostArch"`
	Status         string         `json:"status"`
	Checks         map[string]any `json:"checks"`
	Notes          []string       `json:"notes"`
}
