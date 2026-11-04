require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { MongoClient } = require("mongodb");
const multer = require("multer");
const { createResultUpdate } = require("./result-update");
const { getVisibleSessions, sortResults } = require("./result-query");

const MAX_PDF_SIZE = 20 * 1024 * 1024;
const PDF_PARSE_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const cookieName = "bteb_admin_session";
let uploadInProgress = false;
let uploadStatus = {
  phase: "idle",
  page: 0,
  totalPages: 0,
  records: 0,
  startedAt: null,
};
const curricula = new Set([
  "ডিপ্লোমা ইন ইঞ্জিনিয়ারিং",
  "ডিপ্লোমা ইন এগ্রিকালচার/ফিসারিজ/লাইভস্টক/ফরেস্ট্রি",
  "ডিপ্লোমা ইন টেক্সটাইল ইঞ্জিনিয়ারিং",
]);
const semesters = new Set([
  "১ম সেমিস্টার", "২য় সেমিস্টার", "৩য় সেমিস্টার", "৪র্থ সেমিস্টার",
  "৫ম সেমিস্টার", "৬ষ্ঠ সেমিস্টার", "৭ম সেমিস্টার", "৮ম সেমিস্টার",
]);
const semesterIndices = new Map([...semesters].map((semester, index) => [semester, index + 1]));
const academicSessions = new Set([
  "2017-18", "2018-19", "2019-20", "2020-21", "2021-22",
  "2022-23", "2023-24", "2024-25", "2025-26", "2026-27",
]);
const firstVisibleResultSession = "2022-23";
const visibleResultSessions = getVisibleSessions([...academicSessions], firstVisibleResultSession);

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI পাওয়া যায়নি। .env ফাইলে দিন।");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  const passwordClasses = [
    /[a-z]/.test(adminPassword),
    /[A-Z]/.test(adminPassword),
    /\d/.test(adminPassword),
    /[^A-Za-z0-9]/.test(adminPassword),
  ].filter(Boolean).length;
  const invalidConfig =
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.ADMIN_EMAIL || "") ||
    adminPassword.length < 24 ||
    passwordClasses < 3 ||
    adminPassword.startsWith("CHANGE_") ||
    process.env.MONGO_URI.includes("YOUR_CLUSTER") ||
    process.env.MONGO_URI.includes("DB_USER");
  if (invalidConfig) {
    console.error("Production-এর জন্য বৈধ ADMIN_EMAIL, কমপক্ষে ২৪ অক্ষরের শক্তিশালী ADMIN_PASSWORD এবং আসল MONGO_URI সেট করুন।");
    process.exit(1);
  }
}

const app = express();
app.set("trust proxy", 1); // Render/Railway-তে সঠিক IP পেতে
app.use(cors());
app.use(rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "অনেক অনুরোধ করা হয়েছে। একটু পরে আবার চেষ্টা করুন।" },
}));
app.use(express.json({ limit: "1mb" }));
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "অনেকবার চেষ্টা করা হয়েছে। ১৫ মিনিট পরে আবার চেষ্টা করুন।" },
});
const resultsApiLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "এক মিনিটে API ব্যবহারের সীমা অতিক্রম হয়েছে। পরে আবার চেষ্টা করুন।",
    },
  },
});

const client = new MongoClient(process.env.MONGO_URI);
const col = client.db("bteb").collection("results");
const parserPath = path.join(__dirname, "..", "parser", "parse.py");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_SIZE, files: 1, fields: 3, parts: 4, fieldSize: 1024 },
  fileFilter: (req, file, callback) => {
    if (!/\.pdf$/i.test(file.originalname)) {
      return callback(new Error("শুধু PDF ফাইল আপলোড করা যাবে।"));
    }
    callback(null, true);
  },
});

app.get("/health", (req, res) => res.json({ ok: true }));

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isIsoDate(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day);
}

function getSessionToken(req) {
  const cookies = (req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === cookieName) return value.join("=");
  }
  return "";
}

function requireAdmin(req, res, next) {
  const token = getSessionToken(req);
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: "এই কাজের জন্য আগে লগইন করুন।" });
  }
  next();
}

