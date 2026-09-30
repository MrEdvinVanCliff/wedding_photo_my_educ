"""Small PostgreSQL and Cloudflare R2 adapters; credentials stay on the server."""

from contextlib import contextmanager
import logging
import mimetypes
import re

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
import psycopg
from psycopg.rows import dict_row
from fastapi import HTTPException


class PostgresConnection:
    def __init__(self, db):
        self.db = db

    def execute(self, sql, params=()):
        # Application queries use SQLite placeholders; no user SQL is accepted.
        return self.db.execute(sql.replace("?", "%s"), params)

    def executescript(self, sql):
        for statement in sql.split(";"):
            if statement.strip():
                self.db.execute(statement)


@contextmanager
def postgres_connection(url):
    with psycopg.connect(url, sslmode="require", connect_timeout=15,
                         row_factory=dict_row, prepare_threshold=None) as db:
        # A separate schema keeps tables outside Supabase's public Data API.
        db.execute("SET search_path TO wedding")
        yield PostgresConnection(db)


def initialize_postgres(url):
    with postgres_connection(url) as db:
        db.execute("CREATE SCHEMA IF NOT EXISTS wedding")
        db.execute("REVOKE ALL ON SCHEMA wedding FROM PUBLIC")


class CloudPhotos:
    def __init__(self, account_id, access_key, secret_key, bucket):
        if not re.fullmatch(r"[a-fA-F0-9]{32}", account_id):
            raise RuntimeError("R2_ACCOUNT_ID must be the 32-character Cloudflare account ID")
        self.bucket = bucket
        self.client = boto3.client(
            "s3", endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key, aws_secret_access_key=secret_key,
            region_name="auto",
            config=Config(signature_version="s3v4", connect_timeout=10, read_timeout=120,
                          retries={"max_attempts": 2, "mode": "standard"},
                          s3={"addressing_style": "path"},
                          request_checksum_calculation="when_required",
                          response_checksum_validation="when_required"),
        )

    def check_bucket(self):
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except (BotoCoreError, ClientError):
            raise RuntimeError("Cannot access R2 bucket; check bucket name and R2 credentials") from None

    def url(self, filename, download=False):
        params = {"Bucket": self.bucket, "Key": filename}
        if download:
            params["ResponseContentDisposition"] = f'attachment; filename="wedding-{filename}"'
            params["ResponseContentType"] = "application/octet-stream"
        return self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=3600)

    def upload(self, path):
        try:
            with path.open("rb") as file:
                self.client.put_object(
                    Bucket=self.bucket, Key=path.name, Body=file,
                    ContentLength=path.stat().st_size,
                    ContentType=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                    CacheControl="private, max-age=3600", StorageClass="STANDARD",
                )
        except (BotoCoreError, ClientError):
            raise HTTPException(503, "Не вдалося зберегти фото онлайн. Спробуйте ще раз.") from None

    def delete(self, filenames):
        # Separate deletes are free on R2; attempt every object even if one fails.
        for filename in filenames:
            try:
                self.client.delete_object(Bucket=self.bucket, Key=filename)
            except (BotoCoreError, ClientError):
                logging.getLogger(__name__).error("R2 cleanup failed; check bucket for orphan files")
