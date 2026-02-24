package main

import (
	"fmt"
	"os"
	"path/filepath"
	"text/tabwriter"
	"time"

	"github.com/c4pt0r/tnl/client"
	"github.com/spf13/cobra"
)

const (
	defaultWorkerURL = "wss://tnl.YOUR_ACCOUNT.workers.dev/ws"
)

var (
	workerURL string
	mode      string
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "tnl",
		Short: "Tunnel-based file sharing tool",
	}

	rootCmd.PersistentFlags().StringVar(&workerURL, "worker", defaultWorkerURL, "Worker WebSocket URL")

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
		Short: "Copy remote file to local",
		Args:  cobra.ExactArgs(2),
		Run:   runCopy,
	}
	rootCmd.AddCommand(cpCmd)

	// rm command
	rmCmd := &cobra.Command{
		Use:   "rm <shareCode:path>",
		Short: "Remove remote file (requires rw mode)",
		Args:  cobra.ExactArgs(1),
		Run:   runRemove,
	}
	rootCmd.AddCommand(rmCmd)

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

	if err := c.Copy(remotePath, localPath); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Copied to %s\n", localPath)
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
