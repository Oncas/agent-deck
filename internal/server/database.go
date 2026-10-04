package server

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	"agentdeck/internal/config"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

const (
	dbDriverSQLite   = "sqlite"
	dbDriverPostgres = "postgres"
	dbDriverMySQL    = "mysql"

	databaseIdleTimeout = 5 * time.Minute
)

type databasePool struct {
	db        *sql.DB
	driver    string
	signature string
	lastUsed  time.Time
	active    int
	closing   bool
}

type databaseListResponse struct {
	Connections     []config.DatabaseConnection `json:"connections"`
	Connected       map[string]bool             `json:"connected,omitempty"`
	OrphanedQueries []config.DatabaseSavedQuery `json:"orphaned_queries,omitempty"`
	PasswordWarning string                      `json:"password_warning,omitempty"`
}

type databaseTestRequest struct {
	ID         string                    `json:"id"`
	Connection config.DatabaseConnection `json:"connection"`
}

type databaseConnectionSaveRequest struct {
	Connection    config.DatabaseConnection `json:"connection"`
	ClearPassword bool                      `json:"clear_password"`
}

type databasePasswordRequest struct {
	Password string `json:"password"`
	Save     bool   `json:"save"`
}

type databaseSavedQueryRequest struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	SQL  string `json:"sql"`
}

type databaseTestResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
	Driver  string `json:"driver,omitempty"`
}

type databaseDiscoverRequest struct {
	Project string `json:"project"`
}

type databaseDiscoverResponse struct {
	Project     string                      `json:"project"`
	Suggestions []config.DatabaseConnection `json:"suggestions"`
}

type databaseQueryRequest struct {
	SQL     string `json:"sql"`
	Explain bool   `json:"explain"`
	Limit   int    `json:"limit"`
}

type databaseQueryResponse struct {
	Columns     []string               `json:"columns"`
	ColumnTypes []databaseResultColumn `json:"column_types,omitempty"`
	Rows        [][]any                `json:"rows"`
	RowCount    int                    `json:"row_count"`
	Truncated   bool                   `json:"truncated"`
	ElapsedMS   int64                  `json:"elapsed_ms"`
	SQL         string                 `json:"sql"`
}

type databaseTableCountResponse struct {
	Count     int64  `json:"count"`
	ElapsedMS int64  `json:"elapsed_ms"`
	SQL       string `json:"sql"`
}

type databaseResultColumn struct {
	Name         string `json:"name"`
	DatabaseType string `json:"database_type,omitempty"`
	Length       int64  `json:"length,omitempty"`
	Binary       bool   `json:"binary,omitempty"`
}

type databaseBinaryValue struct {
	Type   string `json:"type"`
	Base64 string `json:"base64"`
	Hex    string `json:"hex"`
	Length int    `json:"length"`
}

type databaseSchemaResponse struct {
	Connection config.DatabaseConnection `json:"connection"`
	Schemas    []databaseSchema          `json:"schemas"`
}

type databaseSchema struct {
	Name   string          `json:"name"`
	Tables []databaseTable `json:"tables"`
}

type databaseTable struct {
	Schema      string               `json:"schema"`
	Name        string               `json:"name"`
	Type        string               `json:"type"`
	Columns     []databaseColumn     `json:"columns,omitempty"`
	Indexes     []databaseIndex      `json:"indexes,omitempty"`
	ForeignKeys []databaseForeignKey `json:"foreign_keys,omitempty"`
}

type databaseColumn struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	Default  string `json:"default,omitempty"`
	Primary  bool   `json:"primary,omitempty"`
	Position int    `json:"position,omitempty"`
}

type databaseIndex struct {
	Name    string   `json:"name"`
	Unique  bool     `json:"unique,omitempty"`
	Columns []string `json:"columns,omitempty"`
	SQL     string   `json:"sql,omitempty"`
}

type databaseForeignKey struct {
	Name             string `json:"name,omitempty"`
	Column           string `json:"column"`
	ReferencedSchema string `json:"referenced_schema,omitempty"`
	ReferencedTable  string `json:"referenced_table"`
	ReferencedColumn string `json:"referenced_column"`
}

func (a *apiHandler) handleListDatabases(w http.ResponseWriter, r *http.Request) {
	state, err := a.databaseStateForResponse()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, state)
}

func (a *apiHandler) handleCreateDatabase(w http.ResponseWriter, r *http.Request) {
	var req databaseConnectionSaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	conn := req.Connection
	if strings.TrimSpace(conn.ID) == "" {
		conn.ID = stableDatabaseID(conn)
	}
	if err := validateDatabaseConnection(conn); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	a.mu.RLock()
	conns := cloneDatabaseConnections(a.databaseConnections)
	a.mu.RUnlock()
	for _, existing := range conns {
		if existing.ID == conn.ID {
			http.Error(w, "database connection already exists", http.StatusConflict)
			return
		}
	}
	passwordWarning := a.persistDatabaseConnectionPassword(conn.ID, conn.Password, false)
	conn.Password = ""
	conns = append(conns, conn)
	if err := a.saveDatabaseConnections(conns); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	state, err := a.databaseStateForResponse()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if passwordWarning != "" {
		state.PasswordWarning = passwordWarning
	}
	writeJSON(w, state)
}

