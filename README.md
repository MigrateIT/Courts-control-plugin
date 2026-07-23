# Court hearing control for Pexip Webapp3

Production-oriented Pexip toolbar plugin for moving cases between breakout waiting rooms and the main hearing.

The chair chooses one non-empty breakout room or all waiting rooms at once. Room snapshots provide participant counts and hide observer-only rooms, while Pexip performs a native room-scoped move-all so admission does not depend on a potentially stale UUID list. Pause asks Pexip to return participants to their server-recorded previous rooms.

## Production artifact

Deploy only these generated files, preserving their relative path:

```text
dist/
├── index.html
└── assets/
    └── index.js
```

Point the Pexip Webapp3 plugin configuration at the deployed `index.html`. The origin must be HTTPS and allowed by the Webapp3 customization.

The artifact is standalone:

- no backend, database, MMM API, CDN, font, image, or network fetch dependency;
- the Pexip public plugin SDK is bundled into `assets/index.js`;
- no hearing state, participant history, browser storage, or application messages are used;
- Start and Pause are independent chair controls, so any chair can perform either operation;
- no widget is used.

MMM and its environment file are used only by the isolated live-validation script. They are not referenced by production code or included in `dist/`.

## Toolbar control design

The chair toolbar intentionally displays two separate controls at the same time:

- **Start a case hearing** uses the play icon and opens the waiting-room selector.
- **Pause hearing and return participants to previous rooms** uses the pause icon and immediately requests the native previous-room return.

This is not a single button that changes mode. Keeping both controls visible makes the available action explicit and allows any chair to pause a hearing without relying on local state from the chair who started it. During a Start, its 10-second countdown, or a Pause operation, both controls are temporarily disabled to prevent overlapping moves. They become available again when the operation and any required hold have completed.

## Safety behavior

- The room selector excludes a breakout only after a complete room snapshot confirms that it has no waiting participants. Rooms whose snapshot has not arrived remain selectable and show **count unavailable**, so incomplete roster data cannot block Start. The final option remains **Admit all waiting rooms at once**.
- Non-waiting Pexip `api` participants, such as MMM observer legs, are excluded from participant counts; observer-only rooms are not offered for Start. Unadmitted `api` participants whose state is `waiting_room` remain included and can be started.
- Start uses `fromBreakoutUuid`, `toRoomUuid: "main"`, and an empty participant array. Pexip interprets this as moving all eligible participants from that room and retains non-movable `api` legs.
- After Pexip accepts Start, the local room count removes the exact participants selected at initiation even if Webapp3 omits the corresponding move activity. Later roster events can still correct the state, and participants who arrived during the countdown are retained.
- Starting shows a non-dismissible 10-second countdown that closes automatically.
- Admit-all sends one room-scoped move per occupied or not-yet-confirmed-empty waiting room at the same time.
- Pause uses Pexip's standard `toRoomUuid: "previous"` destination with an empty participant list, allowing Pexip to return all eligible main-room participants to their server-recorded previous rooms.
- The plugin never calls close-all or empty-all operations.
- Actions are serialized within each plugin instance; repeated local clicks cannot overlap moves.
- An explicit Pexip rejection leaves both independent controls available for a safe retry.
- Both the documented no-body success response and the newer `{ status: 200 }` response are supported.
- Participant roster changes use the v38+ `participantsActivities` event. A room-scoped `participants` snapshot is retained only to seed participants who were already waiting when the plugin subscribed. The deprecated joined/left events are not used.

## Chair workflow

1. Confirm that the separate play and pause controls are visible in the chair toolbar.
2. Click the play button, labelled **Start a case hearing**.
3. Choose one waiting room or the final **Admit all waiting rooms at once** option; current participant counts are shown.
4. Click **Start hearing**. Pexip admits all eligible participants from the selected room while leaving `api` observer legs in place.
5. Any chair can use the separate pause button, labelled **Pause hearing and return participants to previous rooms**. Pexip performs the return using its own previous-room assignments.
6. Repeat for the next waiting room.

The interface follows the Webapp3 language selection in English or Dutch.

## Build and verification

Node.js 20.12.2 or newer is required for development only.

```bash
npm ci
npm run check
npm start -- --port 5175
COURT_PLUGIN_TEST_URL=http://127.0.0.1:5175 npm run test:browser:evidence
```

`npm run check` performs formatting, lint, TypeScript checking, coverage tests, and a clean production build. The browser suite loads the real production plugin through a Pexip RPC simulator and regenerates nine screenshots.

The authorized non-production Pexip validation is deliberately separate because it creates temporary rooms and participants:

```bash
npm run test:live:pexip
```

It uses the existing MMM test environment for credentials and join URLs, injects the exact `dist/` artifact only in its isolated browser context, creates two temporary case rooms, asserts the scoped Start payload and native previous-room Pause payload, observes Pexip SSE room membership, and cleans up in `finally`.

See [release checklist](docs/RELEASE_CHECKLIST.md) and [visual evidence](docs/evidence/README.md).

## Upgrade policy

The runtime surface is intentionally small and uses `@pexip/plugin-api` calls. Pexip's documented `previous` destination is passed through the plugin bridge even though version 22.2.0's TypeScript `RoomID` declaration omits it. Before upgrading the bundled SDK or Webapp3, run the complete check, browser evidence suite, and live validation.
