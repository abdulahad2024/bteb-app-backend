'use strict';

const API_URL = '';
const MAX_PDF_SIZE = 20 * 1024 * 1024;
const $ = id => document.getElementById(id);
const bn = value => String(value).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[digit]);
const en = value =>
  value.replace(/[০-৯]/g, digit => '০১২৩৪৫৬৭৮৯'.indexOf(digit));
const esc = value =>
  String(value).replace(
    /[&<>"']/g,
    char =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );
let currentResults = [];

function showResult(result, index) {
  const passed = result.status === 'passed';
  const withheld = result.status === 'withheld';
  const cancelled = result.status === 'cancelled';
  const statusLabel = passed
    ? 'উত্তীর্ণ'
    : withheld
      ? 'ফল স্থগিত'
      : cancelled
        ? 'বিষয় বাতিল'
        : 'অকৃতকার্য';
  const resultDetail = withheld
    ? `<p class="meta result-detail">${esc(result.note || 'ফল স্থগিত')}</p>`
    : passed
      ? `<p class="gpa"><b>${bn(Number(result.gpa).toFixed(2))}</b><span>গ্রেড পয়েন্ট</span></p>`
      : `<p class="meta result-detail">${cancelled ? 'বাতিল বিষয়:' : 'যেসব বিষয়ে অকৃতকার্য:'}</p>
         <ul class="subjects">${(result.subjects || []).map(subject => `<li>${esc(subject)}</li>`).join('')}</ul>`;
  const semester = result.semester || result.exam;

  return `
    <article class="slip ${esc(result.status)}${index === 0 ? ' latest-result' : ''}">
      <div class="slip-heading">
        <div>
          <div class="slip-tags">
            <span class="semester-tag">${bn(esc(semester))}</span>
            ${index === 0 ? '<span class="latest-tag">সর্বশেষ সেমিস্টার</span>' : ''}
          </div>
          <p class="roll-label">পরীক্ষার্থীর রোল</p>
          <p class="roll">${bn(esc(result.roll))}</p>
        </div>
        <button class="download-button" type="button" data-result-index="${index}" aria-label="এই ফলাফলের ছবি নামান">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg>
          ছবি নামান
        </button>
      </div>
      <div class="result-information">
        <span class="badge">${statusLabel}</span>
        ${
          result.institutionName
            ? `<p class="meta result-detail"><b>প্রতিষ্ঠান:</b> ${esc(result.institutionName)}${result.institutionCode ? ` (${bn(esc(result.institutionCode))})` : ''}</p>`
            : ''
        }
        <p class="meta result-detail"><b>শিক্ষাবর্ষ:</b> ${result.academicSession ? bn(esc(result.academicSession)) : '—'}${result.resultDate ? ` <span class="detail-separator">·</span> <b>প্রকাশের তারিখ:</b> ${bn(esc(result.resultDate))}` : ''}</p>
        ${resultDetail}
      </div>
      <p class="card-credit">সফটওয়্যার তৈরি করেছেন: আব্দুল আহাদ</p>
    </article>`;
}

function showResults(results) {
  currentResults = results;
  const cards = results.map(showResult).join('');
  $('out').innerHTML = `
    <div class="results-heading">
      <div><p class="result-summary">আপনার ফলাফল</p><p class="result-count">২০২২-২৩ শিক্ষাবর্ষ থেকে বর্তমান পর্যন্ত · মোট ${bn(results.length)}টি</p></div>
      <span class="results-order">সর্বশেষ সেমিস্টার আগে</span>
    </div>
    <div class="result-list">${cards}</div>`;
}

function roundedRect(context, x, y, width, height, radius, color) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function wrapCanvasText(context, value, maxWidth) {
  const words = String(value).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function downloadResultImage(result, button) {
  button.disabled = true;
  button.textContent = 'ছবি তৈরি হচ্ছে...';
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('ছবি তৈরি করা যাচ্ছে না।');

    const width = 1200;
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const subjects = result.subjects || [];
    const details = [
      ['পরীক্ষার্থীর রোল', bn(result.roll)],
      ['শিক্ষাক্রম', result.curriculum || 'ডিপ্লোমা ইন ইঞ্জিনিয়ারিং'],
      ['সেমিস্টার', result.semester || result.exam],
      ['শিক্ষাবর্ষ', result.academicSession ? bn(result.academicSession) : '—'],
      [
        'প্রতিষ্ঠান',
        [
          result.institutionName,
          result.institutionCode && `কোড ${bn(result.institutionCode)}`,
        ]
          .filter(Boolean)
          .join(' · ') || '—',
      ],
      ['ফল প্রকাশের তারিখ', result.resultDate ? bn(result.resultDate) : '—'],
    ];
    let height =
      1320 +
      subjects.length * 82 +
      details.reduce(
        (sum, [, value]) =>
          sum + Math.max(0, Math.ceil(String(value).length / 42) - 1) * 40,
        0,
      );
    height = Math.min(height, 5000);
    canvas.width = width;
    canvas.height = height;

    context.fillStyle = '#eef5f2';
    context.fillRect(0, 0, width, height);
    const banner = context.createLinearGradient(0, 0, width, 460);
    banner.addColorStop(0, '#075e59');
    banner.addColorStop(1, '#0b9a83');
    roundedRect(context, 44, 44, width - 88, height - 88, 34, '#ffffff');
    context.save();
    context.beginPath();
    context.moveTo(78, 44);
    context.arcTo(width - 44, 44, width - 44, 78, 34);
    context.lineTo(width - 44, 420);
    context.lineTo(44, 470);
    context.lineTo(44, 78);
    context.arcTo(44, 44, 78, 44, 34);
    context.closePath();
    context.fillStyle = banner;
    context.fill();
    context.restore();

    context.textAlign = 'center';
    context.fillStyle = '#c5f2e7';
    context.font = `500 34px ${fontFamily}`;
    context.fillText('বাংলাদেশ কারিগরি শিক্ষা বোর্ড', width / 2, 145);
    context.fillStyle = '#ffffff';
    context.font = `700 62px ${fontFamily}`;
    context.fillText('পরীক্ষার ফলাফল', width / 2, 238);
    context.font = `500 30px ${fontFamily}`;
    context.fillStyle = '#e3fff6';
    context.fillText(bn(result.semester || result.exam), width / 2, 300, 980);
    context.font = `600 26px ${fontFamily}`;
    context.fillText(
      `শিক্ষাবর্ষ ${result.academicSession ? bn(result.academicSession) : '—'}`,
      width / 2,
      354,
    );

    let y = 535;
    context.textAlign = 'left';
    context.fillStyle = '#172a2b';
    context.font = `700 34px ${fontFamily}`;
    context.fillText('শিক্ষার্থীর তথ্য', 100, y);
    y += 42;
    for (const [label, value] of details) {
      context.font = `500 27px ${fontFamily}`;
      context.fillStyle = '#687b7b';
      context.fillText(label, 100, y + 32);
      context.font = `600 29px ${fontFamily}`;
      context.fillStyle = '#172a2b';
      const lines = wrapCanvasText(context, value, 700);
      lines.forEach((line, lineIndex) =>
        context.fillText(line, 400, y + 32 + lineIndex * 40),
      );
      y += Math.max(78, lines.length * 42 + 24);
      context.strokeStyle = '#e5eeea';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(100, y - 10);
      context.lineTo(width - 100, y - 10);
      context.stroke();
    }

    y += 22;
    const statusColors = {
      passed: ['#e8f7ef', '#19805b'],
      failed: ['#fff0ef', '#c14949'],
      withheld: ['#fff7df', '#986a12'],
      cancelled: ['#f1edfc', '#6754a2'],
    };
    const [statusBackground, statusColor] =
      statusColors[result.status] || statusColors.failed;
    roundedRect(context, 90, y, width - 180, 118, 22, statusBackground);
    const statusLabel =
      result.status === 'passed'
        ? 'উত্তীর্ণ'
        : result.status === 'withheld'
          ? 'ফল স্থগিত'
          : result.status === 'cancelled'
            ? 'বিষয় বাতিল'
            : 'অনুত্তীর্ণ';
    context.fillStyle = statusColor;
    context.font = `700 36px ${fontFamily}`;
    context.fillText(`ফলাফলের অবস্থা: ${statusLabel}`, 125, y + 52);
    if (result.status === 'passed') {
      context.font = `600 29px ${fontFamily}`;
      context.fillText(
        `গ্রেড পয়েন্ট: ${bn(Number(result.gpa).toFixed(2))}`,
        125,
        y + 94,
      );
    }
    y += 150;

    if (result.status === 'withheld' && result.note) {
      context.font = `500 27px ${fontFamily}`;
      context.fillStyle = '#172a2b';
      const lines = wrapCanvasText(context, result.note, 950);
      lines.forEach((line, index) =>
        context.fillText(line, 100, y + 34 + index * 40),
      );
      y += lines.length * 42 + 18;
    }
    if (subjects.length) {
      context.font = `700 30px ${fontFamily}`;
      context.fillStyle = '#172a2b';
      context.fillText(
        result.status === 'cancelled' ? 'বাতিল বিষয়' : 'যেসব বিষয়ে অকৃতকার্য',
        100,
        y + 25,
      );
      y += 64;
      context.font = `500 27px ${fontFamily}`;
      context.fillStyle = statusColor;
      for (const subject of subjects) {
        const lines = wrapCanvasText(context, `• ${subject}`, 980);
        lines.forEach((line, index) =>
          context.fillText(line, 110, y + index * 38),
        );
        y += lines.length * 40 + 12;
      }
    }

    context.textAlign = 'center';
    context.fillStyle = '#687b7b';
    context.font = `500 23px ${fontFamily}`;
    context.fillText(
      'এটি অনানুষ্ঠানিক ফলাফল বিবরণী · চূড়ান্ত তথ্যের জন্য বোর্ডের ওয়েবসাইট দেখুন',
      width / 2,
      height - 108,
      width - 170,
    );
    context.fillStyle = '#087f72';
    context.font = `600 22px ${fontFamily}`;
    context.fillText(
      'সফটওয়্যার তৈরি করেছেন: আবদুল আহাদ',
      width / 2,
      height - 70,
    );

    const image = await new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('ছবিটি সংরক্ষণ করা যায়নি।'));
      }, 'image/png');
    });
    const url = URL.createObjectURL(image);
    const link = document.createElement('a');
    link.href = url;
    const semesterNumber = en(
      String(result.semester || '').match(/[০-৯]+/)?.[0] || '',
    );
    link.download = `bteb-result-${en(result.roll)}-${semesterNumber || 'result'}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    button.disabled = false;
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg> ছবি নামান';
  }
}

function showError(target, message) {
  $(target).innerHTML = `<div class="msg">${esc(message)}</div>`;
}

async function handleResultDownload(event) {
  const button = event.target.closest('[data-result-index]');
  if (!button) return;
  const result = currentResults[Number(button.dataset.resultIndex)];
  if (!result) return;
  try {
    await downloadResultImage(result, button);
  } catch (error) {
    showError('out', error.message || 'ফলাফলের ছবি তৈরি করা যায়নি।');
  }
}

function setLoggedIn(email) {
  $('loginForm').hidden = true;
  $('loginOut').replaceChildren();
  $('adminArea').hidden = false;
  $('adminEmail').textContent = email;
}

function setLoggedOut() {
  $('loginForm').hidden = false;
  $('adminArea').hidden = true;
  $('loginPassword').value = '';
}

async function restoreSession() {
  try {
    const response = await fetch(`${API_URL}/auth/session`);
    if (!response.ok) return;
    const data = await response.json();
    setLoggedIn(data.email);
  } catch {
    showError('loginOut', 'প্রবেশ সেবার সঙ্গে যোগাযোগ করা যাচ্ছে না।');
  }
}

async function handleLogin(event) {
  event.preventDefault();
  $('loginBtn').disabled = true;
  $('loginOut').replaceChildren();
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: $('loginEmail').value,
        password: $('loginPassword').value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'প্রবেশ করা যায়নি।');
    setLoggedIn(data.email);
  } catch (error) {
    showError('loginOut', error.message || 'সার্ভারের সঙ্গে যোগাযোগ হচ্ছে না।');
  } finally {
    $('loginBtn').disabled = false;
  }
}

async function handleLogout() {
  try {
    const response = await fetch(`${API_URL}/auth/logout`, { method: 'POST' });
    if (!response.ok) throw new Error('বের হওয়া যায়নি।');
    setLoggedOut();
    $('uploadOut').replaceChildren();
  } catch {
    showError(
      'loginOut',
      'বের হওয়া যায়নি। সার্ভারের সঙ্গে আবার চেষ্টা করুন।',
    );
  }
}

async function handleSearch(event) {
  event.preventDefault();
  const roll = en($('roll').value.trim());
  const curriculum = $('searchCurriculum').value;
  if (!/^\d{6}$/.test(roll))
    return showError('out', 'রোল নম্বর ৬ সংখ্যার হতে হবে।');
  if (!curriculum) return showError('out', 'শিক্ষাক্রম বেছে নিন।');

  $('btn').disabled = true;
  $('out').replaceChildren();
  try {
    const query = new URLSearchParams({ roll, curriculum });
    const response = await fetch(`${API_URL}/api/v1/results?${query}`);
    const data = await response.json();
    if (!response.ok)
      return showError(
        'out',
        data.error?.message || 'কোনো ফলাফল পাওয়া যায়নি।',
      );
    showResults(data.data);
  } catch {
    showError(
      'out',
      'সার্ভারের সঙ্গে যোগাযোগ হচ্ছে না। একটু পরে আবার চেষ্টা করুন।',
    );
  } finally {
    $('btn').disabled = false;
  }
}

function updateUploadProgress(status) {
  if (status.phase === 'preparing') {
    $('uploadStatus').textContent = 'PDF প্রস্তুত করা হচ্ছে...';
  } else if (status.phase === 'parsing') {
    $('uploadMeter').removeAttribute('value');
    $('uploadStatus').textContent = status.totalPages
      ? `PDF পড়া হচ্ছে... ${bn(status.page)} / ${bn(status.totalPages)} পৃষ্ঠা, ${bn(status.records)}টি ফলাফল পাওয়া গেছে`
      : 'PDF-এর পৃষ্ঠা পড়া হচ্ছে...';
  } else if (status.phase === 'saving') {
    $('uploadMeter').removeAttribute('value');
    $('uploadStatus').textContent =
      `তথ্যভান্ডারে ${bn(status.records)}টি ফলাফল সংরক্ষণ হচ্ছে...`;
  }
}

function sendUpload(formData) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_URL}/upload`);
    request.timeout = 11 * 60 * 1000;
    request.upload.addEventListener('progress', event => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      $('uploadMeter').value = percent;
      $('uploadStatus').textContent =
        percent < 100
          ? `PDF পাঠানো হচ্ছে... ${bn(percent)}%`
          : 'PDF পৌঁছেছে; ফলাফল পড়ে তথ্যভান্ডারে রাখা হচ্ছে...';
    });
    request.addEventListener('load', () => {
      let data;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        reject(new Error('সার্ভার থেকে সঠিক উত্তর পাওয়া যায়নি।'));
        return;
      }
      if (request.status === 401) {
        setLoggedOut();
        reject(new Error('আপনার লগইন মেয়াদ শেষ। আবার লগইন করুন।'));
      } else if (request.status < 200 || request.status >= 300) {
        reject(new Error(data.error || 'PDF থেকে ফলাফল সংরক্ষণ করা যায়নি।'));
      } else {
        resolve(data);
      }
    });
    request.addEventListener('error', () =>
      reject(new Error('সার্ভারের সঙ্গে যোগাযোগ হচ্ছে না।')),
    );
    request.addEventListener('timeout', () =>
      reject(
        new Error(
          'প্রক্রিয়াটি ১১ মিনিটেও শেষ হয়নি। ছোট PDF দিয়ে আবার চেষ্টা করুন।',
        ),
      ),
    );
    request.addEventListener('abort', () =>
      reject(new Error('PDF পাঠানো বাতিল হয়েছে।')),
    );
    request.send(formData);
  });
}

