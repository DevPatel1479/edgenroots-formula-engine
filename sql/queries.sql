USE edgenroots_formula_engine;

-- Supply the UUID of the formula being investigated.
SET @formula_uuid = '00000000-0000-0000-0000-000000000000';

-- 1. Full version history for one formula, oldest first, with version number.
SELECT id, uuid, version_number, name, formula_text, status,
       created_by, modified_by, first_created_at, row_inserted_at
  FROM formula_versions
 WHERE uuid = @formula_uuid
 ORDER BY id ASC;

-- 2. Active formulas in dependency execution order.
-- Walk each active formula down through its formula dependencies. MAX(depth) is the
-- dependency height, so formulas with no dependencies sort before their dependents.
WITH RECURSIVE dependency_walk (root_uuid, formula_uuid, formula_name, depth, name_path) AS (
  SELECT f.uuid, f.uuid, f.name, 0,
         CAST(CONCAT(',', f.name, ',') AS CHAR(4000))
    FROM current_formulas AS f
   WHERE f.status = 'ACTIVE'
  UNION ALL
  SELECT w.root_uuid, dependency.uuid, dependency.name, w.depth + 1,
         CONCAT(w.name_path, dependency.name, ',')
    FROM dependency_walk AS w
    JOIN current_formulas AS owner_formula ON owner_formula.uuid = w.formula_uuid
    JOIN formula_dependencies AS edge ON edge.owner_formula_version_id = owner_formula.id
    JOIN current_formulas AS dependency
      ON dependency.name = edge.depends_on_name AND dependency.status = 'ACTIVE'
   WHERE LOCATE(CONCAT(',', dependency.name, ','), w.name_path) = 0
), execution_levels AS (
  SELECT root_uuid, MAX(depth) AS dependency_height
    FROM dependency_walk
   GROUP BY root_uuid
)
SELECT formula.uuid, formula.name, formula.version_number, formula.formula_text,
       execution_levels.dependency_height AS execution_level
  FROM current_formulas AS formula
  JOIN execution_levels ON execution_levels.root_uuid = formula.uuid
 WHERE formula.status = 'ACTIVE'
 ORDER BY execution_levels.dependency_height ASC, formula.name ASC;

-- 3. Number of versions per logical formula.
SELECT fv.uuid, cf.name AS latest_name, COUNT(*) AS version_count,
       MIN(fv.first_created_at) AS first_created_at, MAX(fv.row_inserted_at) AS latest_change_at
  FROM formula_versions AS fv
  JOIN current_formulas AS cf ON cf.uuid = fv.uuid
 GROUP BY fv.uuid, cf.name
 ORDER BY version_count DESC, latest_name ASC;

-- 4. Last seven days: total runs, failures, and failure percentage per formula.
SELECT logs.formula_uuid, cf.name AS formula_name,
       COUNT(*) AS total_runs,
       SUM(logs.status = 'FAILED') AS failures,
       ROUND(100.0 * SUM(logs.status = 'FAILED') / NULLIF(COUNT(*), 0), 2) AS failure_percentage
  FROM formula_run_logs AS logs
  JOIN current_formulas AS cf ON cf.uuid = logs.formula_uuid
 WHERE logs.row_inserted_at >= NOW(3) - INTERVAL 7 DAY
 GROUP BY logs.formula_uuid, cf.name
 ORDER BY failures DESC, total_runs DESC, formula_name ASC;

-- 5. Top five formulas with the most failures and each formula's latest error.
WITH failure_counts AS (
  SELECT formula_uuid, COUNT(*) AS failures
    FROM formula_run_logs
   WHERE status = 'FAILED'
   GROUP BY formula_uuid
), latest_failure AS (
  SELECT formula_uuid, error_message, row_inserted_at,
         ROW_NUMBER() OVER (PARTITION BY formula_uuid ORDER BY row_inserted_at DESC, id DESC) AS rn
    FROM formula_run_logs
   WHERE status = 'FAILED'
)
SELECT counts.formula_uuid, cf.name AS formula_name, counts.failures,
       latest.error_message AS most_recent_error, latest.row_inserted_at AS most_recent_failure_at
  FROM failure_counts AS counts
  JOIN latest_failure AS latest ON latest.formula_uuid = counts.formula_uuid AND latest.rn = 1
  JOIN current_formulas AS cf ON cf.uuid = counts.formula_uuid
 ORDER BY counts.failures DESC, latest.row_inserted_at DESC
 LIMIT 5;

-- 6. Formulas currently deactivated and not subsequently reactivated.
SELECT cf.uuid, cf.version_number, cf.name, cf.row_inserted_at AS deactivated_at
  FROM current_formulas AS cf
 WHERE cf.status = 'INACTIVE'
 ORDER BY cf.row_inserted_at DESC, cf.name ASC;

-- 7. Time between consecutive versions, plus average time between changes per formula.
WITH version_gaps AS (
  SELECT uuid, name, version_number, row_inserted_at,
         LAG(row_inserted_at) OVER (PARTITION BY uuid ORDER BY id) AS previous_version_at,
         TIMESTAMPDIFF(SECOND,
           LAG(row_inserted_at) OVER (PARTITION BY uuid ORDER BY id),
           row_inserted_at) AS seconds_since_previous_version
    FROM formula_versions
)
SELECT uuid, name, version_number, previous_version_at, row_inserted_at,
       seconds_since_previous_version,
       ROUND(AVG(seconds_since_previous_version) OVER (PARTITION BY uuid), 2) AS average_seconds_between_changes
  FROM version_gaps
 ORDER BY uuid, version_number;
