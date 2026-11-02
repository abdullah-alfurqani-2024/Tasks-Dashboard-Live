#!/bin/sh
# اختبار دوال Edge (admin-users و auth-login و refresh-staging) محلياً على محاكاة لـ Supabase
# التشغيل: sh supabase/tests/functions/run.sh
set -e
cd "$(dirname "$0")"
mkdir -p .build
for f in admin-users auth-login refresh-staging; do
  npx -y esbuild@0.24.0 "../../functions/$f/index.ts" --loader:.ts=ts --format=esm --outfile=".build/$f.mjs" --log-level=warning
done
node harness.mjs
node harness-refresh.mjs
