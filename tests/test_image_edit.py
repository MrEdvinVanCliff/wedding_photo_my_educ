import base64
from io import BytesIO
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from image_edit import edit_photo
from main import create_app
from test_api import picture


class ImageEditTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.storage = Path(self.temp.name)
        self.client = self.enterContext(TestClient(create_app(self.storage)))
        self.enterContext(patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}))

    def process(self, content=None, style="royal"):
        return self.client.post("/api/photos/process", data={"photoStyle": style},
                                files={"photo": ("photo.png", content if content is not None else picture(), "image/png")})

    def test_processing_is_preview_only_then_result_can_be_published(self):
        result = picture((90, 120), "JPEG")
        with patch("image_edit.edit_photo", return_value=result) as edit:
            processed = self.process()
        self.assertEqual(processed.status_code, 200, processed.text)
        self.assertEqual(processed.content, result)
        self.assertEqual(processed.headers["content-type"], "image/jpeg")
        self.assertEqual(processed.headers["cache-control"], "no-store")
        self.assertEqual(self.client.get("/api/posts").json(), [])
        self.assertEqual(list((self.storage / "uploads").iterdir()), [])
        self.assertFalse(list((self.storage / "data").glob("process-*")))
        self.assertEqual(edit.call_args.args[1], "royal")
        saved = self.client.post("/api/posts", data={"authorName": "Тест", "uploadMode": "advanced", "photoStyle": "royal"},
                                 files={"photos": ("processed.jpg", processed.content, "image/jpeg")})
        self.assertEqual(saved.status_code, 201)
        original = saved.json()["photos"][0]["originalUrl"]
        self.assertEqual(self.client.get(original).content, result)

    def test_validation_and_missing_key_never_call_openai(self):
        with patch("image_edit.edit_photo") as edit:
            self.assertEqual(self.process(style="unknown").status_code, 422)
            self.assertEqual(self.process(content=b"bad image").status_code, 422)
            with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
                self.assertEqual(self.process().status_code, 503)
            edit.assert_not_called()

    def test_heif_and_normalized_jpeg_reach_editor_as_webp(self):
        raw = picture((90, 120), "HEIF")
        normalized = self.client.post("/api/photos/normalize", files={
            "photo": ("icloud.HEIF", raw, "application/octet-stream")})
        self.assertEqual(normalized.status_code, 200)

        def inspect_input(path, style):
            with Image.open(path) as image:
                self.assertEqual(image.format, "WEBP")
                self.assertEqual(image.size, (90, 120))
            return picture((90, 120), "JPEG")

        with patch("image_edit.edit_photo", side_effect=inspect_input) as edit:
            for name, content, mime in (("icloud.HEIF", raw, "image/heif"),
                                        ("icloud.jpg", normalized.content, "image/jpeg")):
                with self.subTest(filename=name):
                    result = self.client.post("/api/photos/process", data={"photoStyle": "royal"},
                                              files={"photo": (name, content, mime)})
                    self.assertEqual(result.status_code, 200, result.text)
                    self.assertEqual(result.headers["content-type"], "image/jpeg")
            self.assertEqual(edit.call_count, 2)

    def test_failure_cleans_temporary_files_and_releases_slot(self):
        with patch("image_edit.edit_photo", side_effect=HTTPException(502, "unavailable")):
            self.assertEqual(self.process().status_code, 502)
        with patch("image_edit.edit_photo", return_value=picture(format="JPEG")):
            self.assertEqual(self.process().status_code, 200)
        self.assertFalse(list((self.storage / "data").glob("process-*")))

    def test_openai_multipart_contract_and_output_decoding(self):
        source = self.storage / "source.webp"
        source.write_bytes(picture(format="WEBP"))
        real_client = httpx.Client
        requests = []

        def respond(request):
            requests.append(request)
            body = request.read()
            self.assertIn(b'name="image"', body)
            self.assertIn(b"image/webp", body)
            self.assertIn(b"gpt-image-2.5-sunburst", body)
            self.assertEqual(request.headers["authorization"], "Bearer test-key")
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(picture()).decode()}]})

        with patch("image_edit.httpx.Client", return_value=real_client(transport=httpx.MockTransport(respond))):
            result = edit_photo(source, "cartoon")
        with Image.open(BytesIO(result)) as image:
            self.assertEqual(image.format, "JPEG")
        self.assertEqual(len(requests), 1)

    def test_provider_errors_hide_details_and_are_not_retried(self):
        source = self.storage / "source.webp"
        source.write_bytes(picture(format="WEBP"))
        real_client = httpx.Client
        for provider_status, expected in ((401, 503), (429, 429), (500, 502), (400, 422)):
            calls = []
            def respond(request):
                calls.append(request)
                return httpx.Response(provider_status, json={"error": "sensitive-provider-details"})
            with self.subTest(status=provider_status), patch("image_edit.httpx.Client", return_value=real_client(transport=httpx.MockTransport(respond))):
                with self.assertRaises(HTTPException) as error:
                    edit_photo(source, "mafia")
                self.assertEqual(error.exception.status_code, expected)
                self.assertNotIn("sensitive", error.exception.detail)
            self.assertEqual(len(calls), 1)
