// Package adapter builds native tool commands and reads their session metrics.
package adapter

import (
	"context"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"

	"automator/internal/config"
	"automator/internal/util"
)

// Command is an argv command, not a shell command. The caller sets the working
// directory to project and inherits its environment, adding Env if nonempty.
type Command struct {
	Program string
	Args    []string
	Env     []string
}

// ValidateModel checks the argument whitelist and pricing, just as the native
// adapter does. Values of allowed arguments are intentionally not type-checked:
// string options accept strings or booleans, and switches accept only booleans.
func ValidateModel(key string, model config.Model) error {
	var err error
	if p := model.Pricing; p != nil {
		for _, rate := range []struct {
			name  string
			value float64
		}{
			{"input_per_million", p.InputPerMillion},
			{"output_per_million", p.OutputPerMillion},
			{"cache_read_per_million", p.CacheReadPerMillion},
			{"cache_write_per_million", p.CacheWritePerMillion},
		} {
			if math.IsNaN(rate.value) || math.IsInf(rate.value, 0) || rate.value < 0 {
				err = fmt.Errorf("pricing.%s must be a finite non-negative number", rate.name)
				break
			}
		}
	}
	if err == nil {
		var allowed []string
		switch model.Tool {
		case config.Pi:
			allowed = []string{"thinking", "approve", "session_dir"}
		case config.Opencode:
			allowed = []string{"agent", "variant", "thinking", "format", "dangerously_skip_permissions"}
		case config.Claude:
			allowed = []string{"effort", "dangerously_skip_permissions"}
		default:
			err = fmt.Errorf("unsupported tool: %s", model.Tool)
		}
		if err == nil {
			keys := make([]string, 0, len(model.Args))
			for name := range model.Args {
				keys = append(keys, name)
			}
			sort.Strings(keys)
			for _, name := range keys {
				found := false
				for _, candidate := range allowed {
					if name == candidate {
						found = true
						break
					}
				}
				if !found {
					err = fmt.Errorf("unsupported tool arg: %s", name)
					break
				}
			}
		}
	}
	if err != nil && key != "" {
		return fmt.Errorf("model %s: %w", key, err)
	}
	return err
}

// BuildCommand reads promptPath for OpenCode and Claude; Pi receives @promptPath.
// It never invokes a tool or a shell. OpenCode's accepted format option remains
// unused to preserve the Rust command contract.
func BuildCommand(model config.Model, project, promptPath, title string) (Command, error) {
	if err := ValidateModel("", model); err != nil {
		return Command{}, err
	}
	var prompt string
	if model.Tool != config.Pi {
		path, err := nonCredentialPath(promptPath)
		if err != nil {
			return Command{}, fmt.Errorf("read prompt %s: %w", promptPath, err)
		}
		text, err := os.ReadFile(path)
		if err != nil {
			return Command{}, fmt.Errorf("read prompt %s: %w", promptPath, err)
		}
		prompt = string(text)
	}
	return BuildCommandWithPrompt(model, project, promptPath, prompt, title)
}

// BuildCommandWithPrompt builds validated structured argv without reading or
// creating any files, so dry-run previews can use the same builder as execution.
// Pi uses only promptPath; OpenCode and Claude use prompt exactly as supplied.
func BuildCommandWithPrompt(model config.Model, project, promptPath, prompt, title string) (Command, error) {
	if err := ValidateModel("", model); err != nil {
		return Command{}, err
	}
	var args []string
	switch model.Tool {
	case config.Pi:
		args = []string{"--print", "--provider", model.Provider, "--model", model.Model, "--name", title}
	case config.Opencode:
		args = []string{"run", "--model", model.Provider + "/" + model.Model, "--title", title, "--dir", project}
	case config.Claude:
		args = []string{"--print", "--model", model.Model, "--name", title}
	}
	args = appendModelArgs(args, model)
	if model.Tool == config.Pi {
		args = append(args, "@"+promptPath)
	} else {
		args = append(args, prompt)
	}
	return Command{Program: ToolBinary(model.Tool), Args: args}, nil
}

func ContinueCommand(model config.Model, project, sessionID, message string) (Command, error) {
	if err := ValidateModel("", model); err != nil {
		return Command{}, err
	}
	var args []string
	switch model.Tool {
	case config.Pi:
		return Command{}, fmt.Errorf("continue/nudge is not implemented for pi sessions yet")
	case config.Opencode:
		args = []string{"run", "--session", sessionID, "--model", model.Provider + "/" + model.Model, "--dir", project}
	case config.Claude:
		args = []string{"--print", "--resume", sessionID, "--model", model.Model}
	}
	args = append(appendModelArgs(args, model), message)
	return Command{Program: ToolBinary(model.Tool), Args: args}, nil
}

func appendModelArgs(args []string, model config.Model) []string {
	stringOption := func(name, flag string) {
		var value string
		switch v := model.Args[name].(type) {
		case string:
			value = v
		case bool:
			value = strconv.FormatBool(v)
		default:
			return
		}
		args = append(args, flag, value)
	}
	boolOption := func(name, flag string) {
		if value, _ := model.Args[name].(bool); value {
			args = append(args, flag)
		}
	}
	switch model.Tool {
	case config.Pi:
		stringOption("thinking", "--thinking")
		boolOption("approve", "--approve")
		stringOption("session_dir", "--session-dir")
	case config.Opencode:
		stringOption("agent", "--agent")
		stringOption("variant", "--variant")
		boolOption("thinking", "--thinking")
		boolOption("dangerously_skip_permissions", "--dangerously-skip-permissions")
	case config.Claude:
		stringOption("effort", "--effort")
		boolOption("dangerously_skip_permissions", "--dangerously-skip-permissions")
	}
	return args
}

func ReopenCommand(model config.Model, project, sessionID string) string {
	if sessionID == "" || strings.ContainsAny(sessionID, "\x00\n\r") {
		sessionID = "<session-id>"
	}
	flag := "--session"
	if model.Tool == config.Claude {
		flag = "--resume"
	}
	return "cd " + util.ShellQuote(project) + " && " + ToolBinary(model.Tool) + " " + flag + " " + util.ShellQuote(sessionID)
}

func ToolBinary(tool config.Tool) string {
	switch tool {
	case config.Pi:
		return "pi"
	case config.Opencode:
		return "opencode"
	case config.Claude:
		return "claude"
	default:
		return ""
	}
}

func ModelKeyDisplay(key string, model config.Model) string {
	return fmt.Sprintf("%s (%s/%s)", key, model.Provider, model.Model)
}

// InstalledVersion returns nil for an unavailable tool or unsuccessful command.
func InstalledVersion(ctx context.Context, tool config.Tool) *string {
	program := ToolBinary(tool)
	if program == "" || ctx.Err() != nil {
		return nil
	}
	version, err := util.CommandOutput(ctx, program, "--version")
	if err != nil {
		return nil
	}
	return ptr(strings.TrimSpace(version))
}
