# BTEB পলিটেকনিক রেজাল্ট অ্যাপ

Browser থেকে PDF আপলোড করলে Python parser PDF থেকে ফলাফল বের করে JSON বানায় এবং MongoDB-তে সংরক্ষণ করে। একই responsive পেজে কারিকুলাম ও রোল নম্বর দিয়ে খুঁজলে ওই শিক্ষার্থীর database-এ থাকা সব semester/session-এর ফলাফল একসঙ্গে দেখা যায়।

Frontend সহজে maintain করার জন্য page structure `web/index.html`-এ, সব design ও responsive style `web/css/app.css`-এ, আর login/search/upload interaction `web/js/app.js`-এ রাখা হয়েছে।

## লোকালে চালান

প্রয়োজন: Python 3, Node.js এবং MongoDB Atlas connection string।

1. `api/.env.example` কপি করে `api/.env` বানান (এই repository-তে local `api/.env` template-ও আছে)। `MONGO_URI`-তে Atlas connection string এবং `ADMIN_EMAIL` ও `ADMIN_PASSWORD`-এ নিজের credentials দিন। Password কমপক্ষে ১৬ অক্ষরের unique password রাখুন; কোনো placeholder রেখে চালাবেন না।
2. Repository root থেকে আলাদা Python environment তৈরি করে fast PDF parser ইনস্টল করুন:
   ```
   python3 -m venv .venv
   .venv/bin/python -m pip install -r parser/requirements.txt
   ```
   `api/.env`-এর `PYTHON_BIN`-এ project-এর `.venv/bin/python`-এর absolute path দিন।
3. API dependency ইনস্টল করে সার্ভার চালান:
   ```
   cd api
   npm install
   npm start
   ```
4. `http://localhost:3000` খুলে `ADMIN_EMAIL` ও `ADMIN_PASSWORD` দিয়ে লগইন করুন। এরপর কারিকুলাম, সেমিস্টার এবং academic session dropdown থেকে (যেমন `2022-23`) বেছে PDF upload করুন। Regulation বা পরীক্ষার পরিচয় দেওয়ার দরকার নেই। Parser institute code/name ও `Date` PDF থেকে পড়ে; এগুলোর জন্য আলাদা input নেই। প্রতিটি result document-এ `academicSession`, `institutionCode`, `institutionName`, `resultDate` এবং স্বয়ংক্রিয় `importedAt` MongoDB-তে থাকে। Browser upload progress, PDF parsing-এর পৃষ্ঠা/রেকর্ড অগ্রগতি, ও নতুন/updated result count দেখাবে। সর্বোচ্চ ২০ MB PDF আপলোড করা যাবে; একই সময়ে একটি PDF প্রক্রিয়া হবে।

একই academic session ও semester-এ একই roll আগে থাকলে duplicate তৈরি না করে update হবে। Public search-এ কারিকুলাম ও roll দিয়ে খুঁজলে সব matching semester/session result ফেরত আসে। Pass, fail, withheld ও canceled-subject result আলাদা status হিসেবে সংরক্ষণ হয়। Result row-তে institute code/name বা প্রকাশের তারিখ PDF-এ না পাওয়া গেলে import বন্ধ থাকবে, যাতে metadata বাদ পড়ে না যায়। PDF থেকে কোনো রেজাল্ট পড়া না গেলেও কিছু import হবে না।
Parser PyMuPDF ব্যবহার করে embedded text পড়ে; সমর্থিত BTEB format-এ ৬ সংখ্যার roll, সাধারণ GPA (`123456 (4.50)`), semester-ভিত্তিক GPA (`123456 (gpa6: 3.61, ...)`) অথবা fail/expelled row থাকতে পারে। Upload form-এ বেছে নেওয়া semester-এর `gpaN` ব্যবহার হয়; নির্বাচিত semester-এর GPA row-তে না থাকলে import বন্ধ থাকে, ফলে ভুল pass/fail data database-এ যায় না। Arbitrary PDF, অন্য schema, বা image-only/scanned PDF-তে OCR না থাকলে ফলাফল বের হবে না।

## ঐচ্ছিক: কমান্ড লাইন থেকে JSON বানানো

```
cd parser
python parse.py ../result.pdf --debug
python parse.py ../result.pdf
python parse.py ../result.pdf --semester-index 6 --academic-session 2022-23 --output /tmp/results.json
```

JSON-এর আউটপুট path নির্দিষ্ট করতে `--output /path/to/results.json` ব্যবহার করুন। `--semester-index` দিলে ওই semester-এর GPA বেছে নেওয়া হয়; না দিলে প্রতিটি row-তে থাকা latest GPA বেছে নেওয়া হয়।

## অনলাইনে deploy

Render Web Service-এ repository root-কে Root Directory দিন:
- Build Command: `npm --prefix api install && pip install -r parser/requirements.txt`
- Start Command: `npm --prefix api start`
- Environment Variables: `MONGO_URI`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `NODE_ENV=production` (প্রয়োজন হলে `PYTHON_BIN`)

Login-এর পর ৮ ঘণ্টার HttpOnly session cookie দিয়ে upload অনুমোদিত হয়। Logout করলে session বাতিল হয়; সার্ভার restart হলে active session-গুলোও মুছে যায়।
Production deploy-এ hosting provider-এর secret/environment-variable settings-এ credentials দিন; `.env` GitHub-এ upload করবেন না। `NODE_ENV=production` secure cookie চালু করে, তাই production site অবশ্যই HTTPS-এ চালান।

## সতর্কতা

- `.env` ফাইল, admin password বা connection string কখনো GitHub-এ দেবেন না।
- MongoDB Atlas-এ সীমিত IP access ও least-privilege database user ব্যবহার করুন।
- এটি অনানুষ্ঠানিক রেজাল্ট দেখার টুল; চূড়ান্ত ফলাফলের জন্য BTEB-র অফিসিয়াল ওয়েবসাইট দেখুন।
