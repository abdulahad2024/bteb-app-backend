import unittest

from parse import RESULT_RE, normalize_result_date, parse_result


def parse_row(text, semester_index):
    match = RESULT_RE.fullmatch(text)
    if match is None:
        raise AssertionError("Result row did not match")
    return parse_result(match, semester_index)


class ParseResultTests(unittest.TestCase):
    def test_selects_gpa_for_requested_semester(self):
        self.assertEqual(
            parse_row("123456 (gpa6: 3.61, gpa5: 3.76, gpa1: 3.36)", 6),
            {"status": "passed", "gpa": 3.61},
        )

    def test_gpa_ref_is_failed_even_inside_braces(self):
        self.assertEqual(
            parse_row("123456 { gpa6: ref, ref_sub: 66711(T), 66712(P) }", 6),
            {"status": "failed", "subjects": ["66711(T)", "66712(P)"]},
        )

    def test_numeric_gpa_in_braces_passes_selected_semester(self):
        self.assertEqual(
            parse_row("123456 { gpa6: 3.25, gpa5: ref, ref_sub: 66711(T) }", 6),
            {"status": "passed", "gpa": 3.25},
        )

    def test_legacy_rows_remain_supported(self):
        self.assertEqual(parse_row("123456 (4.50)", 1), {"status": "passed", "gpa": 4.5})
        self.assertEqual(
            parse_row("123456 { 66711(T), 66712(P) }", 1),
            {"status": "failed", "subjects": ["66711(T)", "66712(P)"]},
        )

    def test_expelled_rows_are_classified_as_failed(self):
        self.assertEqual(
            parse_row("123456 (Expelled_sub - 66711; reffered_sub - 66712(T))", 6),
            {"status": "failed", "subjects": ["66712(T)", "Expelled: 66711"]},
        )

    def test_withheld_rows_have_a_separate_status(self):
        self.assertEqual(
            parse_row("123456 (Withheld_sub - 28553(PF))", 4),
            {"status": "withheld", "note": "Withheld"},
        )

    def test_canceled_subject_and_failed_subjects_are_both_preserved(self):
        self.assertEqual(
            parse_row(
                "123456 (Canceled_sub - 25831, 25922; Failed_sub - 25722(T), 25911(P))",
                3,
            ),
            {
                "status": "failed",
                "subjects": ["25722(T)", "25911(P)", "Canceled: 25831", "Canceled: 25922"],
            },
        )

    def test_rows_with_only_canceled_subjects_are_not_marked_failed(self):
        self.assertEqual(
            parse_row("123456 (Canceled_sub - 25831, 25922)", 3),
            {"status": "cancelled", "subjects": ["Canceled: 25831", "Canceled: 25922"]},
        )

    def test_missing_requested_semester_is_not_guessed(self):
        match = RESULT_RE.fullmatch("123456 (gpa5: 3.61, gpa4: 3.76)")
        self.assertIsNotNone(match)
        self.assertIsNone(parse_result(match, 6))

    def test_result_date_is_normalized_and_invalid_dates_are_ignored(self):
        self.assertEqual(normalize_result_date("Date : 05-11-2025"), "2025-11-05")
        self.assertEqual(normalize_result_date("Date : 05/11/2025"), "2025-11-05")
        self.assertIsNone(normalize_result_date("Date : 31-02-2025"))


if __name__ == "__main__":
    unittest.main()
