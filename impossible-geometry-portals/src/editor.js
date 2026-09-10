import { Euler, Quaternion, Vector3 } from "three";
import { cloneDocument, roomBounds, validateDocument } from "./core.js";
import { createBlankLevel, LEVELS } from "./levels.js";

const COLLECTIONS = [
  "rooms",
  "blocks",
  "portals",
  "cubes",
  "plates",
  "doors",
  "goals",
];
const LABELS = {
  rooms: "Room",
  blocks: "Block",
  portals: "Portal",
  cubes: "Cube",
  plates: "Plate",
  doors: "Door",
  goals: "Goal",
  spawn: "Start",
};
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const STORAGE_KEY = "parallax-observatory.editor.v1";
const IDENTITY = [0, 0, 0, 1];
const RAD = Math.PI / 180;
const exceedsImportLimit = (text) =>
  text.length > MAX_IMPORT_BYTES ||
  new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES;
const FACES = {
  north: { label: "North / inward +Z", quaternion: IDENTITY },
  south: { label: "South / inward -Z", quaternion: [0, 1, 0, 0] },
  west: {
    label: "West / inward +X",
    quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
  },
  east: {
    label: "East / inward -X",
    quaternion: [0, -Math.SQRT1_2, 0, Math.SQRT1_2],
  },
  floor: {
    label: "Floor / inward +Y",
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  },
  ceiling: {
    label: "Ceiling / inward -Y",
    quaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  },
};
const failure = (message) => ({
  valid: false,
  errors: [message],
  changed: false,
});
const unchanged = () => ({ valid: true, errors: [], changed: false });
const round = (value) => Number(value.toFixed(6));
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function validate(doc) {
  try {
    const result = validateDocument(doc);
    // JSON can otherwise silently turn nonfinite numbers in extra fields into null.
    JSON.stringify(doc, (_, value) => {
      if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("Document numbers must be finite.");
      return value;
    });
    return { ...result, changed: false };
  } catch (error) {
    return failure(`Invalid document: ${error.message}`);
  }
}

function findEntity(doc, id) {
  if (id === "player") return { key: "spawn", entity: doc.spawn };
  for (const key of COLLECTIONS) {
    const entity = doc[key].find((item) => item.id === id);
    if (entity) return { key, entity };
  }
  if (id === "spawn") return { key: "spawn", entity: doc.spawn };
  return null;
}

function uniqueId(doc, prefix) {
  const ids = new Set(
    COLLECTIONS.flatMap((key) => doc[key].map((entity) => entity.id)),
  );
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

function halfSize(key, entity) {
  const size =
    key === "spawn"
      ? [0.56, 1.7, 0.56]
      : key === "cubes"
        ? [entity.size, entity.size, entity.size]
        : entity.size;
  const half = size.map((n) => n / 2);
  const q = new Quaternion().fromArray(
    entity.rotation || entity.quaternion || IDENTITY,
  );
  const axes = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ].map((v) => new Vector3(...v).applyQuaternion(q).toArray());
  return half.map((_, i) =>
    axes.reduce((sum, axis, j) => sum + Math.abs(axis[i]) * half[j], 0),
  );
}

function moveEntity(doc, id, position) {
  const found = findEntity(doc, id);
  if (!found) throw new Error("Selection no longer exists.");
  const { key, entity } = found;
  if (key === "rooms") {
    const delta = position.map((n, i) => n - entity.center[i]);
    for (const collection of COLLECTIONS.slice(1))
      for (const child of doc[collection]) {
        if (child.room === id)
          child.position = child.position.map((n, i) => n + delta[i]);
      }
    if (doc.spawn.room === id)
      doc.spawn.position = doc.spawn.position.map((n, i) => n + delta[i]);
    entity.center = [...position];
  } else entity.position = [...position];
}

function placeInRoom(doc, key, entity, room, centerFirst = false) {
  const { min, max } = roomBounds(room);
  const half = halfSize(key, entity);
  entity.room = room.id;
  const y = min.y + half[1] + (key === "cubes" || key === "spawn" ? 0.01 : 0);
  const occupied = [
    { key: "spawn", entity: doc.spawn },
    ...["blocks", "cubes", "plates", "doors", "goals"].flatMap((collection) =>
      doc[collection].map((item) => ({ key: collection, entity: item })),
    ),
  ].filter((item) => item.entity !== entity && item.entity.room === room.id);
  const offsets = centerFirst
    ? [
        [0, 0],
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ]
    : [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
        [0, 0],
      ];
  for (let z = -5; z <= 5; z++)
    for (let x = -5; x <= 5; x++)
      offsets.push([
        x * Math.max(0.5, (room.size[0] - half[0] * 2) / 10),
        z * Math.max(0.5, (room.size[2] - half[2] * 2) / 10),
      ]);
  for (const [x, z] of offsets) {
    entity.position = [room.center[0] + x, y, room.center[2] + z];
    if (
      entity.position.some(
        (n, i) =>
          n - half[i] < min.getComponent(i) - 1e-6 ||
          n + half[i] > max.getComponent(i) + 1e-6,
      )
    )
      continue;
    if (
      occupied.some((item) => {
        const otherHalf = halfSize(item.key, item.entity);
        return entity.position.every(
          (n, i) =>
            Math.abs(n - item.entity.position[i]) <
            half[i] + otherHalf[i] + 0.04,
        );
      })
    )
      continue;
    if (validate(doc).valid) return;
  }
  throw new Error(
    `No clear placement in ${room.name}. Make space or choose another room.`,
  );
}

/** Snapshot history has no DOM dependency. All results include valid, errors, and changed. */
export class DocumentHistory {
  constructor(doc) {
    this.undoStack = [];
    this.redoStack = [];
    this._drag = null;
    const result = DocumentHistory.prototype.replace.call(this, doc);
    if (!result.valid) throw new Error(result.errors.join("\n"));
  }

