package client

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/c4pt0r/tnl/protocol"
	"github.com/gorilla/websocket"
)

type ShareClient struct {
	conn     *websocket.Conn
	rootPath string
	mode     string // "ro" or "rw"
	mu       sync.Mutex
}

func NewShareClient(workerURL, rootPath, mode string) (*ShareClient, error) {
	// Resolve absolute path
	absPath, err := filepath.Abs(rootPath)
	if err != nil {
		return nil, fmt.Errorf("invalid path: %w", err)
	}

	// Check path exists
	info, err := os.Stat(absPath)
	if err != nil {
		return nil, fmt.Errorf("path not found: %w", err)
	}

	// If it's a file, use its directory as root and remember the filename
	if !info.IsDir() {
		absPath = filepath.Dir(absPath)
	}

	// Connect to worker
	conn, _, err := websocket.DefaultDialer.Dial(workerURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}

	return &ShareClient{
		conn:     conn,
		rootPath: absPath,
		mode:     mode,
	}, nil
}

func (c *ShareClient) Register() (shareCode, publicURL string, err error) {
	// Send register message
	msg := protocol.RegisterMsg{
		Op:   protocol.OpRegister,
		Mode: c.mode,
	}
	if err := c.conn.WriteJSON(msg); err != nil {
		return "", "", fmt.Errorf("failed to register: %w", err)
	}

	// Wait for response
	var resp protocol.RegisteredMsg
	if err := c.conn.ReadJSON(&resp); err != nil {
		return "", "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.Op != protocol.OpRegistered {
		return "", "", fmt.Errorf("unexpected response: %s", resp.Op)
	}

	return resp.ShareCode, resp.PublicURL, nil
}

func (c *ShareClient) Serve() error {
	for {
		_, msgBytes, err := c.conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("connection closed: %w", err)
		}

		var msg protocol.Message
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			c.sendError(msg.ReqID, "invalid message format")
			continue
		}

		go c.handleRequest(msg)
	}
}

func (c *ShareClient) handleRequest(msg protocol.Message) {
	switch msg.Op {
	case protocol.OpList:
		c.handleList(msg)
	case protocol.OpRead:
		c.handleRead(msg)
	case protocol.OpStat:
		c.handleStat(msg)
	case protocol.OpRemove:
		c.handleRemove(msg)
	case "tree": // recursive listing
		c.handleTree(msg)
	case protocol.OpGlob:
		c.handleGlob(msg)
	case protocol.OpGrep:
		c.handleGrep(msg)
	case protocol.OpWrite:
		c.handleWrite(msg)
	default:
		c.sendError(msg.ReqID, "unknown operation: "+msg.Op)
	}
}

func (c *ShareClient) handleList(msg protocol.Message) {
	fullPath := c.resolvePath(msg.Path)

	entries, err := os.ReadDir(fullPath)
	if err != nil {
		c.sendError(msg.ReqID, err.Error())
		return
	}

	var files []protocol.FileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, protocol.FileInfo{
			Name:    entry.Name(),
			Size:    info.Size(),
			Mode:    info.Mode().String(),
			ModTime: info.ModTime().Unix(),
			IsDir:   entry.IsDir(),
		})
	}

	c.sendResult(msg.ReqID, protocol.ListResult{Files: files})
}

func (c *ShareClient) handleTree(msg protocol.Message) {
	fullPath := c.resolvePath(msg.Path)

	var entries []protocol.TreeEntry
	err := filepath.Walk(fullPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip errors
		}
		relPath, _ := filepath.Rel(fullPath, path)
		if relPath == "." {
			relPath = ""
		}
		entries = append(entries, protocol.TreeEntry{
			Path:    relPath,
			Size:    info.Size(),
			Mode:    info.Mode().String(),
			ModTime: info.ModTime().Unix(),
			IsDir:   info.IsDir(),
		})
		return nil
	})
	if err != nil {
		c.sendError(msg.ReqID, err.Error())
		return
	}

	c.sendResult(msg.ReqID, protocol.TreeResult{Entries: entries})
}

func (c *ShareClient) handleStat(msg protocol.Message) {
	fullPath := c.resolvePath(msg.Path)

	info, err := os.Stat(fullPath)
	if err != nil {
		c.sendError(msg.ReqID, err.Error())
		return
	}

	c.sendResult(msg.ReqID, protocol.FileInfo{
		Name:    info.Name(),
		Size:    info.Size(),
		Mode:    info.Mode().String(),
		ModTime: info.ModTime().Unix(),
		IsDir:   info.IsDir(),
	})
}