func (a *apiHandler) handleUpdateDatabase(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req databaseConnectionSaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	conn := req.Connection
	conn.ID = id
	if err := validateDatabaseConnection(conn); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	a.mu.RLock()
	conns := cloneDatabaseConnections(a.databaseConnections)
	a.mu.RUnlock()
	idx := -1
	for i := range conns {
		if conns[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	passwordWarning := ""
	if req.ClearPassword {
		if a.databasePasswordStore != nil {
			if err := a.databasePasswordStore.Delete(id); err != nil {
				passwordWarning = err.Error()
			}
		}
		a.clearDatabaseSessionPassword(id)
		a.closeDatabasePool(id)
	} else {
		passwordWarning = a.persistDatabaseConnectionPassword(id, conn.Password, false)
	}
	conn.Password = ""
	conns[idx] = conn
	if err := a.saveDatabaseConnections(conns); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	state, err := a.databaseStateForResponse()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if passwordWarning != "" {
		state.PasswordWarning = passwordWarning
	}
	writeJSON(w, state)
}

func (a *apiHandler) handleDeleteDatabase(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a.mu.RLock()
	conns := cloneDatabaseConnections(a.databaseConnections)
	a.mu.RUnlock()
	next := conns[:0]
	found := false
	for _, conn := range conns {
		if conn.ID == id {
			found = true
			continue
		}
		next = append(next, conn)
	}
	if !found {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	if a.databasePasswordStore != nil {
		if err := a.databasePasswordStore.Delete(id); err != nil {
			log.Printf("database password delete failed for %s: %v", id, err)
		}
	}
	a.clearDatabaseSessionPassword(id)
	if err := a.saveDatabaseConnections(next); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	a.closeDatabasePool(id)
	state, err := a.databaseStateForResponse()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, state)
}

func (a *apiHandler) handleSaveDatabasePassword(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := a.databaseConnection(id); !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	var req databasePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	password := strings.TrimSpace(req.Password)
	if password == "" {
		http.Error(w, "password required", http.StatusBadRequest)
		return
	}
	a.setDatabaseSessionPassword(id, password)
	a.closeDatabasePool(id)
	saved := false
	warning := ""
	if req.Save {
		if a.databasePasswordStore == nil {
			warning = "credential storage unavailable"
		} else if err := a.databasePasswordStore.Set(id, password); err != nil {
			warning = err.Error()
		} else {
			saved = true
		}
	}
	writeJSON(w, map[string]any{"status": "ok", "saved": saved, "warning": warning})
}

func (a *apiHandler) handleCreateDatabaseSavedQuery(w http.ResponseWriter, r *http.Request) {
	conn, ok := a.databaseConnection(r.PathValue("id"))
	if !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	var req databaseSavedQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	query := config.DatabaseSavedQuery{
		ID:        strings.TrimSpace(req.ID),
		Name:      strings.TrimSpace(req.Name),
		SQL:       strings.TrimSpace(req.SQL),
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if _, err := writeDatabaseSavedQueryFile(databaseSavedQueriesPath(a.configPath), conn, query); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	a.writeDatabaseStateResponse(w)
}

func (a *apiHandler) handleUpdateDatabaseSavedQuery(w http.ResponseWriter, r *http.Request) {
	conn, ok := a.databaseConnection(r.PathValue("id"))
	if !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	queryID := strings.TrimSpace(r.PathValue("query_id"))
	var req databaseSavedQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	entries, err := loadDatabaseSavedQueryFileEntries(databaseSavedQueriesPath(a.configPath))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var existing *config.DatabaseSavedQuery
	for _, entry := range entries {
		if entry.Query.ID == queryID && entry.Query.ConnectionID == conn.ID {
			q := entry.Query
			existing = &q
			break
		}
	}
	if existing == nil {
		http.Error(w, "saved query not found", http.StatusNotFound)
		return
	}
	query := *existing
	query.Name = strings.TrimSpace(req.Name)
	query.SQL = strings.TrimSpace(req.SQL)
	query.ConnectionID = conn.ID
	query.ConnectionName = conn.Name
	query.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := writeDatabaseSavedQueryFile(databaseSavedQueriesPath(a.configPath), conn, query); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	a.writeDatabaseStateResponse(w)
}

func (a *apiHandler) handleDeleteDatabaseSavedQuery(w http.ResponseWriter, r *http.Request) {
	conn, ok := a.databaseConnection(r.PathValue("id"))
	if !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	if _, ok, err := deleteDatabaseSavedQueryFileForConnection(databaseSavedQueriesPath(a.configPath), conn.ID, r.PathValue("query_id")); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	} else if !ok {
		http.Error(w, "saved query not found", http.StatusNotFound)
		return
	}
	a.writeDatabaseStateResponse(w)
}

func (a *apiHandler) handleDeleteDatabaseOrphanedQuery(w http.ResponseWriter, r *http.Request) {
	queryID := r.PathValue("query_id")
	entries, err := loadDatabaseSavedQueryFileEntries(databaseSavedQueriesPath(a.configPath))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var query *config.DatabaseSavedQuery
	for _, entry := range entries {
		if entry.Query.ID == queryID {
			q := entry.Query
			query = &q
			break
		}
	}
	if query == nil {
		http.Error(w, "orphaned query not found", http.StatusNotFound)
		return
	}
	if _, exists := a.databaseConnection(query.ConnectionID); exists {
		http.Error(w, "query is not orphaned", http.StatusBadRequest)
		return
	}
	if _, ok, err := deleteDatabaseSavedQueryFile(databaseSavedQueriesPath(a.configPath), queryID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	} else if !ok {
		http.Error(w, "orphaned query not found", http.StatusNotFound)
		return
	}
	a.writeDatabaseStateResponse(w)
}

func (a *apiHandler) writeDatabaseStateResponse(w http.ResponseWriter) {
	state, err := a.databaseStateForResponse()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, state)
}

func (a *apiHandler) persistDatabaseConnectionPassword(id, password string, save bool) string {
	password = strings.TrimSpace(password)
	if password == "" {
		return ""
	}
	a.setDatabaseSessionPassword(id, password)
	a.closeDatabasePool(id)
	if a.databasePasswordStore == nil {
		return "credential storage unavailable"
	}
	if err := a.databasePasswordStore.Set(id, password); err != nil {
		return err.Error()
	}
	return ""
}

func (a *apiHandler) handleTestDatabase(w http.ResponseWriter, r *http.Request) {
	var req databaseTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	conn := req.Connection
	if req.ID != "" {
		saved, ok := a.databaseConnection(req.ID)
		if !ok {
			http.Error(w, "database connection not found", http.StatusNotFound)
			return
		}
		conn = saved
		if req.Connection.Password != "" {
			conn.Password = req.Connection.Password
		}
	}
	if err := validateDatabaseConnection(conn); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	prepared, err := a.prepareDatabaseConnection(conn)
	if err != nil {
		if writeDatabasePasswordRequired(w, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	db, driver, err := a.openDatabase(ctx, prepared)
	if err != nil {
		if writeDatabasePasswordRequiredForConnection(w, prepared, err) {
			return
		}
		writeJSON(w, databaseTestResponse{OK: false, Message: err.Error(), Driver: normalizeDatabaseDriver(prepared.Driver)})
		return
	}
	defer db.Close()
	writeJSON(w, databaseTestResponse{OK: true, Message: "connected read-only", Driver: driver})
}

func (a *apiHandler) handleDiscoverDatabases(w http.ResponseWriter, r *http.Request) {
	var req databaseDiscoverRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	project := strings.TrimSpace(req.Project)
	if project == "" {
		http.Error(w, "project required", http.StatusBadRequest)
		return
	}
	proj := a.findProject(project)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	suggestions := discoverDatabaseConnections(proj.Name, proj.Path)
	writeJSON(w, databaseDiscoverResponse{Project: proj.Name, Suggestions: suggestions})
}

func (a *apiHandler) handleDatabaseSchema(w http.ResponseWriter, r *http.Request) {
	conn, ok := a.databaseConnection(r.PathValue("id"))
	if !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	var err error
	conn, err = a.prepareDatabaseConnection(conn)
	if err != nil {
		if writeDatabasePasswordRequired(w, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	db, driver, release, err := a.pooledDatabase(ctx, conn)
	if err != nil {
		if writeDatabasePasswordRequiredForConnection(w, conn, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer release()
	schemas, err := loadDatabaseSchema(ctx, db, driver, conn)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, databaseSchemaResponse{Connection: conn, Schemas: schemas})
}

func (a *apiHandler) handleDatabaseSchemaGroup(w http.ResponseWriter, r *http.Request) {
	conn, ok := a.databaseConnection(r.PathValue("id"))
	if !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	var err error
	conn, err = a.prepareDatabaseConnection(conn)
	if err != nil {
		if writeDatabasePasswordRequired(w, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	schemaName := r.PathValue("schema")
	if schemaName == "" {
		http.Error(w, "schema required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	db, driver, release, err := a.pooledDatabase(ctx, conn)
	if err != nil {
		if writeDatabasePasswordRequiredForConnection(w, conn, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer release()
	schema, err := loadDatabaseSchemaGroup(ctx, db, driver, schemaName)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, schema)
}

func (a *apiHandler) handleDatabaseTableSchema(w http.ResponseWriter, r *http.Request) {
	conn, ok := a.databaseConnection(r.PathValue("id"))
	if !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	var err error
	conn, err = a.prepareDatabaseConnection(conn)
	if err != nil {
		if writeDatabasePasswordRequired(w, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	schemaName := r.PathValue("schema")
	tableName := r.PathValue("table")
	if schemaName == "" || tableName == "" {
		http.Error(w, "schema and table required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	db, driver, release, err := a.pooledDatabase(ctx, conn)
	if err != nil {
		if writeDatabasePasswordRequiredForConnection(w, conn, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer release()
	table, err := loadDatabaseTableSchema(ctx, db, driver, schemaName, tableName)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, table)
}

func (a *apiHandler) handleDatabaseDisconnect(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.databaseConnection(r.PathValue("id")); !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	disconnected := a.closeDatabasePool(r.PathValue("id"))
	writeJSON(w, map[string]bool{"connected": false, "disconnected": disconnected})
}

func (a *apiHandler) handleDatabaseTableRows(w http.ResponseWriter, r *http.Request) {
	conn, ok := a.databaseConnection(r.PathValue("id"))
	if !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	var err error
	conn, err = a.prepareDatabaseConnection(conn)
	if err != nil {
		if writeDatabasePasswordRequired(w, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	driver := normalizeDatabaseDriver(conn.Driver)
	schema := r.PathValue("schema")
	table := r.PathValue("table")
	if table == "" {
		http.Error(w, "table required", http.StatusBadRequest)
		return
	}
	limit := clampDatabaseLimit(queryInt(r, "limit", 100))
	offset := queryInt(r, "offset", 0)
	if offset < 0 {
		offset = 0
	}
	whereClause := strings.TrimSpace(r.URL.Query().Get("where"))
	if err := validateDatabaseWhereClause(whereClause); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	orderColumn := strings.TrimSpace(r.URL.Query().Get("order_column"))
	orderDir, err := validateDatabaseOrder(orderColumn, r.URL.Query().Get("order_dir"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	db, _, release, err := a.pooledDatabase(ctx, conn)
	if err != nil {
		if writeDatabasePasswordRequiredForConnection(w, conn, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer release()
	sqlText := fmt.Sprintf("SELECT * FROM %s", qualifiedTableName(driver, schema, table))
	if whereClause != "" {
		sqlText += " WHERE " + whereClause
	}
	if orderColumn != "" {
		sqlText += " ORDER BY " + quoteDatabaseIdent(driver, orderColumn) + " " + strings.ToUpper(orderDir)
	}
	sqlText += fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)
	result, err := queryDatabaseRows(ctx, db, driver, sqlText, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	result.SQL = sqlText
	writeJSON(w, result)
}

func (a *apiHandler) handleDatabaseTableCount(w http.ResponseWriter, r *http.Request) {
	conn, ok := a.databaseConnection(r.PathValue("id"))
	if !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	var err error
	conn, err = a.prepareDatabaseConnection(conn)
	if err != nil {
		if writeDatabasePasswordRequired(w, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	driver := normalizeDatabaseDriver(conn.Driver)
	schema := r.PathValue("schema")
	table := r.PathValue("table")
	if table == "" {
		http.Error(w, "table required", http.StatusBadRequest)
		return
	}
	whereClause := strings.TrimSpace(r.URL.Query().Get("where"))
	if err := validateDatabaseWhereClause(whereClause); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	db, _, release, err := a.pooledDatabase(ctx, conn)
	if err != nil {
		if writeDatabasePasswordRequiredForConnection(w, conn, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer release()
	sqlText := fmt.Sprintf("SELECT COUNT(*) FROM %s", qualifiedTableName(driver, schema, table))
	if whereClause != "" {
		sqlText += " WHERE " + whereClause
	}
	count, elapsed, err := queryDatabaseCount(ctx, db, sqlText)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, databaseTableCountResponse{Count: count, ElapsedMS: elapsed, SQL: sqlText})
}

func (a *apiHandler) handleDatabaseQuery(w http.ResponseWriter, r *http.Request) {
	conn, ok := a.databaseConnection(r.PathValue("id"))
	if !ok {
		http.Error(w, "database connection not found", http.StatusNotFound)
		return
	}
	var err error
	conn, err = a.prepareDatabaseConnection(conn)
	if err != nil {
		if writeDatabasePasswordRequired(w, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	var req databaseQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	sqlText := strings.TrimSpace(req.SQL)
	if sqlText == "" {
		http.Error(w, "sql required", http.StatusBadRequest)
		return
	}
	if err := validateReadOnlySQL(sqlText); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	driver := normalizeDatabaseDriver(conn.Driver)
	if req.Explain && !startsWithSQLKeyword(sqlText, "explain") {
		sqlText = explainSQL(driver, sqlText)
	}
	limit := clampDatabaseLimit(req.Limit)

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	db, _, release, err := a.pooledDatabase(ctx, conn)
	if err != nil {
		if writeDatabasePasswordRequiredForConnection(w, conn, err) {
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer release()
	result, err := queryDatabaseRows(ctx, db, driver, sqlText, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	result.SQL = sqlText
	writeJSON(w, result)
}

func (a *apiHandler) databaseConnection(id string) (config.DatabaseConnection, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	for _, conn := range a.databaseConnections {
		if conn.ID == id {
			return conn, true
		}
	}
	return config.DatabaseConnection{}, false
}

func (a *apiHandler) pooledDatabase(ctx context.Context, conn config.DatabaseConnection) (*sql.DB, string, func(), error) {
	if strings.TrimSpace(conn.ID) == "" {
		db, driver, err := a.openDatabase(ctx, conn)
		if err != nil {
			return nil, driver, nil, err
		}
		return db, driver, func() { _ = db.Close() }, nil
	}

	signature := databaseConnectionSignature(conn)
	now := time.Now()
	var stale *sql.DB
	a.databaseMu.Lock()
	if a.databasePools == nil {
		a.databasePools = make(map[string]*databasePool)
	}
	if pool := a.databasePools[conn.ID]; pool != nil {
		if pool.signature == signature && !pool.closing {
			pool.active++
			pool.lastUsed = now
			db, driver := pool.db, pool.driver
			a.databaseMu.Unlock()
			return db, driver, func() { a.releaseDatabasePool(pool) }, nil
		}
		delete(a.databasePools, conn.ID)
		if db := retireDatabasePoolLocked(pool); db != nil {
			stale = db
		}
	}
	a.databaseMu.Unlock()
	if stale != nil {
		_ = stale.Close()
	}

	db, driver, err := a.openDatabase(ctx, conn)
	if err != nil {
		return nil, driver, nil, err
	}
	now = time.Now()
	var replaced []*sql.DB
	a.databaseMu.Lock()
	if a.databasePools == nil {
		a.databasePools = make(map[string]*databasePool)
	}
	if pool := a.databasePools[conn.ID]; pool != nil {
		if pool.signature == signature && !pool.closing {
			pool.active++
			pool.lastUsed = now
			pooledDB, pooledDriver := pool.db, pool.driver
			a.databaseMu.Unlock()
			_ = db.Close()
			return pooledDB, pooledDriver, func() { a.releaseDatabasePool(pool) }, nil
		}
		delete(a.databasePools, conn.ID)
		if db := retireDatabasePoolLocked(pool); db != nil {
			replaced = append(replaced, db)
		}
	}
	pool := &databasePool{db: db, driver: driver, signature: signature, lastUsed: now, active: 1}
	a.databasePools[conn.ID] = pool
	a.databaseMu.Unlock()
	for _, db := range replaced {
		_ = db.Close()
	}
	return db, driver, func() { a.releaseDatabasePool(pool) }, nil
}

func (a *apiHandler) releaseDatabasePool(pool *databasePool) {
	if pool == nil {
		return
	}
	var stale *sql.DB
	a.databaseMu.Lock()
	if pool.active > 0 {
		pool.active--
	}
	pool.lastUsed = time.Now()
	if pool.closing && pool.active == 0 && pool.db != nil {
		stale = pool.db
		pool.db = nil
	}
	a.databaseMu.Unlock()
	if stale != nil {
		_ = stale.Close()
	}
}

func retireDatabasePoolLocked(pool *databasePool) *sql.DB {
	if pool == nil || pool.db == nil {
		return nil
	}
	pool.closing = true
	if pool.active > 0 {
		return nil
	}
	db := pool.db
	pool.db = nil
	return db
}

func (a *apiHandler) closeDatabasePool(id string) bool {
	a.databaseMu.Lock()
	if a.databasePools == nil {
		a.databaseMu.Unlock()
		return false
	}
	pool := a.databasePools[id]
	if pool != nil {
		delete(a.databasePools, id)
	}
	var stale *sql.DB
	if pool != nil {
		stale = retireDatabasePoolLocked(pool)
	}
	a.databaseMu.Unlock()
	if pool == nil {
		return false
	}
	if stale != nil {
		_ = stale.Close()
	}
	return true
}

func (a *apiHandler) databaseConnectionStatuses() map[string]bool {
	out := map[string]bool{}
	a.databaseMu.Lock()
	for id := range a.databasePools {
		out[id] = true
	}
	a.databaseMu.Unlock()
	return out
}

func (a *apiHandler) runDatabaseIdleCloser(interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		a.closeIdleDatabasePools(time.Now())
	}
}

func (a *apiHandler) closeIdleDatabasePools(now time.Time) {
	var stale []*sql.DB
	a.databaseMu.Lock()
	for id, pool := range a.databasePools {
		if pool.active > 0 || now.Sub(pool.lastUsed) < databaseIdleTimeout {
			continue
		}
		delete(a.databasePools, id)
		stale = append(stale, pool.db)
	}
	a.databaseMu.Unlock()
	for _, db := range stale {
		_ = db.Close()
	}
}

func (a *apiHandler) reconcileDatabasePools(conns []config.DatabaseConnection) {
	signatures := databaseConnectionSignatures(conns)
	var stale []*sql.DB
	a.databaseMu.Lock()
	for id, pool := range a.databasePools {
		if signatures[id] == pool.signature {
			continue
		}
		delete(a.databasePools, id)
		if db := retireDatabasePoolLocked(pool); db != nil {
			stale = append(stale, db)
		}
	}
	a.databaseMu.Unlock()
	for _, db := range stale {
		_ = db.Close()
	}
}

func databaseConnectionSignatures(conns []config.DatabaseConnection) map[string]string {
	out := make(map[string]string, len(conns))
	for _, conn := range conns {
		if conn.ID == "" {
			continue
		}
		out[conn.ID] = databaseConnectionSignature(conn)
	}
	return out
}

func databaseConnectionSignature(conn config.DatabaseConnection) string {
	conn.SavedQueries = nil
	conn.Password = ""
	conn.HasPassword = false
	data, err := json.Marshal(conn)
	if err != nil {
		return conn.ID
	}
	return string(data)
}

func databaseAuthFailureNeedsPassword(conn config.DatabaseConnection, err error) bool {
	if err == nil || normalizeDatabaseDriver(conn.Driver) == dbDriverSQLite || strings.TrimSpace(conn.User) == "" {
		return false
	}
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == 1045
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "28P01"
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "password authentication failed") ||
		strings.Contains(message, "failed sasl auth") ||
		strings.Contains(message, "access denied for user") ||
		strings.Contains(message, "using password: no") ||
		strings.Contains(message, "requires a password")
}

func (a *apiHandler) openDatabase(ctx context.Context, conn config.DatabaseConnection) (*sql.DB, string, error) {
	driver := normalizeDatabaseDriver(conn.Driver)
	dsn, err := databaseDSN(driver, conn, conn.Password)
	if err != nil {
		return nil, driver, err
	}
	db, err := sql.Open(databaseSQLDriver(driver), dsn)
	if err != nil {
		return nil, driver, err
	}
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(1)
	db.SetConnMaxIdleTime(databaseIdleTimeout)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, driver, err
	}
	if driver == dbDriverSQLite {
		if _, err := db.ExecContext(ctx, "PRAGMA query_only=ON"); err != nil {
			db.Close()
			return nil, driver, err
		}
	}
	return db, driver, nil
}

func validateDatabaseConnection(conn config.DatabaseConnection) error {
	driver := normalizeDatabaseDriver(conn.Driver)
	if driver == "" {
		return errors.New("driver required")
	}
	if conn.Name == "" {
		return errors.New("name required")
	}
	if driver == dbDriverSQLite {
		if strings.TrimSpace(conn.SQLitePath) == "" {
			return errors.New("sqlite_path required")
		}
		return nil
	}
	if strings.TrimSpace(conn.Host) == "" {
		return errors.New("host required")
	}
	if driver == dbDriverPostgres && strings.TrimSpace(conn.Database) == "" {
		return errors.New("database required")
	}
	return nil
}

func databaseDSN(driver string, conn config.DatabaseConnection, password string) (string, error) {
	switch driver {
	case dbDriverSQLite:
		path := strings.TrimSpace(conn.SQLitePath)
		if path == "" {
			return "", errors.New("sqlite_path required")
		}
		if abs, err := filepath.Abs(path); err == nil {
			path = abs
		}
		u := url.URL{Scheme: "file", Path: path}
		q := u.Query()
		q.Set("mode", "ro")
		q.Set("cache", "shared")
		u.RawQuery = q.Encode()
		return u.String(), nil
	case dbDriverPostgres:
		host := strings.TrimSpace(conn.Host)
		if host == "" {
			return "", errors.New("host required")
		}
		u := url.URL{Scheme: "postgres", Host: net.JoinHostPort(host, strconv.Itoa(defaultDatabasePort(driver, conn.Port))), Path: "/" + strings.TrimPrefix(conn.Database, "/")}
		if conn.User != "" {
			if password != "" {
				u.User = url.UserPassword(conn.User, password)
			} else {
				u.User = url.User(conn.User)
			}
		}
		q := u.Query()
		sslMode := strings.TrimSpace(conn.SSLMode)
		if sslMode == "" {
			sslMode = "disable"
		}
		q.Set("sslmode", sslMode)
		for key, value := range conn.Params {
			if key != "" {
				q.Set(key, value)
			}
		}
		u.RawQuery = q.Encode()
		return u.String(), nil
	case dbDriverMySQL:
		cfg := mysql.NewConfig()
		cfg.User = conn.User
		cfg.Passwd = password
		cfg.Net = "tcp"
		cfg.Addr = net.JoinHostPort(strings.TrimSpace(conn.Host), strconv.Itoa(defaultDatabasePort(driver, conn.Port)))
		cfg.DBName = strings.TrimSpace(conn.Database)
		cfg.ParseTime = true
		cfg.Params = map[string]string{}
		for key, value := range conn.Params {
			if key != "" {
				cfg.Params[key] = value
			}
		}
		return cfg.FormatDSN(), nil
	default:
		return "", errors.New("unsupported driver")
	}
}

func queryDatabaseRows(ctx context.Context, db *sql.DB, driver string, sqlText string, maxRows int) (databaseQueryResponse, error) {
	start := time.Now()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return databaseQueryResponse{}, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, sqlText)
	if err != nil {
		return databaseQueryResponse{}, err
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return databaseQueryResponse{}, err
	}
	columnTypes := databaseResultColumns(rows, columns)
	result := databaseQueryResponse{
		Columns:     columns,
		ColumnTypes: columnTypes,
		Rows:        [][]any{},
		SQL:         sqlText,
	}
	for rows.Next() {
		values := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return databaseQueryResponse{}, err
		}
		if result.RowCount >= maxRows {
			result.Truncated = true
			break
		}
		row := make([]any, len(values))
		for i, value := range values {
			row[i] = normalizeDBValue(value, columnTypes[i])
		}
		result.Rows = append(result.Rows, row)
		result.RowCount++
	}
	if err := rows.Err(); err != nil {
		return databaseQueryResponse{}, err
	}
	result.ElapsedMS = time.Since(start).Milliseconds()
	return result, nil
}

func queryDatabaseCount(ctx context.Context, db *sql.DB, sqlText string) (int64, int64, error) {
	start := time.Now()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()

	var count int64
	if err := tx.QueryRowContext(ctx, sqlText).Scan(&count); err != nil {
		return 0, 0, err
	}
	return count, time.Since(start).Milliseconds(), nil
}

func databaseResultColumns(rows *sql.Rows, columns []string) []databaseResultColumn {
	out := make([]databaseResultColumn, len(columns))
	for i, name := range columns {
		out[i] = databaseResultColumn{Name: name}
	}
	columnTypes, err := rows.ColumnTypes()
	if err != nil {
		return out
	}
	for i, columnType := range columnTypes {
		if i >= len(out) {
			break
		}
		databaseType := strings.TrimSpace(columnType.DatabaseTypeName())
		out[i].DatabaseType = databaseType
		if length, ok := columnType.Length(); ok {
			out[i].Length = length
		}
		out[i].Binary = isDatabaseBinaryType(databaseType)
	}
	return out
}

func isDatabaseBinaryType(databaseType string) bool {
	normalized := strings.ToUpper(strings.TrimSpace(databaseType))
	if normalized == "" {
		return false
	}
	if strings.Contains(normalized, "BINARY") || strings.HasSuffix(normalized, "BLOB") {
		return true
	}
	switch normalized {
	case "BLOB", "BYTEA", "RAW", "LONG RAW":
		return true
	default:
		return false
	}
}

func normalizeDBValue(value any, column databaseResultColumn) any {
	switch v := value.(type) {
	case nil:
		return nil
	case []byte:
		if column.Binary {
			return databaseBinaryValue{
				Type:   "binary",
				Base64: base64.StdEncoding.EncodeToString(v),
				Hex:    hex.EncodeToString(v),
				Length: len(v),
			}
		}
		return string(v)
	case time.Time:
		return v.Format(time.RFC3339Nano)
	default:
		return v
	}
}

func loadDatabaseSchema(ctx context.Context, db *sql.DB, driver string, conn config.DatabaseConnection) ([]databaseSchema, error) {
	switch driver {
	case dbDriverSQLite:
		return loadSQLiteSchema(ctx, db)
	case dbDriverPostgres:
		return loadPostgresSchema(ctx, db)
	case dbDriverMySQL:
		return loadMySQLSchema(ctx, db)
	default:
		return nil, errors.New("unsupported driver")
	}
}

func loadDatabaseSchemaGroup(ctx context.Context, db *sql.DB, driver string, schemaName string) (databaseSchema, error) {
	switch driver {
	case dbDriverSQLite:
		if schemaName != "" && schemaName != "main" {
			return databaseSchema{}, fmt.Errorf("schema %q not found", schemaName)
		}
		schemas, err := loadSQLiteSchema(ctx, db)
		if err != nil {
			return databaseSchema{}, err
		}
		if len(schemas) == 0 {
			return databaseSchema{}, errors.New("schema not found")
		}
		return schemas[0], nil
	case dbDriverPostgres:
		return loadPostgresSchemaGroup(ctx, db, schemaName)
	case dbDriverMySQL:
		return loadMySQLSchemaGroup(ctx, db, schemaName)
	default:
		return databaseSchema{}, errors.New("unsupported driver")
	}
}

func loadDatabaseTableSchema(ctx context.Context, db *sql.DB, driver string, schemaName, tableName string) (databaseTable, error) {
	switch driver {
	case dbDriverSQLite:
		if schemaName != "" && schemaName != "main" {
			return databaseTable{}, fmt.Errorf("table %q.%q not found", schemaName, tableName)
		}
		return loadSQLiteTableSchema(ctx, db, tableName)
	case dbDriverPostgres:
		return loadPostgresTableSchema(ctx, db, schemaName, tableName)
	case dbDriverMySQL:
		return loadMySQLTableSchema(ctx, db, schemaName, tableName)
	default:
		return databaseTable{}, errors.New("unsupported driver")
	}
}

func loadSQLiteSchema(ctx context.Context, db *sql.DB) ([]databaseSchema, error) {
	tables, err := sqliteTables(ctx, db)
	if err != nil {
		return nil, err
	}
	for i := range tables {
		table := tables[i].Name
		tables[i].Columns, _ = sqliteColumns(ctx, db, table)
		tables[i].Indexes, _ = sqliteIndexes(ctx, db, table)
		tables[i].ForeignKeys, _ = sqliteForeignKeys(ctx, db, table)
	}
	return []databaseSchema{{Name: "main", Tables: tables}}, nil
}

func loadSQLiteTableSchema(ctx context.Context, db *sql.DB, tableName string) (databaseTable, error) {
	tables, err := sqliteTables(ctx, db)
	if err != nil {
		return databaseTable{}, err
	}
	for _, table := range tables {
		if table.Name != tableName {
			continue
		}
		table.Columns, _ = sqliteColumns(ctx, db, table.Name)
		table.Indexes, _ = sqliteIndexes(ctx, db, table.Name)
		table.ForeignKeys, _ = sqliteForeignKeys(ctx, db, table.Name)
		return table, nil
	}
	return databaseTable{}, fmt.Errorf("table %q not found", tableName)
}

func sqliteTables(ctx context.Context, db *sql.DB) ([]databaseTable, error) {
	rows, err := db.QueryContext(ctx, "SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []databaseTable
	for rows.Next() {
		var name, typ string
		if err := rows.Scan(&name, &typ); err != nil {
			return nil, err
		}
		out = append(out, databaseTable{Schema: "main", Name: name, Type: typ})
	}
	return out, rows.Err()
}

func sqliteColumns(ctx context.Context, db *sql.DB, table string) ([]databaseColumn, error) {
	rows, err := db.QueryContext(ctx, "PRAGMA table_xinfo("+sqliteLiteral(table)+")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []databaseColumn
	for rows.Next() {
		var cid, notNull, pk, hidden int
		var name, typ string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk, &hidden); err != nil {
			return nil, err
		}
		if hidden != 0 {
			continue
		}
		out = append(out, databaseColumn{Name: name, Type: typ, Nullable: notNull == 0, Default: dflt.String, Primary: pk > 0, Position: cid + 1})
	}
	return out, rows.Err()
}

func sqliteIndexes(ctx context.Context, db *sql.DB, table string) ([]databaseIndex, error) {
	rows, err := db.QueryContext(ctx, "PRAGMA index_list("+sqliteLiteral(table)+")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []databaseIndex
	for rows.Next() {
		var seq, unique, partial int
		var name, origin string
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			return nil, err
		}
		out = append(out, databaseIndex{Name: name, Unique: unique == 1, Columns: sqliteIndexColumns(ctx, db, name)})
	}
	return out, rows.Err()
}

func sqliteIndexColumns(ctx context.Context, db *sql.DB, index string) []string {
	rows, err := db.QueryContext(ctx, "PRAGMA index_info("+sqliteLiteral(index)+")")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var seqno, cid int
		var name string
		if err := rows.Scan(&seqno, &cid, &name); err == nil {
			out = append(out, name)
		}
	}
	return out
}

func sqliteForeignKeys(ctx context.Context, db *sql.DB, table string) ([]databaseForeignKey, error) {
	rows, err := db.QueryContext(ctx, "PRAGMA foreign_key_list("+sqliteLiteral(table)+")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []databaseForeignKey
	for rows.Next() {
		var id, seq int
		var refTable, from, to, onUpdate, onDelete, match string
		if err := rows.Scan(&id, &seq, &refTable, &from, &to, &onUpdate, &onDelete, &match); err != nil {
			return nil, err
		}
		out = append(out, databaseForeignKey{Name: fmt.Sprintf("fk_%d", id), Column: from, ReferencedTable: refTable, ReferencedColumn: to})
	}
	return out, rows.Err()
}

func loadPostgresSchema(ctx context.Context, db *sql.DB) ([]databaseSchema, error) {
	tables, err := postgresTables(ctx, db)
	if err != nil {
		return nil, err
	}
	byKey := map[string]*databaseTable{}
	for i := range tables {
		key := tableKey(tables[i].Schema, tables[i].Name)
		byKey[key] = &tables[i]
	}
	applyColumns(ctx, db, byKey, postgresColumnsSQL, nil)
	applyIndexes(ctx, db, byKey, postgresIndexesSQL, nil)
	applyForeignKeys(ctx, db, byKey, postgresForeignKeysSQL, nil)
	return groupDatabaseTables(tables), nil
}

func loadPostgresSchemaGroup(ctx context.Context, db *sql.DB, schemaName string) (databaseSchema, error) {
	tables, err := postgresTablesForSchema(ctx, db, schemaName)
	if err != nil {
		return databaseSchema{}, err
	}
	byKey := map[string]*databaseTable{}
	for i := range tables {
		byKey[tableKey(tables[i].Schema, tables[i].Name)] = &tables[i]
	}
	applyColumns(ctx, db, byKey, postgresColumnsForSchemaSQL, []any{schemaName})
	applyIndexes(ctx, db, byKey, postgresIndexesForSchemaSQL, []any{schemaName})
	applyForeignKeys(ctx, db, byKey, postgresForeignKeysForSchemaSQL, []any{schemaName})
	return databaseSchema{Name: schemaName, Tables: tables}, nil
}

func loadPostgresTableSchema(ctx context.Context, db *sql.DB, schemaName, tableName string) (databaseTable, error) {
	tables, err := postgresTablesForTable(ctx, db, schemaName, tableName)
	if err != nil {
		return databaseTable{}, err
	}
	if len(tables) == 0 {
		return databaseTable{}, fmt.Errorf("table %q.%q not found", schemaName, tableName)
	}
	byKey := map[string]*databaseTable{tableKey(tables[0].Schema, tables[0].Name): &tables[0]}
	args := []any{schemaName, tableName}
	applyColumns(ctx, db, byKey, postgresColumnsForTableSQL, args)
	applyIndexes(ctx, db, byKey, postgresIndexesForTableSQL, args)
	applyForeignKeys(ctx, db, byKey, postgresForeignKeysForTableSQL, args)
	return tables[0], nil
}

func postgresTables(ctx context.Context, db *sql.DB) ([]databaseTable, error) {
	rows, err := db.QueryContext(ctx, `SELECT table_schema, table_name, lower(table_type)
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name`)
	return scanDatabaseTables(rows, err)
}

func postgresTablesForSchema(ctx context.Context, db *sql.DB, schemaName string) ([]databaseTable, error) {
	rows, err := db.QueryContext(ctx, `SELECT table_schema, table_name, lower(table_type)
FROM information_schema.tables
WHERE table_schema = $1
ORDER BY table_schema, table_name`, schemaName)
	return scanDatabaseTables(rows, err)
}

func postgresTablesForTable(ctx context.Context, db *sql.DB, schemaName, tableName string) ([]databaseTable, error) {
	rows, err := db.QueryContext(ctx, `SELECT table_schema, table_name, lower(table_type)
FROM information_schema.tables
WHERE table_schema = $1 AND table_name = $2
ORDER BY table_schema, table_name`, schemaName, tableName)
	return scanDatabaseTables(rows, err)
}

func scanDatabaseTables(rows *sql.Rows, err error) ([]databaseTable, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []databaseTable
	for rows.Next() {
		var schema, name, typ string
		if err := rows.Scan(&schema, &name, &typ); err != nil {
			return nil, err
		}
		out = append(out, databaseTable{Schema: schema, Name: name, Type: typ})
	}
	return out, rows.Err()
}

func loadMySQLSchema(ctx context.Context, db *sql.DB) ([]databaseSchema, error) {
	tables, err := mysqlTables(ctx, db)
	if err != nil {
		return nil, err
	}
	byKey := map[string]*databaseTable{}
	for i := range tables {
		key := tableKey(tables[i].Schema, tables[i].Name)
		byKey[key] = &tables[i]
	}
	applyColumns(ctx, db, byKey, mysqlColumnsSQL, nil)
	applyIndexes(ctx, db, byKey, mysqlIndexesSQL, nil)
	applyForeignKeys(ctx, db, byKey, mysqlForeignKeysSQL, nil)
	return groupDatabaseTables(tables), nil
}

func loadMySQLSchemaGroup(ctx context.Context, db *sql.DB, schemaName string) (databaseSchema, error) {
	tables, err := mysqlTablesForSchema(ctx, db, schemaName)
	if err != nil {
		return databaseSchema{}, err
	}
	byKey := map[string]*databaseTable{}
	for i := range tables {
		byKey[tableKey(tables[i].Schema, tables[i].Name)] = &tables[i]
	}
	applyColumns(ctx, db, byKey, mysqlColumnsForSchemaSQL, []any{schemaName})
	applyIndexes(ctx, db, byKey, mysqlIndexesForSchemaSQL, []any{schemaName})
	applyForeignKeys(ctx, db, byKey, mysqlForeignKeysForSchemaSQL, []any{schemaName})
	return databaseSchema{Name: schemaName, Tables: tables}, nil
}

func loadMySQLTableSchema(ctx context.Context, db *sql.DB, schemaName, tableName string) (databaseTable, error) {
	tables, err := mysqlTablesForTable(ctx, db, schemaName, tableName)
	if err != nil {
		return databaseTable{}, err
	}
	if len(tables) == 0 {
		return databaseTable{}, fmt.Errorf("table %q.%q not found", schemaName, tableName)
	}
	byKey := map[string]*databaseTable{tableKey(tables[0].Schema, tables[0].Name): &tables[0]}
	args := []any{schemaName, tableName}
	applyColumns(ctx, db, byKey, mysqlColumnsForTableSQL, args)
	applyIndexes(ctx, db, byKey, mysqlIndexesForTableSQL, args)
	applyForeignKeys(ctx, db, byKey, mysqlForeignKeysForTableSQL, args)
	return tables[0], nil
}

func mysqlTables(ctx context.Context, db *sql.DB) ([]databaseTable, error) {
	rows, err := db.QueryContext(ctx, `SELECT table_schema, table_name, lower(table_type)
FROM information_schema.tables
WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
ORDER BY table_schema, table_name`)
	return scanDatabaseTables(rows, err)
}

func mysqlTablesForSchema(ctx context.Context, db *sql.DB, schemaName string) ([]databaseTable, error) {
	rows, err := db.QueryContext(ctx, `SELECT table_schema, table_name, lower(table_type)
FROM information_schema.tables
WHERE table_schema = ?
ORDER BY table_schema, table_name`, schemaName)
	return scanDatabaseTables(rows, err)
}

func mysqlTablesForTable(ctx context.Context, db *sql.DB, schemaName, tableName string) ([]databaseTable, error) {
	rows, err := db.QueryContext(ctx, `SELECT table_schema, table_name, lower(table_type)
FROM information_schema.tables
WHERE table_schema = ? AND table_name = ?
ORDER BY table_schema, table_name`, schemaName, tableName)
	return scanDatabaseTables(rows, err)
}

const postgresColumnsSQL = `SELECT table_schema, table_name, column_name, data_type, is_nullable, COALESCE(column_default, ''), ordinal_position
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name, ordinal_position`

const postgresColumnsForSchemaSQL = `SELECT table_schema, table_name, column_name, data_type, is_nullable, COALESCE(column_default, ''), ordinal_position
FROM information_schema.columns
WHERE table_schema = $1
ORDER BY table_schema, table_name, ordinal_position`

const postgresColumnsForTableSQL = `SELECT table_schema, table_name, column_name, data_type, is_nullable, COALESCE(column_default, ''), ordinal_position
FROM information_schema.columns
WHERE table_schema = $1 AND table_name = $2
ORDER BY table_schema, table_name, ordinal_position`

const postgresIndexesSQL = `SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename, indexname`

const postgresIndexesForSchemaSQL = `SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = $1
ORDER BY schemaname, tablename, indexname`

const postgresIndexesForTableSQL = `SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = $1 AND tablename = $2
ORDER BY schemaname, tablename, indexname`

const postgresForeignKeysSQL = `SELECT tc.table_schema, tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`

const postgresForeignKeysForSchemaSQL = `SELECT tc.table_schema, tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1
ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`

const postgresForeignKeysForTableSQL = `SELECT tc.table_schema, tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2
ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`

const mysqlColumnsSQL = `SELECT table_schema, table_name, column_name, column_type, is_nullable, COALESCE(column_default, ''), ordinal_position, column_key = 'PRI'
FROM information_schema.columns
WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
ORDER BY table_schema, table_name, ordinal_position`

const mysqlColumnsForSchemaSQL = `SELECT table_schema, table_name, column_name, column_type, is_nullable, COALESCE(column_default, ''), ordinal_position, column_key = 'PRI'
FROM information_schema.columns
WHERE table_schema = ?
ORDER BY table_schema, table_name, ordinal_position`

const mysqlColumnsForTableSQL = `SELECT table_schema, table_name, column_name, column_type, is_nullable, COALESCE(column_default, ''), ordinal_position, column_key = 'PRI'
FROM information_schema.columns
WHERE table_schema = ? AND table_name = ?
ORDER BY table_schema, table_name, ordinal_position`

const mysqlIndexesSQL = `SELECT table_schema, table_name, index_name, non_unique = 0, column_name
FROM information_schema.statistics
WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
ORDER BY table_schema, table_name, index_name, seq_in_index`

const mysqlIndexesForSchemaSQL = `SELECT table_schema, table_name, index_name, non_unique = 0, column_name
FROM information_schema.statistics
WHERE table_schema = ?
ORDER BY table_schema, table_name, index_name, seq_in_index`

const mysqlIndexesForTableSQL = `SELECT table_schema, table_name, index_name, non_unique = 0, column_name
FROM information_schema.statistics
WHERE table_schema = ? AND table_name = ?
ORDER BY table_schema, table_name, index_name, seq_in_index`

const mysqlForeignKeysSQL = `SELECT table_schema, table_name, constraint_name, column_name, referenced_table_schema, referenced_table_name, referenced_column_name
FROM information_schema.key_column_usage
WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') AND referenced_table_name IS NOT NULL
ORDER BY table_schema, table_name, constraint_name, ordinal_position`

const mysqlForeignKeysForSchemaSQL = `SELECT table_schema, table_name, constraint_name, column_name, referenced_table_schema, referenced_table_name, referenced_column_name
FROM information_schema.key_column_usage
WHERE table_schema = ? AND referenced_table_name IS NOT NULL
ORDER BY table_schema, table_name, constraint_name, ordinal_position`

const mysqlForeignKeysForTableSQL = `SELECT table_schema, table_name, constraint_name, column_name, referenced_table_schema, referenced_table_name, referenced_column_name
FROM information_schema.key_column_usage
WHERE table_schema = ? AND table_name = ? AND referenced_table_name IS NOT NULL
ORDER BY table_schema, table_name, constraint_name, ordinal_position`

func applyColumns(ctx context.Context, db *sql.DB, tables map[string]*databaseTable, query string, args []any) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var schema, table, name, typ, nullable, dflt string
		var position int
		var primary bool
		if strings.Contains(query, "column_key = 'PRI'") {
			if err := rows.Scan(&schema, &table, &name, &typ, &nullable, &dflt, &position, &primary); err != nil {
				continue
			}
		} else {
			if err := rows.Scan(&schema, &table, &name, &typ, &nullable, &dflt, &position); err != nil {
				continue
			}
		}
		if t := tables[tableKey(schema, table)]; t != nil {
			t.Columns = append(t.Columns, databaseColumn{Name: name, Type: typ, Nullable: nullable == "YES", Default: dflt, Position: position, Primary: primary})
		}
	}
}

func applyIndexes(ctx context.Context, db *sql.DB, tables map[string]*databaseTable, query string, args []any) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return
	}
	defer rows.Close()
	indexByKey := map[string]*databaseIndex{}
	for rows.Next() {
		if strings.Contains(query, "pg_indexes") {
			var schema, table, name, def string
			if err := rows.Scan(&schema, &table, &name, &def); err != nil {
				continue
			}
			if t := tables[tableKey(schema, table)]; t != nil {
				t.Indexes = append(t.Indexes, databaseIndex{Name: name, SQL: def})
			}
			continue
		}
		var schema, table, name, column string
		var unique bool
		if err := rows.Scan(&schema, &table, &name, &unique, &column); err != nil {
			continue
		}
		t := tables[tableKey(schema, table)]
		if t == nil {
			continue
		}
		key := tableKey(schema, table) + "\x00" + name
		idx := indexByKey[key]
		if idx == nil {
			t.Indexes = append(t.Indexes, databaseIndex{Name: name, Unique: unique})
			idx = &t.Indexes[len(t.Indexes)-1]
			indexByKey[key] = idx
		}
		idx.Columns = append(idx.Columns, column)
	}
}

func applyForeignKeys(ctx context.Context, db *sql.DB, tables map[string]*databaseTable, query string, args []any) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var schema, table, name, column, refSchema, refTable, refColumn string
		if err := rows.Scan(&schema, &table, &name, &column, &refSchema, &refTable, &refColumn); err != nil {
			continue
		}
		if t := tables[tableKey(schema, table)]; t != nil {
			t.ForeignKeys = append(t.ForeignKeys, databaseForeignKey{Name: name, Column: column, ReferencedSchema: refSchema, ReferencedTable: refTable, ReferencedColumn: refColumn})
		}
	}
}

func groupDatabaseTables(tables []databaseTable) []databaseSchema {
	byName := map[string][]databaseTable{}
	for _, table := range tables {
		byName[table.Schema] = append(byName[table.Schema], table)
	}
	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]databaseSchema, 0, len(names))
	for _, name := range names {
		out = append(out, databaseSchema{Name: name, Tables: byName[name]})
	}
	return out
}

func discoverDatabaseConnections(projectName, projectPath string) []config.DatabaseConnection {
	files := discoverDatabaseFiles(projectPath)
	seen := map[string]bool{}
	var suggestions []config.DatabaseConnection
	for _, file := range files {
		rel, _ := filepath.Rel(projectPath, file)
		values := readEnvLikeFile(file)
		for _, conn := range databaseSuggestionsFromEnv(projectName, rel, values) {
			key := conn.Driver + "|" + conn.Host + "|" + conn.Database + "|" + conn.SQLitePath + "|" + conn.User
			if seen[key] {
				continue
			}
			seen[key] = true
			conn.ID = stableDatabaseID(conn)
			suggestions = append(suggestions, conn)
		}
	}
	sort.Slice(suggestions, func(i, j int) bool {
		return suggestions[i].Name < suggestions[j].Name
	})
	return suggestions
}

func discoverDatabaseFiles(projectPath string) []string {
	names := []string{".env", ".env.local", ".env.development", ".env.test", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"}
	var files []string
	roots := []string{projectPath, filepath.Join(projectPath, "app"), filepath.Join(projectPath, "apps"), filepath.Join(projectPath, "src")}
	seen := map[string]bool{}
	for _, root := range roots {
		for _, name := range names {
			path := filepath.Join(root, name)
			if seen[path] {
				continue
			}
			info, err := os.Stat(path)
			if err == nil && !info.IsDir() && info.Size() <= 512*1024 {
				files = append(files, path)
				seen[path] = true
			}
		}
	}
	return files
}

func databaseSuggestionsFromEnv(projectName, file string, env map[string]string) []config.DatabaseConnection {
	var out []config.DatabaseConnection
	for key, raw := range env {
		if isDatabaseURLKey(key) && raw != "" {
			if conn, ok := databaseConnectionFromURL(projectName, file, key, raw); ok {
				out = append(out, conn)
			}
		}
	}
	if conn, ok := databaseConnectionFromParts(projectName, file, env); ok {
		out = append(out, conn)
	}
	return out
}

func databaseConnectionFromURL(projectName, file, key, raw string) (config.DatabaseConnection, bool) {
	u, err := url.Parse(raw)
	if err != nil {
		return config.DatabaseConnection{}, false
	}
	driver := normalizeDatabaseDriver(u.Scheme)
	if driver == "" {
		return config.DatabaseConnection{}, false
	}
	conn := config.DatabaseConnection{
		Name:    projectName + " " + databaseNameFromEnvKey(key, driver),
		Driver:  driver,
		Project: projectName,
	}
	if driver == dbDriverSQLite {
		conn.SQLitePath = u.Path
		if conn.SQLitePath != "" && !filepath.IsAbs(conn.SQLitePath) {
			conn.SQLitePath = filepath.Join(projectName, conn.SQLitePath)
		}
		return conn, conn.SQLitePath != ""
	}
	conn.Host = u.Hostname()
	conn.Port = parsePort(u.Port(), defaultDatabasePort(driver, 0))
	conn.Database = strings.TrimPrefix(u.Path, "/")
	conn.User = u.User.Username()
	if password, hasPassword := u.User.Password(); hasPassword {
		conn.Password = password
	}
	return conn, conn.Host != "" && (driver == dbDriverMySQL || conn.Database != "")
}

func databaseConnectionFromParts(projectName, file string, env map[string]string) (config.DatabaseConnection, bool) {
	driver := normalizeDatabaseDriver(firstEnv(env, "DB_CONNECTION", "DB_DRIVER", "DATABASE_DRIVER"))
	if driver == "" {
		switch {
		case firstEnv(env, "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_HOST") != "":
			driver = dbDriverPostgres
		case firstEnv(env, "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_HOST") != "":
			driver = dbDriverMySQL
		case firstEnv(env, "SQLITE_PATH", "SQLITE_DATABASE", "DB_PATH") != "":
			driver = dbDriverSQLite
		default:
			return config.DatabaseConnection{}, false
		}
	}
	conn := config.DatabaseConnection{
		Name:    projectName + " " + driver,
		Driver:  driver,
		Project: projectName,
	}
	if driver == dbDriverSQLite {
		conn.SQLitePath = firstEnv(env, "SQLITE_PATH", "SQLITE_DATABASE", "DATABASE_PATH", "DB_PATH")
		return conn, conn.SQLitePath != ""
	}
	conn.Host = firstEnv(env, "DB_HOST", "DATABASE_HOST", "POSTGRES_HOST", "MYSQL_HOST", "PGHOST")
	conn.Port = parsePort(firstEnv(env, "DB_PORT", "DATABASE_PORT", "POSTGRES_PORT", "MYSQL_PORT", "PGPORT"), defaultDatabasePort(driver, 0))
	conn.Database = firstEnv(env, "DB_DATABASE", "DB_NAME", "DATABASE_NAME", "POSTGRES_DB", "MYSQL_DATABASE", "PGDATABASE")
	conn.User = firstEnv(env, "DB_USERNAME", "DB_USER", "DATABASE_USER", "POSTGRES_USER", "MYSQL_USER", "PGUSER")
	for _, key := range []string{"DB_PASSWORD", "DATABASE_PASSWORD", "POSTGRES_PASSWORD", "MYSQL_PASSWORD", "PGPASSWORD"} {
		if env[key] != "" {
			conn.Password = env[key]
			break
		}
	}
	return conn, conn.Host != "" && (driver == dbDriverMySQL || conn.Database != "")
}

func isDatabaseURLKey(key string) bool {
	upper := strings.ToUpper(strings.TrimSpace(key))
	if upper == "DATABASE_URL" || upper == "DB_URL" || upper == "POSTGRES_URL" || upper == "MYSQL_URL" {
		return true
	}
	return strings.Contains(upper, "DATABASE") && strings.HasSuffix(upper, "_URL")
}

func databaseNameFromEnvKey(key, driver string) string {
	key = strings.Trim(strings.ToLower(key), "_")
	if key == "database_url" || key == "db_url" || key == "postgres_url" || key == "mysql_url" {
		return driver
	}
	key = strings.TrimPrefix(key, "database_")
	key = strings.TrimSuffix(key, "_url")
	key = strings.ReplaceAll(key, "_", " ")
	key = strings.TrimSpace(key)
	if key == "" {
		return driver
	}
	return key + " " + driver
}

func readEnvLikeFile(path string) map[string]string {
	data, err := os.ReadFile(path)
	if err != nil {
		return map[string]string{}
	}
	values := map[string]string{}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "- ")
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := splitEnvLine(line)
		if !ok {
			continue
		}
		values[key] = strings.Trim(stripInlineComment(value), `"'`)
	}
	return values
}

func splitEnvLine(line string) (string, string, bool) {
	idx := strings.Index(line, "=")
	if idx < 0 {
		colon := strings.Index(line, ":")
		if colon < 0 {
			return "", "", false
		}
		idx = colon
	}
	key := strings.TrimSpace(line[:idx])
	value := strings.TrimSpace(line[idx+1:])
	key = strings.Trim(key, `"'`)
	if !regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`).MatchString(key) {
		return "", "", false
	}
	return key, value, true
}

func stripInlineComment(value string) string {
	inSingle := false
	inDouble := false
	for i, r := range value {
		switch r {
		case '\'':
			if !inDouble {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle {
				inDouble = !inDouble
			}
		case '#':
			if !inSingle && !inDouble && (i == 0 || value[i-1] == ' ') {
				return strings.TrimSpace(value[:i])
			}
		}
	}
	return strings.TrimSpace(value)
}

func firstEnv(env map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(env[key]); value != "" {
			return value
		}
	}
	return ""
}

func validateReadOnlySQL(sqlText string) error {
	cleaned, err := stripSQLNoise(sqlText)
	if err != nil {
		return err
	}
	if hasMultipleStatements(cleaned) {
		return errors.New("only one SQL statement is allowed")
	}
	tokens := sqlTokens(cleaned)
	if len(tokens) == 0 {
		return errors.New("sql required")
	}
	first := strings.ToLower(tokens[0])
	allowed := map[string]bool{
		"select": true, "with": true, "explain": true, "show": true,
		"describe": true, "desc": true, "pragma": true, "values": true,
	}
	if !allowed[first] {
		return fmt.Errorf("%s statements are not allowed in read-only mode", strings.ToUpper(tokens[0]))
	}
	blocked := map[string]bool{
		"insert": true, "update": true, "delete": true, "drop": true, "alter": true,
		"create": true, "truncate": true, "replace": true, "merge": true, "grant": true,
		"revoke": true, "vacuum": true, "attach": true, "detach": true, "reindex": true,
		"analyze": true, "call": true, "execute": true, "set": true, "begin": true,
		"commit": true, "rollback": true, "copy": true, "load": true,
	}
	for _, token := range tokens {
		if blocked[strings.ToLower(token)] {
			return fmt.Errorf("%s is not allowed in read-only mode", strings.ToUpper(token))
		}
	}
	if first == "pragma" && strings.Contains(cleaned, "=") {
		return errors.New("writable PRAGMA statements are not allowed")
	}
	return nil
}

func validateDatabaseWhereClause(whereClause string) error {
	if whereClause == "" {
		return nil
	}
	if strings.Contains(whereClause, ";") {
		return errors.New("where clause must not include semicolons")
	}
	if strings.Contains(whereClause, "--") || strings.Contains(whereClause, "/*") || strings.Contains(whereClause, "*/") {
		return errors.New("where clause must not include comments")
	}
	cleaned, err := stripSQLNoise(whereClause)
	if err != nil {
		return err
	}
	tokens := sqlTokens(cleaned)
	if len(tokens) == 0 {
		return nil
	}
	blocked := map[string]bool{
		"select": true, "with": true, "where": true, "from": true, "order": true, "group": true,
		"having": true, "limit": true, "offset": true, "insert": true, "update": true,
		"delete": true, "drop": true, "alter": true, "create": true, "union": true,
		"intersect": true, "except": true,
	}
	for _, token := range tokens {
		if blocked[strings.ToLower(token)] {
			return errors.New("enter only the condition, without WHERE or full SQL")
		}
	}
	if err := validateReadOnlySQL("SELECT 1 WHERE " + whereClause); err != nil {
		return err
	}
	return nil
}

func validateDatabaseOrder(column string, direction string) (string, error) {
	direction = strings.ToLower(strings.TrimSpace(direction))
	if column == "" {
		if direction != "" {
			return "", errors.New("order_column is required when order_dir is set")
		}
		return "", nil
	}
	if strings.ContainsAny(column, "\x00\r\n") {
		return "", errors.New("order column must be a single column name")
	}
	if direction == "" {
		return "desc", nil
	}
	if direction != "asc" && direction != "desc" {
		return "", errors.New("order_dir must be asc or desc")
	}
	return direction, nil
}

func stripSQLNoise(sqlText string) (string, error) {
	var out strings.Builder
	inSingle, inDouble, inBacktick := false, false, false
	for i := 0; i < len(sqlText); i++ {
		ch := sqlText[i]
		next := byte(0)
		if i+1 < len(sqlText) {
			next = sqlText[i+1]
		}
		if !inSingle && !inDouble && !inBacktick && ch == '-' && next == '-' {
			for i < len(sqlText) && sqlText[i] != '\n' {
				i++
			}
			out.WriteByte(' ')
			continue
		}
		if !inSingle && !inDouble && !inBacktick && ch == '/' && next == '*' {
			i += 2
			for i+1 < len(sqlText) && !(sqlText[i] == '*' && sqlText[i+1] == '/') {
				i++
			}
			if i+1 >= len(sqlText) {
				return "", errors.New("unterminated SQL comment")
			}
			i++
			out.WriteByte(' ')
			continue
		}
		switch ch {
		case '\'':
			if !inDouble && !inBacktick {
				if inSingle && next == '\'' {
					i++
				} else {
					inSingle = !inSingle
				}
			}
			out.WriteByte(' ')
		case '"':
			if !inSingle && !inBacktick {
				inDouble = !inDouble
			}
			out.WriteByte(' ')
		case '`':
			if !inSingle && !inDouble {
				inBacktick = !inBacktick
			}
			out.WriteByte(' ')
		default:
			if inSingle || inDouble || inBacktick {
				out.WriteByte(' ')
			} else {
				out.WriteByte(ch)
			}
		}
	}
	if inSingle || inDouble || inBacktick {
		return "", errors.New("unterminated SQL string")
	}
	return strings.TrimSpace(out.String()), nil
}

func hasMultipleStatements(cleaned string) bool {
	parts := strings.Split(cleaned, ";")
	nonEmpty := 0
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			nonEmpty++
		}
	}
	return nonEmpty > 1
}

func sqlTokens(cleaned string) []string {
	matches := regexp.MustCompile(`[A-Za-z_][A-Za-z0-9_]*`).FindAllString(cleaned, -1)
	return matches
}

func startsWithSQLKeyword(sqlText, keyword string) bool {
	cleaned, err := stripSQLNoise(sqlText)
	if err != nil {
		return false
	}
	tokens := sqlTokens(cleaned)
	return len(tokens) > 0 && strings.EqualFold(tokens[0], keyword)
}

func explainSQL(driver, sqlText string) string {
	if driver == dbDriverPostgres {
		return "EXPLAIN " + sqlText
	}
	return "EXPLAIN " + sqlText
}

func normalizeDatabaseDriver(driver string) string {
	switch strings.ToLower(strings.TrimSpace(driver)) {
	case "sqlite", "sqlite3":
		return dbDriverSQLite
	case "postgres", "postgresql", "pgsql", "pg":
		return dbDriverPostgres
	case "mysql", "mariadb":
		return dbDriverMySQL
	default:
		return ""
	}
}

func databaseSQLDriver(driver string) string {
	switch driver {
	case dbDriverSQLite:
		return "sqlite"
	case dbDriverPostgres:
		return "pgx"
	case dbDriverMySQL:
		return "mysql"
	default:
		return driver
	}
}

func defaultDatabasePort(driver string, port int) int {
	if port > 0 {
		return port
	}
	switch driver {
	case dbDriverPostgres:
		return 5432
	case dbDriverMySQL:
		return 3306
	default:
		return 0
	}
}

func parsePort(value string, fallback int) int {
	port, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || port <= 0 {
		return fallback
	}
	return port
}

func queryInt(r *http.Request, key string, fallback int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return fallback
	}
	return value
}

func clampDatabaseLimit(limit int) int {
	if limit <= 0 {
		return 500
	}
	if limit > 5000 {
		return 5000
	}
	return limit
}

func quoteDatabaseIdent(driver, value string) string {
	if driver == dbDriverMySQL {
		return "`" + strings.ReplaceAll(value, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func qualifiedTableName(driver, schema, table string) string {
	if driver == dbDriverSQLite || schema == "" {
		return quoteDatabaseIdent(driver, table)
	}
	return quoteDatabaseIdent(driver, schema) + "." + quoteDatabaseIdent(driver, table)
}

func sqliteLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func tableKey(schema, table string) string {
	return schema + "\x00" + table
}

func stableDatabaseID(conn config.DatabaseConnection) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(conn.Driver + "\x00" + conn.Project + "\x00" + conn.Name + "\x00" + conn.Host + "\x00" + conn.Database + "\x00" + conn.SQLitePath))
	return "db-" + strconv.FormatUint(uint64(h.Sum32()), 36)
}
