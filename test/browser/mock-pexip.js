const iframe = document.querySelector("#plugin-frame");
const toolbar = document.querySelector("#plugin-toolbar");
const modalRoot = document.querySelector("#modal-root");
const toastRoot = document.querySelector("#toast-root");

const participants = {
  clerk: participant("clerk-chair", "Court clerk", true),
  court: participant("court-chair", "Presiding judge", true),
  alice: participant("case-a-alice", "A. de Vries"),
  counsel: participant("case-a-counsel", "Counsel Jansen"),
  bob: participant("case-b-bob", "B. Smit"),
  interpreter: participant("case-b-interpreter", "Interpreter Bakker"),
};

const rooms = new Map([
  [
    "main",
    {
      name: "Main hearing",
      participants: [participants.clerk, participants.court],
    },
  ],
  [
    "breakout-case-a",
    {
      name: "Case 2026-0412",
      participants: [participants.alice, participants.counsel],
    },
  ],
  [
    "breakout-case-b",
    {
      name: "Case 2026-0413",
      participants: [participants.bob, participants.interpreter],
    },
  ],
]);

let channelId;
const buttons = new Map();
const previousRooms = new Map();
const moveRequests = [];
let nextButtonId = 1;
let moveDelay = 1200;
let failNextMove = false;

window.mockPexip = {
  setMoveDelay(value) {
    moveDelay = value;
  },
  failNextMove() {
    failNextMove = true;
  },
  moveRequests() {
    return structuredClone(moveRequests);
  },
  snapshot() {
    return Object.fromEntries(
      [...rooms].map(([id, room]) => [
        id,
        room.participants.map(({ uuid }) => uuid),
      ]),
    );
  },
};

window.addEventListener("message", (event) => {
  if (event.source !== iframe.contentWindow || !event.data?.rpc) return;
  channelId = event.data.chanId;
  void handleRpc(event.data);
});

renderRooms();

async function handleRpc(call) {
  switch (call.rpc) {
    case "syn":
      reply(call, { ack: true });
      window.setTimeout(sendInitialEvents, 20);
      break;
    case "ui:button:add":
      {
        const buttonId = `court-hearing-control-${nextButtonId++}`;
        buttons.set(buttonId, { ...call.payload });
        renderButtons();
        reply(call, ok(buttonId));
      }
      break;
    case "ui:button:update":
      buttons.set(call.payload.targetId, { ...call.payload });
      renderButtons();
      reply(call, ok(call.payload.targetId));
      break;
    case "ui:form:open": {
      const id = `form-${Date.now()}`;
      renderForm(id, call.payload);
      reply(call, ok(id));
      break;
    }
    case "ui:removeElement":
      buttons.delete(call.payload.id);
      renderButtons();
      modalRoot.replaceChildren();
      reply(call, ok(call.payload.id));
      break;
    case "ui:toast:show":
      renderToast(call.payload);
      reply(call, ok(`toast-${Date.now()}`));
      break;
    case "conference:breakoutMoveParticipants":
      moveRequests.push(structuredClone(call.payload));
      await delay(moveDelay);
      if (failNextMove) {
        failNextMove = false;
        reply(call, { status: 403, data: { result: false } });
      } else {
        moveParticipants(call.payload);
        reply(call, { status: 200, data: { result: true } });
      }
      break;
    default:
      reply(call, ok(`rpc-${Date.now()}`));
  }
}

function sendInitialEvents() {
  emit("event:conference:authenticated", {
    conferenceAlias: "validation-hearing",
    conferenceName: "Courtroom 4",
  });
  emit("event:me", { id: "main", participant: participants.clerk });
  emit("event:conferenceStatus", {
    id: "main",
    status: {
      started: true,
      directMedia: false,
      breakout: false,
      breakoutRooms: true,
    },
  });
  for (const [id, room] of [...rooms].filter(([id]) => id !== "main")) {
    emit("event:breakoutBegin", {
      breakout_uuid: id,
      participant_uuid: room.participants[0]?.uuid,
    });
    emit("event:conferenceStatus", {
      id,
      status: {
        started: true,
        directMedia: false,
        breakout: true,
        breakoutName: room.name,
      },
    });
  }
  emitAllRosters();
}

