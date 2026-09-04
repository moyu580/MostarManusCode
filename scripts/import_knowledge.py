"""
Import Markdown files into pgvector with an OpenAI-compatible embedding API.

This script is optional. The Spring Boot app can also index knowledge through:
POST /api/knowledge/reindex

Dependencies:
pip install psycopg2-binary requests minio
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path

import psycopg2
import requests
from minio import Minio

KNOWLEDGE_DIR = Path(os.getenv("KNOWLEDGE_DIR", "data/knowledge"))

def build_pg_config() -> dict[str, object]:
    password = os.getenv("PGPASSWORD", "").strip()
    if not password:
        raise RuntimeError("PGPASSWORD is not set.")
    return {
        "host": os.getenv("PGHOST", "localhost"),
        "port": int(os.getenv("PGPORT", "5432")),
        "dbname": os.getenv("PGDATABASE", "mostar"),
        "user": os.getenv("PGUSER", "mostar"),
        "password": password,
    }
VECTOR_TABLE = os.getenv("VECTOR_TABLE", "knowledge_vector_store")
VECTOR_DIMENSIONS = int(os.getenv("VECTOR_DIMENSIONS", "1536"))

OPENAI_API_KEY = os.getenv("EMBEDDING_API_KEY", os.getenv("SILICONFLOW_API_KEY", os.getenv("OPENAI_API_KEY", "")))
OPENAI_BASE_URL = os.getenv("EMBEDDING_BASE_URL", os.getenv("OPENAI_BASE_URL", "https://api.siliconflow.cn/v1")).rstrip("/")
OPENAI_EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "netease-youdao/bce-embedding-base_v1")
OPENAI_EMBEDDING_DIMENSIONS = os.getenv("OPENAI_EMBEDDING_DIMENSIONS", "").strip()
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "25"))

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "").strip()
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "").strip()
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "knowledge-base")
MINIO_USE_SSL = os.getenv("MINIO_USE_SSL", "false").lower() == "true"

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "450"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "50"))


def parse_front_matter(content: str) -> tuple[dict[str, str], str]:
    metadata: dict[str, str] = {}
    body = content
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            for line in parts[1].strip().splitlines():
                if ":" in line:
                    key, val = line.split(":", 1)
                    metadata[key.strip()] = val.strip().strip('"')
            body = parts[2].strip()
    return metadata, body


def chunk_by_paragraph(text: str, max_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        if len(para) > max_size:
            if current:
                chunks.append(current.strip())
                current = ""
            sentences = re.split(r"(。|！|？|\.|!|\?)", para)
            buf = ""
            for i in range(0, len(sentences), 2):
                sent = sentences[i] + (sentences[i + 1] if i + 1 < len(sentences) else "")
                if len(buf) + len(sent) > max_size and buf:
                    chunks.append(buf.strip())
                    buf = sent
                else:
                    buf += sent
            if buf.strip():
                current = buf
            continue

        if len(current) + len(para) + 2 > max_size and current:
            chunks.append(current.strip())
            current = current[-overlap:] + "\n\n" + para if overlap > 0 and len(current) > overlap else para
        else:
            current = current + "\n\n" + para if current else para

    if current.strip():
        chunks.append(current.strip())

    return chunks if chunks else [text[:max_size]]


def get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    all_embeddings: list[list[float]] = []
    url = f"{OPENAI_BASE_URL}/embeddings"

    for i in range(0, len(texts), EMBEDDING_BATCH_SIZE):
        batch = texts[i:i + EMBEDDING_BATCH_SIZE]
        payload: dict[str, object] = {
            "model": OPENAI_EMBEDDING_MODEL,
            "input": batch,
        }
        if OPENAI_EMBEDDING_DIMENSIONS:
            payload["dimensions"] = int(OPENAI_EMBEDDING_DIMENSIONS)

        resp = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        embeddings_by_index = sorted(data["data"], key=lambda item: item["index"])
        all_embeddings.extend(item["embedding"] for item in embeddings_by_index)

        if i + EMBEDDING_BATCH_SIZE < len(texts):
            time.sleep(0.5)

    return all_embeddings


def ensure_table(cur) -> None:
    cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {VECTOR_TABLE} (
            id uuid PRIMARY KEY,
            content text,
            metadata json,
            embedding vector({VECTOR_DIMENSIONS})
        );
    """)


def stable_uuid(value: str) -> str:
    digest = hashlib.md5(value.encode("utf-8")).hexdigest()
    return f"{digest[:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:]}"


