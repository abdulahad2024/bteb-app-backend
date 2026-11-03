"use strict";

const API_URL = "";
const MAX_PDF_SIZE = 20 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const bn = (value) => String(value).replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[digit]);
const en = (value) => value.replace(/[০-৯]/g, (digit) => "০১২৩৪৫৬৭৮৯".indexOf(digit));
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));

function showResult(result) {
  const passed = result.status === "passed";
  const withheld = result.status === "withheld";
  const cancelled = result.status === "cancelled";
  const statusLabel = passed
    ? "উত্তীর্ণ"
    : withheld
      ? "ফল স্থগিত"
      : cancelled
        ? "বিষয় বাতিল"
        : "অকৃতকার্য";
  const resultDetail = withheld
    ? `<p class="meta result-detail">${esc(result.note || "Withheld")}</p>`
    : passed
      ? `<p class="gpa"><b>${bn(Number(result.gpa).toFixed(2))}</b><span>GPA</span></p>`
      : `<p class="meta result-detail">${cancelled ? "বাতিল বিষয়:" : "যে বিষয়গুলোতে অকৃতকার্য:"}</p>
         <ul class="subjects">${(result.subjects || []).map((subject) => `<li>${esc(subject)}</li>`).join("")}</ul>`;

  return `
    <article class="slip ${esc(result.status)}">
      <p class="meta">${bn(esc(result.exam))}</p>
      <p class="roll">${bn(esc(result.roll))}</p>
      <span class="badge">${statusLabel}</span>
      ${result.institutionName
        ? `<p class="meta result-detail">${esc(result.institutionName)}${result.institutionCode ? ` (${bn(esc(result.institutionCode))})` : ""}</p>`
        : ""}
      ${result.academicSession || result.resultDate
        ? `<p class="meta">Session: ${result.academicSession ? bn(esc(result.academicSession)) : "—"} · রেজাল্ট প্রকাশ: ${result.resultDate ? esc(result.resultDate) : "—"}</p>`
        : ""}
      ${resultDetail}
    </article>`;
}

function showResults(results) {
  const cards = results.map(showResult).join("");
  $("out").innerHTML = `
    <p class="result-summary">মোট ${bn(results.length)}টি সেমিস্টার/সেশনের ফলাফল পাওয়া গেছে।</p>
    <div class="result-list">${cards}</div>`;
}

function showError(target, message) {
  $(target).innerHTML = `<div class="msg">${esc(message)}</div>`;
}

function setLoggedIn(email) {
  $("loginForm").hidden = true;
  $("loginOut").replaceChildren();
  $("adminArea").hidden = false;
  $("adminEmail").textContent = email;
}

function setLoggedOut() {
  $("loginForm").hidden = false;
  $("adminArea").hidden = true;
  $("loginPassword").value = "";
}

async function restoreSession() {
  try {
    const response = await fetch(`${API_URL}/auth/session`);
    if (!response.ok) return;
    const data = await response.json();
    setLoggedIn(data.email);
  } catch {
    showError("loginOut", "লগইন সার্ভারের সাথে যোগাযোগ করা যাচ্ছে না।");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  $("loginBtn").disabled = true;
  $("loginOut").replaceChildren();
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: $("loginEmail").value,
        password: $("loginPassword").value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "লগইন করা যায়নি।");
    setLoggedIn(data.email);
  } catch (error) {
    showError("loginOut", error.message || "সার্ভারের সাথে যোগাযোগ হচ্ছে না।");
  } finally {
    $("loginBtn").disabled = false;
  }
}

async function handleLogout() {
  try {
    const response = await fetch(`${API_URL}/auth/logout`, { method: "POST" });
    if (!response.ok) throw new Error("লগআউট করা যায়নি।");
    setLoggedOut();
    $("uploadOut").replaceChildren();
  } catch {
    showError("loginOut", "লগআউট করা যায়নি। সার্ভারের সাথে আবার চেষ্টা করুন।");
  }
}

async function handleSearch(event) {
  event.preventDefault();
  const roll = en($("roll").value.trim());
  const curriculum = $("searchCurriculum").value;
  if (!/^\d{6}$/.test(roll)) return showError("out", "রোল নম্বর ৬ সংখ্যার হতে হবে।");
  if (!curriculum) return showError("out", "কারিকুলাম বেছে নিন।");

  $("btn").disabled = true;
  $("out").replaceChildren();
  try {
    const query = new URLSearchParams({ roll, curriculum });
    const response = await fetch(`${API_URL}/results?${query}`);
    const data = await response.json();
    if (!response.ok) return showError("out", data.error || "রেজাল্ট পাওয়া যায়নি।");
    showResults(data);
  } catch {
    showError("out", "সার্ভারের সাথে যোগাযোগ হচ্ছে না। একটু পরে আবার চেষ্টা করুন।");
  } finally {
    $("btn").disabled = false;
  }
}

function updateUploadProgress(status) {
  if (status.phase === "preparing") {
    $("uploadStatus").textContent = "PDF প্রস্তুত করা হচ্ছে...";
  } else if (status.phase === "parsing") {
    $("uploadMeter").removeAttribute("value");
    $("uploadStatus").textContent = status.totalPages
      ? `PDF পড়া হচ্ছে... ${bn(status.page)} / ${bn(status.totalPages)} পৃষ্ঠা, ${bn(status.records)}টি রেজাল্ট পাওয়া গেছে`
      : "PDF-এর পৃষ্ঠা পড়া হচ্ছে...";
  } else if (status.phase === "saving") {
    $("uploadMeter").removeAttribute("value");
    $("uploadStatus").textContent = `MongoDB-তে ${bn(status.records)}টি রেজাল্ট save হচ্ছে...`;
  }
}

