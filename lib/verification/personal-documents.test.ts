import { describe, expect, it } from "vitest";
import {
  CATEGORY_FK,
  classifyCategoryRestrictError,
  classifyOwnerCheckError,
  OWNER_CHECK,
} from "./personal-documents";

function databaseError(
  message: string,
  options: { code?: string; meta?: unknown; cause?: unknown } = {},
) {
  return Object.assign(new Error(message), options);
}

describe("classifyOwnerCheckError", () => {
  it.each([
    ["message", databaseError(`violates check constraint "${OWNER_CHECK}"`, { code: "P2039" })],
    [
      "meta",
      databaseError("database constraint failed", {
        code: "P2039",
        meta: { database_error: { code: "23514", constraint: OWNER_CHECK } },
      }),
    ],
    [
      "cause",
      databaseError("database constraint failed", {
        code: "P2039",
        cause: databaseError(`constraint ${OWNER_CHECK} rejected the row`, { code: "23514" }),
      }),
    ],
  ])("accepts the exact owner constraint name from %s", (_, error) => {
    expect(classifyOwnerCheckError(error).proof).toBe(OWNER_CHECK);
  });

  it.each([
    ["generic P2004", databaseError("constraint failed", { code: "P2004" })],
    [
      "generic 23514 and Attachment",
      databaseError("check violation on Attachment", {
        code: "P2039",
        meta: { database_error: { code: "23514", table: "Attachment" } },
      }),
    ],
    [
      "nearby constraint name",
      databaseError(`violates constraint ${OWNER_CHECK}_legacy`, { code: "P2039" }),
    ],
    [
      "wrong constraint",
      databaseError("violates constraint Attachment_filename_check", {
        code: "P2039",
        meta: { database_error: { code: "23514" } },
      }),
    ],
  ])("rejects %s without the exact owner constraint name", (_, error) => {
    expect(() => classifyOwnerCheckError(error)).toThrow(OWNER_CHECK);
  });
});

describe("classifyCategoryRestrictError", () => {
  it.each([
    ["message", databaseError(`violates foreign key constraint "${CATEGORY_FK}"`, { code: "P2003" })],
    [
      "meta",
      databaseError("foreign key constraint failed", {
        code: "P2003",
        meta: { database_error: { code: "23503", constraint: CATEGORY_FK } },
      }),
    ],
    [
      "cause",
      databaseError("foreign key constraint failed", {
        code: "P2003",
        cause: databaseError(`constraint ${CATEGORY_FK} rejected the delete`, { code: "23503" }),
      }),
    ],
  ])("accepts the exact category FK name from %s", (_, error) => {
    expect(classifyCategoryRestrictError(error).proof).toBe(CATEGORY_FK);
  });

  it.each([
    ["generic P2003", databaseError("foreign key constraint failed", { code: "P2003" })],
    [
      "generic 23503",
      databaseError("foreign key constraint failed", {
        code: "P2039",
        meta: { database_error: { code: "23503", table: "Attachment" } },
      }),
    ],
    [
      "nearby constraint name",
      databaseError(`violates constraint ${CATEGORY_FK}_legacy`, { code: "P2003" }),
    ],
    [
      "wrong constraint",
      databaseError("violates constraint Attachment_projectId_fkey", {
        code: "P2003",
        meta: { database_error: { code: "23503" } },
      }),
    ],
  ])("rejects %s without the exact category FK name", (_, error) => {
    expect(() => classifyCategoryRestrictError(error)).toThrow(CATEGORY_FK);
  });
});
