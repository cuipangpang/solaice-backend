import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import json
import os
import re
import hashlib
import struct

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GENERATED_DIR = os.path.join(BASE_DIR, 'generated')
PROCESSED_DIR = os.path.join(BASE_DIR, 'processed')
os.makedirs(PROCESSED_DIR, exist_ok=True)


# ──────────────────────────────────────────────────────────────────────────────
# STEP 1: MERGE
# ──────────────────────────────────────────────────────────────────────────────

FILE_GROUPS = [
    'cat_dialogs.json',
    'cat_extra_A.json', 'cat_extra_B.json', 'cat_extra_C.json',
    'cat_extra_D.json', 'cat_extra_E.json',
    'dog_dialogs.json',
    'dog_extra_A.json', 'dog_extra_B.json', 'dog_extra_C.json', 'dog_extra_D.json',
    'emergency_dialogs.json',
    'emergency_extra_A.json', 'emergency_extra_B.json',
    'image_dialogs.json',
    'image_extra_A.json', 'image_extra_B.json',
    'chronic_dialogs.json',
]

def load_file(fname):
    path = os.path.join(GENERATED_DIR, fname)
    if not os.path.exists(path):
        print(f'  [SKIP] {fname} not found')
        return []
    with open(path, 'r', encoding='utf-8') as f:
        d = json.load(f)
    arr = d if isinstance(d, list) else d.get('data', d.get('dialogs', []))
    return arr

print('=' * 60)
print('STEP 1: MERGE')
print('=' * 60)

merged = []
for fname in FILE_GROUPS:
    records = load_file(fname)
    for r in records:
        r['source_file'] = fname
    merged.extend(records)
    print(f'  {fname:35s} {len(records):4d} 조')

merged_path = os.path.join(PROCESSED_DIR, 'merged_raw.json')
with open(merged_path, 'w', encoding='utf-8') as f:
    json.dump(merged, f, ensure_ascii=False, indent=2)

print(f'\n합계: {len(merged)} 조 → merged_raw.json 저장 완료')


# ──────────────────────────────────────────────────────────────────────────────
# STEP 2: FILTER
# ──────────────────────────────────────────────────────────────────────────────

print()
print('=' * 60)
print('STEP 2: FILTER')
print('=' * 60)

REFUSAL_PATTERNS = [
    '죄송합니다 저는 AI',
    '죄송합니다, 저는 AI',
    '답변드리기 어렵',
    '죄송합니다만 저는',
    '저는 AI이므로',
]

def get_gpt_text(record):
    convs = record.get('conversations', [])
    parts = [c.get('value', '') for c in convs if c.get('from') == 'gpt']
    return ' '.join(parts)

def korean_ratio(text):
    if not text:
        return 0.0
    korean = sum(1 for c in text if '\uAC00' <= c <= '\uD7A3')
    return korean / len(text)

reasons = {
    'too_short': 0,
    'too_long': 0,
    'low_korean': 0,
    'refusal': 0,
    'dosage': 0,
    'bad_format': 0,
}

filtered = []
for record in merged:
    convs = record.get('conversations')

    # bad format
    if not isinstance(convs, list) or len(convs) == 0:
        reasons['bad_format'] += 1
        continue

    gpt_text = get_gpt_text(record)

    # length check
    if len(gpt_text) < 100:
        reasons['too_short'] += 1
        continue
    if len(gpt_text) > 2000:
        reasons['too_long'] += 1
        continue

    # korean ratio
    if korean_ratio(gpt_text) < 0.30:
        reasons['low_korean'] += 1
        continue

    # refusal
    if any(p in gpt_text for p in REFUSAL_PATTERNS):
        reasons['refusal'] += 1
        continue

    # dosage pattern \d+mg/kg
    if re.search(r'\d+\s*mg/kg', gpt_text, re.IGNORECASE):
        reasons['dosage'] += 1
        continue

    filtered.append(record)

filtered_path = os.path.join(PROCESSED_DIR, 'filtered.json')
with open(filtered_path, 'w', encoding='utf-8') as f:
    json.dump(filtered, f, ensure_ascii=False, indent=2)

