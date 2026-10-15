# Formula Engine Service – API Documentation

A versioned formula engine that stores business rules (commission, tax, discounts, etc.) as data, resolves dependencies between them automatically, and explains every number it produces.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Base URL & Conventions](#2-base-url--conventions)
3. [Endpoint Summary](#3-endpoint-summary)
4. [Formula Management APIs](#4-formula-management-apis)
   - [4.1 Create Formula](#41-create-formula)
   - [4.2 Change Formula](#42-change-formula)
   - [4.3 List Current Formulas](#43-list-current-formulas)
   - [4.4 Formula History](#44-formula-history)
   - [4.5 Roll Back Formula](#45-roll-back-formula)
   - [4.6 Dependency Impact](#46-dependency-impact)
   - [4.7 Deactivate Formula](#47-deactivate-formula)
5. [Preview APIs](#5-preview-apis)
   - [5.1 Preview One Record](#51-preview-one-record)
   - [5.2 Bulk Preview](#52-bulk-preview)
6. [Failure Handling Behaviour](#6-failure-handling-behaviour)
7. [Error Reference](#7-error-reference)
8. [Worked Example](#8-worked-example)

---

## 1. Overview

| Feature | Description |
|---|---|
| **Insert-only storage** | No `UPDATE`/`DELETE` on business tables. Every change (create, edit, deactivate, rollback) inserts a new row. |
| **UUID + version** | Each formula has a permanent `uuid`. Each change creates a new row with the same `uuid` and an incremented `version_number`. |
| **Optimistic concurrency** | Every change/rollback/deactivate request must send `expectedVersion`. A stale version returns `409 VERSION_CONFLICT`. |
| **Dependency resolution** | Formulas can read results of other formulas (e.g. `total` reads `commission` and `tax`). Execution order is computed automatically. |
| **Cycle protection** | A dependency loop (`a → b → c → a`) cannot be saved. |
| **Isolated execution** | Each formula runs with a timeout (1000 ms). A failing formula never hides others. |
| **Explainability** | Every result includes the inputs, formula, substituted steps and result. |

### How formulas are written

Inside a formula, input values (record fields or other formula results) are read using `EXTERNAL_VAR.<name>`:

```js
return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;
```

---

## 2. Base URL & Conventions

**Base URL:** `http://localhost:3000`

**Headers:** `Content-Type: application/json`

### Success response format

```json
{ "data": { } }
```

### Error response format (consistent across all endpoints)

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "requestId": "uuid",
    "details": {}
  }
}
```

### Formula status values

| Value | Meaning |
|---|---|
| `ACTIVE` | Formula is in use. |
| `INACTIVE` | Formula has been deactivated (a new row was inserted). |

---

## 3. Endpoint Summary

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | `POST` | `/formulas` | Create a formula (no `uuid`) or change one (with `uuid`) |
| 2 | `GET` | `/formulas` | List current version of every formula |
| 3 | `GET` | `/formulas/:uuid/history` | All versions of one formula |
| 4 | `POST` | `/formulas/:uuid/rollback` | Make an older version current again (as a new row) |
| 5 | `GET` | `/formulas/:uuid/impact` | Formulas that depend on this one |
| 6 | `POST` | `/formulas/:uuid/deactivate` | Deactivate a formula |
| 7 | `POST` | `/formulas/preview` | Evaluate formulas for one record |
| 8 | `POST` | `/formulas/preview/bulk` | Evaluate formulas for up to 500 records |

---

## 4. Formula Management APIs

### 4.1 Create Formula

Creates a new formula with a new UUID at version 1.

- **Method:** `POST`
- **Endpoint:** `/formulas`

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Valid identifier, unique among active formulas. This is also the result name. |
| `formulaText` | string | Yes | Formula text ending with `return`. |
| `sampleData` | object | Yes | Sample inputs used to validate the formula before saving. |
| `createdBy` | string | Yes | User creating the formula. |

```json
{
  "name": "commission_test",
  "formulaText": "return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;",
  "sampleData": {
    "amount": 2000,
    "rate": 10
  },
  "createdBy": "admin@example.com"
}
```

#### Response – `201 Created`

```json
{
  "data": {
    "name": "commission_test",
    "formula_text": "return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;",
    "status": "ACTIVE",
    "created_by": "admin@example.com",
    "modified_by": "admin@example.com",
    "uuid": "6dc714e9-2112-4c3c-9124-75b2b5ae26f4",
    "first_created_at": "2026-10-15T20:25:34.567Z",
    "version_number": 1,
    "row_inserted_at": "2026-10-15T20:25:34.567Z",
    "id": 22
  }
}
```

#### Error Responses

**`400` – `FORMULA_NAME_EXISTS`** (an active formula with the same name already exists)

```json
{
  "error": {
    "code": "FORMULA_NAME_EXISTS",
    "message": "An active formula named \"tax\" already exists.",
    "requestId": "d0c72fa6-cd8a-4409-b966-c7e62b068fbf",
    "details": {
      "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685"
    }
  }
}
```

**`400` – `INVALID_FORMULA`** (formula failed against sample data; nothing is saved)

Request:

```json
{
  "name": "postman_invalid_formula",
  "formulaText": "return EXTERNAL_VAR.amount * ;",
  "sampleData": { "amount": 100 },
  "createdBy": "postman-test"
}
```

Response:

```json
{
  "error": {
    "code": "INVALID_FORMULA",
    "message": "Formula failed validation against sample data; nothing was saved.",
    "requestId": "b088a73f-532d-4490-9e6d-53196bcf19d0",
    "details": {
      "formula": "return EXTERNAL_VAR.amount * ;",
      "reason": "Unexpected token ';'",
      "calculation": {
        "inputs": { "amount": 100 },
        "formula": "return EXTERNAL_VAR.amount * ;",
        "substitutedSteps": "return 100 * ;",
        "result": null,
        "engineCalculationText": null
      }
    }
  }
}
```

**`400` – `DEPENDENCY_CYCLE`** (saving would create a dependency loop)

Scenario: `postman_cycle_a` reads `postman_cycle_b`, `postman_cycle_b` reads `postman_cycle_c`, then `postman_cycle_c` is saved reading `postman_cycle_a`.

```json
{
  "error": {
    "code": "DEPENDENCY_CYCLE",
    "message": "Dependency loop detected: postman_cycle_a -> postman_cycle_b -> postman_cycle_c -> postman_cycle_a.",
    "requestId": "9f7b60d0-cd32-4769-a99e-7bf40290b87e",
    "details": {
      "path": [
        "postman_cycle_a",
        "postman_cycle_b",
        "postman_cycle_c",
        "postman_cycle_a"
      ]
    }
  }
}
```

> **Note:** Formulas may be created in any order (e.g. `total` before `tax`). Dependencies are resolved at preview time.

---

### 4.2 Change Formula

Changes an existing formula by inserting a new row with the **same UUID** and an incremented version. Fields not sent keep their previous value.

- **Method:** `POST`
- **Endpoint:** `/formulas` (same endpoint as create – send a `uuid` to change)

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `uuid` | string | Yes | UUID of the formula to change. |
| `expectedVersion` | integer | Yes | Version the client last saw (optimistic lock). |
| `name` | string | No | New/same name. |
| `formulaText` | string | No | New formula text. |
| `modifiedBy` | string | Yes | User making the change. |

```json
{
  "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
  "expectedVersion": 2,
  "name": "tax",
  "formulaText": "return EXTERNAL_VAR.commission * 0.11;",
  "modifiedBy": "admin@example.com"
}
```

#### Response – `200 OK`

```json
{
  "data": {
    "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
    "version_number": 3,
    "name": "tax",
    "formula_text": "return EXTERNAL_VAR.commission * 0.11;",
    "status": "ACTIVE",
    "created_by": "admin@example.com",
    "modified_by": "admin@example.com",
    "first_created_at": "2026-10-15T18:59:02.195Z",
    "row_inserted_at": "2026-10-15T20:57:28.259Z",
    "id": 27
  }
}
```

#### Error Response – `409 Conflict` (`VERSION_CONFLICT`)

Returned when `expectedVersion` is older than the current version. The current version is returned so the client can refresh.

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "The formula has changed since the supplied version was read.",
    "requestId": "93b55f98-4ea0-41e5-88ca-f8c9e81d832e",
    "details": {
      "expectedVersion": 1,
      "currentVersion": 2,
      "currentFormula": {
        "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
        "name": "tax",
        "version": 2,
        "status": "ACTIVE",
        "rowInsertedAt": "2026-10-15T20:56:14.099Z"
      }
    }
  }
}
```

---

### 4.3 List Current Formulas

Returns the **current version** of every formula (read from the current-formulas database view).

- **Method:** `GET`
- **Endpoint:** `/formulas`
- **Request Body:** None

#### Response – `200 OK`

```json
{
  "data": [
    {
      "id": 22,
      "uuid": "6dc714e9-2112-4c3c-9124-75b2b5ae26f4",
      "version_number": 1,
      "name": "commission_test",
      "formula_text": "return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100;",
      "status": "ACTIVE",
      "created_by": "admin@example.com",
      "modified_by": "admin@example.com",
      "first_created_at": "2026-10-15T20:25:34.567Z",
      "row_inserted_at": "2026-10-15T20:25:34.567Z"
    },
    {
      "id": 18,
      "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
      "version_number": 1,
      "name": "tax",
      "formula_text": "return EXTERNAL_VAR.commission * 0.18;",
      "status": "ACTIVE",
      "created_by": "admin@example.com",
      "modified_by": "admin@example.com",
      "first_created_at": "2026-10-15T18:59:02.195Z",
      "row_inserted_at": "2026-10-15T18:59:02.195Z"
    }
  ]
}
```

> The response contains one object per formula; the list above is shortened for readability.

---

### 4.4 Formula History

Returns **all versions** of a single formula, oldest first.

- **Method:** `GET`
- **Endpoint:** `/formulas/:uuid/history`
- **Example:** `/formulas/cd7c19a3-2f9b-4563-b945-e0d950f69685/history`
- **Request Body:** None

#### Response – `200 OK`

```json
{
  "data": [
    {
      "id": 18,
      "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
      "version_number": 1,
      "name": "tax",
      "formula_text": "return EXTERNAL_VAR.commission * 0.18;",
      "status": "ACTIVE",
      "created_by": "admin@example.com",
      "modified_by": "admin@example.com",
      "first_created_at": "2026-10-15T18:59:02.195Z",
      "row_inserted_at": "2026-10-15T18:59:02.195Z"
    },
    {
      "id": 26,
      "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
      "version_number": 2,
      "name": "tax",
      "formula_text": "return EXTERNAL_VAR.commission * 0.17;",
      "status": "ACTIVE",
      "created_by": "admin@example.com",
      "modified_by": "admin@example.com",
      "first_created_at": "2026-10-15T18:59:02.195Z",
      "row_inserted_at": "2026-10-15T20:56:14.099Z"
    }
  ]
}
```

---

### 4.5 Roll Back Formula

Makes an older version current again by inserting a **new row** (new version number) that copies the old version's values.

- **Method:** `POST`
- **Endpoint:** `/formulas/:uuid/rollback`
- **Example:** `/formulas/cd7c19a3-2f9b-4563-b945-e0d950f69685/rollback`

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `expectedVersion` | integer | Yes | Current version the client last saw. |
| `targetVersion` | integer | Yes | Old version whose values should be restored. |
| `modifiedBy` | string | Yes | User performing the rollback. |

```json
{
  "expectedVersion": 3,
  "targetVersion": 1,
  "modifiedBy": "admin@example.com"
}
```

#### Response – `200 OK`

Version 4 is created with the values of version 1.

```json
{
  "data": {
    "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
    "version_number": 4,
    "name": "tax",
    "formula_text": "return EXTERNAL_VAR.commission * 0.18;",
    "status": "ACTIVE",
    "created_by": "admin@example.com",
    "modified_by": "admin@example.com",
    "first_created_at": "2026-10-15T18:59:02.195Z",
    "row_inserted_at": "2026-10-15T21:00:29.230Z",
    "id": 28
  }
}
```

#### Error Response – `409 Conflict` (`VERSION_CONFLICT`)

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "The formula has changed since the supplied version was read.",
    "requestId": "39a9e374-714c-4b11-83cb-65ef5ee50f25",
    "details": {
      "expectedVersion": 2,
      "currentVersion": 3,
      "currentFormula": {
        "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
        "name": "tax",
        "version": 3,
        "status": "ACTIVE",
        "rowInsertedAt": "2026-10-15T20:57:28.259Z"
      }
    }
  }
}
```

---

### 4.6 Dependency Impact

Returns every formula that **directly or indirectly** depends on the given formula.

- **Method:** `GET`
- **Endpoint:** `/formulas/:uuid/impact`
- **Example:** `/formulas/cd7c19a3-2f9b-4563-b945-e0d950f69685/impact`
- **Request Body:** None

#### Response – `200 OK`

| Field | Description |
|---|---|
| `uuid` / `name` / `version` | The dependent formula. |
| `direct` | `true` if it reads this formula directly, `false` if indirectly (through another formula). |

```json
{
  "data": [
    {
      "uuid": "0510dcc0-162a-424c-8259-c118b2744f59",
      "name": "total_formula",
      "version": 1,
      "direct": true
    },
    {
      "uuid": "ea800252-bd4d-4014-9455-761199ad56cf",
      "name": "total_test_formula",
      "version": 1,
      "direct": true
    }
  ]
}
```

---

### 4.7 Deactivate Formula

Deactivates a formula by inserting a new row with the same UUID and status `INACTIVE`. If other active formulas depend on it, the request is rejected unless `force` is `true`.

- **Method:** `POST`
- **Endpoint:** `/formulas/:uuid/deactivate`
- **Example:** `/formulas/cd7c19a3-2f9b-4563-b945-e0d950f69685/deactivate`

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `expectedVersion` | integer | Yes | Current version the client last saw. |
| `force` | boolean | No | Set `true` to deactivate even if active formulas depend on it. |
| `modifiedBy` | string | Yes | User performing the deactivation. |

```json
{
  "expectedVersion": 4,
  "force": true,
  "modifiedBy": "admin@example.com"
}
```

#### Response – `200 OK`

```json
{
  "data": {
    "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
    "version_number": 5,
    "name": "tax",
    "formula_text": "return EXTERNAL_VAR.commission * 0.18;",
    "status": "INACTIVE",
    "created_by": "admin@example.com",
    "modified_by": "admin@example.com",
    "first_created_at": "2026-10-15T18:59:02.195Z",
    "row_inserted_at": "2026-10-15T21:02:57.917Z",
    "id": 29
  }
}
```

#### Error Responses

**`409` – `VERSION_CONFLICT`** (`expectedVersion` is stale)

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "The formula has changed since the supplied version was read.",
    "requestId": "d3b7f2b5-7d4f-4242-bffc-aedf0a02f810",
    "details": {
      "expectedVersion": 2,
      "currentVersion": 4,
      "currentFormula": {
        "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
        "name": "tax",
        "version": 4,
        "status": "ACTIVE",
        "rowInsertedAt": "2026-10-15T21:00:29.230Z"
      }
    }
  }
}
```

**`409` – `DEPENDENTS_EXIST`** (active formulas depend on this one and `force` was not set)

```json
{
  "error": {
    "code": "DEPENDENTS_EXIST",
    "message": "Deactivating \"tax\" would break active formulas. Set force=true to proceed.",
    "requestId": "42cb31ff-07f0-47e0-842f-ba282b0d7a15",
    "details": [
      {
        "uuid": "0510dcc0-162a-424c-8259-c118b2744f59",
        "name": "total_formula"
      },
      {
        "uuid": "ea800252-bd4d-4014-9455-761199ad56cf",
        "name": "total_test_formula"
      }
    ]
  }
}
```

---

## 5. Preview APIs

Preview APIs evaluate formulas against input data. They **do not save or modify any formula data**; they only write run-log rows (one per formula, grouped by one `runUuid`).

### 5.1 Preview One Record

Evaluates formulas for a single data record and explains each result.

- **Method:** `POST`
- **Endpoint:** `/formulas/preview`

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `data` | object | Yes | The input record (fields that formulas can read). |
| `formulaUuids` | string[] | No | Formulas to evaluate. Defaults to all active formulas. |
| `asof` | ISO timestamp | No | Uses formulas exactly as they were at that moment. |
| `createdBy` | string | Yes | Client/user requesting the preview. |

```json
{
  "data": {
    "amount": 2000,
    "rate": 10,
    "commission": 200
  },
  "formulaUuids": [
    "0510dcc0-162a-424c-8259-c118b2744f59",
    "ce65c6fd-ed54-4e91-b126-0ab9f4042a64",
    "cd7c19a3-2f9b-4563-b945-e0d950f69685"
  ],
  "createdBy": "postman-client"
}
```

#### Response – `200 OK`

```json
{
  "data": {
    "runUuid": "8c5ea33c-5f0f-4efa-abc6-73b9dd5dc0f5",
    "input": {
      "amount": 2000,
      "rate": 10,
      "commission": 200
    },
    "results": [
      {
        "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
        "name": "tax",
        "version": 1,
        "status": "SUCCESS",
        "result": 36,
        "calculation": {
          "inputs": { "commission": 200 },
          "formula": "return EXTERNAL_VAR.commission * 0.18;",
          "substitutedSteps": "return 200 * 0.18;",
          "result": 36,
          "engineCalculationText": null
        },
        "error": null,
        "durationMs": 6.59
      },
      {
        "uuid": "0510dcc0-162a-424c-8259-c118b2744f59",
        "name": "total_formula",
        "version": 1,
        "status": "SUCCESS",
        "result": 236,
        "calculation": {
          "inputs": { "commission": 200, "tax": 36 },
          "formula": "return EXTERNAL_VAR.commission + EXTERNAL_VAR.tax;",
          "substitutedSteps": "return 200 + 36;",
          "result": 236,
          "engineCalculationText": null
        },
        "error": null,
        "durationMs": 3.09
      }
    ],
    "record": {
      "amount": 2000,
      "rate": 10,
      "commission": 200,
      "tax": 36,
      "tax_formula": 36,
      "total_formula": 236
    },
    "metrics": {
      "totalTimeMs": 100.84,
      "averageTimePerRecordMs": 100.84,
      "failures": 0,
      "skipped": 0
    }
  }
}
```

> The `results` array above is shortened (the `tax_formula` entry is omitted); the real response has one entry per evaluated formula, ordered by dependency level.

#### Response Field Reference

| Field | Description |
|---|---|
| `runUuid` | UUID shared by all run-log rows of this preview. |
| `input` | The input record that was sent. |
| `results[].status` | `SUCCESS`, `FAILED` or `SKIPPED`. |
| `results[].result` | Computed value (rounded to 2 decimals), or `null` on failure/skip. |
| `results[].calculation.inputs` | Values the formula actually read. |
| `results[].calculation.substitutedSteps` | Formula with real values substituted (the "how was this calculated" explanation). |
| `results[].error` | Error/skip reason, `null` on success. |
| `results[].durationMs` | Time taken by this formula. |
| `record` | Final record = input + every successful formula result added. |
| `metrics` | Total time, average time per record, failures and skipped counts. |

---

### 5.2 Bulk Preview

Evaluates formulas for up to **500 records** in one request.

- **Method:** `POST`
- **Endpoint:** `/formulas/preview/bulk`

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `records` | object[] | Yes | Up to 500 input records. |
| `formulaUuids` | string[] | No | Formulas to evaluate. Defaults to all active formulas. |
| `asof` | ISO timestamp | No | Uses formulas exactly as they were at that moment. |
| `createdBy` | string | Yes | Client/user requesting the preview. |

```json
{
  "records": [
    { "amount": 1000, "rate": 10, "commission": 100, "postman_cycle_a": 10 },
    { "amount": 1500, "rate": 10, "commission": 150, "postman_cycle_a": 15 },
    { "amount": 2000, "rate": 10, "commission": 200, "postman_cycle_a": 20 }
  ],
  "formulaUuids": [
    "cd7c19a3-2f9b-4563-b945-e0d950f69685"
  ],
  "asof": "2026-10-16T00:00:00.000Z",
  "createdBy": "benchmark-test"
}
```

#### Response – `200 OK`

```json
{
  "data": {
    "runUuid": "ab772bd6-e106-409d-92a0-d6cec25b3358",
    "records": [
      {
        "input": { "amount": 1000, "rate": 10, "commission": 100, "postman_cycle_a": 10 },
        "results": [
          {
            "uuid": "cd7c19a3-2f9b-4563-b945-e0d950f69685",
            "name": "tax",
            "version": 1,
            "status": "SUCCESS",
            "result": 18,
            "calculation": {
              "inputs": { "commission": 100 },
              "formula": "return EXTERNAL_VAR.commission * 0.18;",
              "substitutedSteps": "return 100 * 0.18;",
              "result": 18,
              "engineCalculationText": null
            },
            "error": null,
            "durationMs": 2.74
          }
        ],
        "record": {
          "amount": 1000,
          "rate": 10,
          "commission": 100,
          "postman_cycle_a": 10,
          "tax": 18
        }
      },
      {
        "input": { "amount": 1500, "rate": 10, "commission": 150, "postman_cycle_a": 15 },
        "results": [ { "name": "tax", "status": "SUCCESS", "result": 27 } ],
        "record": { "amount": 1500, "rate": 10, "commission": 150, "postman_cycle_a": 15, "tax": 27 }
      },
      {
        "input": { "amount": 2000, "rate": 10, "commission": 200, "postman_cycle_a": 20 },
        "results": [ { "name": "tax", "status": "SUCCESS", "result": 36 } ],
        "record": { "amount": 2000, "rate": 10, "commission": 200, "postman_cycle_a": 20, "tax": 36 }
      }
    ],
    "metrics": {
      "totalTimeMs": 16.45,
      "averageTimePerRecordMs": 5.48,
      "failures": 0,
      "skipped": 0,
      "recordsProcessed": 3,
      "formulaRuns": 3
    }
  }
}
```

> Records 2 and 3 are shortened above; each record in the real response contains the full `results[]` structure shown for record 1.

#### Bulk-specific Metrics

| Field | Description |
|---|---|
| `recordsProcessed` | Number of records evaluated. |
| `formulaRuns` | Total formula evaluations across all records. |
| `averageTimePerRecordMs` | `totalTimeMs ÷ recordsProcessed`. |

---

## 6. Failure Handling Behaviour

Preview endpoints never fail as a whole because of one bad formula.

| Situation | Behaviour |
|---|---|
| Formula runs too long (> 1000 ms) | Marked `FAILED` with a timeout error. |
| Formula depends on a failed/skipped formula | Marked `SKIPPED` with the reason. |
| Formula is independent | Still runs and returns `SUCCESS`. |

### Example – timeout with skipped dependent

**Request** (`POST /formulas/preview`)

```json
{
  "data": {
    "shouldHang": true,
    "amount": 10
  },
  "formulaUuids": [
    "6f9866bb-e8b8-4900-91f2-86775e24e3c9",
    "aabd93d0-1e7e-4ef8-a233-bc210717b342",
    "dd9028d8-9db3-48dc-b641-b0bcbbf07e9b"
  ],
  "createdBy": "postman-test"
}
```

**Formulas used**

| Name | Formula | Expected outcome |
|---|---|---|
| `postman_timeout` | `if (EXTERNAL_VAR.shouldHang) { while (true) {} } return 10;` | `FAILED` (timeout) |
| `postman_timeout_dependent` | `return EXTERNAL_VAR.postman_timeout + 5;` | `SKIPPED` |
| `postman_timeout_independent` | `return EXTERNAL_VAR.amount * 2;` | `SUCCESS` (20) |

**Response – `200 OK`**

```json
{
  "data": {
    "runUuid": "77527d83-4bf5-45d9-ba76-491a7da68451",
    "input": { "shouldHang": true, "amount": 10 },
    "results": [
      {
        "uuid": "6f9866bb-e8b8-4900-91f2-86775e24e3c9",
        "name": "postman_timeout",
        "version": 1,
        "status": "FAILED",
        "result": null,
        "calculation": {
          "inputs": { "shouldHang": true },
          "formula": "if (EXTERNAL_VAR.shouldHang) { while (true) {} } return 10;",
          "substitutedSteps": "if (true) { while (true) {} } return 10;",
          "result": null,
          "engineCalculationText": null
        },
        "error": "Formula exceeded the 1000 ms timeout.",
        "durationMs": 1016.59
      },
      {
        "uuid": "dd9028d8-9db3-48dc-b641-b0bcbbf07e9b",
        "name": "postman_timeout_independent",
        "version": 1,
        "status": "SUCCESS",
        "result": 20,
        "calculation": {
          "inputs": { "amount": 10 },
          "formula": "return EXTERNAL_VAR.amount * 2;",
          "substitutedSteps": "return 10 * 2;",
          "result": 20,
          "engineCalculationText": null
        },
        "error": null,
        "durationMs": 55.59
      },
      {
        "uuid": "aabd93d0-1e7e-4ef8-a233-bc210717b342",
        "name": "postman_timeout_dependent",
        "version": 1,
        "status": "SKIPPED",
        "result": null,
        "calculation": {
          "inputs": { "postman_timeout": null },
          "formula": "return EXTERNAL_VAR.postman_timeout + 5;",
          "substitutedSteps": null,
          "result": null,
          "engineCalculationText": null
        },
        "error": "Skipped because dependency \"postman_timeout\" did not succeed.",
        "durationMs": 0
      }
    ],
    "record": {
      "shouldHang": true,
      "amount": 10,
      "postman_timeout_independent": 20
    },
    "metrics": {
      "totalTimeMs": 1049.48,
      "averageTimePerRecordMs": 1049.48,
      "failures": 1,
      "skipped": 1
    }
  }
}
```

---

## 7. Error Reference

| HTTP Code | Error Code | When it happens | Endpoint(s) |
|---|---|---|---|
| `400` | `FORMULA_NAME_EXISTS` | An active formula with the same name already exists. | `POST /formulas` |
| `400` | `INVALID_FORMULA` | Formula has a syntax/runtime error against sample data. Nothing is inserted. | `POST /formulas` |
| `400` | `DEPENDENCY_CYCLE` | Saving would create a dependency loop. Full path is returned. | `POST /formulas` |
| `409` | `VERSION_CONFLICT` | `expectedVersion` is older than the current version. Current version is returned. | change, rollback, deactivate |
| `409` | `DEPENDENTS_EXIST` | Deactivating would break active formulas and `force` is not `true`. Dependents are listed. | `POST /formulas/:uuid/deactivate` |

---

## 8. Worked Example

**Input record:** `amount = 2000`, `rate = 10`

| Formula | Rule | Depends on | Result |
|---|---|---|---|
| `commission` | `amount × rate ÷ 100` | record fields | `200.00` |
| `tax` | `commission × 0.18` | `commission` | `36.00` |
| `total` | `commission + tax` | `commission`, `tax` | `236.00` |

### Suggested test flow

1. `POST /formulas` – create `total` → `tax` → `commission` (any order works).
2. `POST /formulas/preview` – send `{ "data": { "amount": 2000, "rate": 10 } }` → results `200, 36, 236` in dependency order.
3. `POST /formulas` – change `tax` using `uuid` + `expectedVersion` → new version created.
4. `GET /formulas/:uuid/history` – confirm 2 versions exist.
5. `POST /formulas/preview` with `asof` before the change → old `tax` rule is used.
6. `POST /formulas/:uuid/rollback` – restore version 1 as a new version.
7. `GET /formulas/:uuid/impact` – see which formulas depend on `tax`.
8. `POST /formulas/:uuid/deactivate` – rejected with `DEPENDENTS_EXIST` unless `force: true`.
