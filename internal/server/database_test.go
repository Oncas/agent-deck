package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	"agentdeck/internal/config"
	"agentdeck/internal/scanner"
)

func TestReadOnlySQLGuard(t *testing.T) {
	allowed := []string{
		"select * from users;",
		"with recent as (select * from users) select * from recent",
		"explain select * from users",
		"show tables",
		"pragma table_info(users)",
		"values (1)",
	}
	for _, sqlText := range allowed {
		if err := validateReadOnlySQL(sqlText); err != nil {
			t.Fatalf("validateReadOnlySQL(%q) returned error: %v", sqlText, err)
		}
	}

	blocked := []string{
		"update users set name = 'x'",
		"select * from users; drop table users",
		"with removed as (delete from users returning id) select * from removed",
		"pragma user_version = 2",
		"explain analyze select * from users",
	}
	for _, sqlText := range blocked {
		if err := validateReadOnlySQL(sqlText); err == nil {
			t.Fatalf("validateReadOnlySQL(%q) returned nil error, want blocked", sqlText)
		}
	}
}

func TestValidateDatabaseConnectionAllowsMySQLWithoutDefaultDatabase(t *testing.T) {
	err := validateDatabaseConnection(config.DatabaseConnection{
		ID:     "db-mysql",
		Name:   "MySQL",
		Driver: "mysql",
		Host:   "127.0.0.1",
		User:   "readonly",
	})
	if err != nil {
		t.Fatalf("validate mysql without database = %v, want nil", err)
	}

	err = validateDatabaseConnection(config.DatabaseConnection{
		ID:     "db-postgres",
		Name:   "Postgres",
		Driver: "postgres",
		Host:   "127.0.0.1",
		User:   "readonly",
	})
	if err == nil || !strings.Contains(err.Error(), "database required") {
		t.Fatalf("validate postgres without database = %v, want database required", err)
	}
}

func TestReconcileDatabasePoolsDefersActivePoolClose(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite db: %v", err)
	}

	previousConn := config.DatabaseConnection{
		ID:         "local",
		Name:       "Local",
		Driver:     "sqlite",
		SQLitePath: "previous.db",
	}
	pool := &databasePool{
		db:        db,
		driver:    dbDriverSQLite,
		signature: databaseConnectionSignature(previousConn),
		active:    1,
	}
	api := &apiHandler{databasePools: map[string]*databasePool{"local": pool}}

	nextConn := previousConn
	nextConn.SQLitePath = "next.db"
	api.reconcileDatabasePools([]config.DatabaseConnection{nextConn})

	if _, ok := api.databasePools["local"]; ok {
		t.Fatal("stale pool remains available after reconcile")
	}
	if !pool.closing {
		t.Fatal("active stale pool was not marked for close")
	}
	if pool.db == nil {
		t.Fatal("active stale pool closed before release")
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("active stale pool was closed early: %v", err)
	}

	api.releaseDatabasePool(pool)

	if pool.db != nil {
		t.Fatal("stale pool db remains after final release")
	}
	if err := db.Ping(); err == nil {
		t.Fatal("released stale pool is still open")
	}
}

