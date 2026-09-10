package config

import (
	"fmt"
	"reflect"
	"strings"

	"go.yaml.in/yaml/v3"
)

// decodeFields retains serde's required-field and explicit-null semantics.
// Defaults are set by each caller, while unknown fields remain forward compatible.
func decodeFields(node *yaml.Node, out any, required ...string) error {
	if node.Kind != yaml.MappingNode {
		return fmt.Errorf("line %d: expected a mapping", node.Line)
	}
	fields := make(map[string]*yaml.Node, len(node.Content)/2)
	for i := 0; i < len(node.Content); i += 2 {
		fields[node.Content[i].Value] = node.Content[i+1]
	}
	for _, key := range required {
		if _, ok := fields[key]; !ok {
			return fmt.Errorf("line %d: missing required field %q", node.Line, key)
		}
	}
	typ := reflect.TypeOf(out).Elem()
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		key := strings.Split(field.Tag.Get("yaml"), ",")[0]
		value, ok := fields[key]
		if !ok || field.Type.Kind() == reflect.Pointer {
			continue
		}
		for value.Kind == yaml.AliasNode {
			value = value.Alias
		}
		if value.Tag == "!!null" {
			return fmt.Errorf("line %d: field %q cannot be null", value.Line, key)
		}
		switch field.Type.Kind() {
		case reflect.Int, reflect.Uint32:
			if value.Tag != "!!int" {
				return fmt.Errorf("line %d: field %q must be an integer", value.Line, key)
			}
		case reflect.Bool:
			if value.Tag != "!!bool" {
				return fmt.Errorf("line %d: field %q must be a boolean", value.Line, key)
			}
		case reflect.Float64:
			if value.Tag != "!!int" && value.Tag != "!!float" {
				return fmt.Errorf("line %d: field %q must be a number", value.Line, key)
			}
		}
		if field.Type.Kind() == reflect.Map || field.Type.Kind() == reflect.Slice {
			elem := field.Type.Elem().Kind()
			if elem == reflect.Pointer || elem == reflect.Interface {
				continue
			}
			start, step := 0, 1
			if value.Kind == yaml.MappingNode {
				start, step = 1, 2
			}
			for j := start; j < len(value.Content); j += step {
				item := value.Content[j]
				for item.Kind == yaml.AliasNode {
					item = item.Alias
				}
				if item.Tag == "!!null" {
					return fmt.Errorf("line %d: field %q cannot contain null entries", item.Line, key)
				}
			}
		}
	}
	if err := node.Decode(out); err != nil {
		return err
	}
	value := reflect.ValueOf(out).Elem()
	for _, key := range []string{"Concurrency", "DefaultConcurrency"} {
		if field := value.FieldByName(key); field.IsValid() && field.Int() < 0 {
			return fmt.Errorf("%s cannot be negative", key)
		}
	}
	return nil
}

func (v *AppConfig) UnmarshalYAML(n *yaml.Node) error {
	type plain AppConfig
	x := plain{DefaultConcurrency: 6}
	if err := decodeFields(n, &x, "schema_version"); err != nil {
		return err
	}
	*v = AppConfig(x)
	return nil
}

func (v *ProvidersFile) UnmarshalYAML(n *yaml.Node) error {
	type plain ProvidersFile
	x := plain{Providers: map[string]Provider{}}
	if err := decodeFields(n, &x, "schema_version"); err != nil {
		return err
	}
	*v = ProvidersFile(x)
	return nil
}

func (v *Provider) UnmarshalYAML(n *yaml.Node) error {
	type plain Provider
	x := plain{Auth: "external"}
	if err := decodeFields(n, &x, "display_name"); err != nil {
		return err
	}
	*v = Provider(x)
	return nil
}

func (v *ModelsFile) UnmarshalYAML(n *yaml.Node) error {
	type plain ModelsFile
	x := plain{Models: map[string]Model{}}
	if err := decodeFields(n, &x, "schema_version"); err != nil {
		return err
	}
	*v = ModelsFile(x)
	return nil
}

func (v *Model) UnmarshalYAML(n *yaml.Node) error {
	type plain Model
	x := plain{Args: map[string]any{}}
	if err := decodeFields(n, &x, "display_name", "tool", "provider", "model"); err != nil {
		return err
	}
	*v = Model(x)
	return nil
}