func (c *ShareClient) handleRead(msg protocol.Message) {
	fullPath := c.resolvePath(msg.Path)

	file, err := os.Open(fullPath)
	if err != nil {
		c.sendError(msg.ReqID, err.Error())
		return
	}
	defer file.Close()

	// Get file size for progress
	stat, _ := file.Stat()
	fileSize := stat.Size()

	// Stream file in chunks
	buf := make([]byte, 64*1024) // 64KB chunks
	offset := int64(0)
	firstChunk := true

	for {
		n, err := file.Read(buf)
		eof := err == io.EOF

		// Send chunk if we have data OR if it's EOF (to signal completion)
		if n > 0 || eof {
			data := buf[:n]

			// Compress if requested and we have data
			compressed := false
			if msg.Compress && n > 0 {
				var compBuf bytes.Buffer
				gw := gzip.NewWriter(&compBuf)
				gw.Write(data)
				gw.Close()
				// Only use compressed if smaller
				if compBuf.Len() < n {
					data = compBuf.Bytes()
					compressed = true
				}
			}

			chunk := map[string]any{
				"op":       protocol.OpChunk,
				"reqId":    msg.ReqID,
				"data":     base64.StdEncoding.EncodeToString(data),
				"offset":   offset,
				"eof":      eof,
				"compress": compressed,
			}
			if firstChunk {
				chunk["size"] = fileSize
				firstChunk = false
			}
			c.send(chunk)
			offset += int64(n)
		}

		if eof {
			break
		}
		if err != nil {
			c.sendError(msg.ReqID, err.Error())
			return
		}
	}
}

func (c *ShareClient) handleRemove(msg protocol.Message) {
	if c.mode == "ro" {
		c.sendError(msg.ReqID, "read-only share")
		return
	}

	fullPath := c.resolvePath(msg.Path)

	err := os.RemoveAll(fullPath)
	if err != nil {
		c.sendError(msg.ReqID, err.Error())
		return
	}

	c.sendResult(msg.ReqID, "ok")
}

func (c *ShareClient) resolvePath(path string) string {
	// Clean and join with root, prevent path traversal
	cleaned := filepath.Clean("/" + path)
	return filepath.Join(c.rootPath, cleaned)
}

func (c *ShareClient) sendResult(reqID string, data any) {
	c.send(protocol.Message{
		Op:    protocol.OpResult,
		ReqID: reqID,
		Data:  data,
	})
}

func (c *ShareClient) sendError(reqID, errMsg string) {
	c.send(protocol.ErrorMsg{
		Op:    protocol.OpError,
		ReqID: reqID,
		Error: errMsg,
	})
}

func (c *ShareClient) send(msg any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.conn.WriteJSON(msg)
}

func (c *ShareClient) handleGlob(msg protocol.Message) {
	pattern := msg.Path
	
	// Convert glob pattern to work with our root
	fullPattern := c.resolvePath(pattern)
	
	matches, err := filepath.Glob(fullPattern)
	if err != nil {
		c.sendError(msg.ReqID, err.Error())
		return
	}
	
	// Convert back to relative paths
	var relMatches []string
	for _, m := range matches {
		rel, err := filepath.Rel(c.rootPath, m)
		if err == nil {
			relMatches = append(relMatches, "/"+rel)
		}
	}
	
	c.sendResult(msg.ReqID, protocol.GlobResult{Matches: relMatches})
}

