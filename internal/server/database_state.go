package server

import (
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"agentdeck/internal/config"
)

const databasePasswordRequiredCode = "database_password_required"

type databasePasswordRequiredError struct {
	ConnectionID   string
	ConnectionName string
}

func (e *databasePasswordRequiredError) Error() string {
	if e.ConnectionName != "" {
		return "database password required for " + e.ConnectionName
	}
	return "database password required"
}

func (a *apiHandler) initializeDatabaseState() error {
	if a.databaseStore == nil {
		a.databaseStore = newDatabaseStore(a.configPath)
	}
	if a.databasePasswordStore == nil {
		a.databasePasswordStore = newKeyringDatabasePasswordStore(a.configPath)
	}
	if a.databaseSessionPasswords == nil {
		a.databaseSessionPasswords = make(map[string]string)
	}

	stored, err := a.databaseStore.Load()
	if err != nil {
		return err
	}

	legacyConnections := cloneDatabaseConnections(a.cfg.DatabaseConnections)
	legacyOrphaned := cloneDatabaseSavedQueries(a.cfg.DatabaseOrphanedQueries)
	migratedLegacy := len(legacyConnections) > 0 || len(legacyOrphaned) > 0
	passwordMigrationFailed := false

	connections := stored
	if len(connections) == 0 && len(legacyConnections) > 0 {
		connections = cloneDatabaseConnections(legacyConnections)
	}
	for i := range connections {
		connections[i].Password = ""
	}
	for _, conn := range legacyConnections {
		password := conn.Password
		if password == "" || conn.ID == "" {
			continue
		}
		if err := a.databasePasswordStore.Set(conn.ID, password); err != nil {
			passwordMigrationFailed = true
			log.Printf("database password migration failed for %s: %v", conn.ID, err)
			a.setDatabaseSessionPassword(conn.ID, password)
			continue
		}
		a.setDatabaseSessionPassword(conn.ID, password)
	}
	if len(stored) == 0 && len(connections) > 0 {
		if err := a.databaseStore.Save(connections); err != nil {
			return err
		}
	}

	if migratedLegacy {
		if err := a.migrateLegacySavedQueries(legacyConnections, legacyOrphaned); err != nil {
			return err
		}
		if !passwordMigrationFailed {
			if err := config.Save(a.configPath, configWithoutDatabaseState(a.cfg)); err != nil {
				return err
			}
		}
	}

	a.mu.Lock()
	a.databaseConnections = sanitizeDatabaseConnectionsForStorage(connections)
	a.preserveLegacyDatabaseState = migratedLegacy && passwordMigrationFailed
	if a.preserveLegacyDatabaseState {
		a.cfg = cloneRawConfig(a.cfg)
	} else {
		a.cfg = configWithoutDatabaseState(a.cfg)
	}
	a.mu.Unlock()
	return nil
}

func (a *apiHandler) migrateLegacySavedQueries(conns []config.DatabaseConnection, orphaned []config.DatabaseSavedQuery) error {
	dir := databaseSavedQueriesPath(a.configPath)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, conn := range conns {
		for _, query := range normalizeDatabaseSavedQueriesForServer(conn.SavedQueries) {
			if query.ConnectionID == "" {
				query.ConnectionID = conn.ID
			}
			if query.ConnectionName == "" {
				query.ConnectionName = conn.Name
			}
			if query.CreatedAt == "" {
				query.CreatedAt = now
			}
			query.UpdatedAt = firstNonEmpty(query.UpdatedAt, now)
			if _, err := writeDatabaseSavedQueryFile(dir, conn, query); err != nil {
				return err
			}
		}
	}
	for _, query := range normalizeDatabaseSavedQueriesForServer(orphaned) {
		conn := config.DatabaseConnection{ID: query.ConnectionID, Name: query.ConnectionName}
		if conn.ID == "" {
			conn.ID = "orphaned"
		}
		if conn.Name == "" {
			conn.Name = "Orphaned"
		}
		if query.CreatedAt == "" {
			query.CreatedAt = now
		}
		query.UpdatedAt = firstNonEmpty(query.UpdatedAt, now)
		if _, err := writeDatabaseSavedQueryFile(dir, conn, query); err != nil {
			return err
		}
	}
	return nil
}

