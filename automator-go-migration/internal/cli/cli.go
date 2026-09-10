// Package cli defines the public command surface and the background worker protocol.
package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"automator/internal/config"
	"automator/internal/executor"
	"automator/internal/report"
	"automator/internal/tui"
	"automator/internal/util"
	"automator/internal/worker"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

const Version = "0.1.0"

// Execute distinguishes usage errors (2), operational errors (1), and
// cancellation (130). A failed model is isolated by the run executor itself.
func Execute(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	for _, arg := range args {
		if arg == "--" {
			break
		}
		for _, flag := range []string{"--force", "--run-heavy", "--version", "--help"} {
			if strings.HasPrefix(arg, flag+"=") {
				fmt.Fprintf(stderr, "Error: %s does not take a value\n", flag)
				return 2
			}
		}
	}
	command := NewCommand()
	command.SetArgs(args)
	command.SetOut(stdout)
	command.SetErr(stderr)
	started := false
	var wrap func(*cobra.Command)
	wrap = func(cmd *cobra.Command) {
		if run := cmd.RunE; run != nil {
			cmd.RunE = func(cmd *cobra.Command, args []string) error {
				started = true
				return run(cmd, args)
			}
		}
		for _, child := range cmd.Commands() {
			wrap(child)
		}
	}
	wrap(command)
	err := command.ExecuteContext(ctx)
	if err == nil {
		return 0
	}
	if errors.Is(err, context.Canceled) || ctx.Err() != nil {
		fmt.Fprintln(stderr, "Error: cancelled")
		return 130
	}
	fmt.Fprintln(stderr, "Error:", util.RedactSecrets(err.Error()))
	if !started {
		fmt.Fprintln(stderr, "For more information, try '--help'.")
		return 2
	}
	return 1
}

