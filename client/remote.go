package client

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/c4pt0r/tnl/protocol"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/schollz/progressbar/v3"
)

type RemoteClient struct {
	conn      *websocket.Conn
	shareCode string
}

// ParseRemotePath parses "shareCode:path" format
func ParseRemotePath(s string) (shareCode, path string, err error) {
	parts := strings.SplitN(s, ":", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid remote path format, expected 'shareCode:path'")
	}
	return parts[0], parts[1], nil
}

func NewRemoteClient(workerURL, shareCode string) (*RemoteClient, error) {
	// Connect to worker with share code
	url := fmt.Sprintf("%s?code=%s", workerURL, shareCode)
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}

	return &RemoteClient{
		conn:      conn,
		shareCode: shareCode,
	}, nil
}

func (c *RemoteClient) List(path string) ([]protocol.FileInfo, error) {
	reqID := uuid.New().String()

	err := c.conn.WriteJSON(protocol.Message{
		Op:    protocol.OpList,
		ReqID: reqID,
		Path:  path,
	})
	if err != nil {
		return nil, err
	}

	// Read response
	var resp struct {
		Op    string              `json:"op"`
		ReqID string              `json:"reqId"`
		Data  protocol.ListResult `json:"data"`
		Error string              `json:"error"`
	}

	if err := c.conn.ReadJSON(&resp); err != nil {
		return nil, err
	}

	if resp.Op == protocol.OpError {
		return nil, fmt.Errorf(resp.Error)
	}

	return resp.Data.Files, nil
}

func (c *RemoteClient) Tree(path string) ([]protocol.TreeEntry, error) {
	reqID := uuid.New().String()

	err := c.conn.WriteJSON(map[string]any{
		"op":    "tree",
		"reqId": reqID,
		"path":  path,
	})
	if err != nil {
		return nil, err
	}

	var resp struct {
		Op    string              `json:"op"`
		ReqID string              `json:"reqId"`
		Data  protocol.TreeResult `json:"data"`
		Error string              `json:"error"`
	}

	if err := c.conn.ReadJSON(&resp); err != nil {
		return nil, err
	}

	if resp.Op == protocol.OpError {
		return nil, fmt.Errorf(resp.Error)
	}

	return resp.Data.Entries, nil
}

func (c *RemoteClient) Stat(path string) (*protocol.FileInfo, error) {
	reqID := uuid.New().String()

	err := c.conn.WriteJSON(protocol.Message{
		Op:    protocol.OpStat,
		ReqID: reqID,
		Path:  path,
	})
	if err != nil {
		return nil, err
	}

	var resp struct {
		Op    string            `json:"op"`
		ReqID string            `json:"reqId"`
		Data  protocol.FileInfo `json:"data"`
		Error string            `json:"error"`
	}

	if err := c.conn.ReadJSON(&resp); err != nil {
		return nil, err
	}

	if resp.Op == protocol.OpError {
		return nil, fmt.Errorf(resp.Error)
	}

	return &resp.Data, nil
}

func (c *RemoteClient) Cat(path string, w io.Writer) error {
	return c.download(path, w, false, nil)
}

func (c *RemoteClient) CatWithProgress(path string, w io.Writer) error {
	return c.download(path, w, true, nil)
}