  _commit(next, label = "Edit document") {
    const result = validate(next);
    if (!result.valid) return result;
    if (JSON.stringify(this.doc) === JSON.stringify(next)) return unchanged();
    const committed = cloneDocument(next);
    this.undoStack.push({ doc: cloneDocument(this.doc), label });
    this.redoStack.length = 0;
    this.doc = committed;
    return { valid: true, errors: [], changed: true, label };
  }

  transaction(mutator, label = "Edit document") {
    if (this._drag) this.endDrag();
    try {
      const next = cloneDocument(this.doc);
      const returned = mutator(next);
      if (returned && typeof returned.then === "function")
        return failure("Transactions must be synchronous.");
      return this._commit(next, label);
    } catch (error) {
      return failure(error.message);
    }
  }

  undo() {
    if (this._drag) this.endDrag();
    const previous = this.undoStack.at(-1);
    if (!previous) return unchanged();
    const result = validate(previous.doc);
    if (!result.valid) return result;
    this.redoStack.push({
      doc: cloneDocument(this.doc),
      label: previous.label,
    });
    this.doc = cloneDocument(previous.doc);
    this.undoStack.pop();
    return {
      valid: true,
      errors: [],
      changed: true,
      label: `Undo: ${previous.label}`,
    };
  }

  redo() {
    if (this._drag) this.endDrag();
    const next = this.redoStack.at(-1);
    if (!next) return unchanged();
    const result = validate(next.doc);
    if (!result.valid) return result;
    this.undoStack.push({ doc: cloneDocument(this.doc), label: next.label });
    this.doc = cloneDocument(next.doc);
    this.redoStack.pop();
    return {
      valid: true,
      errors: [],
      changed: true,
      label: `Redo: ${next.label}`,
    };
  }

  replace(doc) {
    try {
      const next = cloneDocument(doc),
        result = validate(next);
      if (!result.valid) return result;
      const changed = JSON.stringify(this.doc) !== JSON.stringify(next);
      this.doc = next;
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this._drag = null;
      return { valid: true, errors: [], changed, label: "Document loaded" };
    } catch (error) {
      return failure(error.message);
    }
  }

  deleteEntity(id) {
    return this.transaction(
      (doc) => {
        const found = findEntity(doc, id);
        if (!found) throw new Error("Selection no longer exists.");
        if (found.key === "spawn")
          throw new Error(
            "A start is required. Move it instead of deleting it.",
          );
        const removed = new Set([id]);
        if (found.key === "rooms") {
          if (doc.rooms.length === 1)
            throw new Error("Keep at least one room.");
          for (const key of COLLECTIONS.slice(1))
            for (const entity of doc[key])
              if (entity.room === id) removed.add(entity.id);
        }
        for (const portal of doc.portals)
          if (removed.has(portal.id)) removed.add(portal.linkedTo);
        for (const key of COLLECTIONS)
          doc[key] = doc[key].filter((entity) => !removed.has(entity.id));
        for (const plate of doc.plates)
          plate.doorIds = plate.doorIds.filter(
            (doorId) => !removed.has(doorId),
          );
        for (const goal of doc.goals)
          goal.requires = goal.requires.filter(
            (doorId) => !removed.has(doorId),
          );
        if (found.key === "rooms" && doc.spawn.room === id) {
          let placed = false;
          for (const room of doc.rooms) {
            try {
              placeInRoom(doc, "spawn", doc.spawn, room, true);
              placed = true;
              break;
            } catch {
              /* Try the next surviving room. */
            }
          }
          if (!placed)
            throw new Error(
              "Cannot remove this room: no safe start fits in the remaining rooms.",
            );
        }
      },
      `Delete ${LABELS[findEntity(this.doc, id)?.key] || "selection"}`,
    );
  }

  exportJSON() {
    return JSON.stringify(this.doc, null, 2);
  }

  importJSON(text) {
    if (typeof text !== "string") return failure("Import expects JSON text.");
    if (exceedsImportLimit(text))
      return failure("JSON import is limited to 2 MB.");
    try {
      return this.replace(JSON.parse(text));
    } catch (error) {
      return failure(`Could not parse JSON: ${error.message}`);
    }
  }

  beginDrag(id) {
    if (this._drag) this.endDrag();
    if (!findEntity(this.doc, id))
      return failure("Selection no longer exists.");
    this._drag = { id, before: cloneDocument(this.doc), result: unchanged() };
    return unchanged();
  }

  updateDrag(position) {
    if (!this._drag) return failure("Begin a drag before moving a selection.");
    const beforeUpdate = JSON.stringify(this.doc);
    let result;
    try {
      const values = position?.isVector3 ? position.toArray() : position;
      if (
        !Array.isArray(values) ||
        values.length !== 3 ||
        !values.every(Number.isFinite)
      )
        throw new Error("Position needs three finite coordinates.");
      const next = cloneDocument(this._drag.before);
      moveEntity(next, this._drag.id, values);
      result = validate(next);
      this.doc = result.valid ? next : cloneDocument(this._drag.before);
    } catch (error) {
      result = failure(error.message);
      this.doc = cloneDocument(this._drag.before);
    }
    result.changed = beforeUpdate !== JSON.stringify(this.doc);
    this._drag.result = result;
    return result;
  }

  endDrag() {
    if (!this._drag) return unchanged();
    const { before, result } = this._drag,
      next = this.doc;
    this._drag = null;
    this.doc = before;
    return result.valid
      ? this._commit(next, "Move selection")
      : { ...result, changed: false };
  }
}

const option = (value, label, selected) =>
  `<option value="${escapeHTML(value)}"${value === selected ? " selected" : ""}>${escapeHTML(label)}</option>`;
const field = (label, control) =>
  `<label class="ed-field"><span>${escapeHTML(label)}</span>${control}</label>`;
const numberInput = (name, value, attributes = "") =>
  `<input type="number" name="${escapeHTML(name)}" value="${escapeHTML(value)}" step="any" required ${attributes}>`;
const textInput = (name, value, attributes = "") =>
  `<input name="${escapeHTML(name)}" value="${escapeHTML(value)}" maxlength="500" required ${attributes}>`;