function allowSingleUpload(req, res, next) {
  if (uploadInProgress) {
    return res.status(409).json({ error: "আরেকটি PDF এখন প্রক্রিয়া হচ্ছে। সেটি শেষ হলে আবার চেষ্টা করুন।" });
  }
  uploadInProgress = true;
  uploadStatus = {
    phase: "receiving",
    page: 0,
    totalPages: 0,
    records: 0,
    startedAt: Date.now(),
  };
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    uploadInProgress = false;
  };
  res.once("finish", release);
  res.once("close", release);
  next();
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
  );
}

app.post("/auth/login", loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    return res.status(503).json({ error: "সার্ভারে ADMIN_EMAIL ও ADMIN_PASSWORD সেট করা নেই।" });
  }
  if (typeof email !== "string" || typeof password !== "string" ||
      !safeEqual(email.trim().toLowerCase(), adminEmail.trim().toLowerCase()) ||
      !safeEqual(password, adminPassword)) {
    return res.status(401).json({ error: "ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।" });
  }

  const now = Date.now();
  for (const [session, expiresAt] of sessions) {
    if (expiresAt <= now) sessions.delete(session);
  }
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, now + SESSION_TTL_MS);
  setSessionCookie(res, token);
  res.json({ email: adminEmail });
});

app.get("/auth/session", requireAdmin, (req, res) => {
  res.json({ email: process.env.ADMIN_EMAIL });
});

app.get("/upload/status", requireAdmin, (req, res) => {
  res.json(uploadStatus);
});

app.post("/auth/logout", (req, res) => {
  const token = getSessionToken(req);
  if (token) sessions.delete(token);
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
  res.json({ ok: true });
});

