#!/bin/sh
# يبني tailwind.css من الكلاسات المستعملة في index.html و js/
# الأداة: Tailwind v3.4.17 الرسمية (ملف واحد) في ~/.cache/fastpay/tailwindcss — خارج المشروع حتى لا تُرفع مع الموقع
set -e
cd "$(dirname "$0")/.."
TW="$HOME/.cache/fastpay/tailwindcss"
if [ ! -x "$TW" ]; then
    echo "أداة Tailwind غير موجودة: $TW"
    echo "نزّلها من https://github.com/tailwindlabs/tailwindcss/releases/tag/v3.4.17 (tailwindcss-macos-arm64) وضعها هناك ثم chmod +x"
    exit 1
fi
"$TW" -c build/tailwind.config.js -i build/tailwind.input.css -o tailwind.css --minify
