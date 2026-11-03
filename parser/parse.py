"""
PDF থেকে রেজাল্ট বের করে result.json বানায়।

চালানোর নিয়ম (parser ফোল্ডারে থেকে):
    python parse.py ../result.pdf                      -> result.json বানাবে
    python parse.py ../result.pdf --debug              -> প্রথম পেজের লেখা দেখাবে
    python parse.py ../result.pdf --output custom.json -> নির্দিষ্ট JSON ফাইল বানাবে
"""
import json
import re
import argparse
from datetime import date

import pymupdf

RESULT_RE = re.compile(
    r"(?P<roll>\b\d{6})\s*(?:"
    r"\(\s*(?P<paren>(?:[^()]|\([^()]*\))*)\)"
    r"|\{\s*(?P<brace>[^}]*)\})",
    re.DOTALL,
)
GPA_FIELD_RE = re.compile(r"\bgpa([1-8])\s*:\s*(ref|\d\.\d{1,2})", re.IGNORECASE)
SIMPLE_GPA_RE = re.compile(r"^\s*(\d\.\d{1,2})\s*$")
SUBJECT_RE = re.compile(r"\b\d{5,6}\s*\([^)]+\)")
SUBJECT_CODE_RE = re.compile(r"\b\d{5,6}\b")
INSTITUTE_HEADER_RE = re.compile(r"^\s*(\d{3,8})\s*[-–]\s*(.{2,120}?)\s*$")
RESULT_DATE_RE = re.compile(
    r"\bDate\s*:\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})",
    re.IGNORECASE,
)


def normalize_result_date(text):
    match = RESULT_DATE_RE.search(text)
    if not match:
        return None
    day, month, year = (int(part) for part in match.groups())
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def failed_result(body):
    subjects_text = body
    referenced_subjects = re.search(
        r"\b(?:ref_sub|reffered_sub|referred_sub)\s*[-:]\s*(.*)",
        body,
        re.IGNORECASE | re.DOTALL,
    )
    if referenced_subjects:
        subjects_text = referenced_subjects.group(1)
    subjects = [subject.strip() for subject in SUBJECT_RE.findall(subjects_text)]
    expelled_subject = re.search(r"\bexpelled_sub\s*[-:]\s*(\d{5,6})?", body, re.IGNORECASE)
    if expelled_subject:
        code = expelled_subject.group(1)
        subjects.append(f"Expelled: {code}" if code else "Expelled")
    return {"status": "failed", "subjects": subjects}


def parse_canceled_subject_result(body):
    canceled_match = re.search(
        r"\bcancell?ed_sub\s*[-:]\s*(.*?)(?=;\s*failed_sub\b|$)",
        body,
        re.IGNORECASE | re.DOTALL,
    )
    canceled_subjects = (
        [f"Canceled: {code}" for code in SUBJECT_CODE_RE.findall(canceled_match.group(1))]
        if canceled_match
        else []
    )
    failed_match = re.search(r"\bfailed_sub\s*[-:]\s*(.*)", body, re.IGNORECASE | re.DOTALL)
    failed_subjects = (
        [subject.strip() for subject in SUBJECT_RE.findall(failed_match.group(1))]
        if failed_match
        else []
    )

    if failed_subjects:
        return {
            "status": "failed",
            "subjects": failed_subjects + canceled_subjects,
        }
    if canceled_subjects:
        return {"status": "cancelled", "subjects": canceled_subjects}
    return None


def parse_result(match, semester_index):
    body = match.group("paren") if match.group("paren") is not None else match.group("brace")
    canceled_subject_result = parse_canceled_subject_result(body)
    if canceled_subject_result:
        return canceled_subject_result
    if re.search(r"\bwithheld_sub\b", body, re.IGNORECASE):
        return {"status": "withheld", "note": "Withheld"}
    if re.search(r"\bexpelled_sub\b", body, re.IGNORECASE):
        return failed_result(body)

    gpa_fields = {
        int(index): value.lower()
        for index, value in GPA_FIELD_RE.findall(body)
    }

    if gpa_fields:
        selected_index = semester_index or max(gpa_fields)
        if selected_index not in gpa_fields:
            return None

        gpa = gpa_fields[selected_index]
        if gpa != "ref":
            return {"status": "passed", "gpa": float(gpa)}
        return failed_result(body)

    simple_gpa = SIMPLE_GPA_RE.fullmatch(body)
    if simple_gpa:
        return {"status": "passed", "gpa": float(simple_gpa.group(1))}

    if match.group("brace") is not None:
        return failed_result(body)

    if re.search(r"\b(?:reffered_sub|referred_sub)\b", body, re.IGNORECASE):
        return failed_result(body)

    return None