function sendUpload(formData) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}/upload`);
    request.timeout = 11 * 60 * 1000;
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      $("uploadMeter").value = percent;
      $("uploadStatus").textContent = percent < 100
        ? `PDF আপলোড হচ্ছে... ${bn(percent)}%`
        : "PDF সার্ভারে পৌঁছেছে; এখন ফলাফল পড়ে database-এ রাখা হচ্ছে...";
    });
    request.addEventListener("load", () => {
      let data;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        reject(new Error("সার্ভার থেকে সঠিক response পাওয়া যায়নি."));
        return;
      }
      if (request.status === 401) {
        setLoggedOut();
        reject(new Error("আপনার লগইন মেয়াদ শেষ। আবার লগইন করুন।"));
      } else if (request.status < 200 || request.status >= 300) {
        reject(new Error(data.error || "PDF ইমপোর্ট করা যায়নি।"));
      } else {
        resolve(data);
      }
    });
    request.addEventListener("error", () => reject(new Error("সার্ভারের সাথে যোগাযোগ হচ্ছে না।")));
    request.addEventListener("timeout", () => reject(new Error("প্রক্রিয়াটি ১১ মিনিটেও শেষ হয়নি। ছোট বা কম পৃষ্ঠার PDF দিয়ে চেষ্টা করুন।")));
    request.addEventListener("abort", () => reject(new Error("PDF upload বাতিল হয়েছে।")));
    request.send(formData);
  });
}

function showUploadSuccess(data) {
  $("uploadOut").innerHTML = `
    <div class="msg success">
      ${esc(data.message)}<br>
      ${bn(esc(data.exam))}<br>
      ${bn(data.institutionCount)}টি প্রতিষ্ঠান · প্রকাশের তারিখ ${data.resultDates.map(esc).join(", ")}<br>
      মোট ${bn(data.total)}টি: পাস ${bn(data.passed)}, ফেল ${bn(data.failed)}, স্থগিত ${bn(data.withheld)}, বিষয় বাতিল ${bn(data.cancelled)}।<br>
      নতুন ${bn(data.inserted)}টি, update ${bn(data.updated)}টি।
    </div>`;
}

async function handleUpload(event) {
  event.preventDefault();
  const file = $("pdfFile").files[0];
  if (!file) return showError("uploadOut", "একটি PDF ফাইল বেছে নিন।");
  if (!/\.pdf$/i.test(file.name)) return showError("uploadOut", "শুধু PDF ফাইল আপলোড করুন।");
  if (file.size > MAX_PDF_SIZE) return showError("uploadOut", "PDF ফাইলের আকার ২০ MB-এর বেশি হতে পারবে না।");

  const curriculum = $("uploadCurriculum").value;
  const semester = $("uploadSemester").value;
  const academicSession = $("uploadSession").value;
  if (!curriculum || !semester) return showError("uploadOut", "কারিকুলাম ও সেমিস্টার বেছে নিন।");
  if (!academicSession) return showError("uploadOut", "Academic session তালিকা থেকে বেছে নিন।");

  const formData = new FormData();
  formData.append("curriculum", curriculum);
  formData.append("semester", semester);
  formData.append("academicSession", academicSession);
  formData.append("pdf", file);

  $("uploadBtn").disabled = true;
  $("uploadBtn").textContent = "PDF প্রক্রিয়া হচ্ছে...";
  $("uploadOut").replaceChildren();
  $("uploadProgress").hidden = false;
  $("uploadMeter").value = 0;
  $("uploadStatus").textContent = "PDF আপলোড শুরু হচ্ছে...";

  const progressTimer = window.setInterval(async () => {
    try {
      const response = await fetch(`${API_URL}/upload/status`);
      if (response.ok) updateUploadProgress(await response.json());
    } catch {
      // The upload request reports its own connection errors.
    }
  }, 1200);

  try {
    const data = await sendUpload(formData);
    $("uploadProgress").hidden = true;
    showUploadSuccess(data);
    $("pdfFile").value = "";
  } catch (error) {
    $("uploadProgress").hidden = true;
    showError("uploadOut", error.message || "সার্ভারের সাথে যোগাযোগ হচ্ছে না।");
  } finally {
    window.clearInterval(progressTimer);
    $("uploadBtn").disabled = false;
    $("uploadBtn").textContent = "PDF আপলোড ও ইমপোর্ট";
  }
}

function handleFileChange() {
  const file = $("pdfFile").files[0];
  if (file && file.size > MAX_PDF_SIZE) {
    $("pdfFile").value = "";
    showError("uploadOut", "PDF ফাইলের আকার ২০ MB-এর বেশি হতে পারবে না।");
  }
}

$("loginForm").addEventListener("submit", handleLogin);
$("logoutBtn").addEventListener("click", handleLogout);
$("f").addEventListener("submit", handleSearch);
$("uploadForm").addEventListener("submit", handleUpload);
$("pdfFile").addEventListener("change", handleFileChange);
restoreSession();
