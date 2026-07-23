# Production release checklist

## Completed baseline

- [x] Clean install lockfile is present.
- [x] Formatting and ESLint pass.
- [x] TypeScript strict checking passes.
- [x] Unit and state-machine tests pass.
- [x] Coverage gate run and report reviewed.
- [x] Production build completes without source maps.
- [x] Runtime bundle has no external application dependency.
- [x] Production and development dependency audits report zero known vulnerabilities.
- [x] Browser RPC simulation validates two independent waiting rooms, sequential hearings, busy guards, and failure retention.
- [x] Unit coverage distinguishes confirmed-empty rooms from rooms with unavailable snapshots; unavailable counts do not block a room-scoped Start.
- [x] Real Webapp3 loads the exact production artifact and renders the chair-only toolbar control and native room-selection form.
- [ ] Real Pexip accepts the selected-room-to-main request with an empty participant list, moves all eligible waiting participants, and leaves `api` observer legs in the breakout.
- [ ] Real Pexip accepts the native `previous` destination with an empty participant list through the deployed Webapp3 plugin bridge.
- [x] The other waiting room remains unchanged through both plugin operations.
- [x] Temporary Pexip rooms and sessions are closed in a `finally` cleanup path.
- [x] Shared MMM services on ports 3001 and 5173 were not stopped or replaced; validation used isolated browser routing and local port 5175.

## Deployment-day checks

1. Serve `dist/` from the final HTTPS production origin.
2. Confirm the origin is allowed by Webapp3 and the plugin URL ends at `index.html` or its containing path.
3. Open a low-impact conference with two disposable waiting rooms.
4. Confirm only chair users see the two separate toolbar controls: play for **Start a case hearing** and pause for **Pause hearing and return participants to previous rooms**.
5. Confirm both controls remain visible rather than replacing or toggling each other.
6. Start one disposable case and verify both controls remain disabled for the complete 10-second Start hold and the second room count is unchanged. Also confirm a room is hidden only after its participant snapshot establishes that it is empty.
7. Confirm any `api` observer leg remains in the selected breakout after the case participants enter the main room.
8. Pause it and verify the same people arrive back in the original room.
9. Confirm another chair can use the independent Pause control without receiving state from the chair who started the hearing.
10. Retain the prior plugin URL for immediate configuration rollback.

## Live-test caveat

The prior live result covered explicit participant UUIDs and an explicit room-UUID return. It does not validate the new empty-list Start or native `previous` call. Run `npm run test:live:pexip` before release. The simulated production-bundle suite verifies API observer retention and completed previous-room membership; the deployment-day disposable-room check above remains the final operational gate.

## Rollback

The plugin has no database migration or server-side state. Roll back by restoring the prior Webapp3 plugin URL/configuration and reloading the Webapp. An in-progress active case should be returned manually from Pexip's breakout controls before rollback.