func TestDatabaseSQLiteQueryAndWriteBlock(t *testing.T) {
	dbPath := seedSQLiteTestDB(t)
	api, _ := newConfigTestHandler(t, &config.Config{
		DatabaseConnections: []config.DatabaseConnection{{
			ID:         "local",
			Name:       "Local",
			Driver:     "sqlite",
			SQLitePath: dbPath,
		}},
	})

	queryRec := httptest.NewRecorder()
	queryReq := newJSONRequest(t, http.MethodPost, "/api/databases/local/query", map[string]any{
		"sql": "select name from users order by id",
	})
	queryReq.SetPathValue("id", "local")
	api.handleDatabaseQuery(queryRec, queryReq)
	if queryRec.Code != http.StatusOK {
		t.Fatalf("query status = %d, body = %s", queryRec.Code, queryRec.Body.String())
	}
	var result databaseQueryResponse
	if err := json.Unmarshal(queryRec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode query response: %v", err)
	}
	if result.RowCount != 2 || result.Rows[0][0] != "Ada" {
		t.Fatalf("query result = %#v, want Ada and two rows", result.Rows)
	}
	if !api.databaseConnectionStatuses()["local"] {
		t.Fatal("query did not mark database connection as connected")
	}

	schemaRec := httptest.NewRecorder()
	schemaReq := httptest.NewRequest(http.MethodGet, "/api/databases/local/schemas/main", nil)
	schemaReq.SetPathValue("id", "local")
	schemaReq.SetPathValue("schema", "main")
	api.handleDatabaseSchemaGroup(schemaRec, schemaReq)
	if schemaRec.Code != http.StatusOK {
		t.Fatalf("schema status = %d, body = %s", schemaRec.Code, schemaRec.Body.String())
	}
	var schema databaseSchema
	if err := json.Unmarshal(schemaRec.Body.Bytes(), &schema); err != nil {
		t.Fatalf("decode schema response: %v", err)
	}
	if schema.Name != "main" || len(schema.Tables) == 0 {
		t.Fatalf("schema = %#v, want main schema with tables", schema)
	}

	tableSchemaRec := httptest.NewRecorder()
	tableSchemaReq := httptest.NewRequest(http.MethodGet, "/api/databases/local/schemas/main/tables/users", nil)
	tableSchemaReq.SetPathValue("id", "local")
	tableSchemaReq.SetPathValue("schema", "main")
	tableSchemaReq.SetPathValue("table", "users")
	api.handleDatabaseTableSchema(tableSchemaRec, tableSchemaReq)
	if tableSchemaRec.Code != http.StatusOK {
		t.Fatalf("table schema status = %d, body = %s", tableSchemaRec.Code, tableSchemaRec.Body.String())
	}
	var tableSchema databaseTable
	if err := json.Unmarshal(tableSchemaRec.Body.Bytes(), &tableSchema); err != nil {
		t.Fatalf("decode table schema response: %v", err)
	}
	if tableSchema.Name != "users" || len(tableSchema.Columns) == 0 {
		t.Fatalf("table schema = %#v, want users columns", tableSchema)
	}

	disconnectRec := httptest.NewRecorder()
	disconnectReq := httptest.NewRequest(http.MethodPost, "/api/databases/local/disconnect", nil)
	disconnectReq.SetPathValue("id", "local")
	api.handleDatabaseDisconnect(disconnectRec, disconnectReq)
	if disconnectRec.Code != http.StatusOK {
		t.Fatalf("disconnect status = %d, body = %s", disconnectRec.Code, disconnectRec.Body.String())
	}
	if api.databaseConnectionStatuses()["local"] {
		t.Fatal("disconnect left database connection marked connected")
	}

	binaryRec := httptest.NewRecorder()
	binaryReq := newJSONRequest(t, http.MethodPost, "/api/databases/local/query", map[string]any{
		"sql": "select id from binary_ids",
	})
	binaryReq.SetPathValue("id", "local")
	api.handleDatabaseQuery(binaryRec, binaryReq)
	if binaryRec.Code != http.StatusOK {
		t.Fatalf("binary query status = %d, body = %s", binaryRec.Code, binaryRec.Body.String())
	}
	if err := json.Unmarshal(binaryRec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode binary query response: %v", err)
	}
	if len(result.ColumnTypes) != 1 || !result.ColumnTypes[0].Binary {
		t.Fatalf("column types = %#v, want binary column", result.ColumnTypes)
	}
	binaryValue, ok := result.Rows[0][0].(map[string]any)
	if !ok || binaryValue["type"] != "binary" || binaryValue["hex"] != "00112233445566778899aabbccddeeff" || binaryValue["length"] != float64(16) {
		t.Fatalf("binary value = %#v, want structured 16 byte value", result.Rows[0][0])
	}

	tableRec := httptest.NewRecorder()
	tableReq := httptest.NewRequest(http.MethodGet, "/api/databases/local/tables/main/users?where=name+%3D+%27Ada%27", nil)
	tableReq.SetPathValue("id", "local")
	tableReq.SetPathValue("schema", "main")
	tableReq.SetPathValue("table", "users")
	api.handleDatabaseTableRows(tableRec, tableReq)
	if tableRec.Code != http.StatusOK {
		t.Fatalf("table rows status = %d, body = %s", tableRec.Code, tableRec.Body.String())
	}
	if err := json.Unmarshal(tableRec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode table response: %v", err)
	}
	if result.RowCount != 1 || result.Rows[0][1] != "Ada" || !strings.Contains(result.SQL, "WHERE name = 'Ada'") {
		t.Fatalf("filtered table result = %#v sql=%q, want Ada only", result.Rows, result.SQL)
	}

	countRec := httptest.NewRecorder()
	countReq := httptest.NewRequest(http.MethodGet, "/api/databases/local/tables/main/users/count?where=name+%3D+%27Ada%27", nil)
	countReq.SetPathValue("id", "local")
	countReq.SetPathValue("schema", "main")
	countReq.SetPathValue("table", "users")
	api.handleDatabaseTableCount(countRec, countReq)
	if countRec.Code != http.StatusOK {
		t.Fatalf("table count status = %d, body = %s", countRec.Code, countRec.Body.String())
	}
	var countResult databaseTableCountResponse
	if err := json.Unmarshal(countRec.Body.Bytes(), &countResult); err != nil {
		t.Fatalf("decode table count response: %v", err)
	}
	if countResult.Count != 1 || !strings.Contains(countResult.SQL, "WHERE name = 'Ada'") {
		t.Fatalf("filtered table count = %#v, want one Ada count", countResult)
	}

	likeRec := httptest.NewRecorder()
	likeReq := httptest.NewRequest(http.MethodGet, "/api/databases/local/tables/main/users?where=name+like+%22%25Ada%25%22", nil)
	likeReq.SetPathValue("id", "local")
	likeReq.SetPathValue("schema", "main")
	likeReq.SetPathValue("table", "users")
	api.handleDatabaseTableRows(likeRec, likeReq)
	if likeRec.Code != http.StatusOK {
		t.Fatalf("like where status = %d, body = %s", likeRec.Code, likeRec.Body.String())
	}
	if err := json.Unmarshal(likeRec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode like table response: %v", err)
	}
	if result.RowCount != 1 || result.Rows[0][1] != "Ada" || !strings.Contains(result.SQL, `WHERE name like "%Ada%"`) {
		t.Fatalf("like table result = %#v sql=%q, want Ada only", result.Rows, result.SQL)
	}

	orderRec := httptest.NewRecorder()
	orderReq := httptest.NewRequest(http.MethodGet, "/api/databases/local/tables/main/users?order_column=name&order_dir=desc", nil)
	orderReq.SetPathValue("id", "local")
	orderReq.SetPathValue("schema", "main")
	orderReq.SetPathValue("table", "users")
	api.handleDatabaseTableRows(orderRec, orderReq)
	if orderRec.Code != http.StatusOK {
		t.Fatalf("ordered table status = %d, body = %s", orderRec.Code, orderRec.Body.String())
	}
	if err := json.Unmarshal(orderRec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode ordered table response: %v", err)
	}
	if result.RowCount != 2 || result.Rows[0][1] != "Linus" || !strings.Contains(result.SQL, `ORDER BY "name" DESC`) {
		t.Fatalf("ordered table result = %#v sql=%q, want Linus first", result.Rows, result.SQL)
	}

	if err := validateDatabaseWhereClause(`name like "%select%"`); err != nil {
		t.Fatalf("validateDatabaseWhereClause with quoted keyword returned error: %v", err)
	}

	badOrderRec := httptest.NewRecorder()
	badOrderReq := httptest.NewRequest(http.MethodGet, "/api/databases/local/tables/main/users?order_column=name&order_dir=drop", nil)
	badOrderReq.SetPathValue("id", "local")
	badOrderReq.SetPathValue("schema", "main")
	badOrderReq.SetPathValue("table", "users")
	api.handleDatabaseTableRows(badOrderRec, badOrderReq)
	if badOrderRec.Code != http.StatusBadRequest {
		t.Fatalf("bad order status = %d, want 400, body = %s", badOrderRec.Code, badOrderRec.Body.String())
	}

	badWhereRec := httptest.NewRecorder()
	badWhereReq := httptest.NewRequest(http.MethodGet, "/api/databases/local/tables/main/users?where=where+id+%3D+1", nil)
	badWhereReq.SetPathValue("id", "local")
	badWhereReq.SetPathValue("schema", "main")
	badWhereReq.SetPathValue("table", "users")
	api.handleDatabaseTableRows(badWhereRec, badWhereReq)
	if badWhereRec.Code != http.StatusBadRequest {
		t.Fatalf("bad where status = %d, want 400, body = %s", badWhereRec.Code, badWhereRec.Body.String())
	}

	writeRec := httptest.NewRecorder()
	writeReq := newJSONRequest(t, http.MethodPost, "/api/databases/local/query", map[string]any{
		"sql": "insert into users(name) values ('Grace')",
	})
	writeReq.SetPathValue("id", "local")
	api.handleDatabaseQuery(writeRec, writeReq)
	if writeRec.Code != http.StatusBadRequest {
		t.Fatalf("write status = %d, want 400, body = %s", writeRec.Code, writeRec.Body.String())
	}

	db, _, err := api.openDatabase(queryReq.Context(), api.databaseConnections[0])
	if err != nil {
		t.Fatalf("open read-only sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.ExecContext(queryReq.Context(), "insert into users(name) values ('Grace')"); err == nil {
		t.Fatal("direct insert through read-only connection succeeded, want failure")
	}
}

func TestDatabaseDiscoveryUsesExplicitProjectFiles(t *testing.T) {
	dir := t.TempDir()
	projectDir := filepath.Join(dir, "app")
	if err := os.Mkdir(projectDir, 0755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	env := "DB_CONNECTION=postgres\nDB_HOST=127.0.0.1\nDB_PORT=5433\nDB_DATABASE=appdb\nDB_USERNAME=readonly\nDB_PASSWORD=secret\n"
	if err := os.WriteFile(filepath.Join(projectDir, ".env"), []byte(env), 0644); err != nil {
		t.Fatalf("write env: %v", err)
	}
	compose := "services:\n  db:\n    environment:\n      MYSQL_DATABASE: shop\n      MYSQL_USER: ro\n      MYSQL_PASSWORD: pass\n      MYSQL_HOST: mysql\n"
	if err := os.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), []byte(compose), 0644); err != nil {
		t.Fatalf("write compose: %v", err)
	}

	api, _ := newConfigTestHandler(t, &config.Config{})
	api.projects = []scanner.Project{{Name: "app", Path: projectDir}}
	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPost, "/api/databases/discover", map[string]any{"project": "app"})
	api.handleDiscoverDatabases(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("discover status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var result databaseDiscoverResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode discovery response: %v", err)
	}
	if len(result.Suggestions) != 2 {
		t.Fatalf("suggestions = %#v, want postgres and mysql", result.Suggestions)
	}
	if result.Suggestions[0].Password == "" || result.Suggestions[1].Password == "" {
		t.Fatalf("passwords not extracted: %#v", result.Suggestions)
	}
}