def upsert_chunks(cur, file_path: Path, title: str, category: str, chunks: list[str], embeddings: list[list[float]]) -> None:
    source_path = str(file_path.resolve())
    content_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
    for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
        chunk_id = f"{source_path}:{i}:{content_hash}"
        doc_id = stable_uuid(chunk_id)
        emb_str = "[" + ",".join(f"{v:.8f}" for v in emb) + "]"
        metadata = json.dumps({
            "type": "knowledge",
            "source_type": "local",
            "source_path": source_path,
            "doc_title": title,
            "category": category,
            "chunk_index": i,
            "chunk_id": chunk_id,
            "content_hash": content_hash,
        }, ensure_ascii=False)

        cur.execute(f"""
            INSERT INTO {VECTOR_TABLE} (id, content, metadata, embedding)
            VALUES (%s::uuid, %s, %s::json, %s::vector)
            ON CONFLICT (id) DO UPDATE SET
                content = EXCLUDED.content,
                metadata = EXCLUDED.metadata,
                embedding = EXCLUDED.embedding
        """, (doc_id, chunk, metadata, emb_str))


def upload_to_minio(files: list[Path]) -> None:
    if not MINIO_ACCESS_KEY or not MINIO_SECRET_KEY:
        print("[MinIO] skipped: MINIO_ACCESS_KEY/MINIO_SECRET_KEY are not set")
        return
    client = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=MINIO_USE_SSL,
    )
    if not client.bucket_exists(MINIO_BUCKET):
        client.make_bucket(MINIO_BUCKET)
        print(f"[MinIO] Created bucket: {MINIO_BUCKET}")

    for file_path in files:
        client.fput_object(MINIO_BUCKET, f"knowledge/{file_path.name}", str(file_path))
        print(f"[MinIO] Uploaded: knowledge/{file_path.name}")


def guess_category(file_name: str, content_head: str) -> str:
    category_keywords = {
        "考研": ["考研", "备考", "408"],
        "校招": ["校招", "秋招", "Offer", "简历", "面试", "八股", "实习", "转正"],
        "职业规划": ["就业", "职业", "选择", "筹码", "逆袭", "竞争力"],
        "技术方向": ["前端", "Java", "嵌入式", "测试", "运维", "算法", "AI", "数据"],
        "海外深造": ["留学", "雅思", "海外"],
        "行业洞察": ["芯片", "新能源", "具身智能", "中国制造"],
    }
    combined = file_name + content_head
    scores = {cat: sum(1 for kw in kws if kw in combined) for cat, kws in category_keywords.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "general"


def main() -> None:
    md_files = sorted(
        path for path in KNOWLEDGE_DIR.rglob("*.md")
        if not path.name.startswith("知识库部署指南")
    )
    print(f"Found {len(md_files)} Markdown files in {KNOWLEDGE_DIR}")

    all_records: list[tuple[Path, str, str, str]] = []
    for file_path in md_files:
        content = file_path.read_text(encoding="utf-8")
        metadata, body = parse_front_matter(content)
        title = metadata.get("title", file_path.stem)
        category = metadata.get("category", guess_category(file_path.name, body[:500]))
        chunks = chunk_by_paragraph(body)
        all_records.extend((file_path, title, category, chunk) for chunk in chunks)
        print(f"  {file_path.name}: {len(chunks)} chunks")

    texts = [record[3] for record in all_records]
    print(f"\nEmbedding {len(texts)} chunks with {OPENAI_EMBEDDING_MODEL} via {OPENAI_BASE_URL}")
    embeddings = get_embeddings_batch(texts)
    if len(embeddings) != len(all_records):
        raise RuntimeError(f"Embedding count mismatch: {len(embeddings)} != {len(all_records)}")

    conn = psycopg2.connect(**build_pg_config())
    try:
        cur = conn.cursor()
        ensure_table(cur)

        offset = 0
        for file_path in md_files:
            file_records = [record for record in all_records if record[0] == file_path]
            if not file_records:
                continue
            file_embeddings = embeddings[offset:offset + len(file_records)]
            offset += len(file_records)
            chunks = [record[3] for record in file_records]
            upsert_chunks(cur, file_path, file_records[0][1], file_records[0][2], chunks, file_embeddings)

        conn.commit()
        cur.execute(f"""
            SELECT count(*) AS total,
                   count(DISTINCT metadata->>'source_path') AS files
            FROM {VECTOR_TABLE}
            WHERE metadata->>'type' = 'knowledge'
        """)
        total, files = cur.fetchone()
        print(f"\npgvector import complete: {total} chunks from {files} files")
    finally:
        conn.close()

    try:
        upload_to_minio(md_files)
    except Exception as exc:
        print(f"\nMinIO upload failed, pgvector import is not affected: {exc}")


if __name__ == "__main__":
    main()
