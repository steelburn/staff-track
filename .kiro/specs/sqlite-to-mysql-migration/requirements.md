# SQLite to MySQL Migration - Requirements

## Overview
Migrate StaffTrack's persistent data layer from SQLite (better-sqlite3) to MySQL with zero downtime where possible and guaranteed data preservation. Maintain application functionality throughout transition.

## User Stories

### US-1: Export All Data from SQLite
**As a** database administrator  
**I want to** export all tables and data from SQLite without corruption  
**So that** I have a reliable backup before migration begins

**EARS Acceptance Criteria:**
- GIVEN the SQLite database is running and contains all current data
- WHEN I execute the export command
- THEN all 12 tables are exported with 100% data fidelity
- AND the export includes table schemas (CREATE TABLE statements)
- AND foreign key relationships are preserved in export
- AND timestamps are preserved in ISO 8601 format
- AND NULL values are correctly represented
- AND the export file can be validated independently

---

### US-2: Create MySQL Schema from SQLite Schema
**As a** developer  
**I want to** convert SQLite CREATE TABLE statements to MySQL-compatible DDL  
**So that** tables are created correctly in MySQL with appropriate data types

**EARS Acceptance Criteria:**
- GIVEN I have the SQLite schema (12 tables)
- WHEN I convert to MySQL DDL
- THEN each table is created with:
  - Correct column types (TEXT → VARCHAR(255), etc.)
  - PRIMARY KEY constraints preserved
  - FOREIGN KEY constraints preserved with appropriate actions
  - DEFAULT values preserved
  - UNIQUE constraints preserved
  - CHECK constraints converted or noted as unsupported
- AND AUTO_INCREMENT replaces SQLite's AUTOINCREMENT
- AND character set is UTF8MB4
- AND collation is UTF8MB4_unicode_ci
- AND storage engine is InnoDB (for ACID compliance)

---

### US-3: Establish MySQL Connection
**As a** application developer  
**I want to** connect the backend to MySQL instead of SQLite  
**So that** all database operations target MySQL

**EARS Acceptance Criteria:**
- GIVEN a MySQL instance is running and accessible
- WHEN the application starts
- THEN it connects to MySQL using environment variables:
  - MYSQL_HOST (hostname/IP)
  - MYSQL_PORT (default 3306)
  - MYSQL_USER (username)
  - MYSQL_PASSWORD (password)
  - MYSQL_DATABASE (database name)
- AND the connection includes a connection pool with min 5, max 20 connections
- AND connection timeouts are set to 30 seconds
- AND reconnection logic handles transient failures
- AND the banner/startup logs confirm MySQL is connected (not SQLite)

---

### US-4: Migrate Data from SQLite to MySQL
**As a** database administrator  
**I want to** transfer all data from SQLite to MySQL tables  
**So that** no records are lost during the transition

**EARS Acceptance Criteria:**
- GIVEN both SQLite and MySQL databases are populated with their schemas
- WHEN I execute the data migration
- THEN:
  - All 1000+ staff records migrate with correct field mappings
  - All submissions migrate with child records (skills, projects)
  - All user roles and auth tokens migrate
  - All audit logs migrate with timestamps intact
  - Foreign key relationships are maintained
  - Duplicate prevention: running migration twice doesn't create duplicates
- AND migration includes row count validation before/after
- AND any data type mismatches are logged as warnings
- AND the migration can be rolled back if critical errors occur

---

### US-5: Verify Data Integrity After Migration
**As a** QA engineer  
**I want to** validate that migrated data matches source data exactly  
**So that** I can confirm zero data loss occurred

**EARS Acceptance Criteria:**
- GIVEN data has been migrated from SQLite to MySQL
- WHEN I run the integrity check
- THEN:
  - Row counts match between source and destination for all tables
  - Checksums validate data integrity (sample rows)
  - Foreign key constraints are verified (no orphaned records)
  - NULL values are correctly preserved
  - Timestamps are identical
  - Decimal/numeric precision is maintained
- AND the report is machine-readable (JSON) and human-readable
- AND any mismatches are flagged as warnings/errors

---

### US-6: Update Application Code for MySQL
**As a** developer  
**I want to** modify database initialization and query code for MySQL compatibility  
**So that** the application works with MySQL drivers

**EARS Acceptance Criteria:**
- GIVEN the backend code currently uses better-sqlite3
- WHEN database initialization runs
- THEN:
  - MySQL driver (mysql2/promise) is loaded
  - Connection string is built from environment variables
  - Connection pool is initialized
  - Schema migration (via Flyway or custom) creates tables if not present
  - WAL (Write-Ahead Logging) pragma is skipped (MySQL-specific)
  - Foreign key pragma is set if needed
  - Error handling converts MySQL errors to consistent error codes

