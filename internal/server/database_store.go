package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/zalando/go-keyring"
	"agentdeck/internal/config"
)

const (
	databaseConfigFileName     = "databases.json"
	databaseSavedQueriesDir    = "saved-queries"
	databaseKeyringServiceName = "agentdeck.database"

	savedQueryMetaPrefix         = "-- agentdeck-"
	savedQueryMetaID             = "query-id"
	savedQueryMetaName           = "query-name"
	savedQueryMetaConnectionID   = "connection-id"
	savedQueryMetaConnectionName = "connection-name"
	savedQueryMetaCreatedAt      = "created-at"
	savedQueryMetaUpdatedAt      = "updated-at"
)

type databaseStore struct {
	path string
}

type databaseStoreFile struct {
	Connections []config.DatabaseConnection `json:"connections,omitempty"`
}

type databaseSavedQueryFile struct {
	Query config.DatabaseSavedQuery
	Path  string
}

type databasePasswordStore interface {
	Get(connectionID string) (string, bool, error)
	Set(connectionID, password string) error
	Delete(connectionID string) error
}

type keyringDatabasePasswordStore struct {
	scope string
}

func newDatabaseStore(configPath string) *databaseStore {
	return &databaseStore{path: filepath.Join(filepath.Dir(configPath), databaseConfigFileName)}
}

func (s *databaseStore) Load() ([]config.DatabaseConnection, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var file databaseStoreFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, err
	}
	return sanitizeDatabaseConnectionsForStorage(file.Connections), nil
}

func (s *databaseStore) Save(conns []config.DatabaseConnection) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0755); err != nil {
		return err
	}
	file := databaseStoreFile{Connections: sanitizeDatabaseConnectionsForStorage(conns)}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0644)
}

func sanitizeDatabaseConnectionsForStorage(conns []config.DatabaseConnection) []config.DatabaseConnection {
	out := cloneDatabaseConnections(conns)
	for i := range out {
		out[i].Password = ""
		out[i].HasPassword = false
		out[i].SavedQueries = nil
	}
	return out
}

func newKeyringDatabasePasswordStore(configPath string) databasePasswordStore {
	dir := filepath.Dir(configPath)
	if abs, err := filepath.Abs(dir); err == nil {
		dir = abs
	}
	sum := sha256.Sum256([]byte(dir))
	return keyringDatabasePasswordStore{scope: hex.EncodeToString(sum[:])}
}

func (s keyringDatabasePasswordStore) account(connectionID string) string {
	return s.scope + ":" + strings.TrimSpace(connectionID)
}