func TestDatabaseDiscoveryAllowsMySQLWithoutConfiguredDatabase(t *testing.T) {
	dir := t.TempDir()
	projectDir := filepath.Join(dir, "app")
	if err := os.Mkdir(projectDir, 0755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	env := "DB_CONNECTION=mysql\nDB_HOST=mysql.local\nDB_PORT=3306\nDB_USERNAME=readonly\nDB_PASSWORD=secret\n"
	if err := os.WriteFile(filepath.Join(projectDir, ".env"), []byte(env), 0644); err != nil {
		t.Fatalf("write env: %v", err)
	}

	suggestions := discoverDatabaseConnections("app", projectDir)
	if len(suggestions) != 1 {
		t.Fatalf("suggestions = %#v, want one mysql suggestion", suggestions)
	}
	got := suggestions[0]
	if got.Driver != "mysql" || got.Host != "mysql.local" || got.Database != "" || got.User != "readonly" {
		t.Fatalf("suggestion = %#v, want mysql host credentials without database", got)
	}
}

func TestDatabaseDiscoveryScansNestedAppEnvAndNamedDatabaseURLs(t *testing.T) {
	dir := t.TempDir()
	projectDir := filepath.Join(dir, "shop-api")
	appDir := filepath.Join(projectDir, "app")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		t.Fatalf("mkdir app dir: %v", err)
	}
	env := "DATABASE_READ_SHOP_URL=postgres://reader:localpass@127.0.0.1:5432/shop\n"
	if err := os.WriteFile(filepath.Join(appDir, ".env"), []byte(env), 0644); err != nil {
		t.Fatalf("write nested env: %v", err)
	}

	suggestions := discoverDatabaseConnections("acme/shop-api", projectDir)
	if len(suggestions) != 1 {
		t.Fatalf("suggestions = %#v, want one nested database url", suggestions)
	}
	got := suggestions[0]
	if got.Driver != "postgres" || got.User != "reader" || got.Password != "localpass" || got.Database != "shop" {
		t.Fatalf("suggestion = %#v, want parsed postgres url with password", got)
	}
	if !strings.Contains(got.Name, "read shop postgres") {
		t.Fatalf("suggestion name = %q, want key-derived name", got.Name)
	}
}

