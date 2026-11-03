const test = require("node:test");
const assert = require("node:assert/strict");
const { createResultUpdate } = require("./result-update");

const common = {
  roll: "123456",
  exam: "ডিপ্লোমা - ৪র্থ সেমিস্টার - 2022-23",
  curriculum: "ডিপ্লোমা ইন ইঞ্জিনিয়ারিং",
  semester: "৪র্থ সেমিস্টার",
  academicSession: "2022-23",
  importedAt: new Date("2026-11-03T00:00:00.000Z"),
  result: {
    institutionCode: "12345",
    institutionName: "Example Polytechnic Institute",
    resultDate: "2025-10-26",
  },
};

for (const [status, fields, removedFields] of [
  ["passed", { gpa: 3.75 }, ["subjects", "note"]],
  ["failed", { subjects: ["28553(T)"] }, ["gpa", "note"]],
  ["withheld", { note: "Withheld" }, ["gpa", "subjects"]],
  ["cancelled", { subjects: ["Canceled: 28553"] }, ["gpa", "note"]],
]) {
  test(`${status} update sets only non-conflicting fields`, () => {
    const operation = createResultUpdate({
      ...common,
      result: { ...common.result, status, ...fields },
    });
    const { $set, $unset } = operation.updateOne.update;

    assert.deepEqual(Object.keys($set).filter((key) => key in $unset), []);
    for (const [key, value] of Object.entries(fields)) {
      assert.deepEqual($set[key], value);
    }
    for (const key of removedFields) {
      assert.equal($unset[key], "");
    }
  });
}