const vectorFields = (label, name, values, cube = false) =>
  `<fieldset class="ed-vector"><legend>${escapeHTML(label)}</legend><div class="ed-grid ed-three">${values.map((value, i) => field(["X", "Y", "Z"][i], numberInput(`${name}${i}`, value, cube && i > 0 ? 'readonly aria-description="Cubes have uniform dimensions; edit X to set all axes."' : ""))).join("")}</div></fieldset>`;
const button = (action, label, className = "", attributes = "") =>
  `<button type="button" data-action="${escapeHTML(action)}" class="${className}" ${attributes}>${label}</button>`;

/** Import editor.css in the app entry; keeping CSS out of this module permits Node tests. */
export class Editor extends DocumentHistory {
  constructor({
    container,
    doc,
    onChange = () => {},
    onPlaytest = () => {},
    onExit = () => {},
    onImage = () => {},
    notify = () => {},
  }) {
    super(doc);
    this.container = container;
    this.onChange = onChange;
    this.onPlaytest = onPlaytest;
    this.onExit = onExit;
    this.onImage = onImage;
    this.notify = notify;
    this.selectedId = "player";
    this.selectedRoom = this.doc.spawn.room;
    this.overlays = true;
    this.snap = 0.25;
    this._message = "Authoring copy ready. Your playtest stays separate.";
    this._errors = [];
    this._disposed = false;
    this._fileRequest = 0;
    this._events = [
      "click",
      "submit",
      "change",
      "input",
      "pointerdown",
      "keydown",
      "keyup",
      "focusout",
    ];
    this._listener = (event) => this._handleEvent(event);
    this._release = () => {
      if (this._drag) this.endDrag();
    };
    this._cancel = () => {
      if (!this._drag) return;
      const changed =
        JSON.stringify(this.doc) !== JSON.stringify(this._drag.before);
      this.doc = this._drag.before;
      this._drag = null;
      if (changed) this._emit(false);
      this.render();
    };
    if (container) {
      container.classList.add("level-editor");
      for (const type of this._events)
        container.addEventListener(type, this._listener);
      this._window = container.ownerDocument.defaultView;
      this._window.addEventListener("pointerup", this._release);
      this._window.addEventListener("pointercancel", this._cancel);
      this._window.addEventListener("blur", this._release);
    }
    this.render();
  }

  _emit(editorOnly = false, extra = {}) {
    if (!this._disposed)
      this.onChange(this.doc, {
        overlays: this.overlays,
        selectedId: this.selectedId,
        selectedRoom: this.selectedRoom,
        editorOnly,
        ...extra,
      });
  }

  _report(result, message = result.label, emit = true) {
    this._errors = result.errors;
    this._message = result.valid
      ? message || "No changes to apply."
      : "Edit not applied. Your document is unchanged.";
    if (!result.valid) this.notify(result.errors.join("\n"), "error");
    if (result.valid && result.changed) {
      if (!findEntity(this.doc, this.selectedId)) this.selectedId = "player";
      const selected = findEntity(this.doc, this.selectedId);
      this.selectedRoom =
        selected.key === "rooms" ? selected.entity.id : selected.entity.room;
      if (emit) this._emit(false);
    }
    const status = this.container?.querySelector(".ed-status");
    if (!result.valid && status) {
      status.classList.add("ed-status-error");
      status.innerHTML = this._statusHTML();
    } else this.render();
    return result;
  }

  setDocument(doc) {
    const result = super.replace(doc);
    if (result.valid) {
      this._fileRequest++;
      this.selectedId = "player";
      this.selectedRoom = this.doc.spawn.room;
      if (!result.changed) this._emit(true);
    }
    return this._report(result, "Document loaded. History reset.");
  }

  transaction(mutator, label) {
    return this._report(super.transaction(mutator, label));
  }
  undo() {
    return this._report(super.undo());
  }
  redo() {
    return this._report(super.redo());
  }

  importJSON(text) {
    const result = super.importJSON(text);
    if (result.valid) {
      this._fileRequest++;
      this.selectedId = "player";
      this.selectedRoom = this.doc.spawn.room;
      if (!result.changed) this._emit(true);
    }
    return this._report(result, "JSON imported. History reset.");
  }

  select(id) {
    const found = findEntity(this.doc, id);
    if (!found) return false;
    if (this._drag) this.endDrag();
    this.selectedId = found.key === "spawn" ? "player" : id;
    this.selectedRoom =
      found.key === "rooms" ? found.entity.id : found.entity.room;
    this.render();
    const inspector = this.container?.querySelector(
      '[data-section="inspector"]',
    );
    if (inspector) {
      inspector.open = true;
      inspector.querySelector("summary").scrollIntoView({ block: "nearest" });
    }
    this._emit(true);
    return true;
  }

  beginDrag(id = this.selectedId) {
    const result = super.beginDrag(id);
    if (result.valid) {
      const found = findEntity(this.doc, id);
      this.selectedId = found.key === "spawn" ? "player" : id;
      this.selectedRoom =
        found.key === "rooms" ? found.entity.id : found.entity.room;
    }
    return result;
  }

  _snapped(position, original) {
    return position.map((n, i) =>
      n === original[i] ? n : round(Math.round(n / this.snap) * this.snap),
    );
  }

  updateDrag(position) {
    const values = position?.isVector3 ? position.toArray() : position;
    const found = this._drag && findEntity(this._drag.before, this._drag.id);
    const snapped =
      found && Array.isArray(values)
        ? this._snapped(values, found.entity.center || found.entity.position)
        : values;
    const result = super.updateDrag(snapped);
    // A rejected sample restores the validated starting snapshot, never an invalid preview.
    if (result.changed) this._emit(false, { dragging: true });
    const status = this.container?.querySelector("[data-drag-status]");
    if (status)
      status.textContent = result.valid
        ? "Release to commit one move."
        : result.errors[0];
    return result;
  }