func normalizeDatabaseSavedQueriesForServer(items []config.DatabaseSavedQuery) []config.DatabaseSavedQuery {
	out := make([]config.DatabaseSavedQuery, 0, len(items))
	for _, item := range items {
		item.ID = strings.TrimSpace(item.ID)
		item.Name = strings.TrimSpace(item.Name)
		item.SQL = strings.TrimSpace(item.SQL)
		item.ConnectionID = strings.TrimSpace(item.ConnectionID)
		item.ConnectionName = strings.TrimSpace(item.ConnectionName)
		if item.ID == "" || item.Name == "" || item.SQL == "" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (a *apiHandler) databaseStateForResponse() (databaseListResponse, error) {
	a.mu.RLock()
	conns := cloneDatabaseConnections(a.databaseConnections)
	a.mu.RUnlock()
	saved, orphaned, err := loadDatabaseSavedQueryFiles(databaseSavedQueriesPath(a.configPath), conns)
	if err != nil {
		return databaseListResponse{}, err
	}
	for i := range conns {
		conns[i].Password = ""
		conns[i].SavedQueries = saved[conns[i].ID]
		conns[i].HasPassword = a.databaseConnectionHasPassword(conns[i].ID)
	}
	return databaseListResponse{
		Connections:     conns,
		Connected:       a.databaseConnectionStatuses(),
		OrphanedQueries: orphaned,
	}, nil
}

func (a *apiHandler) saveDatabaseConnections(conns []config.DatabaseConnection) error {
	next := sanitizeDatabaseConnectionsForStorage(conns)
	if err := a.databaseStore.Save(next); err != nil {
		return err
	}
	a.mu.Lock()
	prev := cloneDatabaseConnections(a.databaseConnections)
	a.databaseConnections = cloneDatabaseConnections(next)
	a.mu.Unlock()
	if !reflectDatabaseConnectionSignaturesEqual(prev, next) {
		a.reconcileDatabasePools(next)
	}
	return nil
}

func reflectDatabaseConnectionSignaturesEqual(a, b []config.DatabaseConnection) bool {
	left := databaseConnectionSignatures(a)
	right := databaseConnectionSignatures(b)
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func (a *apiHandler) databaseConnectionHasPassword(connectionID string) bool {
	if strings.TrimSpace(connectionID) == "" {
		return false
	}
	if _, ok, _ := a.databasePassword(connectionID); ok {
		return true
	}
	return false
}

func (a *apiHandler) databasePassword(connectionID string) (string, bool, error) {
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" {
		return "", false, nil
	}
	if a.databasePasswordStore != nil {
		password, ok, err := a.databasePasswordStore.Get(connectionID)
		if err == nil && ok {
			return password, true, nil
		}
		if err != nil {
			log.Printf("database password lookup failed for %s: %v", connectionID, err)
		}
	}
	a.mu.RLock()
	password, ok := a.databaseSessionPasswords[connectionID]
	a.mu.RUnlock()
	if ok && password != "" {
		return password, true, nil
	}
	return "", false, nil
}

func (a *apiHandler) setDatabaseSessionPassword(connectionID, password string) {
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" || password == "" {
		return
	}
	a.mu.Lock()
	if a.databaseSessionPasswords == nil {
		a.databaseSessionPasswords = make(map[string]string)
	}
	a.databaseSessionPasswords[connectionID] = password
	a.mu.Unlock()
}

func (a *apiHandler) clearDatabaseSessionPassword(connectionID string) {
	a.mu.Lock()
	delete(a.databaseSessionPasswords, connectionID)
	a.mu.Unlock()
}

func (a *apiHandler) prepareDatabaseConnection(conn config.DatabaseConnection) (config.DatabaseConnection, error) {
	conn.Password = strings.TrimSpace(conn.Password)
	if normalizeDatabaseDriver(conn.Driver) == dbDriverSQLite || conn.Password != "" {
		return conn, nil
	}
	password, ok, _ := a.databasePassword(conn.ID)
	if ok {
		conn.Password = password
		return conn, nil
	}
	return conn, nil
}

func writeDatabasePasswordRequiredForConnection(w http.ResponseWriter, conn config.DatabaseConnection, err error) bool {
	if !databaseAuthFailureNeedsPassword(conn, err) {
		return false
	}
	return writeDatabasePasswordRequired(w, &databasePasswordRequiredError{ConnectionID: conn.ID, ConnectionName: conn.Name})
}

func writeDatabasePasswordRequired(w http.ResponseWriter, err error) bool {
	var passwordErr *databasePasswordRequiredError
	if !errors.As(err, &passwordErr) {
		return false
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusConflict)
	writeJSON(w, map[string]string{
		"code":            databasePasswordRequiredCode,
		"error":           "database password required",
		"connection_id":   passwordErr.ConnectionID,
		"connection_name": passwordErr.ConnectionName,
	})
	return true
}
