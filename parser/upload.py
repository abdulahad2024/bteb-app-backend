"""
result.json MongoDB-তে আপলোড করে।

আগে parser ফোল্ডারে .env ফাইল বানান (.env.example দেখুন), তারপর:
    python upload.py "5th-semester-2025"
"""
import json
import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient, UpdateOne

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    sys.exit("MONGO_URI পাওয়া যায়নি। .env ফাইলে দিন।")
if len(sys.argv) < 2:
    sys.exit('ব্যবহার: python upload.py "5th-semester-2025"')

EXAM = sys.argv[1]

col = MongoClient(MONGO_URI)["bteb"]["results"]
col.create_index([("roll", 1), ("exam", 1)], unique=True)

with open("result.json", encoding="utf-8") as f:
    data = json.load(f)

ops = [
    UpdateOne(
        {"roll": roll, "exam": EXAM},
        {"$set": {"roll": roll, "exam": EXAM, **d}},
        upsert=True,
    )
    for roll, d in data.items()
]

for i in range(0, len(ops), 1000):
    col.bulk_write(ops[i : i + 1000])
    print("আপলোড হয়েছে:", min(i + 1000, len(ops)), "/", len(ops))

print("শেষ! Atlas-এ Browse Collections-এ দেখুন।")
