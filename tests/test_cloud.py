"""Offline cloud contracts. Live R2/PostgreSQL checks still require deployment."""

from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse
import os
import sqlite3
import unittest

from botocore.stub import ANY, Stubber
from fastapi import HTTPException
from fastapi.testclient import TestClient

from cloud import CloudPhotos
from main import create_app
from test_api import picture


class R2Tests(unittest.TestCase):
    def setUp(self):
        self.photos = CloudPhotos("a" * 32, "test-access", "test-secret", "wedding-photos")

    def test_signed_download_uses_r2_without_exposing_secret(self):
        url = self.photos.url("test.jpg", download=True)
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        self.assertEqual(parsed.hostname, "a" * 32 + ".r2.cloudflarestorage.com")
        self.assertEqual(parsed.path, "/wedding-photos/test.jpg")
        self.assertEqual(params["X-Amz-Expires"], ["3600"])
        self.assertIn("attachment", params["response-content-disposition"][0])
        self.assertNotIn("test-secret", url)

    def test_upload_and_bucket_check_use_s3_contract(self):
        with TemporaryDirectory() as directory, Stubber(self.photos.client) as stub:
            path = Path(directory) / "test.webp"
            path.write_bytes(b"image bytes")
            stub.add_response("head_bucket", {}, {"Bucket": "wedding-photos"})
            stub.add_response("put_object", {}, {
                "Bucket": "wedding-photos", "Key": "test.webp", "Body": ANY,
                "ContentLength": 11, "ContentType": "image/webp",
                "CacheControl": "private, max-age=3600", "StorageClass": "STANDARD",
            })
            self.photos.check_bucket()
            self.photos.upload(path)
            stub.assert_no_pending_responses()

    def test_failed_upload_reports_retryable_error(self):
        with TemporaryDirectory() as directory, Stubber(self.photos.client) as stub:
            path = Path(directory) / "test.jpg"
            path.write_bytes(b"image")
            stub.add_client_error("put_object", service_error_code="AccessDenied", http_status_code=403)
            with self.assertRaises(HTTPException) as raised:
                self.photos.upload(path)
            self.assertEqual(raised.exception.status_code, 503)

    def test_cleanup_continues_after_one_delete_fails(self):
        with Stubber(self.photos.client) as stub:
            stub.add_client_error("delete_object", service_error_code="AccessDenied",
                                  expected_params={"Bucket": "wedding-photos", "Key": "one.jpg"})
            stub.add_response("delete_object", {}, {"Bucket": "wedding-photos", "Key": "two.jpg"})
            with self.assertLogs("cloud", level="ERROR"):
                self.photos.delete(["one.jpg", "two.jpg"])
            stub.assert_no_pending_responses()


class CloudAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        directory = Path(self.temp.name)
        # Use SQLite only as a test double; PostgreSQL locking is not tested here.
        class DatabaseDouble:
            def __init__(self, db):
                self.db = db

            def execute(self, sql, params=()):
                if "pg_advisory_xact_lock" in sql:
                    return self.db.execute("BEGIN IMMEDIATE")
                return self.db.execute(sql, params)

            def executescript(self, sql):
                return self.db.executescript(sql)

        @contextmanager
        def database(_url):
            db = sqlite3.connect(directory / "test.sqlite3")
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys = ON")
            try:
                with db:
                    yield DatabaseDouble(db)
            finally:
                db.close()

        env = {"WEDDING_BACKEND": "cloud", "WEDDING_STORAGE_DIR": str(directory / "scratch"),
               "DATABASE_URL": "test-only", "R2_ACCOUNT_ID": "a" * 32,
               "R2_ACCESS_KEY_ID": "test", "R2_SECRET_ACCESS_KEY": "test", "R2_BUCKET": "test"}
        self.enterContext(patch.dict(os.environ, env))
        self.enterContext(patch("cloud.initialize_postgres"))
        self.enterContext(patch("cloud.postgres_connection", database))
        self.photos = self.enterContext(patch("cloud.CloudPhotos")).return_value
        self.photos.url.return_value = "https://example.invalid/signed-photo"
        self.client = self.enterContext(TestClient(create_app()))
        self.scratch = directory / "scratch"

    def upload(self):
        return self.client.post("/api/posts", data={"authorName": "Тест"},
                                files=[("photos", ("test.png", picture(), "image/png"))])

    def test_upload_media_and_download_without_local_persistence(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.text)
        photo = response.json()["photos"][0]
        self.assertEqual(self.photos.upload.call_count, 3)
        self.assertEqual(list((self.scratch / "uploads").iterdir()), [])
        self.assertFalse(list((self.scratch / "data").iterdir()))
        for field in ("url", "thumbnailUrl", "originalUrl"):
            fetched = self.client.get(photo[field], follow_redirects=False)
            self.assertEqual(fetched.status_code, 302)
            self.assertEqual(fetched.headers["cache-control"], "no-store")
        self.assertEqual(self.client.get("/media/unknown.jpg").status_code, 404)
        download = self.client.get(f'/api/photos/{photo["id"]}/download', follow_redirects=False)
        self.assertEqual(download.status_code, 302)
        self.assertTrue(self.photos.url.call_args.kwargs["download"])

    def test_partial_remote_upload_rolls_back_post_and_cleans_files(self):
        self.photos.upload.side_effect = [None, HTTPException(503, "Storage unavailable")]
        self.assertEqual(self.upload().status_code, 503)
        self.assertEqual(self.client.get("/api/posts").json(), [])
        self.assertEqual(len(self.photos.delete.call_args.args[0]), 2)
        self.assertFalse(list((self.scratch / "data").iterdir()))

    def test_incomplete_cloud_config_cannot_fall_back_to_sqlite(self):
        with patch.dict(os.environ, {"R2_SECRET_ACCESS_KEY": ""}):
            with self.assertRaisesRegex(RuntimeError, "R2_SECRET_ACCESS_KEY"):
                create_app()


if __name__ == "__main__":
    unittest.main()
