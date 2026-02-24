package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"text/tabwriter"
	"time"

	"github.com/c4pt0r/tnl/client"
	"github.com/spf13/cobra"
)

var (
	workerURL string
	mode      string
	recursive bool
	progress  bool
)

// Config file structure
type Config struct {
	WorkerURL string `json:"worker_url"`
}

// getDefaultWorkerURL returns worker URL from env, config file, or empty string
func getDefaultWorkerURL() string {
	// 1. Environment variable takes priority
	if url := os.Getenv("TNL_WORKER_URL"); url != "" {
		return url
	}

	// 2. Try config file
	configPaths := []string{
		filepath.Join(os.Getenv("HOME"), ".tnl", "config.json"),
		filepath.Join(os.Getenv("HOME"), ".config", "tnl", "config.json"),
	}

	for _, path := range configPaths {
		if data, err := os.ReadFile(path); err == nil {
			var cfg Config
			if json.Unmarshal(data, &cfg) == nil && cfg.WorkerURL != "" {
				return cfg.WorkerURL
			}
		}
	}

	// 3. No default - must be configured
	return ""
}

func main() {
	rootCmd := &cobra.Command{
		Use:   "tnl",
		Short: "Tunnel-based file sharing tool",
		Long: `Tunnel-based ephemeral file sharing tool.

Configure worker URL via:
  1. Command line: --worker wss://your-worker.workers.dev/ws
  2. Environment:  export TNL_WORKER_URL=wss://...
  3. Config file:  ~/.tnl/config.json or ~/.config/tnl/config.json
     {"worker_url": "wss://your-worker.workers.dev/ws"}`,
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			if workerURL == "" {
				return fmt.Errorf("worker URL not configured.\n\nSet via:\n  --worker wss://...\n  TNL_WORKER_URL=wss://...\n  ~/.tnl/config.json")
			}
			return nil
		},
	}

	rootCmd.PersistentFlags().StringVar(&workerURL, "worker", getDefaultWorkerURL(), "Worker WebSocket URL")
	rootCmd.PersistentFlags().BoolVarP(&progress, "progress", "p", true, "Show progress bar")

	// share command
	shareCmd := &cobra.Command{
		Use:   "share <path>",
		Short: "Share a file or directory",
		Args:  cobra.ExactArgs(1),
		Run:   runShare,
	}
	shareCmd.Flags().StringVar(&mode, "mode", "ro", "Share mode: ro (read-only) or rw (read-write)")
	rootCmd.AddCommand(shareCmd)

	// ls command
	lsCmd := &cobra.Command{
		Use:   "ls <shareCode:path>",
		Short: "List remote directory",
		Args:  cobra.ExactArgs(1),
		Run:   runList,
	}
	rootCmd.AddCommand(lsCmd)

	// cat command
	catCmd := &cobra.Command{
		Use:   "cat <shareCode:path>",
		Short: "Print remote file content",
		Args:  cobra.ExactArgs(1),
		Run:   runCat,
	}
	rootCmd.AddCommand(catCmd)

	// cp command
	cpCmd := &cobra.Command{
		Use:   "cp <shareCode:remotePath> <localPath>",
		Short: "Copy remote file/directory to local",
		Args:  cobra.ExactArgs(2),
		Run:   runCopy,
	}
	cpCmd.Flags().BoolVarP(&recursive, "recursive", "r", false, "Copy directories recursively")
	rootCmd.AddCommand(cpCmd)

	// rm command
	rmCmd := &cobra.Command{
		Use:   "rm <shareCode:path>",
		Short: "Remove remote file (requires rw mode)",
		Args:  cobra.ExactArgs(1),
		Run:   runRemove,
	}
	rootCmd.AddCommand(rmCmd)

	// tree command
	treeCmd := &cobra.Command{
		Use:   "tree <shareCode:path>",
		Short: "List remote directory tree recursively",
		Args:  cobra.ExactArgs(1),
		Run:   runTree,
	}
	rootCmd.AddCommand(treeCmd)

	// init command - setup config
	initCmd := &cobra.Command{
		Use:   "init <worker-url>",
		Short: "Initialize config with worker URL",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			configDir := filepath.Join(os.Getenv("HOME"), ".tnl")
			if err := os.MkdirAll(configDir, 0755); err != nil {
				return err
			}

			cfg := Config{WorkerURL: args[0]}
			data, _ := json.MarshalIndent(cfg, "", "  ")

			configPath := filepath.Join(configDir, "config.json")
			if err := os.WriteFile(configPath, data, 0644); err != nil {
				return err
			}

			fmt.Printf("Config saved to %s\n", configPath)
			return nil
		},
	}
	initCmd.SetHelpFunc(func(cmd *cobra.Command, args []string) {
		fmt.Println("Initialize tnl config with your worker URL.\n")
		fmt.Println("Usage:")
		fmt.Println("  tnl init wss://tnl.your-account.workers.dev/ws")
	})
	// Skip PersistentPreRunE for init command
	initCmd.PersistentPreRunE = func(cmd *cobra.Command, args []string) error { return nil }
	rootCmd.AddCommand(initCmd)

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func runShare(cmd *cobra.Command, args []string) {
	path := args[0]

	c, err := client.NewShareClient(workerURL, path, mode)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer c.Close()

	shareCode, publicURL, err := c.Register()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	absPath, _ := filepath.Abs(path)
	fmt.Printf("Sharing: %s\n", absPath)
	fmt.Printf("Mode: %s\n", mode)
	fmt.Printf("\n")
	fmt.Printf("Share code:  %s\n", shareCode)
	fmt.Printf("Public URL:  %s\n", publicURL)
	fmt.Printf("\n")
	fmt.Printf("Others can access with:\n")
	fmt.Printf("  tnl ls %s:/\n", shareCode)
	fmt.Printf("  tnl cp %s:<file> ./local\n", shareCode)
	fmt.Printf("  tnl cp -r %s:/ ./localdir\n", shareCode)
	fmt.Printf("\n")
	fmt.Printf("Press Ctrl+C to stop sharing\n")

	// Serve requests
	if err := c.Serve(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func runList(cmd *cobra.Command, args []string) {
	shareCode, path, err := client.ParseRemotePath(args[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	c, err := client.NewRemoteClient(workerURL, shareCode)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer c.Close()

	files, err := c.List(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	for _, f := range files {
		modTime := time.Unix(f.ModTime, 0).Format("Jan 02 15:04")
		size := formatSize(f.Size)
		name := f.Name
		if f.IsDir {
			name += "/"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", f.Mode, size, modTime, name)
	}
	w.Flush()
}

func runTree(cmd *cobra.Command, args []string) {
	shareCode, path, err := client.ParseRemotePath(args[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	c, err := client.NewRemoteClient(workerURL, shareCode)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer c.Close()

	entries, err := c.Tree(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	var totalSize int64
	for _, e := range entries {
		prefix := ""
		if e.IsDir {
			prefix = "📁 "
		} else {
			prefix = "📄 "
			totalSize += e.Size
		}
		if e.Path == "" {
			fmt.Printf("%s.\n", prefix)
		} else {
			fmt.Printf("%s%s  (%s)\n", prefix, e.Path, formatSize(e.Size))
		}
	}
	fmt.Printf("\nTotal: %s\n", formatSize(totalSize))
}

func runCat(cmd *cobra.Command, args []string) {
	shareCode, path, err := client.ParseRemotePath(args[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	c, err := client.NewRemoteClient(workerURL, shareCode)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer c.Close()

	if err := c.Cat(path, os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func runCopy(cmd *cobra.Command, args []string) {
	shareCode, remotePath, err := client.ParseRemotePath(args[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	localPath := args[1]

	c, err := client.NewRemoteClient(workerURL, shareCode)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer c.Close()

	if recursive {
		if err := c.CopyRecursive(remotePath, localPath, progress); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("\nCopied to %s/\n", localPath)
	} else {
		if err := c.Copy(remotePath, localPath, progress); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("\nCopied to %s\n", localPath)
	}
}

func runRemove(cmd *cobra.Command, args []string) {
	shareCode, path, err := client.ParseRemotePath(args[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	c, err := client.NewRemoteClient(workerURL, shareCode)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer c.Close()

	if err := c.Remove(path); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Removed %s\n", path)
}

func formatSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}
