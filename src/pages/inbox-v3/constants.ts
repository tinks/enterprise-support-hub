// Hard data floor for Inbox v3. Nothing before this date is fetched, stored, or
// reportable in v3. Enforced in both edge functions (server) and the UI clamp
// (client). Single source of truth.
export const CLEAN_DATA_START_ISO = "2026-06-01T00:00:00Z";
export const CLEAN_DATA_START_DATE = new Date(CLEAN_DATA_START_ISO);
export const CLEAN_DATA_START_LABEL = "June 1, 2026";