print(f'  필터 전: {len(merged)} 조')
print(f'  필터 후: {len(filtered)} 조  (삭제: {len(merged) - len(filtered)} 조)')
print()
print('  삭제 사유별:')
for k, v in reasons.items():
    if v > 0:
        print(f'    {k:15s}: {v} 조')


# ──────────────────────────────────────────────────────────────────────────────
# STEP 3: MINHASH DEDUPLICATION
# ──────────────────────────────────────────────────────────────────────────────

print()
print('=' * 60)
print('STEP 3: MINHASH DEDUP (128 hashes, Jaccard > 0.85)')
print('=' * 60)

NUM_HASHES = 128
JACCARD_THRESHOLD = 0.85
SHINGLE_SIZE = 3

# Large primes for universal hashing: h(x) = (a*x + b) % p
_P = (1 << 61) - 1  # Mersenne prime

def _mmh3_int(val, seed):
    """Simple but good-enough integer hash via FNV-style mixing."""
    h = seed ^ 0x9e3779b9
    h = (h ^ val) * 0x517cc1b727220a95
    h = ((h ^ (h >> 30)) * 0xbf58476d1ce4e5b9) & 0xFFFFFFFFFFFFFFFF
    h = ((h ^ (h >> 27)) * 0x94d049bb133111eb) & 0xFFFFFFFFFFFFFFFF
    return h ^ (h >> 31)

def get_shingles(text):
    tokens = list(text)  # character-level
    return set(
        hashlib.md5(''.join(tokens[i:i+SHINGLE_SIZE]).encode('utf-8')).digest()[:8]
        for i in range(len(tokens) - SHINGLE_SIZE + 1)
    )

def minhash(shingles):
    if not shingles:
        return [0] * NUM_HASHES
    int_shingles = [struct.unpack('<q', s)[0] for s in shingles]
    sig = []
    for seed in range(NUM_HASHES):
        min_val = min(_mmh3_int(v & 0xFFFFFFFFFFFFFFFF, seed) for v in int_shingles)
        sig.append(min_val)
    return sig

def jaccard_from_sig(s1, s2):
    matches = sum(1 for a, b in zip(s1, s2) if a == b)
    return matches / NUM_HASHES

def get_full_text(record):
    convs = record.get('conversations', [])
    parts = [c.get('value', '') for c in convs if c.get('from') in ('human', 'gpt')]
    return ' '.join(parts)

print(f'  MinHash 서명 계산 중 ({len(filtered)} 조)...')
sigs = []
for i, record in enumerate(filtered):
    text = get_full_text(record)
    shingles = get_shingles(text[:1000])  # first 1000 chars is sufficient
    sigs.append(minhash(shingles))
    if (i + 1) % 200 == 0:
        print(f'    {i+1}/{len(filtered)} 완료...')

print('  중복 검사 중...')
keep = [True] * len(filtered)
dup_count = 0

for i in range(len(filtered)):
    if not keep[i]:
        continue
    for j in range(i + 1, len(filtered)):
        if not keep[j]:
            continue
        sim = jaccard_from_sig(sigs[i], sigs[j])
        if sim >= JACCARD_THRESHOLD:
            keep[j] = False
            dup_count += 1

deduped = [r for r, k in zip(filtered, keep) if k]

deduped_path = os.path.join(PROCESSED_DIR, 'deduped.json')
with open(deduped_path, 'w', encoding='utf-8') as f:
    json.dump(deduped, f, ensure_ascii=False, indent=2)

print(f'  중복 제거 전: {len(filtered)} 조')
print(f'  중복 제거 후: {len(deduped)} 조  (제거: {dup_count} 조)')

# ──────────────────────────────────────────────────────────────────────────────
# FINAL SUMMARY
# ──────────────────────────────────────────────────────────────────────────────

print()
print('=' * 60)
print('최종 통계')
print('=' * 60)
print(f'  merged_raw  : {len(merged):5d} 조')
print(f'  filtered    : {len(filtered):5d} 조  ({len(filtered)/len(merged)*100:.1f}%)')
print(f'  deduped     : {len(deduped):5d} 조  ({len(deduped)/len(merged)*100:.1f}%)')
print()
print('처리 완료!')