  endDrag() {
    const active = Boolean(this._drag);
    const result = super.endDrag();
    if (active) {
      this._report(
        result,
        result.changed ? "Move selection" : "Selection restored.",
        false,
      );
      if (!result.valid) this.render();
      this._emit(true, { dragging: false });
    }
    return result;
  }

  _roomOptions(selected) {
    return this.doc.rooms
      .map((room) => option(room.id, room.name, selected))
      .join("");
  }

  _statusHTML() {
    return `<span class="ed-meta">${this._errors.length ? "Validation / rejected" : "Document / valid"}</span><p>${escapeHTML(this._message)}</p>${
      this._errors.length
        ? `<ul>${this._errors
            .slice(0, 5)
            .map((error) => `<li>${escapeHTML(error)}</li>`)
            .join(
              "",
            )}</ul>${this._errors.length > 5 ? `<p>And ${this._errors.length - 5} more validation errors.</p>` : ""}`
        : ""
    }`;
  }

  _inspector() {
    const { key, entity } = findEntity(this.doc, this.selectedId);
    const position = entity.center || entity.position;
    const room = this.doc.rooms.find((item) => item.id === this.selectedRoom);
    const rotation = entity.rotation || entity.quaternion || IDENTITY;
    const euler = new Euler().setFromQuaternion(
      new Quaternion().fromArray(rotation),
      "XYZ",
    );
    const degrees = [euler.x, euler.y, euler.z].map((n) => round(n / RAD));
    let properties =
      key === "rooms"
        ? field("Room name", textInput("name", entity.name))
        : field(
            "Room",
            `<select name="room">${this._roomOptions(entity.room)}</select>`,
          );
    properties += vectorFields(
      key === "rooms" ? "Center / meters" : "Position / meters",
      "position",
      position,
    );
    if (["rooms", "blocks", "cubes", "plates", "doors", "goals"].includes(key))
      properties += vectorFields(
        key === "cubes" ? "Dimensions / uniform cube" : "Dimensions / meters",
        "size",
        key === "cubes" ? [entity.size, entity.size, entity.size] : entity.size,
        key === "cubes",
      );
    if (["blocks", "cubes", "portals"].includes(key))
      properties += vectorFields("Rotation / degrees XYZ", "rotation", degrees);
    if (key === "spawn")
      properties += `<div class="ed-grid">${field("Yaw / degrees", numberInput("yaw", entity.yaw / RAD))}${field("Pitch / degrees", numberInput("pitch", entity.pitch / RAD, 'min="-90" max="90"'))}</div>`;
    if (key === "portals") {
      const normal = new Vector3(0, 0, 1)
        .applyQuaternion(new Quaternion().fromArray(entity.quaternion))
        .toArray()
        .map(round);
      properties += `<div class="ed-readout"><span>Inward normal</span><code>${escapeHTML(normal.join(" / "))}</code></div>
        <p class="ed-hint">Keep the normal axis-aligned and the position on its room boundary. Width and height update both ends.</p>
        <div class="ed-grid">${field("Width / meters", numberInput("width", entity.width, 'min="1" max="20"'))}${field("Height / meters", numberInput("height", entity.height, 'min="1" max="20"'))}</div>
        ${field(
          "Linked portal",
          `<select name="linkedTo">${this.doc.portals
            .filter((item) => item.id !== entity.id)
            .map((item) =>
              option(item.id, `${item.id} / ${item.room}`, entity.linkedTo),
            )
            .join("")}</select>`,
        )}
        <p class="ed-hint">Choosing another partner swaps both pairs atomically. Incompatible apertures are rejected.</p>
        <label class="ed-check"><input type="checkbox" name="enabled"${entity.enabled && this.doc.portals.find((portal) => portal.id === entity.linkedTo).enabled ? " checked" : ""}> Enable both ends</label>`;
    }
    if (key === "rooms" || key === "portals")
      properties += field(
        key === "rooms" ? "Room color" : "Aperture color",
        textInput("color", entity.color, 'type="color"'),
      );
    if (key === "plates" || key === "goals") {
      const linkField = key === "plates" ? "doorIds" : "requires";
      properties += `<fieldset class="ed-wiring"><legend>${key === "plates" ? "Doors controlled" : "Required active doors"}</legend>${this.doc.doors.length ? this.doc.doors.map((door) => `<label class="ed-check"><input type="checkbox" name="links" value="${escapeHTML(door.id)}"${entity[linkField].includes(door.id) ? " checked" : ""}><span>${escapeHTML(door.id)}</span></label>`).join("") : '<p class="ed-hint">Add a door to begin wiring.</p>'}</fieldset><p class="ed-hint">${key === "plates" ? "All plates wired to a door must be pressed to open it." : "An empty requirement list makes this goal always available."}</p>`;
    }
    if (key === "doors") {
      const controls = this.doc.plates.filter((plate) =>
        plate.doorIds.includes(entity.id),
      );
      properties += `<div class="ed-readout"><span>Controlled by</span><span>${escapeHTML(controls.map((plate) => plate.id).join(", ") || "No plates wired")}</span></div><p class="ed-hint">Select a plate to wire this door. All connected plates are required.</p>`;
    }
    const bounds = roomBounds(room);
    const normal =
      key === "portals"
        ? new Vector3(0, 0, 1)
            .applyQuaternion(new Quaternion().fromArray(rotation))
            .toArray()
        : null;
    const half =
      key === "rooms" || key === "portals" ? [0, 0, 0] : halfSize(key, entity);
    const sliders = [0, 2]
      .map((axis) => {
        const min =
          key === "rooms"
            ? position[axis] - 20
            : bounds.min.getComponent(axis) + half[axis];
        const max =
          key === "rooms"
            ? position[axis] + 20
            : bounds.max.getComponent(axis) - half[axis];
        return `<label class="ed-range"><span>${axis === 0 ? "X" : "Z"}</span><input type="range" aria-label="Move selection ${axis === 0 ? "X" : "Z"}" data-drag-axis="${axis}" min="${escapeHTML(Math.ceil(min / this.snap) * this.snap)}" max="${escapeHTML(Math.floor(max / this.snap) * this.snap)}" step="${escapeHTML(this.snap)}" value="${escapeHTML(position[axis])}"${normal && Math.abs(normal[axis]) > 0.99 ? " disabled" : ""}><output>${escapeHTML(round(position[axis]))}</output></label>`;
      })
      .join("");
    return `<div class="ed-inspector-heading"><span class="ed-tag">${LABELS[key]}</span><code title="${escapeHTML(this.selectedId)}">${escapeHTML(key === "spawn" ? "Player start" : entity.id)}</code></div>
      <form data-form="inspector">${properties}<button class="ed-primary ed-full" type="submit">Apply changes <span>&crarr;</span></button></form>
      <fieldset class="ed-move"><legend>Move selection</legend>${sliders}<p class="ed-hint" data-drag-status>Drag or use arrow keys. One move, one undo.</p></fieldset>
      ${key !== "spawn" ? button("delete", key === "portals" ? "Delete linked pair" : key === "rooms" ? "Delete room &amp; contents" : "Delete selection", "ed-danger ed-full", key === "rooms" && this.doc.rooms.length === 1 ? 'disabled title="At least one room is required"' : "") : '<p class="ed-hint">One start is always required. Move it to change the entry point.</p>'}`;
  }