func TestDatabaseStateMigratesOutOfConfig(t *testing.T) {
	initial := &config.Config{
		ScanPaths: []string{"/workspace/main"},
		DatabaseConnections: []config.DatabaseConnection{{
			ID:         "db-1",
			Name:       "Main",
			Driver:     "sqlite",
			SQLitePath: "/tmp/main.sqlite",
			Params:     map[string]string{"cache": "shared"},
			SavedQueries: []config.DatabaseSavedQuery{{
				ID:   "query-1",
				Name: "All users",
				SQL:  "select * from users",
			}},
		}},
		DatabaseOrphanedQueries: []config.DatabaseSavedQuery{{
			ID:             "orphan-1",
			Name:           "Old users",
			SQL:            "select * from old_users",
			ConnectionName: "Deleted",
		}},
	}
	api, configPath := newConfigTestHandler(t, initial)

	dbRec := httptest.NewRecorder()
	dbReq := httptest.NewRequest(http.MethodGet, "/api/databases", nil)
	api.handleListDatabases(dbRec, dbReq)
	if dbRec.Code != http.StatusOK {
		t.Fatalf("GET /api/databases status = %d, body = %s", dbRec.Code, dbRec.Body.String())
	}
	var dbState databaseListResponse
	if err := json.Unmarshal(dbRec.Body.Bytes(), &dbState); err != nil {
		t.Fatalf("decode database response: %v", err)
	}
	if len(dbState.Connections) != 1 ||
		dbState.Connections[0].Params["cache"] != "shared" ||
		len(dbState.Connections[0].SavedQueries) != 1 ||
		dbState.Connections[0].SavedQueries[0].ID != "query-1" ||
		len(dbState.OrphanedQueries) != 1 ||
		dbState.OrphanedQueries[0].ID != "orphan-1" {
		t.Fatalf("database state = %#v / %#v, want migrated connection, saved query, and orphan", dbState.Connections, dbState.OrphanedQueries)
	}
	if matches, err := filepath.Glob(filepath.Join(filepath.Dir(configPath), databaseSavedQueriesDir, "*.sql")); err != nil || len(matches) != 2 {
		t.Fatalf("saved query files = %v, %v, want two .sql files", matches, err)
	}

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"theme": "dark",
	})
	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}
	saved := loadConfigFile(t, configPath)
	if saved.Theme != "dark" {
		t.Fatalf("saved theme = %q, want dark", saved.Theme)
	}
	if len(saved.DatabaseConnections) != 0 || len(saved.DatabaseOrphanedQueries) != 0 {
		t.Fatalf("config database fields = %#v / %#v, want scrubbed", saved.DatabaseConnections, saved.DatabaseOrphanedQueries)
	}
}

