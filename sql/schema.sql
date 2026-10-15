-- Edgenroots Formula Engine schema (MySQL 8.0+)
-- Rows are append-only so all historical versions remain available.
CREATE DATABASE IF NOT EXISTS edgenroots_formula_engine CHARACTER
SET
  utf8mb4 COLLATE utf8mb4_0900_ai_ci;

USE edgenroots_formula_engine;

CREATE TABLE IF NOT EXISTS formula_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid CHAR(36) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  formula_text TEXT NOT NULL,
  status ENUM ('ACTIVE', 'INACTIVE') NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  modified_by VARCHAR(255) NOT NULL,
  first_created_at DATETIME (3) NOT NULL,
  row_inserted_at DATETIME (3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_formula_uuid_version (uuid, version_number),
  KEY idx_formula_uuid_id (uuid, id),
  KEY idx_formula_name_status_id (name, status, id),
  KEY idx_formula_status_inserted (status, row_inserted_at),
  KEY idx_formula_inserted (row_inserted_at)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS formula_dependencies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid CHAR(36) NOT NULL,
  owner_formula_uuid CHAR(36) NOT NULL,
  owner_formula_version_id BIGINT UNSIGNED NOT NULL,
  formula_name VARCHAR(100) NOT NULL,
  depends_on_name VARCHAR(100) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  first_created_at DATETIME (3) NOT NULL,
  row_inserted_at DATETIME (3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dependency_uuid (uuid),
  KEY idx_dependency_owner_version (owner_formula_version_id),
  KEY idx_dependency_owner_uuid (owner_formula_uuid),
  KEY idx_dependency_name (depends_on_name),
  CONSTRAINT fk_dependency_formula_version FOREIGN KEY (owner_formula_version_id) REFERENCES formula_versions (id)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS formula_run_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid CHAR(36) NOT NULL,
  run_uuid CHAR(36) NOT NULL,
  formula_uuid CHAR(36) NOT NULL,
  formula_version INT UNSIGNED NOT NULL,
  formula_name VARCHAR(100) NOT NULL,
  status ENUM ('SUCCESS', 'FAILED', 'SKIPPED') NOT NULL,
  input_json JSON NOT NULL,
  result_json JSON NULL,
  calculation_json JSON NOT NULL,
  error_message TEXT NULL,
  duration_ms DECIMAL(12, 3) NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NOT NULL,
  first_created_at DATETIME (3) NOT NULL,
  row_inserted_at DATETIME (3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_run_log_uuid (uuid),
  KEY idx_run_uuid (run_uuid),
  KEY idx_run_inserted_status (row_inserted_at, status),
  KEY idx_run_formula_inserted (formula_uuid, row_inserted_at),
  KEY idx_run_formula_name_status (formula_name, status),
  KEY idx_run_status_inserted (status, row_inserted_at)
) ENGINE = InnoDB;

-- Pick exactly one current-formula view implementation after loading this schema:
--   mysql ... < sql/views_aggregate.sql
-- OR
--   mysql ... < sql/views_window.sql