  render() {
    if (!this.container || this._disposed) return;
    if (!findEntity(this.doc, this.selectedId)) this.selectedId = "player";
    if (!this.doc.rooms.some((room) => room.id === this.selectedRoom))
      this.selectedRoom = this.doc.spawn.room;
    const open = new Map(
      [...this.container.querySelectorAll("details[data-section]")].map(
        (section) => [section.dataset.section, section.open],
      ),
    );
    const section = (id, title, subtitle, body, initiallyOpen = false) =>
      `<details class="ed-section" data-section="${id}"${(open.get(id) ?? initiallyOpen) ? " open" : ""}><summary><span>${title}</span><small>${subtitle}</small></summary><div class="ed-section-body">${body}</div></details>`;
    const scroll = this.container.querySelector(".ed-scroll")?.scrollTop || 0;
    const active = this.container.ownerDocument.activeElement;
    const focus = this.container.contains(active)
      ? {
          name: active.getAttribute("name"),
          form: active.closest("form")?.dataset.form,
          action: active.dataset.action,
          control: active.dataset.control,
          dragAxis: active.dataset.dragAxis,
          start: active.selectionStart,
          end: active.selectionEnd,
        }
      : null;
    const count = COLLECTIONS.slice(1).reduce(
      (sum, key) => sum + this.doc[key].length,
      0,
    );
    const roomSelect = field(
      "View / placement room",
      `<select data-control="room" aria-label="View and placement room">${this._roomOptions(this.selectedRoom)}</select>`,
    );
    const selection = field(
      "Selected entity",
      `<select data-control="selection" aria-label="Selected entity">${option("player", "Start / player", this.selectedId)}${COLLECTIONS.map((key) => `<optgroup label="${escapeHTML(key)}">${this.doc[key].map((entity) => option(entity.id, `${LABELS[key]} / ${entity.name || entity.id}`, this.selectedId)).join("")}</optgroup>`).join("")}</select>`,
    );
    const scene = `${roomSelect}${selection}<div class="ed-scene-options">${field("Snap / meters", `<input type="number" data-control="snap" aria-label="Snap in meters" value="${escapeHTML(this.snap)}" min="0.01" max="10" step="any">`)}<label class="ed-check"><input type="checkbox" data-control="overlays"${this.overlays ? " checked" : ""}> Overlays</label></div><p class="ed-hint">Drag to orbit &middot; scroll to zoom &middot; select an entity to inspect</p>`;
    const palette = `<p class="ed-hint">Build in <strong>${escapeHTML(this.doc.rooms.find((room) => room.id === this.selectedRoom).name)}</strong>. New objects find a clear floor position.</p><div class="ed-palette">${[
      ["room", "01", "Room"],
      ["block", "02", "Block"],
      ["cube", "03", "Cube"],
      ["plate", "04", "Plate"],
      ["door", "05", "Door"],
      ["goal", "06", "Goal"],
    ]
      .map(([type, index, label]) =>
        button(
          `add-${type}`,
          `<span class="ed-meta">${index}</span><span>${label}</span><span aria-hidden="true">+</span>`,
        ),
      )
      .join(
        "",
      )}</div>${button("place-start", "Place start in this room", "ed-full ed-subtle")}`;
    const endpoint = (suffix, title, room, face) =>
      `<fieldset class="ed-endpoint"><legend>${title}</legend>${field("Room", `<select name="room${suffix}">${this._roomOptions(room)}</select>`)}${field(
        "Boundary face",
        `<select name="face${suffix}">${Object.entries(FACES)
          .map(([id, value]) => option(id, value.label, face))
          .join("")}</select>`,
      )}<div class="ed-grid">${field("Horizontal offset", numberInput(`horizontal${suffix}`, 0))}${field("Vertical offset", numberInput(`vertical${suffix}`, 0))}</div></fieldset>`;
    const portals = `<p class="ed-hint">Two surfaces. One connection. Normals face inward; both ends are created together.</p><form data-form="portals">${endpoint("A", "A / Entry surface", this.selectedRoom, "north")}${endpoint("B", "B / Exit surface", this.doc.rooms.find((room) => room.id !== this.selectedRoom)?.id || this.selectedRoom, "south")}<div class="ed-grid">${field("Width / meters", numberInput("width", 2.4, 'min="1" max="20"'))}${field("Height / meters", numberInput("height", 3.2, 'min="1" max="20"'))}</div><p class="ed-hint">Offsets follow each portal\'s local right/up axes. Walls start flush with the floor; floor and ceiling offsets lie along the surface.</p><button type="submit" class="ed-primary ed-full">Create portal pair <span>&harr;</span></button></form>`;
    const pairs = this.doc.portals.filter(
      (portal) => portal.id < portal.linkedTo,
    );
    const links = `<div class="ed-link-list">${pairs.map((portal) => `<button type="button" data-select="${escapeHTML(portal.id)}"><span class="ed-meta">${portal.enabled && this.doc.portals.find((item) => item.id === portal.linkedTo).enabled ? "Active pair" : "Disabled pair"}</span><span>${escapeHTML(portal.id)} <b>&harr;</b> ${escapeHTML(portal.linkedTo)}</span></button>`).join("")}${this.doc.plates.map((plate) => `<button type="button" data-select="${escapeHTML(plate.id)}"><span class="ed-meta">Plate &rarr; doors</span><span>${escapeHTML(plate.id)} <b>&rarr;</b> ${escapeHTML(plate.doorIds.join(", ") || "Not wired")}</span></button>`).join("")}${this.doc.goals.map((goal) => `<button type="button" data-select="${escapeHTML(goal.id)}"><span class="ed-meta">Goal requirements</span><span>${escapeHTML(goal.id)} <b>&rarr;</b> ${escapeHTML(goal.requires.join(", ") || "Always available")}</span></button>`).join("") || '<p class="ed-hint">Your first connection starts with a portal pair or a plate and door.</p>'}</div>`;
    const documentForm = `<form data-form="document">${field("Level name", textInput("name", this.doc.name))}${field("Description", `<textarea name="description" maxlength="500" required rows="3">${escapeHTML(this.doc.description)}</textarea>`)}${field("Player notes", `<textarea name="lesson" maxlength="500" required rows="4">${escapeHTML(this.doc.lesson)}</textarea>`)}${field("Accent color", textInput("accent", this.doc.accent, 'type="color"'))}<button type="submit" class="ed-full">Update level details</button></form>`;
    const files = `${field("Supplied experiment", `<select data-control="library" aria-label="Supplied experiment">${LEVELS.map((level) => option(level.id, level.name, this.doc.id)).join("")}</select>`)}${button("load-level", "Edit supplied level", "ed-full")}${button("blank", "New blank experiment", "ed-full ed-subtle")}<p class="ed-hint">Loading or importing replaces this copy and resets history. Export or save first.</p><div class="ed-grid">${button("save", "Save locally")}${button("reload", "Reload save")}${button("export", "Export JSON")}${button("import", "Import JSON")}</div>${button("image", "Export scene image <span>&nearr;</span>", "ed-full ed-subtle")}<input type="file" accept=".json,application/json" data-control="file" hidden><p class="ed-hint">One local save slot in this browser. JSON limit: 2 MB.</p>`;
    // All imported values pass through escapeHTML; no imported markup enters the DOM.
    this.container.innerHTML = `<header class="ed-header"><div class="ed-eyebrow"><span class="ed-dot"></span>Authoring workspace <span>V.01</span></div><div class="ed-title-row"><h2>Spatial workshop<span>Make room for impossible.</span></h2>${button("exit", "&times;", "ed-exit", 'aria-label="Exit editor" title="Exit editor"')}</div><div class="ed-toolbar">${button("playtest", "Playtest <span>&rarr;</span>", "ed-primary")}${button("undo", "&larr;", "", `aria-label="Undo" title="${escapeHTML(this.undoStack.at(-1)?.label || "Nothing to undo")}"${this.undoStack.length ? "" : " disabled"}`)}${button("redo", "&rarr;", "", `aria-label="Redo" title="${escapeHTML(this.redoStack.at(-1)?.label || "Nothing to redo")}"${this.redoStack.length ? "" : " disabled"}`)}</div></header>
      <div class="ed-scroll"><div class="ed-counts"><div><strong>${this.doc.rooms.length.toString().padStart(2, "0")}</strong><span>Rooms</span></div><div><strong>${pairs.length.toString().padStart(2, "0")}</strong><span>Pairs</span></div><div><strong>${count.toString().padStart(2, "0")}</strong><span>Objects</span></div></div>
      ${section("scene", "Scene", "01 / Navigate", scene, true)}${section("build", "Blockout &amp; objects", "02 / Build", palette, true)}${section("portals", "Portal pairing", "03 / Connect", portals)}${section("inspector", "Inspector", "04 / Refine", this._inspector(), true)}${section("links", "Connections", `${pairs.length + this.doc.plates.length} links`, links)}${section("document", "Level details", "Metadata", documentForm)}${section("files", "Library &amp; files", "Keep your work", files)}</div>
      <footer class="ed-status${this._errors.length ? " ed-status-error" : ""}" role="status" aria-live="polite">${this._statusHTML()}</footer>`;
    this.container.querySelector(".ed-scroll").scrollTop = scroll;
    if (focus) {
      const target = [
        ...this.container.querySelectorAll("input, select, textarea, button"),
      ].find((element) => {
        if (focus.name)
          return (
            element.getAttribute("name") === focus.name &&
            element.closest("form")?.dataset.form === focus.form
          );
        if (focus.action) return element.dataset.action === focus.action;
        if (focus.control) return element.dataset.control === focus.control;
        return (
          focus.dragAxis !== undefined &&
          element.dataset.dragAxis === focus.dragAxis
        );
      });
      if (target) {
        target.focus({ preventScroll: true });
        if (focus.start !== null && ["text", "textarea"].includes(target.type))
          target.setSelectionRange(focus.start, focus.end);
      }
    }
  }