// PDF parse করে JSON রেজাল্ট MongoDB-তে সংরক্ষণ করে।
app.post("/upload", requireAdmin, allowSingleUpload, (req, res, next) => {
  upload.single("pdf")(req, res, (error) => {
    if (error) return next(error);
    next();
  });
}, async (req, res) => {
  const { curriculum, semester, academicSession } = req.body;
  if (!curricula.has(curriculum) || !semesters.has(semester)) {
    uploadStatus = { ...uploadStatus, phase: "failed" };
    return res.status(400).json({ error: "কারিকুলাম ও সেমিস্টার তালিকা থেকে সঠিকভাবে নির্বাচন করুন।" });
  }
  if (!academicSessions.has(academicSession)) {
    uploadStatus = { ...uploadStatus, phase: "failed" };
    return res.status(400).json({ error: "তালিকা থেকে সঠিক academic session নির্বাচন করুন।" });
  }
  const exam = `${curriculum} - ${semester} - ${academicSession}`;
  if (!req.file) {
    uploadStatus = { ...uploadStatus, phase: "failed" };
    return res.status(400).json({ error: "একটি PDF ফাইল নির্বাচন করুন।" });
  }
  if (!req.file.buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    uploadStatus = { ...uploadStatus, phase: "failed" };
    return res.status(400).json({ error: "আপলোড করা ফাইলটি বৈধ PDF নয়।" });
  }

  let tempDir;
  try {
    uploadStatus = { ...uploadStatus, phase: "preparing" };
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bteb-upload-"));
    const pdfPath = path.join(tempDir, "upload.pdf");
    const jsonPath = path.join(tempDir, "results.json");
    await fs.promises.writeFile(pdfPath, req.file.buffer);

    uploadStatus = { ...uploadStatus, phase: "parsing" };
    const { summary } = await runParser(
      pdfPath,
      jsonPath,
      semesterIndices.get(semester),
      academicSession
    );
    if (summary.semester !== String(semesterIndices.get(semester))) {
      throw new Error("PDF parser used an unexpected semester");
    }
    if (summary.session !== academicSession) {
      throw new Error("PDF parser used an unexpected academic session");
    }
    if (summary.unclassified > 0) {
      uploadStatus = { ...uploadStatus, phase: "failed" };
      return res.status(422).json({
        error: `PDF-এর ${summary.unclassified}টি result row নির্বাচিত semester অনুযায়ী বোঝা যায়নি। কোনো data database-এ save করা হয়নি। সঠিক semester বেছে নিন অথবা PDF format পরীক্ষা করুন।`,
      });
    }
    if (summary.metadataMissing > 0) {
      uploadStatus = { ...uploadStatus, phase: "failed" };
      return res.status(422).json({
        error: `PDF-এর ${summary.metadataMissing}টি result row-তে institute code/name বা result date পাওয়া যায়নি। PDF-এ এই তথ্য আছে কি না পরীক্ষা করুন; না থাকলে import করা যাবে না।`,
      });
    }

    const results = JSON.parse(await fs.promises.readFile(jsonPath, "utf8"));
    const records = Object.entries(results);
    if (records.length !== summary.total) {
      throw new Error("PDF parser summary does not match its JSON output");
    }
    uploadStatus = { ...uploadStatus, phase: "saving", records: records.length };
    if (!records.length) {
      uploadStatus = { ...uploadStatus, phase: "failed" };
      return res.status(422).json({
        error: "PDF থেকে কোনো রোল/GPA রেজাল্ট পড়া যায়নি। PDF scanned/image-only হলে OCR দরকার; text PDF হলে তার format parser-এর সঙ্গে মিলিয়ে দেখতে হবে।",
      });
    }

    const importedAt = new Date();
    const operations = records.map(([roll, result]) => {
      if (!result || typeof result !== "object" ||
          !/^\d{6}$/.test(roll) ||
          !["passed", "failed", "withheld", "cancelled"].includes(result.status)) {
        throw new Error("PDF-এ অকার্যকর রেজাল্ট ডেটা পাওয়া গেছে।");
      }
      if (
        result.academicSession !== academicSession ||
        !/^\d{3,8}$/.test(result.institutionCode || "") ||
        !result.institutionName ||
        !isIsoDate(result.resultDate || "")
      ) {
        throw new Error("PDF-এ অকার্যকর পরীক্ষা বা ইনস্টিটিউটের metadata পাওয়া গেছে।");
      }
      const passed = result.status === "passed";
      const failed = result.status === "failed";
      const cancelled = result.status === "cancelled";
      if (passed && (!Number.isFinite(result.gpa) || result.gpa < 0 || result.gpa > 4)) {
        throw new Error("PDF-এ অকার্যকর GPA পাওয়া গেছে।");
      }
      if (failed && !Array.isArray(result.subjects)) {
        throw new Error("PDF-এ অকৃতকার্য বিষয়ের তালিকা পাওয়া যায়নি।");
      }
      if (cancelled && (!Array.isArray(result.subjects) || result.subjects.length === 0)) {
        throw new Error("PDF-এ বাতিল বিষয়ের তালিকা পাওয়া যায়নি।");
      }
      if (!passed && !failed && !cancelled && result.note !== "Withheld") {
        throw new Error("PDF-এ অকার্যকর স্থগিত ফলাফলের তথ্য পাওয়া গেছে।");
      }
      return createResultUpdate({
        roll,
        exam,
        curriculum,
        semester,
        result,
        academicSession,
        importedAt,
      });
    });

    const passed = records.filter(([, result]) => result.status === "passed").length;
    const failed = records.filter(([, result]) => result.status === "failed").length;
    const withheld = records.filter(([, result]) => result.status === "withheld").length;
    const cancelled = records.filter(([, result]) => result.status === "cancelled").length;
    if (
      passed !== summary.passed ||
      failed !== summary.failed ||
      withheld !== summary.withheld ||
      cancelled !== summary.cancelled ||
      records.length !== passed + failed + withheld + cancelled
    ) {
      throw new Error("PDF parser classification summary does not match its JSON output");
    }

    let inserted = 0;
    let updated = 0;
    const batchSize = 1000;
    for (let i = 0; i < operations.length; i += batchSize) {
      const result = await col.bulkWrite(operations.slice(i, i + batchSize), { ordered: false });
      inserted += result.upsertedCount;
      updated += result.matchedCount;
    }

    uploadStatus = { ...uploadStatus, phase: "complete", records: records.length };
    res.json({
      message: "PDF থেকে ফলাফল পড়ে তথ্যভান্ডারে সংরক্ষণ করা হয়েছে।",
      exam,
      academicSession,
      institutionCount: new Set(
        records.map(([, result]) => `${result.institutionCode}:${result.institutionName}`)
      ).size,
      resultDates: [...new Set(records.map(([, result]) => result.resultDate))].sort(),
      total: records.length,
      passed,
      failed,
      withheld,
      cancelled,
      inserted,
      updated,
    });
  } catch (error) {
    console.error("PDF upload failed:", error);
    uploadStatus = { ...uploadStatus, phase: "failed" };
    if (error instanceof SyntaxError) {
      return res.status(422).json({ error: "PDF থেকে JSON তৈরি করা যায়নি।" });
    }
    if (error.code === "ENOENT") {
      return res.status(500).json({ error: "Python বা PDF parser পাওয়া যায়নি।" });
    }
    if (error.code === 1 && error.stderr?.includes("ModuleNotFoundError")) {
      return res.status(500).json({ error: "PDF parser-এর package ইনস্টল নেই। parser/requirements.txt থেকে dependency install করে server restart করুন।" });
    }
    if (Array.isArray(error.writeErrors)) {
      return res.status(500).json({
        error: "MongoDB-তে কিছু result save হয়েছে, কিন্তু কয়েকটি save হয়নি। একই PDF আবার upload করুন; আগেরগুলো duplicate হবে না, update হবে।",
      });
    }
    if (typeof error.code === "number") {
      return res.status(422).json({ error: "PDF পড়া যায়নি। ফাইলটি পরীক্ষা করে আবার চেষ্টা করুন।" });
    }
    if (error.killed && error.signal === "SIGTERM") {
      return res.status(422).json({ error: error.code === "PDF_PARSE_FAILED" && error.killed
        ? "PDF parse করতে ১০ মিনিটের বেশি লাগছে। ছোট PDF বা কম পৃষ্ঠার ফাইল দিয়ে চেষ্টা করুন।"
        : "PDF parser-এর output বেশি বড় হয়েছে। ছোট PDF দিয়ে চেষ্টা করুন।" });
    }
    if (error.code === "PDF_PARSE_FAILED") {
      return res.status(422).json({ error: "PDF পড়া যায়নি। ফাইলটি text-based কি না এবং format সঠিক কি না পরীক্ষা করুন।" });
    }
    res.status(500).json({ error: "PDF প্রক্রিয়া করা যায়নি। সার্ভার লগ দেখুন।" });
  } finally {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
        .catch((error) => console.error("Temporary upload cleanup failed:", error));
    }
  }
});

