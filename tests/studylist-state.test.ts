import assert from "node:assert/strict";
import {
  getNextStudylistSyncStatus,
  shouldPushStudylistAssignment,
  shouldSkipEmptySyncedStudylistAssignment,
} from "../src/studylist-sync-status";

assert.equal(getNextStudylistSyncStatus("synced", "local-change"), "dirty");
assert.equal(getNextStudylistSyncStatus("dirty", "push-success"), "synced");
assert.equal(getNextStudylistSyncStatus("dirty", "remote-pull"), "synced");
assert.equal(getNextStudylistSyncStatus("dirty", "push-failure"), "dirty");
assert.equal(getNextStudylistSyncStatus("dirty", "no-change"), "dirty");

assert.equal(shouldPushStudylistAssignment("dirty"), true);
assert.equal(shouldPushStudylistAssignment("dirty", "Unknown Eudic studylist name"), false);
assert.equal(shouldPushStudylistAssignment("synced"), false);

assert.equal(shouldSkipEmptySyncedStudylistAssignment([], [], "synced"), true);
assert.equal(shouldSkipEmptySyncedStudylistAssignment([], [], "dirty"), false);
assert.equal(shouldSkipEmptySyncedStudylistAssignment(["0"], [], "synced"), false);