  _applyInspector(form) {
    const data = new this._window.FormData(form);
    const number = (name) => {
      const value = data.get(name);
      if (
        value === null ||
        String(value).trim() === "" ||
        !Number.isFinite(Number(value))
      )
        throw new Error(`${name} needs a finite number.`);
      return Number(value);
    };
    const vector = (name) => [0, 1, 2].map((i) => number(`${name}${i}`));
    this.transaction((doc) => {
      const { key, entity } = findEntity(doc, this.selectedId);
      const position = this._snapped(
        vector("position"),
        entity.center || entity.position,
      );
      moveEntity(doc, this.selectedId, position);
      if (key === "rooms") {
        entity.name = data.get("name").trim();
        entity.size = vector("size");
        entity.color = data.get("color");
      } else entity.room = data.get("room");
      if (["blocks", "plates", "doors", "goals"].includes(key))
        entity.size = vector("size");
      if (key === "cubes") entity.size = number("size0");
      if (["blocks", "cubes", "portals"].includes(key)) {
        const original = new Euler().setFromQuaternion(
          new Quaternion().fromArray(
            entity.rotation || entity.quaternion || IDENTITY,
          ),
          "XYZ",
        );
        const degrees = vector("rotation");
        if (
          degrees.some(
            (n, i) =>
              n !== round([original.x, original.y, original.z][i] / RAD),
          )
        ) {
          entity[key === "blocks" ? "rotation" : "quaternion"] =
            new Quaternion()
              .setFromEuler(new Euler(...degrees.map((n) => n * RAD), "XYZ"))
              .normalize()
              .toArray();
        }
      }
      if (key === "spawn") {
        entity.yaw = number("yaw") * RAD;
        entity.pitch = number("pitch") * RAD;
      }
      if (key === "portals") {
        const partner = doc.portals.find(
          (portal) => portal.id === data.get("linkedTo"),
        );
        if (!partner || partner === entity)
          throw new Error("Choose a distinct portal partner.");
        if (partner.id !== entity.linkedTo) {
          const oldA = doc.portals.find(
            (portal) => portal.id === entity.linkedTo,
          );
          const oldB = doc.portals.find(
            (portal) => portal.id === partner.linkedTo,
          );
          oldA.linkedTo = oldB.id;
          oldB.linkedTo = oldA.id;
          entity.linkedTo = partner.id;
          partner.linkedTo = entity.id;
        }
        entity.width = partner.width = number("width");
        entity.height = partner.height = number("height");
        entity.enabled = partner.enabled = data.has("enabled");
        entity.color = data.get("color");
      }
      if (key === "plates") entity.doorIds = data.getAll("links");
      if (key === "goals") entity.requires = data.getAll("links");
    }, "Apply inspector changes");
  }