func TestDatabaseStateRetainsLegacyConfigWhenPasswordMigrationFails(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	initial := &config.Config{
		ScanPaths: []string{"/workspace/main"},
		DatabaseConnections: []config.DatabaseConnection{{
			ID:       "pg",
			Name:     "Postgres",
			Driver:   "postgres",
			Host:     "127.0.0.1",
			Database: "app",
			User:     "readonly",
			Password: "secret",
		}},
	}
	if err := config.Save(configPath, initial); err != nil {
		t.Fatalf("seed config: %v", err)
	}

	store := newTestDatabasePasswordStore()
	store.setErr = errors.New("keyring unavailable")
	api := &apiHandler{
		configPath:               configPath,
		cfg:                      initial,
		databaseStore:            newDatabaseStore(configPath),
		databasePasswordStore:    store,
		databaseSessionPasswords: make(map[string]string),
		databasePools:            make(map[string]*databasePool),
	}
	if err := api.initializeDatabaseState(); err != nil {
		t.Fatalf("initialize database state: %v", err)
	}
	if !api.preserveLegacyDatabaseState {
		t.Fatal("preserveLegacyDatabaseState = false, want true after password migration failure")
	}
	saved := loadConfigFile(t, configPath)
	if len(saved.DatabaseConnections) != 1 || saved.DatabaseConnections[0].Password != "secret" {
		t.Fatalf("saved legacy database connections = %#v, want password retained", saved.DatabaseConnections)
	}

	if _, err := api.updateConfig(func(next *config.Config) {
		next.Theme = "dark"
	}); err != nil {
		t.Fatalf("update config: %v", err)
	}
	saved = loadConfigFile(t, configPath)
	if len(saved.DatabaseConnections) != 1 || saved.DatabaseConnections[0].Password != "secret" {
		t.Fatalf("saved legacy database connections after config update = %#v, want password retained", saved.DatabaseConnections)
	}

	store.setErr = nil
	retryConfig := loadConfigFile(t, configPath)
	retryAPI := &apiHandler{
		configPath:               configPath,
		cfg:                      retryConfig,
		databaseStore:            newDatabaseStore(configPath),
		databasePasswordStore:    store,
		databaseSessionPasswords: make(map[string]string),
		databasePools:            make(map[string]*databasePool),
	}
	if err := retryAPI.initializeDatabaseState(); err != nil {
		t.Fatalf("retry initialize database state: %v", err)
	}
	if retryAPI.preserveLegacyDatabaseState {
		t.Fatal("preserveLegacyDatabaseState = true, want false after password migration succeeds")
	}
	if got := store.values["pg"]; got != "secret" {
		t.Fatalf("migrated password = %q, want secret", got)
	}
	saved = loadConfigFile(t, configPath)
	if len(saved.DatabaseConnections) != 0 {
		t.Fatalf("saved database connections after retry = %#v, want scrubbed", saved.DatabaseConnections)
	}
}

