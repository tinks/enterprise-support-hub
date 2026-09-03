# Sandbox error diagnosis

## Finding

`FAILED_TO_ACQUIRE_SANDBOX` occurred before project code could run: Lovable could not allocate or attach the coding sandbox for that request.

Current evidence shows the project itself is healthy:
- The replacement sandbox started Vite normally.
- No build, runtime, or browser-console error logs are present.
- Both read-only reporting audit jobs completed successfully.

## Recommended response

1. Treat this occurrence as transient and continue the reporting audit.
2. Make no application or database changes for this error.
3. If it repeats, capture the timestamp and affected action, then investigate the Lovable execution trace and sandbox lifecycle rather than debugging app code.
4. Escalate only if repeated retries fail or the same error affects multiple unrelated requests.

## Verification boundary

The exact infrastructure-side allocation cause is not exposed in project logs. The conclusion is based on the error class and the healthy replacement sandbox; the underlying platform event remains **unverified** unless the error recurs and trace-level diagnostics are available.
