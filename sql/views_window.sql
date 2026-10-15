USE edgenroots_formula_engine;

-- Alternative view using a window function (requires MySQL 8.0+).
CREATE
OR REPLACE VIEW current_formulas AS
SELECT
  id,
  uuid,
  version_number,
  name,
  formula_text,
  status,
  created_by,
  modified_by,
  first_created_at,
  row_inserted_at
FROM
  (
    SELECT
      fv.*,
      ROW_NUMBER() OVER (
        PARTITION BY
          uuid
        ORDER BY
          id DESC
      ) AS row_rank
    FROM
      formula_versions AS fv
  ) AS ranked
WHERE
  row_rank = 1;