func (c *RemoteClient) download(path string, w io.Writer, showProgress bool, bar *progressbar.ProgressBar) error {
	reqID := uuid.New().String()

	err := c.conn.WriteJSON(protocol.Message{
		Op:       protocol.OpRead,
		ReqID:    reqID,
		Path:     path,
		Compress: true, // request compression
	})
	if err != nil {
		return err
	}

	var totalSize int64
	var currentBar *progressbar.ProgressBar

	// Read chunks until EOF
	for {
		_, msgBytes, err := c.conn.ReadMessage()
		if err != nil {
			return err
		}

		// Check if it's an error
		var errResp protocol.ErrorMsg
		if json.Unmarshal(msgBytes, &errResp); errResp.Op == protocol.OpError {
			return fmt.Errorf(errResp.Error)
		}

		// Parse as chunk
		var chunk struct {
			Op       string `json:"op"`
			ReqID    string `json:"reqId"`
			Data     string `json:"data"` // base64 encoded
			EOF      bool   `json:"eof"`
			Compress bool   `json:"compress"`
			Size     int64  `json:"size"`
		}
		if err := json.Unmarshal(msgBytes, &chunk); err != nil {
			return err
		}

		if chunk.Op != protocol.OpChunk {
			continue
		}

		// Initialize progress bar on first chunk
		if chunk.Size > 0 && showProgress && currentBar == nil {
			totalSize = chunk.Size
			if bar != nil {
				currentBar = bar
			} else {
				currentBar = progressbar.DefaultBytes(totalSize, filepath.Base(path))
			}
		}

		// Decode base64
		data, err := base64.StdEncoding.DecodeString(chunk.Data)
		if err != nil {
			return fmt.Errorf("failed to decode chunk: %w", err)
		}

		// Decompress if needed
		if chunk.Compress {
			gr, err := gzip.NewReader(bytes.NewReader(data))
			if err != nil {
				return fmt.Errorf("failed to decompress: %w", err)
			}
			data, err = io.ReadAll(gr)
			gr.Close()
			if err != nil {
				return fmt.Errorf("failed to decompress: %w", err)
			}
		}

		// Write data
		if _, err := w.Write(data); err != nil {
			return err
		}

		// Update progress
		if currentBar != nil {
			currentBar.Add(len(data))
		}

		if chunk.EOF {
			break
		}
	}

	return nil
}

func (c *RemoteClient) Copy(remotePath, localPath string, showProgress bool) error {
	// Create local file
	file, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer file.Close()

	if showProgress {
		return c.CatWithProgress(remotePath, file)
	}
	return c.Cat(remotePath, file)
}

func (c *RemoteClient) CopyRecursive(remotePath, localPath string, showProgress bool) error {
	// Get tree listing
	entries, err := c.Tree(remotePath)
	if err != nil {
		return err
	}

	// Calculate total size for progress
	var totalSize int64
	var fileCount int
	for _, e := range entries {
		if !e.IsDir {
			totalSize += e.Size
			fileCount++
		}
	}

	var bar *progressbar.ProgressBar
	if showProgress {
		bar = progressbar.DefaultBytes(totalSize, fmt.Sprintf("Copying %d files", fileCount))
	}

	// Create directories and copy files
	for _, entry := range entries {
		localEntryPath := filepath.Join(localPath, entry.Path)

		if entry.IsDir {
			if err := os.MkdirAll(localEntryPath, 0755); err != nil {
				return err
			}
		} else {
			// Ensure parent directory exists
			if err := os.MkdirAll(filepath.Dir(localEntryPath), 0755); err != nil {
				return err
			}

			// Download file
			remoteFilePath := filepath.Join(remotePath, entry.Path)
			file, err := os.Create(localEntryPath)
			if err != nil {
				return err
			}

			err = c.downloadWithBar(remoteFilePath, file, bar)
			file.Close()
			if err != nil {
				return fmt.Errorf("failed to copy %s: %w", entry.Path, err)
			}
		}
	}

	return nil
}

func (c *RemoteClient) downloadWithBar(path string, w io.Writer, bar *progressbar.ProgressBar) error {
	reqID := uuid.New().String()

	err := c.conn.WriteJSON(protocol.Message{
		Op:       protocol.OpRead,
		ReqID:    reqID,
		Path:     path,
		Compress: true,
	})
	if err != nil {
		return err
	}

	for {
		_, msgBytes, err := c.conn.ReadMessage()
		if err != nil {
			return err
		}

		var errResp protocol.ErrorMsg
		if json.Unmarshal(msgBytes, &errResp); errResp.Op == protocol.OpError {
			return fmt.Errorf(errResp.Error)
		}

		var chunk struct {
			Op       string `json:"op"`
			Data     string `json:"data"`
			EOF      bool   `json:"eof"`
			Compress bool   `json:"compress"`
		}
		if err := json.Unmarshal(msgBytes, &chunk); err != nil {
			return err
		}

		if chunk.Op != protocol.OpChunk {
			continue
		}

		data, err := base64.StdEncoding.DecodeString(chunk.Data)
		if err != nil {
			return err
		}

		if chunk.Compress {
			gr, err := gzip.NewReader(bytes.NewReader(data))
			if err != nil {
				return err
			}
			data, err = io.ReadAll(gr)
			gr.Close()
			if err != nil {
				return err
			}
		}

		if _, err := w.Write(data); err != nil {
			return err
		}

		if bar != nil {
			bar.Add(len(data))
		}

		if chunk.EOF {
			break
		}
	}

	return nil
}

