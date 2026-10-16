#!/bin/sh
# يجهّز مجلد dist/ فيه ملفات الموقع بس (بدون السكربت ولا ملفات البناء ولا الملاحظات)، جاهز للرفع على Netlify أو GitHub Pages
# الاستعمال: sh build/publish.sh ثم اسحب مجلد dist على https://app.netlify.com/drop
set -e
cd "$(dirname "$0")/.."
sh build/build-css.sh
rm -rf dist
mkdir -p dist
cp -R index.html styles.css tailwind.css manifest.webmanifest js assets dist/
echo "جاهز: $(pwd)/dist"