func (c *ShareClient) handleGrep(msg protocol.Message) {
	// Parse grep request from Data field
	data, ok := msg.Data.(map[string]any)
	if !ok {
		c.sendError(msg.ReqID, "invalid grep request")
		return
	}
	
	pattern, _ := data["pattern"].(string)
	path, _ := data["path"].(string)
	ignoreCase, _ := data["ignoreCase"].(bool)
	filesOnly, _ := data["filesOnly"].(bool)
	countOnly, _ := data["countOnly"].(bool)
	wordMatch, _ := data["wordMatch"].(bool)
	beforeCtx, _ := data["beforeContext"].(float64)
	afterCtx, _ := data["afterContext"].(float64)
	beforeContext := int(beforeCtx)
	afterContext := int(afterCtx)
	
	if path == "" {
		path = "/"
	}
	
	// Build regex pattern
	if wordMatch {
		pattern = `\b` + pattern + `\b`
	}
	if ignoreCase {
		pattern = "(?i)" + pattern
	}
	
	// Compile regex
	re, err := regexp.Compile(pattern)
	if err != nil {
		c.sendError(msg.ReqID, "invalid regex: "+err.Error())
		return
	}
	
	fullPath := c.resolvePath(path)
	var matches []protocol.GrepMatch
	counts := make(map[string]int)
	filesWithMatches := make(map[string]bool)
	needContext := beforeContext > 0 || afterContext > 0
	
	// Walk through files
	filepath.Walk(fullPath, func(fpath string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		
		// Skip binary files (simple heuristic)
		if isBinaryFile(fpath) {
			return nil
		}
		
		file, err := os.Open(fpath)
		if err != nil {
			return nil
		}
		defer file.Close()
		
		relPath, _ := filepath.Rel(c.rootPath, fpath)
		relPath = "/" + relPath
		
		// For context, read all lines first
		if needContext && !filesOnly && !countOnly {
			allLines := []string{}
			scanner := bufio.NewScanner(file)
			for scanner.Scan() {
				allLines = append(allLines, scanner.Text())
			}
			
			for lineIdx, line := range allLines {
				if re.MatchString(line) {
					filesWithMatches[relPath] = true
					counts[relPath]++
					
					// Get before context
					var before []string
					start := lineIdx - beforeContext
					if start < 0 {
						start = 0
					}
					for i := start; i < lineIdx; i++ {
						before = append(before, truncate(allLines[i], 200))
					}
					
					// Get after context
					var after []string
					end := lineIdx + afterContext + 1
					if end > len(allLines) {
						end = len(allLines)
					}
					for i := lineIdx + 1; i < end; i++ {
						after = append(after, truncate(allLines[i], 200))
					}
					
					matches = append(matches, protocol.GrepMatch{
						Path:    relPath,
						Line:    lineIdx + 1,
						Content: truncate(line, 200),
						Before:  before,
						After:   after,
					})
					
					if len(matches) > 500 {
						return filepath.SkipAll
					}
				}
			}
		} else {
			// No context needed - stream through file
			scanner := bufio.NewScanner(file)
			lineNum := 0
			
			for scanner.Scan() {
				lineNum++
				line := scanner.Text()
				if re.MatchString(line) {
					filesWithMatches[relPath] = true
					counts[relPath]++
					
					if !filesOnly && !countOnly {
						matches = append(matches, protocol.GrepMatch{
							Path:    relPath,
							Line:    lineNum,
							Content: truncate(line, 200),
						})
						if len(matches) > 1000 {
							return filepath.SkipAll
						}
					}
					
					if filesOnly {
						return nil
					}
				}
			}
		}
		return nil
	})
	
	// Build result based on mode
	result := protocol.GrepResult{}
	if filesOnly {
		for f := range filesWithMatches {
			result.Files = append(result.Files, f)
		}
	} else if countOnly {
		result.Counts = counts
	} else {
		result.Matches = matches
	}
	
	c.sendResult(msg.ReqID, result)
}

func (c *ShareClient) handleWrite(msg protocol.Message) {
	if c.mode == "ro" {
		c.sendError(msg.ReqID, "read-only share")
		return
	}

	// Parse write request from Data field
	data, ok := msg.Data.(map[string]any)
	if !ok {
		c.sendError(msg.ReqID, "invalid write request")
		return
	}

	content, _ := data["content"].(string)
	append_, _ := data["append"].(bool)

	fullPath := c.resolvePath(msg.Path)

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		c.sendError(msg.ReqID, err.Error())
		return
	}

	// Decode base64 content
	decoded, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		c.sendError(msg.ReqID, "invalid content encoding: "+err.Error())
		return
	}

	// Write or append
	var file *os.File
	if append_ {
		file, err = os.OpenFile(fullPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	} else {
		file, err = os.Create(fullPath)
	}
	if err != nil {
		c.sendError(msg.ReqID, err.Error())
		return
	}
	defer file.Close()

	n, err := file.Write(decoded)
	if err != nil {
		c.sendError(msg.ReqID, err.Error())
		return
	}

	c.sendResult(msg.ReqID, map[string]any{"written": n})
}

func isBinaryFile(path string) bool {
	// Check by extension
	ext := strings.ToLower(filepath.Ext(path))
	binaryExts := map[string]bool{
		".exe": true, ".bin": true, ".so": true, ".dylib": true,
		".zip": true, ".tar": true, ".gz": true, ".rar": true,
		".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
		".pdf": true, ".doc": true, ".docx": true,
		".mp3": true, ".mp4": true, ".avi": true, ".mov": true,
	}
	return binaryExts[ext]
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func (c *ShareClient) Close() error {
	return c.conn.Close()
}
