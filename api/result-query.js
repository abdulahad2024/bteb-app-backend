"use strict";

function getVisibleSessions(sessions, firstSession) {
  const firstYear = Number(firstSession.slice(0, 4));
  return sessions.filter((session) => Number(session.slice(0, 4)) >= firstYear);
}

function getSemesterIndex(result, curriculum, semesters) {
  if (result.semester) {
    const semesterIndex = semesters.indexOf(result.semester);
    if (semesterIndex !== -1) return semesterIndex;
  }
  const legacyExam = String(result.exam || "");
  const semester = semesters.find((item) =>
    legacyExam.startsWith(`${curriculum} - ${item} -`)
  );
  return semester ? semesters.indexOf(semester) : -1;
}

function sortResults(results, curriculum, semesters) {
  return results.sort((left, right) =>
    getSemesterIndex(right, curriculum, semesters) -
      getSemesterIndex(left, curriculum, semesters) ||
    String(right.academicSession || "").localeCompare(String(left.academicSession || "")) ||
    String(left.exam || "").localeCompare(String(right.exam || ""))
  );
}

module.exports = { getVisibleSessions, sortResults };
