#!/usr/bin/env bash
# علامات الإصدارات (Tags): v<رقم الإصدار> على آخر حفظ يحمل ذلك الرقم.
# يشغّله .github/workflows/tags.yml داخل GitHub:
#   tag-versions.sh push <الفرع>   بعد كل رفع: علامة لرقم الإصدار الحالي إن لم توجد.
#                                  في staging و dev تتقدّم العلامة مع الحفظ اللاحق بنفس الرقم (توثيق، إصلاح دالة…).
#                                  في main لا تتحرك علامة موجودة أبداً (فالتراجع Revert لا يغيّرها).
#   tag-versions.sh backfill       مرة واحدة: علامات كل الإصدارات السابقة من تاريخ الفروع الثلاثة.
# لا يحذف أي علامة، ولا يحرّك علامة إلى حفظ ليس بعدها.
set -euo pipefail

ver_at() { { git show "$1:version.json" 2>/dev/null || true; } | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1; }
subject_of() { # عنوان أول حفظ أدخل هذا الرقم
  local v=$1 c=$2 first=$2
  for x in $(git rev-list --no-merges "$c" -- version.json); do [ "$(ver_at "$x")" = "$v" ] && first=$x || break; done
  git log -1 --format=%s "$first"
}
make_tag() { # make_tag <رقم> <حفظ> <يسمح بالتقدّم 0/1>
  local v=$1 c=$2 move=$3 t="v$1"
  if git rev-parse -q --verify "refs/tags/$t" >/dev/null; then
    local cur; cur=$(git rev-list -n1 "$t")
    if [ "$cur" = "$(git rev-parse "$c")" ]; then echo "= $t"; return; fi
    if [ "$move" = 1 ] && git merge-base --is-ancestor "$cur" "$c"; then
      git tag -f -a "$t" -m "$(git tag -l --format='%(contents:subject)' "$t")" "$c" >/dev/null
      git push -q -f origin "refs/tags/$t"; echo "→ $t تقدّمت إلى $(git rev-parse --short "$c")"
    else echo "= $t (باقية على $(git rev-parse --short "$cur"))"; fi
  else
    git tag -a "$t" -m "$(subject_of "$v" "$c")" "$c"
    git push -q origin "refs/tags/$t"; echo "+ $t على $(git rev-parse --short "$c")"
  fi
}

case "${1:-}" in
  push)
    branch=${2:?الفرع}; c=$(git rev-parse HEAD); v=$(ver_at "$c")
    [ -n "$v" ] || { echo "لا يوجد version.json"; exit 0; }
    make_tag "$v" "$c" "$([ "$branch" = main ] && echo 0 || echo 1)" ;;
  backfill)
    declare -A last=()
    refs=(); for b in main staging dev; do git rev-parse -q --verify "origin/$b" >/dev/null && refs+=("origin/$b"); done
    for c in $(git rev-list --topo-order --reverse --no-merges "${refs[@]}"); do
      v=$(ver_at "$c"); [ -n "$v" ] && last[$v]=$c
    done
    for v in "${!last[@]}"; do echo "$v ${last[$v]}"; done | sort -V | while read -r v c; do make_tag "$v" "$c" 0; done ;;
  *) echo "الاستخدام: tag-versions.sh push <الفرع> | backfill"; exit 1 ;;
esac