func TestDatabaseRoutesPersistConnectionsAndSavedQueryFiles(t *testing.T) {
	api, configPath := newConfigTestHandler(t, &config.Config{})
	dbPath := seedSQLiteTestDB(t)

	createRec := httptest.NewRecorder()
	createReq := newJSONRequest(t, http.MethodPost, "/api/databases", map[string]any{
		"connection": map[string]any{
			"id":          "local",
			"name":        "Local DB",
			"driver":      "sqlite",
			"sqlite_path": dbPath,
		},
	})
	api.handleCreateDatabase(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("POST /api/databases status = %d, body = %s", createRec.Code, createRec.Body.String())
	}

	savedConfig := loadConfigFile(t, configPath)
	if len(savedConfig.DatabaseConnections) != 0 {
		t.Fatalf("config database connections = %#v, want none", savedConfig.DatabaseConnections)
	}
	storeData, err := os.ReadFile(filepath.Join(filepath.Dir(configPath), databaseConfigFileName))
	if err != nil {
		t.Fatalf("read databases.json: %v", err)
	}
	if strings.Contains(string(storeData), "saved_queries") || strings.Contains(string(storeData), "password") {
		t.Fatalf("databases.json contains query/password fields: %s", string(storeData))
	}

	queryRec := httptest.NewRecorder()
	queryReq := newJSONRequest(t, http.MethodPost, "/api/databases/local/saved-queries", map[string]any{
		"id":   "query-1",
		"name": "Recent Users",
		"sql":  "select * from users order by id desc",
	})
	queryReq.SetPathValue("id", "local")
	api.handleCreateDatabaseSavedQuery(queryRec, queryReq)
	if queryRec.Code != http.StatusOK {
		t.Fatalf("POST saved query status = %d, body = %s", queryRec.Code, queryRec.Body.String())
	}
	files, err := filepath.Glob(filepath.Join(filepath.Dir(configPath), databaseSavedQueriesDir, "*.sql"))
	if err != nil || len(files) != 1 {
		t.Fatalf("saved query files = %v, %v, want one file", files, err)
	}
	fileBody, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatalf("read query file: %v", err)
	}
	if !strings.Contains(string(fileBody), "Recent Users") || !strings.Contains(string(fileBody), "select * from users") {
		t.Fatalf("query file body = %q, want metadata and SQL", string(fileBody))
	}

	deleteConnRec := httptest.NewRecorder()
	deleteConnReq := httptest.NewRequest(http.MethodDelete, "/api/databases/local", nil)
	deleteConnReq.SetPathValue("id", "local")
	api.handleDeleteDatabase(deleteConnRec, deleteConnReq)
	if deleteConnRec.Code != http.StatusOK {
		t.Fatalf("DELETE database status = %d, body = %s", deleteConnRec.Code, deleteConnRec.Body.String())
	}
	var state databaseListResponse
	if err := json.Unmarshal(deleteConnRec.Body.Bytes(), &state); err != nil {
		t.Fatalf("decode delete response: %v", err)
	}
	if len(state.Connections) != 0 || len(state.OrphanedQueries) != 1 || state.OrphanedQueries[0].ID != "query-1" {
		t.Fatalf("state after delete = %#v / %#v, want orphaned query", state.Connections, state.OrphanedQueries)
	}

	deleteQueryRec := httptest.NewRecorder()
	deleteQueryReq := httptest.NewRequest(http.MethodDelete, "/api/databases/orphaned-queries/query-1", nil)
	deleteQueryReq.SetPathValue("query_id", "query-1")
	api.handleDeleteDatabaseOrphanedQuery(deleteQueryRec, deleteQueryReq)
	if deleteQueryRec.Code != http.StatusOK {
		t.Fatalf("DELETE orphaned query status = %d, body = %s", deleteQueryRec.Code, deleteQueryRec.Body.String())
	}
	files, _ = filepath.Glob(filepath.Join(filepath.Dir(configPath), databaseSavedQueriesDir, "*.sql"))
	if len(files) != 0 {
		t.Fatalf("saved query files after delete = %v, want none", files)
	}
}

