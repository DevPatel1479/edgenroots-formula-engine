USE edgenroots_formula_engine;

-- Current row is the formula version with the highest auto-increment id for its UUID.
CREATE
OR REPLACE VIEW current_formulas AS
SELECT
  fv.*
FROM
  formula_versions AS fv
  JOIN (
    SELECT
      uuid,
      MAX(id) AS current_id
    FROM
      formula_versions
    GROUP BY
      uuid
  ) AS latest ON latest.current_id = fv.id;
