"""Server-side OpenAI image edits. No credentials or provider errors reach the browser."""

import base64
import binascii
from io import BytesIO
import os

import httpx
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

STYLE_PROMPTS = {
    "mafia": "Elegant 1920s wedding cinema: tailored evening suits, glamorous vintage dresses, warm film lighting and an art-deco reception. No weapons, violence or text.",
    "cartoon": "A charming high-quality 3D animated wedding illustration, expressive recognizable faces, soft lighting and joyful colors. No text.",
    "royal": "A luxurious royal wedding portrait: tasteful crowns, elegant formal attire, crystal glasses and a palace reception with warm golden light. No text.",
    "disco": "A joyful 1980s disco wedding: festive retro outfits, a mirror ball, pink and violet lights, subtle film grain. No text.",
}


def edit_photo(path, style):
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "Обробку фото ще не підключено. Адміністратор має додати ключ OpenAI на сервері.")
    prompt = (
        "Edit this wedding photograph in the following style. Preserve the number of people, "
        "their identities, recognizable facial features, skin tones, ages, pose and composition. "
        "Keep the result celebratory and suitable for a family wedding album. " + STYLE_PROMPTS[style]
    )
    try:
        # Do not automatically retry a paid image edit after an ambiguous network failure.
        with httpx.Client(timeout=httpx.Timeout(240, connect=15)) as client, path.open("rb") as source:
            response = client.post(
                "https://api.openai.com/v1/images/edits",
                headers={"Authorization": f"Bearer {key}"},
                data={"model": os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2.5-sunburst"),
                      "prompt": prompt, "n": "1", "size": "auto", "quality": "medium",
                      "output_format": "jpeg"},
                files={"image": ("wedding.webp", source, "image/webp")},
            )
    except httpx.TimeoutException:
        raise HTTPException(504, "Обробка триває надто довго. Результат не отримано; повторне натискання запустить нову обробку.") from None
    except httpx.RequestError:
        raise HTTPException(502, "Втрачено зв’язок із сервісом обробки. Повторне натискання запустить нову обробку.") from None
    if response.status_code in (401, 403):
        raise HTTPException(503, "OpenAI не дозволив обробку. Адміністратор має перевірити ключ і доступ до моделі.")
    if response.status_code == 429:
        raise HTTPException(429, "Досягнуто ліміту OpenAI. Спробуйте пізніше або зверніться до адміністратора.")
    if response.status_code == 400:
        raise HTTPException(422, "Не вдалося обробити це фото в обраному стилі. Спробуйте інше фото або стиль.")
    if not response.is_success:
        raise HTTPException(502, "Сервіс обробки тимчасово недоступний. Спробуйте пізніше.")
    try:
        encoded = response.json()["data"][0]["b64_json"]
        if len(encoded) > 28 * 1024 * 1024:
            raise ValueError("Oversized result")
        raw = base64.b64decode(encoded, validate=True)
        with Image.open(BytesIO(raw)) as image:
            if image.width * image.height > 50_000_000:
                raise ValueError("Oversized image")
            image.load()
            with image.convert("RGB") as rgb:
                rgb.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                output = BytesIO()
                rgb.save(output, "JPEG", quality=92)
        result = output.getvalue()
        if len(result) > 10 * 1024 * 1024:
            raise ValueError("Oversized file")
        return result
    except (KeyError, IndexError, TypeError, ValueError, binascii.Error, OSError,
            UnidentifiedImageError, Image.DecompressionBombError):
        raise HTTPException(502, "Сервіс не повернув коректне зображення. Початкове фото залишилося у формі.") from None
