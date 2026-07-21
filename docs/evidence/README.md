# Visual and machine-readable evidence

All images are 1440×1000 PNG captures. Files 01–09 use the current production bundle in a deterministic Pexip RPC browser simulator. Files 10–13 are historical captures from plugin version 3 in the authorized non-production Pexip Webapp3 environment.

## Deterministic workflow evidence

| Stage                                                | Evidence                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Two independent cases waiting                        | [01-idle-two-cases-waiting.png](01-idle-two-cases-waiting.png)                             |
| Select Case A only                                   | [02-room-selection-case-a.png](02-room-selection-case-a.png)                               |
| Start action locked while moving                     | [03-starting-case-a-guarded.png](03-starting-case-a-guarded.png)                           |
| Case A active; Case B still waiting                  | [04-case-a-active-success.png](04-case-a-active-success.png)                               |
| Pause action locked while returning                  | [05-pausing-case-a-guarded.png](05-pausing-case-a-guarded.png)                             |
| Case A returned to its original room                 | [06-case-a-returned.png](06-case-a-returned.png)                                           |
| Select Case B next                                   | [07-room-selection-case-b.png](07-room-selection-case-b.png)                               |
| Case B active; Case A waiting                        | [08-case-b-active-case-a-waiting.png](08-case-b-active-case-a-waiting.png)                 |
| Return failure leaves participants in main for retry | [09-return-failure-active-state-retained.png](09-return-failure-active-state-retained.png) |

## Historical live Webapp3 evidence

Files 10–13 and `live-validation-report.json` apply to plugin version 3's explicit-room return. They do not validate version 4's native `previous` destination; that live check is intentionally pending in the release checklist.

| Stage                                               | Evidence                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| Plugin play control registered in the chair toolbar | [10-live-pexip-idle.png](10-live-pexip-idle.png)                       |
| Native Pexip form lists the selected room and count | [11-live-pexip-room-selection.png](11-live-pexip-room-selection.png)   |
| Version 3 active pause control after admission      | [12-live-pexip-case-a-active.png](12-live-pexip-case-a-active.png)     |
| Version 3 idle control after explicit-room return   | [13-live-pexip-case-a-returned.png](13-live-pexip-case-a-returned.png) |

`live-validation-report.json` is marked as superseded historical evidence. It contains sanitized hashes, counts, and assertion outcomes, with no credentials, join URLs, aliases, tokens, participant names, or raw UUIDs.