func TestDatabaseSavedQueryRoutesScopeByConnection(t *testing.T) {
	api, configPath := newConfigTestHandler(t, &config.Config{
		DatabaseConnections: []config.DatabaseConnection{{
			ID:         "a",
			Name:       "A",
			Driver:     "sqlite",
			SQLitePath: "/tmp/a.sqlite",
		}, {
			ID:         "b",
			Name:       "B",
			Driver:     "sqlite",
			SQLitePath: "/tmp/b.sqlite",
		}},
	})
	connA, ok := api.databaseConnection("a")
	if !ok {
		t.Fatal("connection a not found")
	}
	connB, ok := api.databaseConnection("b")
	if !ok {
		t.Fatal("connection b not found")
	}
	dir := databaseSavedQueriesPath(configPath)
	if _, err := writeDatabaseSavedQueryFile(dir, connA, config.DatabaseSavedQuery{
		ID:   "shared",
		Name: "A query",
		SQL:  "select 1",
	}); err != nil {
		t.Fatalf("write query a: %v", err)
	}
	if _, err := writeDatabaseSavedQueryFile(dir, connB, config.DatabaseSavedQuery{
		ID:   "shared",
		Name: "B query",
		SQL:  "select 2",
	}); err != nil {
		t.Fatalf("write query b: %v", err)
	}

	updateRec := httptest.NewRecorder()
	updateReq := newJSONRequest(t, http.MethodPatch, "/api/databases/a/saved-queries/shared", map[string]any{
		"name": "A updated",
		"sql":  "select 10",
	})
	updateReq.SetPathValue("id", "a")
	updateReq.SetPathValue("query_id", "shared")
	api.handleUpdateDatabaseSavedQuery(updateRec, updateReq)
	if updateRec.Code != http.StatusOK {
		t.Fatalf("PATCH saved query status = %d, body = %s", updateRec.Code, updateRec.Body.String())
	}
	state, err := api.databaseStateForResponse()
	if err != nil {
		t.Fatalf("database state after update: %v", err)
	}
	queryA := findSavedQueryForTest(state.Connections, "a", "shared")
	queryB := findSavedQueryForTest(state.Connections, "b", "shared")
	if queryA == nil || queryA.Name != "A updated" || queryA.SQL != "select 10" {
		t.Fatalf("query a = %#v, want updated", queryA)
	}
	if queryB == nil || queryB.Name != "B query" || queryB.SQL != "select 2" {
		t.Fatalf("query b = %#v, want untouched", queryB)
	}

	deleteRec := httptest.NewRecorder()
	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/databases/a/saved-queries/shared", nil)
	deleteReq.SetPathValue("id", "a")
	deleteReq.SetPathValue("query_id", "shared")
	api.handleDeleteDatabaseSavedQuery(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE saved query status = %d, body = %s", deleteRec.Code, deleteRec.Body.String())
	}
	state, err = api.databaseStateForResponse()
	if err != nil {
		t.Fatalf("database state after delete: %v", err)
	}
	if got := findSavedQueryForTest(state.Connections, "a", "shared"); got != nil {
		t.Fatalf("query a after delete = %#v, want nil", got)
	}
	if got := findSavedQueryForTest(state.Connections, "b", "shared"); got == nil || got.Name != "B query" {
		t.Fatalf("query b after delete = %#v, want untouched", got)
	}
}

func findSavedQueryForTest(conns []config.DatabaseConnection, connID, queryID string) *config.DatabaseSavedQuery {
	for _, conn := range conns {
		if conn.ID != connID {
			continue
		}
		for i := range conn.SavedQueries {
			if conn.SavedQueries[i].ID == queryID {
				return &conn.SavedQueries[i]
			}
		}
	}
	return nil
}

