package client

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/c4pt0r/tnl/protocol"
	"github.com/gorilla/websocket"
	"github.com/google/uuid"
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
	reqID := uuid.New().String()
	
	err := c.conn.WriteJSON(protocol.Message{
		Op:    protocol.OpRead,
		ReqID: reqID,
		Path:  path,
	})
	if err != nil {
		return err
	}

	// Read chunks until EOF
	for {
		_, msgBytes, err := c.conn.ReadMessage()
		if err != nil {
			return err
		}

		var msg json.RawMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			return err
		}

		// Check if it's an error
		var errResp protocol.ErrorMsg
		if json.Unmarshal(msgBytes, &errResp); errResp.Op == protocol.OpError {
			return fmt.Errorf(errResp.Error)
		}

		// Parse as chunk
		var chunk struct {
			Op    string `json:"op"`
			ReqID string `json:"reqId"`
			Data  string `json:"data"` // base64 encoded
			EOF   bool   `json:"eof"`
		}
		if err := json.Unmarshal(msgBytes, &chunk); err != nil {
			return err
		}

		if chunk.Op != protocol.OpChunk {
			continue
		}

		// Decode and write
		data, err := base64.StdEncoding.DecodeString(chunk.Data)
		if err != nil {
			return fmt.Errorf("failed to decode chunk: %w", err)
		}
		
		if _, err := w.Write(data); err != nil {
			return err
		}

		if chunk.EOF {
			break
		}
	}

	return nil
}

func (c *RemoteClient) Copy(remotePath, localPath string) error {
	// Create local file
	file, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer file.Close()

	return c.Cat(remotePath, file)
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

func (c *RemoteClient) Close() error {
	return c.conn.Close()
}
