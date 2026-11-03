function createResultUpdate({
  roll,
  exam,
  curriculum,
  semester,
  result,
  academicSession,
  importedAt,
}) {
  const setFields = {
    roll,
    exam,
    curriculum,
    semester,
    status: result.status,
    academicSession,
    institutionCode: result.institutionCode,
    institutionName: result.institutionName,
    resultDate: result.resultDate,
    importedAt,
  };
  const unsetFields = { examYear: "", regulation: "" };

  if (result.status === "passed") {
    setFields.gpa = result.gpa;
    unsetFields.subjects = "";
    unsetFields.note = "";
  } else if (result.status === "failed") {
    setFields.subjects = result.subjects;
    unsetFields.gpa = "";
    unsetFields.note = "";
  } else if (result.status === "cancelled") {
    setFields.subjects = result.subjects;
    unsetFields.gpa = "";
    unsetFields.note = "";
  } else {
    setFields.note = result.note;
    unsetFields.gpa = "";
    unsetFields.subjects = "";
  }

  return {
    updateOne: {
      filter: { roll, exam },
      update: {
        $set: setFields,
        $unset: unsetFields,
      },
      upsert: true,
    },
  };
}

module.exports = { createResultUpdate };