func TestDatabasePasswordlessAndSessionPassword(t *testing.T) {
	api, _ := newConfigTestHandler(t, &config.Config{
		DatabaseConnections: []config.DatabaseConnection{{
			ID:       "pg",
			Name:     "Postgres",
			Driver:   "postgres",
			Host:     "127.0.0.1",
			Database: "app",
			User:     "readonly",
		}},
	})

	conn, ok := api.databaseConnection("pg")
	if !ok {
		t.Fatal("database connection not found")
	}
	prepared, err := api.prepareDatabaseConnection(conn)
	if err != nil {
		t.Fatalf("prepare without password: %v", err)
	}
	if prepared.Password != "" {
		t.Fatalf("prepared password = %q, want empty password", prepared.Password)
	}

	api.databasePools["pg"] = &databasePool{}
	passwordRec := httptest.NewRecorder()
	passwordReq := newJSONRequest(t, http.MethodPost, "/api/databases/pg/password", map[string]any{
		"password": "secret",
		"save":     false,
	})
	passwordReq.SetPathValue("id", "pg")
	api.handleSaveDatabasePassword(passwordRec, passwordReq)
	if passwordRec.Code != http.StatusOK {
		t.Fatalf("POST password status = %d, body = %s", passwordRec.Code, passwordRec.Body.String())
	}
	if _, ok := api.databasePools["pg"]; ok {
		t.Fatal("database pool still exists after password update")
	}
	prepared, err = api.prepareDatabaseConnection(conn)
	if err != nil {
		t.Fatalf("prepare with session password: %v", err)
	}
	if prepared.Password != "secret" {
		t.Fatalf("prepared password = %q, want session password", prepared.Password)
	}

	state, err := api.databaseStateForResponse()
	if err != nil {
		t.Fatalf("database state: %v", err)
	}
	if len(state.Connections) != 1 || !state.Connections[0].HasPassword || state.Connections[0].Password != "" {
		t.Fatalf("connection password state = %#v, want redacted has_password", state.Connections)
	}
}

func TestDatabaseAuthFailureNeedsPassword(t *testing.T) {
	pgConn := config.DatabaseConnection{
		ID:       "pg",
		Name:     "Postgres",
		Driver:   "postgres",
		Host:     "127.0.0.1",
		Database: "app",
		User:     "readonly",
	}
	if !databaseAuthFailureNeedsPassword(pgConn, &pgconn.PgError{Code: "28P01", Message: "password authentication failed"}) {
		t.Fatal("postgres invalid password error was not classified as password-required")
	}
	if !databaseAuthFailureNeedsPassword(pgConn, errors.New("failed SASL auth: password authentication failed for user readonly")) {
		t.Fatal("wrapped postgres password error was not classified as password-required")
	}
	if databaseAuthFailureNeedsPassword(pgConn, errors.New("dial tcp 127.0.0.1:5432: connect: connection refused")) {
		t.Fatal("connection refused was classified as password-required")
	}

	mysqlConn := config.DatabaseConnection{
		ID:       "mysql",
		Name:     "MySQL",
		Driver:   "mysql",
		Host:     "127.0.0.1",
		Database: "app",
		User:     "readonly",
	}
	if !databaseAuthFailureNeedsPassword(mysqlConn, &mysql.MySQLError{Number: 1045, Message: "Access denied for user"}) {
		t.Fatal("mysql access denied error was not classified as password-required")
	}
	mysqlConn.User = ""
	if databaseAuthFailureNeedsPassword(mysqlConn, &mysql.MySQLError{Number: 1045, Message: "Access denied for user"}) {
		t.Fatal("mysql access denied without a configured user was classified as password-required")
	}

	sqliteConn := config.DatabaseConnection{ID: "local", Name: "Local", Driver: "sqlite", SQLitePath: "/tmp/app.sqlite"}
	if databaseAuthFailureNeedsPassword(sqliteConn, errors.New("requires a password")) {
		t.Fatal("sqlite error was classified as password-required")
	}
}

func TestWriteDatabasePasswordRequiredForConnection(t *testing.T) {
	rec := httptest.NewRecorder()
	conn := config.DatabaseConnection{
		ID:       "pg",
		Name:     "Postgres",
		Driver:   "postgres",
		Host:     "127.0.0.1",
		Database: "app",
		User:     "readonly",
	}
	if !writeDatabasePasswordRequiredForConnection(rec, conn, &pgconn.PgError{Code: "28P01", Message: "password authentication failed"}) {
		t.Fatal("writeDatabasePasswordRequiredForConnection returned false")
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusConflict)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["code"] != databasePasswordRequiredCode || body["connection_id"] != "pg" || body["connection_name"] != "Postgres" {
		t.Fatalf("response body = %#v, want password-required code and connection metadata", body)
	}
}

func seedSQLiteTestDB(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "app.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE binary_ids(id BLOB NOT NULL);
INSERT INTO users(name) VALUES ('Ada'), ('Linus');
INSERT INTO binary_ids(id) VALUES (X'00112233445566778899AABBCCDDEEFF');`); err != nil {
		t.Fatalf("seed sqlite: %v", err)
	}
	return path
}