---

### US-7: Update Docker Compose Configuration
**As a** devops engineer  
**I want to** replace SQLite container with MySQL container  
**So that** the application runs against MySQL in Docker

**EARS Acceptance Criteria:**
- GIVEN the compose.yaml currently uses alpine/sqlite
- WHEN I update the configuration
- THEN:
  - MySQL container (mysql:8.0) is defined with proper environment
  - Port 3306 is exposed for backend connectivity
  - MySQL root password is set via environment variable
  - Initial database is created with UTF8MB4 charset
  - Data volume is persistent across container restarts
  - Health checks verify MySQL is ready before starting backend
  - Backend depends_on MySQL with condition: service_healthy

---

### US-8: Implement Zero-Downtime Switching
**As a** operations team  
**I want to** switch the application from SQLite to MySQL with minimal downtime  
**So that** users experience no service interruption

**EARS Acceptance Criteria:**
- GIVEN both databases are synchronized with current data
- WHEN I execute the switch procedure
- THEN:
  - Feature flag enables gradual rollover: 0% → 100% to MySQL
  - Read operations begin on MySQL while reads still possible on SQLite
  - Write operations are dual-written (SQLite + MySQL) for safety
  - Automated rollback script reverts to SQLite if MySQL encounters errors
  - Switch procedure takes <5 minutes for first 1% traffic
  - Monitoring tracks error rates and performance during switch

---

### US-9: Backup and Restore with MySQL
**As a** database administrator  
**I want to** backup MySQL data and restore it if needed  
**So that** I have disaster recovery capability

**EARS Acceptance Criteria:**
- GIVEN MySQL is running with current data
- WHEN I execute the backup command
- THEN mysqldump creates a complete backup file with:
  - All data and schema
  - Binary-safe format
  - Compression (gzip)
  - Timestamp in filename
  - Checksum for integrity verification
- WHEN I execute the restore command
- THEN the backup is restored to MySQL with:
  - All tables and data intact
  - Zero data loss
  - Validation that row counts match

---

### US-10: Document MySQL Configuration and Migration
**As a** future maintainer  
**I want to** have clear documentation on how the migration was done  
**So that** I can support MySQL operations and troubleshoot issues

**EARS Acceptance Criteria:**
- GIVEN the migration is complete
- WHEN I read the documentation
- THEN I find:
  - MySQL schema definition (CREATE TABLE statements)
  - Connection string format and environment variables
  - Password management best practices
  - Backup/restore procedures
  - Monitoring and alerting setup
  - Rollback procedure if needed
  - Common MySQL issues and solutions

---

## Non-Functional Requirements

### Performance
- Queries should perform as well or better than SQLite for 1000+ records
- Connection pool should handle concurrent requests (50+ requests/sec)
- Migration of 10,000+ records should complete in <5 minutes
- Backup of 10,000+ records should complete in <2 minutes

### Security
- MySQL passwords stored in environment variables (not in code)
- Database connection uses SSL/TLS for remote connections
- Account has minimal required privileges (no root password exposure)
- SQL injection protection via parameterized queries
- Audit logs track all admin operations during migration

### Reliability
- Connection failures trigger automatic reconnection with exponential backoff
- Data migration is idempotent (safe to retry)
- Rollback procedure tested and verified before execution
- Zero tolerance for data loss (verify counts before/after)

### Compatibility
- Existing application code requires minimal changes
- Better-sqlite3 replaced with mysql2/promise
- All query syntax remains compatible (standard SQL)
- Foreign key behavior matches between SQLite and MySQL

---

## Implementation Approach

### Phase 1: Preparation
1. Export current SQLite data
2. Create MySQL schema
3. Set up local MySQL instance
4. Migrate and validate data
5. Update application code

### Phase 2: Testing
1. Run integration tests against MySQL
2. Performance benchmark (SQLite vs MySQL)
3. Failover and recovery tests
4. Load testing

### Phase 3: Deployment
1. Set up production MySQL instance (RDS/managed)
2. Run migration in staging environment
3. Run migration in production (off-hours)
4. Monitor and validate
5. Keep SQLite backup for 30 days

---

## Dependencies
- MySQL 8.0+
- mysql2/promise npm package
- mysqldump utility
- Node.js 20
- Docker Compose v2+

---

## Out of Scope
- Migration from other databases
- Schema redesign or optimization
- Application performance tuning beyond database driver changes
- User authentication/permission system redesign
- Real-time replication between SQLite and MySQL during transition
