/**
 * @deprecated Import from `./exposed-table-security.ts`. Kept so existing
 * dedicated push callers keep compiling while the privilege-aware inspection
 * becomes the shared contract.
 */
export {
  buildAssertExposedApiSchemaHasRlsSql,
  buildAssertExposedTableSecuritySql,
} from "./exposed-table-security.ts";