  _create(type) {
    let id;
    const result = this.transaction(
      (doc) => {
        const room = doc.rooms.find((item) => item.id === this.selectedRoom);
        if (type === "room") {
          const farthest = doc.rooms.reduce((a, b) =>
            a.center[0] > b.center[0] ? a : b,
          );
          id = uniqueId(doc, "room");
          const centerX = Math.max(
            farthest.center[0] + 20,
            ...doc.rooms.map((item) => item.center[0] + item.size[0] / 2 + 14),
          );
          doc.rooms.push({
            id,
            name: `Room ${doc.rooms.length + 1}`,
            center: [
              centerX,
              room.center[1] - room.size[1] / 2 + 2.5,
              room.center[2],
            ],
            size: [12, 5, 14],
            color: "#183b43",
          });
          return;
        }
        if (type === "spawn") {
          id = "player";
          placeInRoom(doc, "spawn", doc.spawn, room, true);
          return;
        }
        const key = `${type}s`;
        id = uniqueId(doc, type);
        const entity = { id, room: room.id, position: [0, 0, 0] };
        if (type === "cube") {
          entity.size = 0.7;
          entity.quaternion = [...IDENTITY];
        } else
          entity.size = {
            block: [1, 1, 1],
            plate: [1.3, 0.14, 1.3],
            door: [2, 3, 0.3],
            goal: [1.6, 1.8, 1.6],
          }[type];
        if (type === "plate") entity.doorIds = [];
        if (type === "goal") entity.requires = [];
        doc[key].push(entity);
        placeInRoom(doc, key, entity, room, type === "door");
      },
      type === "spawn" ? "Place start" : `Add ${type}`,
    );
    if (result.valid && id) this.select(id);
    return result;
  }

  _createPortals(form) {
    const data = new this._window.FormData(form);
    let selected;
    const result = this.transaction((doc) => {
      const width = Number(data.get("width")),
        height = Number(data.get("height"));
      const pair = ["A", "B"].map((suffix, index) => {
        const room = doc.rooms.find(
          (item) => item.id === data.get(`room${suffix}`),
        );
        const quaternion = [...FACES[data.get(`face${suffix}`)].quaternion];
        const q = new Quaternion().fromArray(quaternion),
          normal = new Vector3(0, 0, 1).applyQuaternion(q);
        const axis = [0, 1, 2].find(
          (i) => Math.abs(normal.getComponent(i)) > 0.99,
        );
        const bounds = roomBounds(room),
          position = new Vector3(...room.center);
        if (axis !== 1) position.y = bounds.min.y + height / 2;
        position.setComponent(
          axis,
          (normal.getComponent(axis) > 0
            ? bounds.min
            : bounds.max
          ).getComponent(axis),
        );
        position.add(
          new Vector3(1, 0, 0)
            .applyQuaternion(q)
            .multiplyScalar(Number(data.get(`horizontal${suffix}`))),
        );
        position.add(
          new Vector3(0, 1, 0)
            .applyQuaternion(q)
            .multiplyScalar(Number(data.get(`vertical${suffix}`))),
        );
        const portal = {
          id: uniqueId(doc, "portal"),
          room: room.id,
          position: position.toArray(),
          quaternion,
          width,
          height,
          linkedTo: "",
          enabled: true,
          color: index ? "#ffbd72" : "#a8edcf",
        };
        doc.portals.push(portal);
        return portal;
      });
      pair[0].linkedTo = pair[1].id;
      pair[1].linkedTo = pair[0].id;
      selected = pair[0].id;
    }, "Create portal pair");
    if (result.valid) this.select(selected);
    return result;
  }