function moveParticipants({
  fromBreakoutUuid = "main",
  toRoomUuid,
  participants: ids,
}) {
  const source = rooms.get(fromBreakoutUuid);
  if (!source) return;
  const selectedIds = ids.length
    ? new Set(ids)
    : new Set(source.participants.map(({ uuid }) => uuid));
  const moved = source.participants.filter(({ uuid }) => selectedIds.has(uuid));
  source.participants = source.participants.filter(
    ({ uuid }) => !selectedIds.has(uuid),
  );
  for (const person of moved) {
    const destinationId =
      toRoomUuid === "previous" ? previousRooms.get(person.uuid) : toRoomUuid;
    const destination = rooms.get(destinationId);
    if (!destination) {
      source.participants.push(person);
      continue;
    }
    previousRooms.set(person.uuid, fromBreakoutUuid);
    if (!destination.participants.some(({ uuid }) => uuid === person.uuid)) {
      destination.participants.push(person);
    }
  }
  renderRooms();
  emitAllRosters();
}

function emitAllRosters() {
  for (const [id, room] of rooms) {
    emit("event:participants", { id, participants: room.participants });
  }
}

function renderButtons() {
  toolbar.replaceChildren(
    ...[...buttons].map(([buttonId, button]) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `plugin-button${button.isActive ? " active" : ""}${button.isDisabled ? " busy" : ""}`;
      element.dataset.testid =
        button.icon === "IconPause" ? "hearing-return" : "hearing-start";
      element.title = button.tooltip;
      element.textContent = button.tooltip;
      element.disabled = button.isDisabled;
      element.addEventListener("click", () => {
        emit("ui:button:click", {
          buttonId,
          input: { buttonId },
        });
      });
      return element;
    }),
  );
}

function renderForm(id, payload) {
  const room = payload.form.elements.room;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <form class="modal" data-testid="room-form">
      <p class="eyebrow">Room-scoped operation</p>
      <h2>${escapeHtml(payload.title)}</h2>
      <p>${escapeHtml(payload.description)}</p>
      <label>${escapeHtml(room.name)}
        <select name="room" data-testid="room-select">
          ${room.options.map((option) => `<option value="${escapeHtml(option.id)}" ${option.id === room.selected ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
      <div class="modal-actions">
        <button type="submit">${escapeHtml(payload.form.submitBtnTitle)}</button>
      </div>
    </form>`;
  backdrop.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    emit("ui:form:input", { modalId: id, input: { room: form.get("room") } });
    backdrop.remove();
  });
  modalRoot.replaceChildren(backdrop);
}

function renderToast(payload) {
  const toast = document.createElement("div");
  toast.className = `toast${payload.isDanger ? " danger" : ""}`;
  toast.dataset.testid = "toast";
  toast.textContent = payload.message;
  toastRoot.replaceChildren(toast);
  window.setTimeout(() => toast.remove(), 6500);
}

function renderRooms() {
  const main = rooms.get("main");
  document.querySelector("#main-count").textContent =
    `${main.participants.length} present`;
  document
    .querySelector("#main-participants")
    .replaceChildren(...main.participants.map(participantCard));

  const roomElements = [...rooms]
    .filter(([id]) => id !== "main")
    .map(([id, room]) => {
      const card = document.createElement("article");
      card.className = "room-card";
      card.dataset.roomId = id;
      card.innerHTML = `
        <h3>${escapeHtml(room.name)}</h3>
        <p>${room.participants.length} participant(s) waiting</p>
        <div class="room-people">
          ${
            room.participants.length
              ? room.participants
                  .map(
                    ({ displayName }) =>
                      `<span class="person-chip">${escapeHtml(displayName)}</span>`,
                  )
                  .join("")
              : '<span class="room-empty">Room empty while its case is in session</span>'
          }
        </div>`;
      return card;
    });
  document.querySelector("#rooms").replaceChildren(...roomElements);
}

function participantCard(person) {
  const card = document.createElement("div");
  card.className = "participant";
  card.innerHTML = `<span class="role">${person.isHost ? "Court" : "Case participant"}</span><strong>${escapeHtml(person.displayName)}</strong>`;
  return card;
}

function participant(uuid, displayName, isHost = false) {
  return { uuid, displayName, isHost };
}

function emit(event, payload) {
  iframe.contentWindow.postMessage({ chanId: channelId, event, payload }, "*");
}

function reply(call, payload) {
  iframe.contentWindow.postMessage(
    { chanId: call.chanId, replyTo: call.id, payload },
    "*",
  );
}

function ok(id) {
  return { status: "ok", id, data: {} };
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