// NewCommand constructs an independent command tree for each invocation.
func NewCommand() *cobra.Command {
	root := &cobra.Command{
		Use: "automator", Short: "Run coding-agent model comparison benchmarks", Version: Version,
		SilenceUsage: true, SilenceErrors: true, Args: cobra.NoArgs,
		RunE:              func(cmd *cobra.Command, _ []string) error { return tui.Run(cmd.Context()) },
		CompletionOptions: cobra.CompletionOptions{DisableDefaultCmd: true},
	}
	root.SetVersionTemplate("automator {{.Version}}\n")
	root.Flags().BoolP("version", "V", false, "Print version")
	root.SetHelpCommand(&cobra.Command{Use: "help [command]", Short: "Print this message or the help of the given subcommand(s)", RunE: func(cmd *cobra.Command, args []string) error {
		target, remaining, err := root.Find(args)
		if err != nil {
			return err
		}
		if len(remaining) > 0 {
			return fmt.Errorf("unknown command %q", strings.Join(remaining, " "))
		}
		return target.Help()
	}})
	root.AddCommand(&cobra.Command{Use: "tui", Short: "Open the terminal dashboard (default command)", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return tui.Run(cmd.Context()) }})
	for _, verb := range []string{"run", "validate"} {
		selection := config.ModelSelection{}
		description := "Execute latest draft version"
		if verb == "validate" {
			description = "Dry-run validation for latest draft version"
		}
		cmd := &cobra.Command{Use: verb + " <draft-name>", Short: description, Args: cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				if verb == "run" {
					return executor.RunDraft(cmd.Context(), args[0], selection)
				}
				out, err := executor.ValidateDraft(cmd.Context(), args[0], selection)
				if err == nil {
					fmt.Fprintln(cmd.OutOrStdout(), out)
				}
				return err
			}}
		cmd.Flags().VarP((*selectionValues)(&selection.Models), "model", "m", "Model key(s); repeat or comma-separate")
		cmd.Flags().VarP((*selectionValues)(&selection.Presets), "preset", "p", "Model preset(s) to expand; repeat or comma-separate")
		cmd.Flags().BoolVar(&selection.RunHeavy, "run-heavy", false, "Execute heavy drafts instead of creating paused model states")
		once(cmd.Flags().Lookup("run-heavy"))
		root.AddCommand(cmd)
	}
	for _, action := range []struct{ name, description string }{
		{"attach", "Attach Herdr to a run/model window"},
		{"start", "Start a paused/queued model in an existing run"},
		{"retry", "Fresh-retry one model in an existing run without creating a new run folder"},
		{"stop", "Stop one currently running model"},
		{"continue", "Continue/nudge one failed or cancelled model's existing native session"},
	} {
		force := false
		cmd := &cobra.Command{Use: action.name + " <run> <model>", Short: action.description, Args: cobra.ExactArgs(2),
			RunE: func(cmd *cobra.Command, args []string) error {
				switch action.name {
				case "attach":
					return executor.Attach(cmd.Context(), args[0], args[1])
				case "start":
					return executor.StartModel(cmd.Context(), args[0], args[1], force)
				case "retry":
					return executor.RetryModel(cmd.Context(), args[0], args[1], force)
				case "stop":
					return executor.StopModel(cmd.Context(), args[0], args[1])
				default:
					return executor.ContinueModel(cmd.Context(), args[0], args[1], strings.Join(args[2:], " "), force)
				}
			}}
		if action.name == "start" || action.name == "retry" || action.name == "continue" {
			cmd.Flags().BoolVar(&force, "force", false, "Force start of a terminal model (accepted but not overriding safety for retry/continue)")
			once(cmd.Flags().Lookup("force"))
		}
		if action.name == "continue" {
			cmd.Use += " [message...]"
			cmd.Args = cobra.MinimumNArgs(2)
		}
		root.AddCommand(cmd)
	}
	root.AddCommand(&cobra.Command{Use: "report <run>", Short: "Print report path and summary", Args: cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error { return report.Print(args[0]) }})
	root.AddCommand(&cobra.Command{Use: "models", Short: "List model registry", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			file, err := config.Models()
			if err != nil {
				return err
			}
			for _, key := range config.SortedKeys(file.Models) {
				model := file.Models[key]
				tool := string(model.Tool)
				tool = strings.ToUpper(tool[:1]) + tool[1:]
				fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\t%s\t%s/%s\n", key, model.DisplayName, tool, model.Provider, model.Model)
			}
			return nil
		}})
	root.AddCommand(&cobra.Command{Use: "presets", Short: "List model preset registry", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			file, err := config.ModelPresets()
			if err != nil {
				return err
			}
			for _, key := range config.SortedKeys(file.Presets) {
				preset := file.Presets[key]
				fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\t%s\n", key, preset.DisplayName, strings.Join(preset.Models, ","))
			}
			return nil
		}})
	root.AddCommand(&cobra.Command{Use: "reprice [run]", Short: "Recalculate configured model costs from supported native session usage", Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			run := ""
			if len(args) > 0 {
				run = args[0]
			}
			return executor.Reprice(cmd.Context(), run)
		}})
	root.AddCommand(&cobra.Command{Use: "init", Short: "Initialize ~/.automator sample config", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if err := config.EnsureHome(); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "initialized", config.HomeDir())
			return nil
		}})
	for _, name := range []string{"worker", "worker-failed", "continue-worker", "report-refresh"} {
		var run, model, message, failure string
		cmd := &cobra.Command{Use: name, Hidden: true, Args: cobra.NoArgs,
			RunE: func(cmd *cobra.Command, _ []string) error {
				switch name {
				case "worker":
					return worker.Run(cmd.Context(), run, model)
				case "continue-worker":
					return worker.Continue(cmd.Context(), run, model, message)
				case "worker-failed":
					return worker.MarkFailed(run, model, failure)
				default:
					return report.Write(run)
				}
			}}
		cmd.Flags().StringVar(&run, "run", "", "Run directory")
		_ = cmd.MarkFlagRequired("run")
		if name != "report-refresh" {
			cmd.Flags().StringVar(&model, "model", "", "Model key")
			_ = cmd.MarkFlagRequired("model")
		}
		if name == "continue-worker" {
			cmd.Flags().StringVar(&message, "message", "", "Continuation message")
			_ = cmd.MarkFlagRequired("message")
		}
		if name == "worker-failed" {
			cmd.Flags().StringVar(&failure, "error", "", "Failure description")
			_ = cmd.MarkFlagRequired("error")
		}
		cmd.Flags().VisitAll(once)
		root.AddCommand(cmd)
	}
	return root
}

// Clap's delimiter behavior is a simple comma split, not CSV interpretation.
type selectionValues []string

func (v *selectionValues) Set(value string) error {
	*v = append(*v, strings.Split(value, ",")...)
	return nil
}
func (v *selectionValues) String() string { return strings.Join(*v, ",") }
func (v *selectionValues) Type() string   { return "strings" }

type singleValue struct {
	pflag.Value
	name string
	set  bool
}

func (v *singleValue) Set(value string) error {
	if v.set {
		return fmt.Errorf("the argument '--%s' cannot be used multiple times", v.name)
	}
	v.set = true
	return v.Value.Set(value)
}

func once(flag *pflag.Flag) { flag.Value = &singleValue{Value: flag.Value, name: flag.Name} }