func (c *RemoteClient) Remove(path string) error {
	reqID := uuid.New().String()

	err := c.conn.WriteJSON(protocol.Message{
		Op:    protocol.OpRemove,
		ReqID: reqID,
		Path:  path,
	})
	if err != nil {
		return err
	}

	var resp struct {
		Op    string `json:"op"`
		Error string `json:"error"`
	}

	if err := c.conn.ReadJSON(&resp); err != nil {
		return err
	}

	if resp.Op == protocol.OpError {
		return fmt.Errorf(resp.Error)
	}

	return nil
}

func (c *RemoteClient) Write(path string, content []byte, append_ bool) (int, error) {
	reqID := uuid.New().String()

	err := c.conn.WriteJSON(map[string]any{
		"op":    protocol.OpWrite,
		"reqId": reqID,
		"path":  path,
		"data": map[string]any{
			"content": base64.StdEncoding.EncodeToString(content),
			"append":  append_,
		},
	})
	if err != nil {
		return 0, err
	}

	var resp struct {
		Op    string         `json:"op"`
		ReqID string         `json:"reqId"`
		Data  map[string]any `json:"data"`
		Error string         `json:"error"`
	}

	if err := c.conn.ReadJSON(&resp); err != nil {
		return 0, err
	}

	if resp.Op == protocol.OpError {
		return 0, fmt.Errorf(resp.Error)
	}

	written, _ := resp.Data["written"].(float64)
	return int(written), nil
}

func (c *RemoteClient) Glob(pattern string) ([]string, error) {
	reqID := uuid.New().String()

	err := c.conn.WriteJSON(protocol.Message{
		Op:    protocol.OpGlob,
		ReqID: reqID,
		Path:  pattern,
	})
	if err != nil {
		return nil, err
	}

	var resp struct {
		Op    string              `json:"op"`
		ReqID string              `json:"reqId"`
		Data  protocol.GlobResult `json:"data"`
		Error string              `json:"error"`
	}

	if err := c.conn.ReadJSON(&resp); err != nil {
		return nil, err
	}

	if resp.Op == protocol.OpError {
		return nil, fmt.Errorf(resp.Error)
	}

	return resp.Data.Matches, nil
}

func (c *RemoteClient) Grep(pattern, path string, opts protocol.GrepOptions) (*protocol.GrepResult, error) {
	reqID := uuid.New().String()

	err := c.conn.WriteJSON(map[string]any{
		"op":    protocol.OpGrep,
		"reqId": reqID,
		"data": map[string]any{
			"pattern":       pattern,
			"path":          path,
			"ignoreCase":    opts.IgnoreCase,
			"filesOnly":     opts.FilesOnly,
			"countOnly":     opts.CountOnly,
			"wordMatch":     opts.WordMatch,
			"beforeContext": opts.BeforeContext,
			"afterContext":  opts.AfterContext,
		},
	})
	if err != nil {
		return nil, err
	}

	var resp struct {
		Op    string              `json:"op"`
		ReqID string              `json:"reqId"`
		Data  protocol.GrepResult `json:"data"`
		Error string              `json:"error"`
	}

	if err := c.conn.ReadJSON(&resp); err != nil {
		return nil, err
	}

	if resp.Op == protocol.OpError {
		return nil, fmt.Errorf(resp.Error)
	}

	return &resp.Data, nil
}

func (c *RemoteClient) Close() error {
	return c.conn.Close()
}