def main():
    parser = argparse.ArgumentParser(description="PDF থেকে রেজাল্ট JSON তৈরি করে।")
    parser.add_argument("pdf_path", help="ইনপুট PDF ফাইল")
    parser.add_argument("--debug", action="store_true", help="প্রথম পেজের লেখা দেখান")
    parser.add_argument("--output", default="result.json", help="JSON আউটপুট ফাইল")
    parser.add_argument(
        "--semester-index",
        type=int,
        choices=range(1, 9),
        help="যে semester-এর GPA নিতে হবে (১–৮); না দিলে PDF-এর latest GPA নেওয়া হবে",
    )
    parser.add_argument(
        "--academic-session",
        required=True,
        help="Academic session, যেমন 2022-23",
    )
    args = parser.parse_args()
    session_match = re.fullmatch(r"(20\d{2})-(\d{2})", args.academic_session)
    if not session_match or int(session_match.group(2)) != (int(session_match.group(1)) + 1) % 100:
        parser.error("--academic-session অবশ্যই 2022-23-এর মতো সঠিক session হতে হবে")

    results = {}
    unclassified = 0
    current_institute_code = None
    current_institute_name = None
    current_result_date = None
    with pymupdf.open(args.pdf_path) as pdf:
        if args.debug:
            if pdf.page_count:
                print(pdf[0].get_text("text")[:3000])
            return

        total = pdf.page_count
        for n, page in enumerate(pdf, 1):
            text = page.get_text("text")
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            for line in lines[:6]:
                institute = INSTITUTE_HEADER_RE.fullmatch(line)
                if institute:
                    current_institute_code = institute.group(1)
                    current_institute_name = institute.group(2).strip()
                    break
            page_result_date = normalize_result_date(text)
            if page_result_date:
                current_result_date = page_result_date

            for match in RESULT_RE.finditer(text):
                result = parse_result(match, args.semester_index)
                if result is None:
                    unclassified += 1
                    continue
                result.update({
                    "academicSession": args.academic_session,
                    "institutionCode": current_institute_code,
                    "institutionName": current_institute_name,
                    "resultDate": current_result_date,
                })
                results[match.group("roll")] = result

            if n == 1 or n % 20 == 0 or n == total:
                print(f"PROGRESS {n} {total} {len(results)}", flush=True)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, separators=(",", ":"))

    passed = sum(1 for r in results.values() if r["status"] == "passed")
    failed = sum(1 for r in results.values() if r["status"] == "failed")
    withheld = sum(1 for r in results.values() if r["status"] == "withheld")
    cancelled = sum(1 for r in results.values() if r["status"] == "cancelled")
    metadata_missing = sum(
        not result["institutionCode"] or
        not result["institutionName"] or
        not result["resultDate"]
        for result in results.values()
    )
    print(
        f"SUMMARY total={len(results)} passed={passed} failed={failed} "
        f"withheld={withheld} cancelled={cancelled} unclassified={unclassified} "
        f"semester={args.semester_index or 'latest'} "
        f"session={args.academic_session} metadataMissing={metadata_missing}",
        flush=True,
    )
    print(
        f"\nমোট {len(results)}টি রেজাল্ট "
        f"(পাস {passed}, ফেল {failed}, স্থগিত {withheld}, বাতিল {cancelled})"
    )
    print(f"{args.output} তৈরি হয়েছে। ফাইলটা খুলে ভালো করে দেখে নিন।")


if __name__ == "__main__":
    main()