  async _importFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      this._report(failure("JSON import is limited to 2 MB."));
      return;
    }
    const request = ++this._fileRequest,
      current = this.doc;
    try {
      const text = await file.text();
      if (this._disposed || request !== this._fileRequest) return;
      if (this.doc !== current) {
        this._report(
          failure(
            "The document changed while reading the file. Import again to replace it.",
          ),
        );
        return;
      }
      this.importJSON(text);
    } catch (error) {
      if (!this._disposed)
        this._report(failure(`Could not read file: ${error.message}`));
    }
  }

  _action(action) {
    if (action.startsWith("add-")) return this._create(action.slice(4));
    if (action === "place-start") return this._create("spawn");
    if (action === "undo") return this.undo();
    if (action === "redo") return this.redo();
    if (action === "delete") {
      const key = findEntity(this.doc, this.selectedId).key;
      if (
        key === "rooms" &&
        !this._window.confirm(
          "Delete this room and its contents, including linked portal partners? A start in this room will be moved to a clear surviving room.",
        )
      )
        return;
      return this.deleteEntity(this.selectedId);
    }
    if (action === "playtest") {
      if (this._drag) this.endDrag();
      return this.onPlaytest(this.doc);
    }
    if (action === "exit") return this.onExit();
    if (action === "image") return this.onImage(this.doc);
    if (action === "import")
      return this.container.querySelector('[data-control="file"]').click();
    if (action === "blank" || action === "load-level") {
      if (
        !this._window.confirm(
          "Replace this authoring copy and reset history? Export or save first to keep your work.",
        )
      )
        return;
      const id = this.container.querySelector('[data-control="library"]').value;
      return this.setDocument(
        action === "blank"
          ? createBlankLevel()
          : LEVELS.find((level) => level.id === id),
      );
    }
    try {
      if (action === "save") {
        const text = this.exportJSON();
        if (exceedsImportLimit(text))
          throw new Error(
            "Local saves are limited to 2 MB so they can be reloaded.",
          );
        this._window.localStorage.setItem(STORAGE_KEY, text);
        this._report(unchanged(), "Saved locally in this browser.");
      } else if (action === "reload") {
        const text = this._window.localStorage.getItem(STORAGE_KEY);
        if (text === null)
          throw new Error("No local save yet. Save locally first.");
        if (
          this._window.confirm(
            "Replace this authoring copy with your local save and reset history?",
          )
        )
          this.importJSON(text);
      } else if (action === "export") {
        const url = this._window.URL.createObjectURL(
          new this._window.Blob([this.exportJSON()], {
            type: "application/json",
          }),
        );
        const anchor = this.container.ownerDocument.createElement("a");
        anchor.href = url;
        anchor.download = `${this.doc.id.replace(/[^a-z0-9_-]/gi, "-").slice(0, 100) || "level"}.json`;
        anchor.hidden = true;
        this.container.append(anchor);
        anchor.click();
        anchor.remove();
        this._window.setTimeout(
          () => this._window.URL.revokeObjectURL(url),
          1000,
        );
        this._report(unchanged(), "JSON download prepared.");
      }
    } catch (error) {
      this._report(failure(`File operation failed: ${error.message}`));
    }
  }

  _handleEvent(event) {
    if (this._disposed) return;
    const target = event.target;
    if (event.type === "click") {
      const action = target.closest("[data-action]"),
        selection = target.closest("[data-select]");
      if (action && !action.disabled) this._action(action.dataset.action);
      else if (selection) this.select(selection.dataset.select);
    } else if (event.type === "submit") {
      event.preventDefault();
      if (!target.reportValidity()) return;
      if (target.dataset.form === "inspector") this._applyInspector(target);
      else if (target.dataset.form === "portals") this._createPortals(target);
      else if (target.dataset.form === "document") {
        const data = new this._window.FormData(target);
        this.transaction((doc) => {
          for (const key of ["name", "description", "lesson", "accent"])
            doc[key] = data.get(key).trim();
        }, "Update level details");
      }
    } else if (event.type === "change") {
      if (target.dataset.control === "selection") this.select(target.value);
      else if (target.dataset.control === "room") this.select(target.value);
      else if (target.dataset.control === "overlays") {
        this.overlays = target.checked;
        this._emit(true);
      } else if (target.dataset.control === "snap") {
        const value = Number(target.value);
        if (!Number.isFinite(value) || value < 0.01 || value > 10) {
          target.value = this.snap;
          this._report(failure("Snap must be between 0.01 and 10 meters."));
        } else {
          this.snap = value;
          this.render();
        }
      } else if (target.dataset.control === "file") {
        const file = target.files[0];
        target.value = "";
        this._importFile(file);
      }
    } else if (
      event.type === "pointerdown" &&
      target.matches("[data-drag-axis]")
    )
      this.beginDrag();
    else if (event.type === "input" && target.matches("[data-drag-axis]")) {
      if (!this._drag) this.beginDrag();
      const found = findEntity(this.doc, this.selectedId),
        position = [...(found.entity.center || found.entity.position)];
      position[Number(target.dataset.dragAxis)] = Number(target.value);
      this.updateDrag(position);
      target.parentElement.querySelector("output").textContent = target.value;
    } else if (event.type === "keydown") {
      if (event.key === "Escape" && this._drag) {
        event.preventDefault();
        this._cancel();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        !target.matches('textarea, input:not([type="range"]), select')
      ) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          event.shiftKey ? this.redo() : this.undo();
        } else if (event.key.toLowerCase() === "y") {
          event.preventDefault();
          this.redo();
        }
      }
    } else if (
      ((event.type === "keyup" &&
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ].includes(event.key)) ||
        event.type === "focusout") &&
      target.matches("[data-drag-axis]") &&
      this._drag
    )
      this.endDrag();
  }

  dispose() {
    this._cancel();
    this._disposed = true;
    this._fileRequest++;
    if (!this.container) return;
    for (const type of this._events)
      this.container.removeEventListener(type, this._listener);
    this._window.removeEventListener("pointerup", this._release);
    this._window.removeEventListener("pointercancel", this._cancel);
    this._window.removeEventListener("blur", this._release);
    this.container.replaceChildren();
    this.container.classList.remove("level-editor");
  }
}
