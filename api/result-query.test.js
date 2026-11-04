"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getVisibleSessions, sortResults } = require("./result-query");

const semesters = ["১ম সেমিস্টার", "২য় সেমিস্টার", "৩য় সেমিস্টার", "৪র্থ সেমিস্টার"];
const curriculum = "ডিপ্লোমা ইন ইঞ্জিনিয়ারিং";

test("includes sessions from 2022-23 through the latest configured session", () => {
  const sessions = [
    "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27",
  ];

  assert.deepEqual(
    getVisibleSessions(sessions, "2022-23"),
    ["2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]
  );
});

test("sorts the latest semester first, then the latest session", () => {
  const results = [
    { semester: "১ম সেমিস্টার", academicSession: "2025-26", exam: "first" },
    { semester: "৪র্থ সেমিস্টার", academicSession: "2022-23", exam: "fourth-old" },
    { semester: "৪র্থ সেমিস্টার", academicSession: "2024-25", exam: "fourth-new" },
    { semester: "২য় সেমিস্টার", academicSession: "2026-27", exam: "second" },
  ];

  assert.deepEqual(
    sortResults(results, curriculum, semesters).map((result) => result.exam),
    ["fourth-new", "fourth-old", "second", "first"]
  );
});

test("sorts older records from legacy exam fields", () => {
  const results = [
    { academicSession: "2022-23", exam: `${curriculum} - ১ম সেমিস্টার - 2022-23` },
    { academicSession: "2022-23", exam: `${curriculum} - ৩য় সেমিস্টার - 2022-23` },
  ];

  assert.deepEqual(
    sortResults(results, curriculum, semesters).map((result) => result.exam),
    [`${curriculum} - ৩য় সেমিস্টার - 2022-23`, `${curriculum} - ১ম সেমিস্টার - 2022-23`]
  );
});