function showUploadSuccess(data) {
  $('uploadOut').innerHTML = `
    <div class="msg success">
      ${esc(data.message)}<br>
      ${bn(esc(data.exam))}<br>
      ${bn(data.institutionCount)}টি প্রতিষ্ঠান · প্রকাশের তারিখ ${data.resultDates.map(date => bn(esc(date))).join(', ')}<br>
      মোট ${bn(data.total)}টি: উত্তীর্ণ ${bn(data.passed)}, অনুত্তীর্ণ ${bn(data.failed)}, স্থগিত ${bn(data.withheld)}, বিষয় বাতিল ${bn(data.cancelled)}।<br>
      নতুন সংরক্ষণ ${bn(data.inserted)}টি, হালনাগাদ ${bn(data.updated)}টি।
    </div>`;
}

async function handleUpload(event) {
  event.preventDefault();
  const file = $('pdfFile').files[0];
  if (!file) return showError('uploadOut', 'একটি PDF ফাইল বেছে নিন।');
  if (!/\.pdf$/i.test(file.name))
    return showError('uploadOut', 'শুধু PDF ফাইল পাঠানো যাবে।');
  if (file.size > MAX_PDF_SIZE)
    return showError(
      'uploadOut',
      'PDF ফাইলের আকার ২০ মেগাবাইটের বেশি হতে পারবে না।',
    );

  const curriculum = $('uploadCurriculum').value;
  const semester = $('uploadSemester').value;
  const academicSession = $('uploadSession').value;
  if (!curriculum || !semester)
    return showError('uploadOut', 'কারিকুলাম ও সেমিস্টার বেছে নিন।');
  if (!academicSession)
    return showError('uploadOut', 'শিক্ষাবর্ষের তালিকা থেকে একটি বেছে নিন।');

  const formData = new FormData();
  formData.append('curriculum', curriculum);
  formData.append('semester', semester);
  formData.append('academicSession', academicSession);
  formData.append('pdf', file);

  $('uploadBtn').disabled = true;
  $('uploadBtn').textContent = 'PDF প্রক্রিয়া হচ্ছে...';
  $('uploadOut').replaceChildren();
  $('uploadProgress').hidden = false;
  $('uploadMeter').value = 0;
  $('uploadStatus').textContent = 'PDF পাঠানো শুরু হচ্ছে...';

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
    $('uploadProgress').hidden = true;
    showUploadSuccess(data);
    $('pdfFile').value = '';
  } catch (error) {
    $('uploadProgress').hidden = true;
    showError(
      'uploadOut',
      error.message || 'সার্ভারের সঙ্গে যোগাযোগ হচ্ছে না।',
    );
  } finally {
    window.clearInterval(progressTimer);
    $('uploadBtn').disabled = false;
    $('uploadBtn').textContent = 'PDF পাঠিয়ে সংরক্ষণ করুন';
  }
}

function handleFileChange() {
  const file = $('pdfFile').files[0];
  if (file && file.size > MAX_PDF_SIZE) {
    $('pdfFile').value = '';
    showError('uploadOut', 'PDF ফাইলের আকার ২০ মেগাবাইটের বেশি হতে পারবে না।');
  }
}

$('loginForm').addEventListener('submit', handleLogin);
$('logoutBtn').addEventListener('click', handleLogout);
$('f').addEventListener('submit', handleSearch);
$('out').addEventListener('click', handleResultDownload);
$('uploadForm').addEventListener('submit', handleUpload);
$('pdfFile').addEventListener('change', handleFileChange);
restoreSession();