func (s keyringDatabasePasswordStore) Get(connectionID string) (string, bool, error) {
	password, err := keyring.Get(databaseKeyringServiceName, s.account(connectionID))
	if errors.Is(err, keyring.ErrNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return password, true, nil
}

func (s keyringDatabasePasswordStore) Set(connectionID, password string) error {
	return keyring.Set(databaseKeyringServiceName, s.account(connectionID), password)
}

func (s keyringDatabasePasswordStore) Delete(connectionID string) error {
	err := keyring.Delete(databaseKeyringServiceName, s.account(connectionID))
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}

func databaseSavedQueriesPath(configPath string) string {
	return filepath.Join(filepath.Dir(configPath), databaseSavedQueriesDir)
}

func loadDatabaseSavedQueryFiles(dir string, conns []config.DatabaseConnection) (map[string][]config.DatabaseSavedQuery, []config.DatabaseSavedQuery, error) {
	entries, err := loadDatabaseSavedQueryFileEntries(dir)
	if err != nil {
		return nil, nil, err
	}
	connNames := make(map[string]string, len(conns))
	for _, conn := range conns {
		if conn.ID != "" {
			connNames[conn.ID] = conn.Name
		}
	}
	byConnection := make(map[string][]config.DatabaseSavedQuery)
	var orphaned []config.DatabaseSavedQuery
	for _, entry := range entries {
		query := entry.Query
		if query.ConnectionID != "" {
			if name, ok := connNames[query.ConnectionID]; ok {
				if query.ConnectionName == "" {
					query.ConnectionName = name
				}
				byConnection[query.ConnectionID] = append(byConnection[query.ConnectionID], query)
				continue
			}
		}
		orphaned = append(orphaned, query)
	}
	for id := range byConnection {
		sortDatabaseSavedQueries(byConnection[id])
	}
	sortDatabaseSavedQueries(orphaned)
	return byConnection, orphaned, nil
}

func loadDatabaseSavedQueryFileEntries(dir string) ([]databaseSavedQueryFile, error) {
	files, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var entries []databaseSavedQueryFile
	for _, file := range files {
		if file.IsDir() || !strings.EqualFold(filepath.Ext(file.Name()), ".sql") {
			continue
		}
		path := filepath.Join(dir, file.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		query := parseDatabaseSavedQueryFile(file.Name(), string(data))
		if query.ID == "" {
			query.ID = databaseSavedQueryIDFromFile(file.Name(), string(data))
		}
		if query.Name == "" {
			query.Name = databaseSavedQueryNameFromFile(file.Name())
		}
		if strings.TrimSpace(query.SQL) == "" {
			continue
		}
		entries = append(entries, databaseSavedQueryFile{Query: query, Path: path})
	}
	sort.Slice(entries, func(i, j int) bool {
		return databaseSavedQueryLess(entries[i].Query, entries[j].Query)
	})
	return entries, nil
}

func parseDatabaseSavedQueryFile(filename, body string) config.DatabaseSavedQuery {
	lines := strings.Split(body, "\n")
	meta := map[string]string{}
	sqlStart := 0
	for sqlStart < len(lines) {
		line := strings.TrimSpace(lines[sqlStart])
		if line == "" {
			sqlStart++
			continue
		}
		if !strings.HasPrefix(line, savedQueryMetaPrefix) {
			break
		}
		raw := strings.TrimPrefix(line, savedQueryMetaPrefix)
		key, value, ok := strings.Cut(raw, ":")
		if ok {
			meta[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
		sqlStart++
	}
	sqlText := strings.TrimSpace(strings.Join(lines[sqlStart:], "\n"))
	return config.DatabaseSavedQuery{
		ID:             meta[savedQueryMetaID],
		Name:           meta[savedQueryMetaName],
		SQL:            sqlText,
		ConnectionID:   meta[savedQueryMetaConnectionID],
		ConnectionName: meta[savedQueryMetaConnectionName],
		CreatedAt:      meta[savedQueryMetaCreatedAt],
		UpdatedAt:      meta[savedQueryMetaUpdatedAt],
	}
}

func writeDatabaseSavedQueryFile(dir string, conn config.DatabaseConnection, query config.DatabaseSavedQuery) (config.DatabaseSavedQuery, error) {
	if strings.TrimSpace(query.ID) == "" {
		query.ID = "saved-query-" + strconvBase36(time.Now().UnixNano())
	}
	query.Name = strings.TrimSpace(query.Name)
	query.SQL = strings.TrimSpace(query.SQL)
	query.ConnectionID = conn.ID
	query.ConnectionName = conn.Name
	if query.CreatedAt == "" {
		query.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if query.UpdatedAt == "" {
		query.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if query.Name == "" || query.SQL == "" || query.ConnectionID == "" {
		return config.DatabaseSavedQuery{}, errors.New("saved query requires name, SQL, and connection")
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return config.DatabaseSavedQuery{}, err
	}
	entries, err := loadDatabaseSavedQueryFileEntries(dir)
	if err != nil {
		return config.DatabaseSavedQuery{}, err
	}
	newPath := filepath.Join(dir, databaseSavedQueryFilename(conn, query))
	for _, entry := range entries {
		if entry.Query.ID == query.ID && entry.Query.ConnectionID == query.ConnectionID && entry.Path != newPath {
			_ = os.Remove(entry.Path)
			break
		}
	}
	var b strings.Builder
	writeSavedQueryMeta(&b, savedQueryMetaID, query.ID)
	writeSavedQueryMeta(&b, savedQueryMetaName, query.Name)
	writeSavedQueryMeta(&b, savedQueryMetaConnectionID, query.ConnectionID)
	writeSavedQueryMeta(&b, savedQueryMetaConnectionName, query.ConnectionName)
	writeSavedQueryMeta(&b, savedQueryMetaCreatedAt, query.CreatedAt)
	writeSavedQueryMeta(&b, savedQueryMetaUpdatedAt, query.UpdatedAt)
	b.WriteString("\n")
	b.WriteString(query.SQL)
	b.WriteString("\n")
	if err := os.WriteFile(newPath, []byte(b.String()), 0644); err != nil {
		return config.DatabaseSavedQuery{}, err
	}
	return query, nil
}

func deleteDatabaseSavedQueryFile(dir, queryID string) (config.DatabaseSavedQuery, bool, error) {
	return deleteDatabaseSavedQueryFileForConnection(dir, "", queryID)
}

func deleteDatabaseSavedQueryFileForConnection(dir, connectionID, queryID string) (config.DatabaseSavedQuery, bool, error) {
	entries, err := loadDatabaseSavedQueryFileEntries(dir)
	if err != nil {
		return config.DatabaseSavedQuery{}, false, err
	}
	for _, entry := range entries {
		if entry.Query.ID != queryID {
			continue
		}
		if connectionID != "" && entry.Query.ConnectionID != connectionID {
			continue
		}
		if err := os.Remove(entry.Path); err != nil {
			return config.DatabaseSavedQuery{}, false, err
		}
		return entry.Query, true, nil
	}
	return config.DatabaseSavedQuery{}, false, nil
}

func databaseSavedQueryFilename(conn config.DatabaseConnection, query config.DatabaseSavedQuery) string {
	connPart := slugForFilename(conn.Name)
	if connPart == "" {
		connPart = slugForFilename(conn.ID)
	}
	queryPart := slugForFilename(query.Name)
	if queryPart == "" {
		queryPart = "query"
	}
	idPart := slugForFilename(query.ID)
	if len(idPart) > 12 {
		idPart = idPart[len(idPart)-12:]
	}
	if idPart == "" {
		idPart = strconvBase36(time.Now().UnixNano())
	}
	return fmt.Sprintf("%s--%s--%s.sql", connPart, queryPart, idPart)
}

func writeSavedQueryMeta(b *strings.Builder, key, value string) {
	if strings.TrimSpace(value) == "" {
		return
	}
	b.WriteString(savedQueryMetaPrefix)
	b.WriteString(key)
	b.WriteString(": ")
	b.WriteString(strings.ReplaceAll(value, "\n", " "))
	b.WriteString("\n")
}

var filenameSlugPattern = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func slugForFilename(value string) string {
	value = strings.TrimSpace(value)
	value = filenameSlugPattern.ReplaceAllString(value, "-")
	value = strings.Trim(value, ".-_")
	if len(value) > 64 {
		value = strings.Trim(value[:64], ".-_")
	}
	return strings.ToLower(value)
}

func databaseSavedQueryNameFromFile(filename string) string {
	name := strings.TrimSuffix(filename, filepath.Ext(filename))
	parts := strings.Split(name, "--")
	if len(parts) >= 2 {
		name = parts[1]
	}
	name = strings.ReplaceAll(name, "-", " ")
	name = strings.ReplaceAll(name, "_", " ")
	return strings.TrimSpace(name)
}

func databaseSavedQueryIDFromFile(filename, body string) string {
	sum := sha256.Sum256([]byte(filename + "\n" + body))
	return "saved-query-" + hex.EncodeToString(sum[:8])
}

func sortDatabaseSavedQueries(queries []config.DatabaseSavedQuery) {
	sort.SliceStable(queries, func(i, j int) bool {
		return databaseSavedQueryLess(queries[i], queries[j])
	})
}

func databaseSavedQueryLess(a, b config.DatabaseSavedQuery) bool {
	au := strings.TrimSpace(a.UpdatedAt)
	bu := strings.TrimSpace(b.UpdatedAt)
	if au != "" || bu != "" {
		return au > bu
	}
	return strings.ToLower(a.Name) < strings.ToLower(b.Name)
}

func strconvBase36(v int64) string {
	if v < 0 {
		v = -v
	}
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	if v == 0 {
		return "0"
	}
	var out [32]byte
	i := len(out)
	for v > 0 {
		i--
		out[i] = alphabet[v%36]
		v /= 36
	}
	return string(out[i:])
}