func (v *ModelPricing) UnmarshalYAML(n *yaml.Node) error {
	type plain ModelPricing
	var x plain
	if err := decodeFields(n, &x, "input_per_million", "output_per_million", "cache_read_per_million", "cache_write_per_million"); err != nil {
		return err
	}
	*v = ModelPricing(x)
	return nil
}

func (v *ModelPresetsFile) UnmarshalYAML(n *yaml.Node) error {
	type plain ModelPresetsFile
	x := plain{Presets: map[string]ModelPreset{}}
	if err := decodeFields(n, &x, "schema_version"); err != nil {
		return err
	}
	*v = ModelPresetsFile(x)
	return nil
}

func (v *ModelPreset) UnmarshalYAML(n *yaml.Node) error {
	type plain ModelPreset
	x := plain{Models: []string{}}
	if err := decodeFields(n, &x, "display_name"); err != nil {
		return err
	}
	*v = ModelPreset(x)
	return nil
}

func (v *TemplatesFile) UnmarshalYAML(n *yaml.Node) error {
	type plain TemplatesFile
	x := plain{Templates: map[string]Template{}}
	if err := decodeFields(n, &x, "schema_version"); err != nil {
		return err
	}
	*v = TemplatesFile(x)
	return nil
}

func (v *Template) UnmarshalYAML(n *yaml.Node) error {
	type plain Template
	x := plain{Steps: []ShellStep{}}
	if err := decodeFields(n, &x, "display_name"); err != nil {
		return err
	}
	*v = Template(x)
	return nil
}

func (v *ShellStep) UnmarshalYAML(n *yaml.Node) error {
	type plain ShellStep
	var x plain
	if err := decodeFields(n, &x, "shell"); err != nil {
		return err
	}
	*v = ShellStep(x)
	return nil
}

func (v *DraftRun) UnmarshalYAML(n *yaml.Node) error {
	type plain DraftRun
	x := plain{Concurrency: 6, Mode: Headful, Pre: []ShellStep{}, PostEach: []ShellStep{}, PostAll: []ShellStep{}}
	if err := decodeFields(n, &x, "schema_version", "name", "root", "template", "prompt"); err != nil {
		return err
	}
	*v = DraftRun(x)
	return nil
}

func (v *RunsIndex) UnmarshalYAML(n *yaml.Node) error {
	type plain RunsIndex
	x := plain{Runs: []RunIndexEntry{}}
	if err := decodeFields(n, &x, "schema_version"); err != nil {
		return err
	}
	*v = RunsIndex(x)
	return nil
}

func (v *RunIndexEntry) UnmarshalYAML(n *yaml.Node) error {
	type plain RunIndexEntry
	var x plain
	if err := decodeFields(n, &x, "name", "path", "started_at", "mode"); err != nil {
		return err
	}
	*v = RunIndexEntry(x)
	return nil
}

func (v *RunSnapshot) UnmarshalYAML(n *yaml.Node) error {
	type plain RunSnapshot
	x := plain{HerdrSession: "Automator", Pre: []ShellStep{}, PostEach: []ShellStep{}, PostAll: []ShellStep{}}
	if err := decodeFields(n, &x, "schema_version", "name", "root", "run_dir", "concurrency", "mode", "template", "template_key", "models", "prompt"); err != nil {
		return err
	}
	*v = RunSnapshot(x)
	return nil
}

func (v *Tool) UnmarshalYAML(n *yaml.Node) error {
	switch Tool(n.Value) {
	case Pi, Opencode, Claude:
		if n.Kind == yaml.ScalarNode {
			*v = Tool(n.Value)
			return nil
		}
	}
	return fmt.Errorf("line %d: invalid tool %q; expected pi, opencode, or claude", n.Line, n.Value)
}

func (v *RunMode) UnmarshalYAML(n *yaml.Node) error {
	switch RunMode(n.Value) {
	case Headful, Headless:
		if n.Kind == yaml.ScalarNode {
			*v = RunMode(n.Value)
			return nil
		}
	}
	return fmt.Errorf("line %d: invalid run mode %q; expected headful or headless", n.Line, n.Value)
}
