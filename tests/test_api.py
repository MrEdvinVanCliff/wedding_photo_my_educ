"""Run with: python -m unittest discover -s tests -v."""

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from main import MAX_FILE_BYTES, create_app


def picture(size=(120, 80), format="PNG", exif=None):
    buffer = BytesIO()
    with Image.new("RGB", size, "#3c6e71") as image:
        image.save(buffer, format=format, **({"exif": exif} if exif else {}))
    return buffer.getvalue()


class AlbumTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.storage = Path(self.temporary.name)
        self.client = TestClient(create_app(self.storage)).__enter__()
        self.device = str(uuid4())
        self.headers = {"X-Device-Id": self.device}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temporary.cleanup()

    def upload(self, count=1, data=None, files=None):
        return self.client.post("/api/posts", headers=self.headers,
            data=data if data is not None else {"authorName": "Діана"},
            files=files if files is not None else [
                ("photos", (f"photo-{i}.png", picture((80, 160) if i % 2 else (160, 90)), "image/png"))
                for i in range(count)
            ])

    def posts(self):
        return self.client.get("/api/posts", headers=self.headers).json()

    def like(self, post_id, device=None, **extra):
        return self.client.post(f"/api/posts/{post_id}/like", json={"deviceId": device or self.device, **extra})

    def test_six_photos_create_one_persistent_post_in_order(self):
        response = self.upload(6, {"authorName": "  Діана  ", "comment": " Чудове\nвесілля! "})
        self.assertEqual(response.status_code, 201, response.text)
        post = response.json()
        self.assertEqual(len(self.posts()), 1)
        self.assertEqual(len(post["photos"]), 6)
        self.assertEqual(post["authorName"], "Діана")
        self.assertEqual(post["comment"], "Чудове весілля!")
        self.assertFalse(post["isAnonymous"])
        for i, photo in enumerate(post["photos"]):
            self.assertEqual((photo["width"], photo["height"]), (80, 160) if i % 2 else (160, 90))
            for key in ("url", "thumbnailUrl", "originalUrl"):
                fetched = self.client.get(photo[key])
                self.assertEqual(fetched.status_code, 200)
                self.assertTrue((self.storage / photo[key].lstrip("/")).is_file())
        self.like(post["id"], liked=True)
        self.client.__exit__(None, None, None)
        self.client = TestClient(create_app(self.storage)).__enter__()
        restored = self.posts()[0]
        self.assertEqual(restored["id"], post["id"])
        self.assertEqual(restored["photos"], post["photos"])
        self.assertEqual(restored["likesCount"], 1)
        self.assertTrue(restored["likedByDevice"])

    def test_anonymous_discards_author_and_comment_is_optional(self):
        response = self.upload(data={"isAnonymous": "true", "authorName": "Приховане ім’я"})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["isAnonymous"])
        self.assertEqual(response.json()["authorName"], "")
        self.assertEqual(response.json()["comment"], "")

    def test_like_toggle_and_one_like_per_device(self):
        post_id = self.upload().json()["id"]
        self.assertEqual(self.like(post_id).json()["likesCount"], 1)
        self.assertEqual(self.like(post_id).json()["likesCount"], 0)
        self.like(post_id, liked=True)
        self.like(post_id, liked=True)
        other = str(uuid4())
        self.assertEqual(self.like(post_id, other, liked=True).json()["likesCount"], 2)
        self.assertTrue(self.posts()[0]["likedByDevice"])
        stranger = self.client.get("/api/posts", headers={"X-Device-Id": str(uuid4())}).json()[0]
        self.assertEqual(stranger["likesCount"], 2)
        self.assertFalse(stranger["likedByDevice"])
        self.assertEqual(self.like(post_id, liked=False).json()["likesCount"], 1)

    def test_concurrent_like_intent_cannot_duplicate(self):
        post_id = self.upload().json()["id"]
        with ThreadPoolExecutor(max_workers=6) as executor:
            responses = list(executor.map(lambda _: self.like(post_id, liked=True), range(12)))
        self.assertTrue(all(r.status_code == 200 for r in responses))
        self.assertEqual(self.posts()[0]["likesCount"], 1)

    def test_upload_retry_does_not_duplicate_post_or_files(self):
        data = {"authorName": "Тест", "submissionId": str(uuid4())}
        first = self.upload(2, data).json()
        second = self.upload(2, data).json()
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self.posts()), 1)
        self.assertEqual(len(list((self.storage / "uploads").iterdir())), 6)

    def test_invalid_batch_is_atomic(self):
        response = self.upload(files=[
            ("photos", ("valid.png", picture(), "image/png")),
            ("photos", ("fake.jpg", b"not an image", "image/jpeg")),
        ])
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.posts(), [])
        self.assertEqual(list((self.storage / "uploads").iterdir()), [])
        self.assertFalse(list((self.storage / "data").glob("upload-*")))

    def test_file_count_size_and_required_name(self):
        self.assertEqual(self.upload(13).status_code, 422)
        self.assertEqual(self.upload(data={}).status_code, 422)
        self.assertEqual(self.upload(data={"authorName": " "}).status_code, 422)
        self.assertEqual(self.upload(data={"authorName": "Тест", "comment": "x" * 281}).status_code, 422)
        self.assertEqual(self.upload(files=[("photos", ("empty.png", b"", "image/png"))]).status_code, 422)
        large = b"x" * (MAX_FILE_BYTES + 1)
        self.assertEqual(self.upload(files=[("photos", ("large.jpg", large, "image/jpeg"))]).status_code, 413)
        self.assertEqual(self.posts(), [])
        self.assertEqual(len(self.upload(12).json()["photos"]), 12)

    def test_phone_orientation_and_heic(self):
        exif = Image.Exif()
        exif[274] = 6
        raw = picture((60, 100), "JPEG", exif)
        response = self.upload(files=[("photos", ("phone.jpg", raw, "image/jpeg"))])
        self.assertEqual(response.status_code, 201)
        photo = response.json()["photos"][0]
        self.assertEqual((photo["width"], photo["height"]), (100, 60))
        self.assertEqual(self.client.get(photo["originalUrl"]).content, raw)
        response = self.upload(files=[("photos", ("phone.heic", picture((90, 120), "HEIF"), "image/heic"))])
        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["photos"][0]["url"].endswith(".webp"))

    def test_untrusted_filenames_and_private_files(self):
        response = self.upload(files=[("photos", ("../../attack.html", picture(), "text/html"))])
        self.assertEqual(response.status_code, 201)  # The image content determines its type.
        photo = response.json()["photos"][0]
        self.assertNotIn("attack", photo["url"])
        self.assertTrue(photo["originalUrl"].endswith(".png"))
        for url in ("/main.py", "/.git/config", "/data/wedding.sqlite3", "/uploads/%2e%2e/data/wedding.sqlite3"):
            self.assertEqual(self.client.get(url).status_code, 404, url)
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/style.css").status_code, 200)

    def test_invalid_like_and_advanced_mode(self):
        self.assertEqual(self.like(str(uuid4())).status_code, 404)
        self.assertEqual(self.like(str(uuid4()), device="invalid").status_code, 422)
        self.assertEqual(self.upload(2, {"authorName": "Тест", "uploadMode": "advanced"}).status_code, 422)
        response = self.upload(data={"authorName": "Тест", "uploadMode": "advanced", "photoStyle": "royal"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["photoStyle"], "royal")


if __name__ == "__main__":
    unittest.main()
