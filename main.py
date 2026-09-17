"""Local wedding album: uvicorn main:app --host 0.0.0.0 --port 8000 --reload."""

from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
import os
import shutil
import sqlite3
from tempfile import TemporaryDirectory
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
MAX_PHOTOS = 12
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 50_000_000
FORMATS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif", "AVIF": ".avif", "HEIF": ".heic"}
register_heif_opener()


class LikeRequest(BaseModel):
    deviceId: UUID
    # Sending the desired state also makes a retry safe after a lost response.
    liked: bool | None = None


def create_app(storage_dir: Path | None = None) -> FastAPI:
    storage = Path(storage_dir or os.environ.get("WEDDING_STORAGE_DIR", BASE_DIR)).resolve()
    uploads = storage / "uploads"
    data = storage / "data"
    database = data / "wedding.sqlite3"

    @contextmanager
    def connection():
        db = sqlite3.connect(database, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @asynccontextmanager
    async def lifespan(_app):
        data.mkdir(parents=True, exist_ok=True)
        uploads.mkdir(parents=True, exist_ok=True)
        with connection() as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS posts (
                    id TEXT PRIMARY KEY,
                    submission_id TEXT NOT NULL UNIQUE,
                    author_name TEXT NOT NULL,
                    is_anonymous INTEGER NOT NULL CHECK (is_anonymous IN (0, 1)),
                    comment TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    upload_mode TEXT NOT NULL,
                    photo_style TEXT
                );
                CREATE TABLE IF NOT EXISTS photos (
                    id TEXT PRIMARY KEY,
                    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    original_file TEXT NOT NULL,
                    display_file TEXT NOT NULL,
                    thumbnail_file TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    thumbnail_width INTEGER NOT NULL,
                    UNIQUE (post_id, position)
                );
                CREATE TABLE IF NOT EXISTS likes (
                    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                    device_id TEXT NOT NULL,
                    PRIMARY KEY (post_id, device_id)
                );
                CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at DESC, id DESC);
            """)
        yield

    app = FastAPI(title="Весільний альбом", lifespan=lifespan)

    def read_posts(db, device_id="", post_id=None):
        sql = """
            SELECT p.*, (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND device_id = ?) AS liked
            FROM posts AS p
        """
        params = [str(device_id or "")]
        if post_id:
            sql += " WHERE p.id = ?"
            params.append(str(post_id))
        sql += " ORDER BY p.created_at DESC, p.id DESC"
        rows = db.execute(sql, params).fetchall()
        if not rows:
            return []
        # Fetch all photos once, avoiding one database query per card.
        photo_sql = "SELECT * FROM photos"
        photo_params = []
        if post_id:
            photo_sql += " WHERE post_id = ?"
            photo_params.append(str(post_id))
        photo_sql += " ORDER BY position"
        grouped = {}
        for photo in db.execute(photo_sql, photo_params):
            grouped.setdefault(photo["post_id"], []).append({
                "id": photo["id"],
                "url": f'/uploads/{photo["display_file"]}',
                "thumbnailUrl": f'/uploads/{photo["thumbnail_file"]}',
                "originalUrl": f'/uploads/{photo["original_file"]}',
                "width": photo["width"],
                "height": photo["height"],
                "thumbnailWidth": photo["thumbnail_width"],
            })
        return [{
            "id": row["id"],
            "authorName": row["author_name"],
            "isAnonymous": bool(row["is_anonymous"]),
            "comment": row["comment"],
            "createdAt": row["created_at"],
            "likesCount": row["likes_count"],
            "likedByDevice": bool(row["liked"]),
            "uploadMode": row["upload_mode"],
            "photoStyle": row["photo_style"],
            "photos": grouped.get(row["id"], []),
        } for row in rows]

    def prepare_photo(upload, staging):
        photo_id = str(uuid4())
        raw_path = staging / f"{photo_id}.original"
        size = 0
        with raw_path.open("wb") as target:
            while chunk := upload.file.read(64 * 1024):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise HTTPException(413, "Кожне фото має бути не більше 10 МБ.")
                target.write(chunk)
        if not size:
            raise HTTPException(422, "Не можна завантажити порожній файл.")

        try:
            with Image.open(raw_path) as source:
                extension = FORMATS.get(source.format)
                if not extension:
                    raise HTTPException(422, "Підтримуються JPG, PNG, WebP, GIF, AVIF та HEIC/HEIF.")
                if source.width * source.height > MAX_PIXELS:
                    raise HTTPException(422, "Фото перевищує 50 мегапікселів. Виберіть зменшену копію.")
                # Decode the image, apply phone orientation, and keep its full ratio.
                source.seek(0)
                source.load()
                with ImageOps.exif_transpose(source) as oriented:
                    image = oriented.convert("RGBA" if "A" in oriented.getbands() or "transparency" in oriented.info else "RGB")
            original_file = f"{photo_id}{extension}"
            raw_path.rename(staging / original_file)
            display_file = f"{photo_id}-display.webp"
            thumbnail_file = f"{photo_id}-thumb.webp"
            with image:
                image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                width, height = image.size
                # The original is retained; the gallery gets smaller, metadata-free files.
                image.save(staging / display_file, "WEBP", quality=85, method=4, exif=b"", icc_profile=b"", xmp=b"")
                image.thumbnail((480, 480), Image.Resampling.LANCZOS)
                thumbnail_width = image.width
                image.save(staging / thumbnail_file, "WEBP", quality=82, method=4, exif=b"", icc_profile=b"", xmp=b"")
            return (photo_id, original_file, display_file, thumbnail_file, width, height, thumbnail_width)
        except HTTPException:
            raise
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
            raise HTTPException(422, "Не вдалося прочитати фото. Перевірте файл або виберіть інше зображення.") from error

    @app.get("/api/posts")
    def get_posts(device_id: Annotated[UUID | None, Header(alias="X-Device-Id")] = None):
        with connection() as db:
            return read_posts(db, device_id)

    @app.post("/api/posts", status_code=201)
    def create_post(
        photos: Annotated[list[UploadFile], File()],
        authorName: Annotated[str, Form(max_length=100)] = "",
        isAnonymous: Annotated[bool, Form()] = False,
        comment: Annotated[str, Form(max_length=280)] = "",
        submissionId: Annotated[UUID | None, Form()] = None,
        uploadMode: Annotated[str, Form()] = "standard",
        photoStyle: Annotated[str | None, Form()] = None,
        device_id: Annotated[UUID | None, Header(alias="X-Device-Id")] = None,
    ):
        if not 1 <= len(photos) <= MAX_PHOTOS:
            raise HTTPException(422, "Одна публікація має містити від 1 до 12 фото.")
        if not isAnonymous and not authorName.strip():
            raise HTTPException(422, "Введіть ім’я або виберіть анонімний режим.")
        if uploadMode not in {"standard", "advanced"}:
            raise HTTPException(422, "Невідомий режим завантаження.")
        if uploadMode == "advanced" and len(photos) != 1:
            raise HTTPException(422, "У розширеному режимі можна вибрати лише одне фото.")
        if photoStyle and photoStyle not in {"mafia", "cartoon", "royal", "disco"}:
            raise HTTPException(422, "Невідомий стиль фото.")
        submission_id = str(submissionId or uuid4())
        with connection() as db:
            existing = db.execute("SELECT id FROM posts WHERE submission_id = ?", (submission_id,)).fetchone()
            if existing:
                return read_posts(db, device_id, existing["id"])[0]

        post_id = str(uuid4())
        moved = []
        try:
            # Validate the entire batch before making any post or public file visible.
            with TemporaryDirectory(prefix="upload-", dir=data) as temporary:
                staging = Path(temporary)
                prepared = [prepare_photo(photo, staging) for photo in photos]
                with connection() as db:
                    db.execute("BEGIN IMMEDIATE")
                    existing = db.execute("SELECT id FROM posts WHERE submission_id = ?", (submission_id,)).fetchone()
                    if existing:
                        return read_posts(db, device_id, existing["id"])[0]
                    db.execute("INSERT INTO posts VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (
                        post_id, submission_id, "" if isAnonymous else authorName.strip(), int(isAnonymous),
                        " ".join(comment.split()), datetime.now(timezone.utc).isoformat(), uploadMode,
                        photoStyle if uploadMode == "advanced" else None,
                    ))
                    for position, photo in enumerate(prepared):
                        photo_id, original, display, thumbnail, width, height, thumb_width = photo
                        for filename in (original, display, thumbnail):
                            destination = uploads / filename
                            shutil.move(staging / filename, destination)
                            moved.append(destination)
                        db.execute("INSERT INTO photos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (
                            photo_id, post_id, position, original, display, thumbnail, width, height, thumb_width,
                        ))
                    result = read_posts(db, device_id, post_id)[0]
            return result
        except Exception:
            for path in moved:
                path.unlink(missing_ok=True)
            raise
        finally:
            for photo in photos:
                photo.file.close()

    @app.post("/api/posts/{post_id}/like")
    def like_post(post_id: UUID, payload: LikeRequest):
        post_id, device_id = str(post_id), str(payload.deviceId)
        with connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM posts WHERE id = ?", (post_id,)).fetchone():
                raise HTTPException(404, "Публікацію не знайдено.")
            was_liked = bool(db.execute("SELECT 1 FROM likes WHERE post_id = ? AND device_id = ?", (post_id, device_id)).fetchone())
            liked = not was_liked if payload.liked is None else payload.liked
            if liked:
                db.execute("INSERT OR IGNORE INTO likes VALUES (?, ?)", (post_id, device_id))
            else:
                db.execute("DELETE FROM likes WHERE post_id = ? AND device_id = ?", (post_id, device_id))
            count = db.execute("SELECT COUNT(*) FROM likes WHERE post_id = ?", (post_id,)).fetchone()[0]
            return {"id": post_id, "likesCount": count, "likedByDevice": liked}

    @app.middleware("http")
    async def api_headers(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(BASE_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/index.html", include_in_schema=False)
    def index_file():
        return index()

    @app.get("/style.css", include_in_schema=False)
    def stylesheet():
        return FileResponse(BASE_DIR / "style.css", headers={"Cache-Control": "no-cache"})

    @app.get("/script.js", include_in_schema=False)
    def javascript():
        return FileResponse(BASE_DIR / "script.js", headers={"Cache-Control": "no-cache"})

    # Do not mount the repository root: SQLite, .git and configuration stay private.
    app.mount("/assets", StaticFiles(directory=BASE_DIR / "assets"), name="assets")
    app.mount("/uploads", StaticFiles(directory=uploads, check_dir=False), name="uploads")
    return app


app = create_app()
