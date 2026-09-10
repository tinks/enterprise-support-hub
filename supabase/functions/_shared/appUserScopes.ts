// Slack user-token scopes for the per-person "Ask Pax as me" flow.
// Must match the Slack app's User Token Scopes exactly.
export const SLACK_SCOPES = ["chat:write", "channels:read", "users:read"];

export const SLACK_CONNECTOR_ID = "slack";
export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
