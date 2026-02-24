package protocol

// Message types
const (
	// Control messages
	OpRegister   = "register"   // client -> worker: register share
	OpRegistered = "registered" // worker -> client: share code assigned

	// File operations (B -> Worker -> A)
	OpList   = "ls"
	OpRead   = "cat"
	OpCopy   = "cp"
	OpRemove = "rm"
	OpStat   = "stat"
	OpGlob   = "glob"
	OpGrep   = "grep"
	OpWrite  = "write"  // write content to file

	// Responses
	OpResult = "result"
	OpError  = "error"
	OpChunk  = "chunk" // for streaming file content
)

// Message is the base message format
type Message struct {
	Op       string `json:"op"`
	ReqID    string `json:"reqId,omitempty"`
	Path     string `json:"path,omitempty"`
	Data     any    `json:"data,omitempty"`
	Error    string `json:"error,omitempty"`
	Compress bool   `json:"compress,omitempty"` // request gzip compression
}

// RegisterMsg sent by sharer to worker
type RegisterMsg struct {
	Op   string `json:"op"`
	Mode string `json:"mode"` // "ro" or "rw"
}

// RegisteredMsg response from worker
type RegisteredMsg struct {
	Op        string `json:"op"`
	ShareCode string `json:"shareCode"`
	PublicURL string `json:"publicUrl"`
}

// FileInfo for directory listings
type FileInfo struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime int64  `json:"modTime"`
	IsDir   bool   `json:"isDir"`
}

// ListResult for ls response
type ListResult struct {
	Files []FileInfo `json:"files"`
}

// ChunkMsg for streaming file content
type ChunkMsg struct {
	Op       string `json:"op"`
	ReqID    string `json:"reqId"`
	Data     []byte `json:"data"`   // base64 encoded in JSON
	Offset   int64  `json:"offset"`
	EOF      bool   `json:"eof"`
	Compress bool   `json:"compress"` // data is gzip compressed
	Size     int64  `json:"size"`     // total file size (sent in first chunk)
}

// ErrorMsg for error responses
type ErrorMsg struct {
	Op    string `json:"op"`
	ReqID string `json:"reqId"`
	Error string `json:"error"`
}

// TreeEntry for recursive listing
type TreeEntry struct {
	Path    string `json:"path"`    // relative path from root
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime int64  `json:"modTime"`
	IsDir   bool   `json:"isDir"`
}

// TreeResult for recursive ls
type TreeResult struct {
	Entries []TreeEntry `json:"entries"`
}

// GlobResult for glob matches
type GlobResult struct {
	Matches []string `json:"matches"`
}

// GrepMatch for grep results
type GrepMatch struct {
	Path    string   `json:"path"`
	Line    int      `json:"line"`
	Content string   `json:"content"`
	Before  []string `json:"before,omitempty"`  // context lines before
	After   []string `json:"after,omitempty"`   // context lines after
}

// GrepResult for grep matches
type GrepResult struct {
	Matches []GrepMatch       `json:"matches"`
	Counts  map[string]int    `json:"counts,omitempty"`  // file -> count (for -c)
	Files   []string          `json:"files,omitempty"`   // files with matches (for -l)
}

// GrepOptions for grep flags
type GrepOptions struct {
	IgnoreCase    bool `json:"ignoreCase"`
	FilesOnly     bool `json:"filesOnly"`
	CountOnly     bool `json:"countOnly"`
	WordMatch     bool `json:"wordMatch"`
	BeforeContext int  `json:"beforeContext"`
	AfterContext  int  `json:"afterContext"`
}