function runParser(pdfPath, jsonPath, semesterIndex, academicSession) {
  return new Promise((resolve, reject) => {
    const args = [
      parserPath,
      pdfPath,
      "--output", jsonPath,
      "--semester-index", String(semesterIndex),
      "--academic-session", academicSession,
    ];
    const child = spawn(
      process.env.PYTHON_BIN || "python3",
      args,
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let pending = "";
    let summary;
    let settled = false;
    let timedOut = false;
    uploadStatus = { ...uploadStatus, page: 0, totalPages: 0, records: 0 };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, PDF_PARSE_TIMEOUT_MS);
    const appendOutput = (current, chunk) => {
      const next = current + chunk.toString();
      if (next.length > 2 * 1024 * 1024) {
        child.kill("SIGTERM");
        throw new Error("PDF parser output limit exceeded");
      }
      return next;
    };

    child.stdout.on("data", (chunk) => {
      try {
        stdout = appendOutput(stdout, chunk);
        pending += chunk.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || "";
        for (const line of lines) {
          const progress = line.match(/^PROGRESS (\d+) (\d+) (\d+)$/);
          if (progress) {
            uploadStatus = {
              ...uploadStatus,
              phase: "parsing",
              page: Number(progress[1]),
              totalPages: Number(progress[2]),
              records: Number(progress[3]),
            };
          }
          const parsedSummary = line.match(
                /^SUMMARY total=(\d+) passed=(\d+) failed=(\d+) withheld=(\d+) cancelled=(\d+) unclassified=(\d+) semester=(\d+|latest) session=(20\d{2}-\d{2}) metadataMissing=(\d+)$/
          );
          if (parsedSummary) {
            summary = {
              total: Number(parsedSummary[1]),
              passed: Number(parsedSummary[2]),
              failed: Number(parsedSummary[3]),
              withheld: Number(parsedSummary[4]),
              cancelled: Number(parsedSummary[5]),
              unclassified: Number(parsedSummary[6]),
              semester: parsedSummary[7],
              session: parsedSummary[8],
              metadataMissing: Number(parsedSummary[9]),
            };
          }
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        stderr = appendOutput(stderr, chunk);
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0 && summary) return resolve({ stdout, stderr, summary });
      if (code === 0) {
        const error = new Error("PDF parser did not return a result summary");
        error.code = "PDF_PARSE_FAILED";
        error.stderr = stderr;
        return reject(error);
      }
      const error = new Error("PDF parser exited unsuccessfully");
      error.code = code === null ? "PDF_PARSE_FAILED" : code;
      error.signal = signal;
      error.killed = timedOut;
      error.stderr = stderr;
      reject(error);
    });
  });
}

// কারিকুলাম ও রোল নম্বর দিয়ে সব semester/session-এর রেজাল্ট
async function getResults(req, res, versioned = false) {
  res.set("Cache-Control", "no-store");
  const { roll, curriculum } = req.query;
  if (!/^\d{6}$/.test(roll || "") || !curricula.has(curriculum)) {
    const message = "সঠিক শিক্ষাক্রম বেছে নিয়ে ৬ সংখ্যার রোল নম্বর দিন।";
    return res.status(400).json(versioned
      ? { error: { code: "INVALID_SEARCH", message } }
      : { error: message });
  }
  try {
    const legacyExamPrefix = new RegExp(`^${curriculum.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s-`);
    const legacySessionSuffix = new RegExp(` - (${visibleResultSessions.join("|")})$`);
    const results = await col.find(
      {
        roll: String(roll),
        $and: [
          {
            $or: [
              { curriculum: String(curriculum) },
              { exam: { $regex: legacyExamPrefix } },
            ],
          },
          {
            $or: [
              { academicSession: { $in: visibleResultSessions } },
              {
                academicSession: { $in: [null, ""] },
                exam: { $regex: legacySessionSuffix },
              },
            ],
          },
        ],
      },
      { projection: { _id: 0 } }
    ).maxTimeMS(5000).toArray();
    if (!results.length) {
      const message = "এই শিক্ষাক্রমে কোনো ফলাফল পাওয়া যায়নি।";
      return res.status(404).json(versioned
        ? { error: { code: "RESULTS_NOT_FOUND", message } }
        : { error: message });
    }
    sortResults(results, curriculum, [...semesters]);
    if (versioned) {
      return res.json({
        data: results,
        meta: {
          version: "1",
          roll: String(roll),
          curriculum: String(curriculum),
          count: results.length,
          sessionFrom: firstVisibleResultSession,
          sessionThrough: visibleResultSessions.at(-1),
        },
      });
    }
    res.json(results);
  } catch (e) {
    console.error("Result search failed:", e);
    const message = "সার্ভারে সমস্যা হয়েছে।";
    const timedOut = e.code === 50;
    res.status(timedOut ? 503 : 500).json(versioned
      ? { error: { code: timedOut ? "SEARCH_TIMEOUT" : "INTERNAL_ERROR", message } }
      : { error: message });
  }
}

app.get("/results", (req, res) => getResults(req, res));
app.get("/api/v1/results", resultsApiLimiter, (req, res) => getResults(req, res, true));

app.use((error, req, res, next) => {
  if (req.path === "/upload") {
    uploadStatus = { ...uploadStatus, phase: "failed" };
  }
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "PDF ফাইলের আকার ২০ MB-এর বেশি হতে পারবে না।"
      : "ফাইল আপলোড করা যায়নি।";
    return res.status(400).json({ error: message });
  }
  if (error) {
    return res.status(400).json({ error: error.message || "রিকোয়েস্ট সঠিক নয়।" });
  }
  next();
});

// ../web ফোল্ডার থাকলে সেটাও এই সার্ভার থেকে দেখাবে (লোকালে টেস্টের জন্য সুবিধা)
const webDir = path.join(__dirname, "..", "web");
if (fs.existsSync(webDir)) app.use(express.static(webDir));

client.connect().then(() => {
  return Promise.all([
    col.createIndex({ roll: 1, exam: 1 }, { unique: true }),
    col.createIndex(
      { roll: 1, curriculum: 1, semester: -1, academicSession: -1 },
      { name: "results_roll_curriculum_semester_session" }
    ),
  ]);
}).then(() => {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`সার্ভার চালু: http://localhost:${port}`));
}).catch((error) => {
  console.error("MongoDB-তে সংযোগ করা যায়নি:", error);
  process.exit(1);
});
