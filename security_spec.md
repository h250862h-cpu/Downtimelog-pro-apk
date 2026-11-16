# Security Specification for Downtime Log

## 1. Data Invariants
1. **Equipment & Temporal Integrity**: Every downtime log document must specify a valid `equipmentId`, `equipmentName`, `date`, `shift`, `category`, `severity`, `startTime`, and `status`.
2. **Signature Immutability & Tampering Protection**: Once a technician or supervisor signature is affixed and status moves to `Signed`, core incident fields (`equipmentId`, `startTime`, `faultDescription`) cannot be arbitrarily altered or retroactively erased.
3. **Bounded Size & Payloads**: All string fields are constrained to strict maxLengths (descriptions <= 2000 chars, digital signature data URLs <= 200,000 chars) to prevent resource exhaustion / Denial-of-Wallet attacks.
4. **Allowed Collections**: The database permits writes strictly to `/downtime_logs/{logId}` and `/daily_summaries/{summaryId}` with valid IDs matching `^[a-zA-Z0-9_\-]+$`.
5. **No Blanket Access**: Reads and writes must validate schema and document path bounds.

## 2. The "Dirty Dozen" Payloads (Must be Denied)
1. **Unauthenticated Write**: Creating a log entry without authentication or valid ID.
2. **Oversized Signature Attack**: Injecting a 5MB base64 payload into `technicianSignature`.
3. **Ghost Field Injection**: Adding unauthorized root fields such as `adminOverride: true` or `bypassed: true`.
4. **Missing Required Fields**: Submitting a downtime log missing `equipmentId` or `startTime`.
5. **Invalid Document ID Injection**: Attempting to write to `/downtime_logs/../../etc/passwd` or non-alphanumeric IDs.
6. **Path Traversal / Shadow Collection**: Writing to undeclared collections like `/superadmins/`.
7. **Negative Downtime Minutes**: Submitting `durationMinutes: -120`.
8. **Invalid Status Transition**: Submitting illegal status string like `status: "HACKED"`.
9. **Tampering with Closed Shift**: Attempting to delete or overwrite closed daily summaries without authorization.
10. **Type Confusion Attack**: Sending a boolean `equipmentName: true` instead of string.
11. **Excessive Notes String**: Sending `faultDescription` exceeding 2000 characters.
12. **Malformed Verification Code**: Injecting executable script into `digitalVerificationCode`.

## 3. Test Runner
Included in test suite for verifying PERMISSION_DENIED on unverified/tampered payloads.
