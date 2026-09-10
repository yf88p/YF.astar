// Package config defines Automator's on-disk configuration and run schemas.
package config

type AppConfig struct {
	SchemaVersion      uint32 `yaml:"schema_version" json:"schema_version"`
	DefaultConcurrency int    `yaml:"default_concurrency" json:"default_concurrency"`
}

type ProvidersFile struct {
	SchemaVersion uint32              `yaml:"schema_version" json:"schema_version"`
	Providers     map[string]Provider `yaml:"providers" json:"providers"`
}

type Provider struct {
	DisplayName string `yaml:"display_name" json:"display_name"`
	Auth        string `yaml:"auth" json:"auth"`
}

type ModelsFile struct {
	SchemaVersion uint32           `yaml:"schema_version" json:"schema_version"`
	Models        map[string]Model `yaml:"models" json:"models"`
}

type Model struct {
	DisplayName string         `yaml:"display_name" json:"display_name"`
	Tool        Tool           `yaml:"tool" json:"tool"`
	Provider    string         `yaml:"provider" json:"provider"`
	Model       string         `yaml:"model" json:"model"`
	Pricing     *ModelPricing  `yaml:"pricing" json:"pricing"`
	Args        map[string]any `yaml:"args" json:"args"`
}

type ModelPricing struct {
	InputPerMillion      float64 `yaml:"input_per_million" json:"input_per_million"`
	OutputPerMillion     float64 `yaml:"output_per_million" json:"output_per_million"`
	CacheReadPerMillion  float64 `yaml:"cache_read_per_million" json:"cache_read_per_million"`
	CacheWritePerMillion float64 `yaml:"cache_write_per_million" json:"cache_write_per_million"`
}

type ModelPresetsFile struct {
	SchemaVersion uint32                 `yaml:"schema_version" json:"schema_version"`
	Presets       map[string]ModelPreset `yaml:"presets" json:"presets"`
}

type ModelPreset struct {
	DisplayName string   `yaml:"display_name" json:"display_name"`
	Models      []string `yaml:"models" json:"models"`
}

type ModelSelection struct {
	Models   []string
	Presets  []string
	RunHeavy bool
}

type Tool string

const (
	Pi       Tool = "pi"
	Opencode Tool = "opencode"
	Claude   Tool = "claude"
)

type TemplatesFile struct {
	SchemaVersion uint32              `yaml:"schema_version" json:"schema_version"`
	Templates     map[string]Template `yaml:"templates" json:"templates"`
}

type Template struct {
	DisplayName string      `yaml:"display_name" json:"display_name"`
	Steps       []ShellStep `yaml:"steps" json:"steps"`
}

type ShellStep struct {
	Shell string `yaml:"shell" json:"shell"`
}

type DraftRun struct {
	SchemaVersion uint32      `yaml:"schema_version" json:"schema_version"`
	Name          string      `yaml:"name" json:"name"`
	Root          string      `yaml:"root" json:"root"`
	Concurrency   int         `yaml:"concurrency" json:"concurrency"`
	Mode          RunMode     `yaml:"mode" json:"mode"`
	Template      string      `yaml:"template" json:"template"`
	Heavy         bool        `yaml:"heavy" json:"heavy"`
	Prompt        string      `yaml:"prompt" json:"prompt"`
	Pre           []ShellStep `yaml:"pre" json:"pre"`
	PostEach      []ShellStep `yaml:"post_each" json:"post_each"`
	PostAll       []ShellStep `yaml:"post_all" json:"post_all"`
}

type RunMode string

const (
	Headful  RunMode = "headful"
	Headless RunMode = "headless"
)

type RunsIndex struct {
	SchemaVersion uint32          `yaml:"schema_version" json:"schema_version"`
	Runs          []RunIndexEntry `yaml:"runs" json:"runs"`
}

type RunIndexEntry struct {
	Name      string  `yaml:"name" json:"name"`
	Path      string  `yaml:"path" json:"path"`
	StartedAt string  `yaml:"started_at" json:"started_at"`
	Mode      RunMode `yaml:"mode" json:"mode"`
}

type RunSnapshot struct {
	SchemaVersion       uint32           `yaml:"schema_version" json:"schema_version"`
	Name                string           `yaml:"name" json:"name"`
	Root                string           `yaml:"root" json:"root"`
	RunDir              string           `yaml:"run_dir" json:"run_dir"`
	TmuxSession         string           `yaml:"tmux_session" json:"tmux_session"`
	HerdrSession        string           `yaml:"herdr_session" json:"herdr_session"`
	HerdrWorkspaceLabel string           `yaml:"herdr_workspace_label" json:"herdr_workspace_label"`
	HerdrWorkspaceID    *string          `yaml:"herdr_workspace_id" json:"herdr_workspace_id"`
	HerdrRootTabID      *string          `yaml:"herdr_root_tab_id" json:"herdr_root_tab_id"`
	HerdrRootPaneID     *string          `yaml:"herdr_root_pane_id" json:"herdr_root_pane_id"`
	Concurrency         int              `yaml:"concurrency" json:"concurrency"`
	Mode                RunMode          `yaml:"mode" json:"mode"`
	Template            Template         `yaml:"template" json:"template"`
	TemplateKey         string           `yaml:"template_key" json:"template_key"`
	Models              map[string]Model `yaml:"models" json:"models"`
	Heavy               bool             `yaml:"heavy" json:"heavy"`
	Prompt              string           `yaml:"prompt" json:"prompt"`
	Pre                 []ShellStep      `yaml:"pre" json:"pre"`
	PostEach            []ShellStep      `yaml:"post_each" json:"post_each"`
	PostAll             []ShellStep      `yaml:"post_all" json:"post_all"`
}
