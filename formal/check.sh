#!/usr/bin/env bash
# Model-check the commitment state machine (docs/neutrality.md "How neutrality is tested").
#
# Exits 0 iff
#   - every formal/*.cfg passes (TLC finds no violation), and
#   - every formal/broken/*.cfg fails, with TLC output matching the "\* expect:" line in that config,
#     so each property is shown to bite.
# Prints distinct states, depth and wall time per config. Logs go to reports/formal/ (gitignored).
#
# Tools: TLC from tla2tools.jar (pinned release, sha256-checked) and a Java 11+ runtime. If no working
# java is on PATH, a pinned Eclipse Temurin JRE is fetched from its official GitHub release into
# formal/.tools/ (gitignored). Nothing is installed system-wide.
#
# Usage: formal/check.sh [name-filter]   e.g. formal/check.sh live-   or   formal/check.sh broken/
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
tools="$here/.tools"
logs="$root/reports/formal"
filter="${1:-}"

TLA_VERSION="v1.7.4"
TLA_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
JRE_TAG="jdk-21.0.13+9"
JRE_TAG_URL="jdk-21.0.13%2B9"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

fetch() { # url dest sha
  local tmp="$2.part"
  curl -sSLf --retry 3 -o "$tmp" "$1"
  local got
  got="$(sha256 "$tmp")"
  if [ "$got" != "$3" ]; then
    rm -f "$tmp"
    echo "checksum mismatch for $1: got $got, want $3" >&2
    exit 2
  fi
  mv "$tmp" "$2"
}

mkdir -p "$tools" "$logs"

jar="$tools/tla2tools-$TLA_VERSION.jar"
if [ ! -f "$jar" ]; then
  echo "fetching tla2tools.jar $TLA_VERSION"
  fetch "https://github.com/tlaplus/tlaplus/releases/download/$TLA_VERSION/tla2tools.jar" "$jar" "$TLA_SHA256"
fi

JAVA=""
if [ -n "${JAVA_HOME:-}" ] && "$JAVA_HOME/bin/java" -version >/dev/null 2>&1; then
  JAVA="$JAVA_HOME/bin/java"
elif command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1; then
  JAVA="java"
else
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) jre_os=mac; jre_arch=aarch64; jre_sha=225bab0a09491ef06835488cd942f5d2befa9a0410a2484f0c8bbcf7506ec09a ;;
    Darwin-x86_64) jre_os=mac; jre_arch=x64; jre_sha=c909674b1c10c261b9a3fb7e9c0efebd303e33f88a4fe84be7135b5e2d711f89 ;;
    Linux-x86_64) jre_os=linux; jre_arch=x64; jre_sha=a535a1df9c6284d9618872984e026ae0352d1f7e9e0605425c0e6114f47351dd ;;
    Linux-aarch64) jre_os=linux; jre_arch=aarch64; jre_sha=b1734db7ade49c3f6acc6ae06233b8c2dd90e3e2f00f67000ae1c972aaa64d8c ;;
    *) echo "no java on PATH and no pinned JRE for $(uname -s)-$(uname -m); install Java 11+ and retry" >&2; exit 2 ;;
  esac
  jre_dir="$tools/jre-$JRE_TAG-$jre_os-$jre_arch"
  if [ ! -d "$jre_dir" ]; then
    file="OpenJDK21U-jre_${jre_arch}_${jre_os}_hotspot_${JRE_TAG#jdk-}.tar.gz"
    file="${file/+/_}"
    echo "fetching Temurin JRE $JRE_TAG ($jre_os/$jre_arch)"
    fetch "https://github.com/adoptium/temurin21-binaries/releases/download/$JRE_TAG_URL/$file" "$tools/$file" "$jre_sha"
    mkdir -p "$jre_dir.part"
    tar -xzf "$tools/$file" -C "$jre_dir.part"
    rm -f "$tools/$file"
    mv "$jre_dir.part" "$jre_dir"
  fi
  JAVA="$(find "$jre_dir" -type f -path '*/bin/java' | head -n 1)"
fi

failures=0
printf '%-28s %-6s %12s %6s %10s\n' config result distinct depth wall
run() { # cfg expect-pass(1|0)
  local cfg="$1" want_pass="$2"
  local name="${cfg#"$here"/}"
  name="${name%.cfg}"
  case "$name" in *"$filter"*) ;; *) return 0 ;; esac
  local log="$logs/${name//\//-}.log"
  local meta="$logs/states/${name//\//-}"
  rm -rf "$meta"
  local start end rc
  start="$(date +%s)"
  set +e
  "$JAVA" -XX:+UseParallelGC -Xss16m -cp "$jar" tlc2.TLC -deadlock -workers auto -cleanup \
    -metadir "$meta" -config "$cfg" "$here/Holdback.tla" >"$log" 2>&1
  rc=$?
  set -e
  end="$(date +%s)"
  rm -rf "$meta"
  local distinct depth result
  distinct="$(sed -n 's/.* \([0-9][0-9]*\) distinct states found.*/\1/p' "$log" | tail -n 1)"
  depth="$(sed -n 's/.*depth of the complete state graph search is \([0-9][0-9]*\).*/\1/p' "$log" | tail -n 1)"
  if [ "$want_pass" = 1 ]; then
    if [ "$rc" = 0 ] && grep -q 'Model checking completed. No error has been found.' "$log"; then result=pass; else result=FAIL; failures=$((failures + 1)); fi
  else
    local expect
    expect="$(sed -n 's/^\\\* expect: //p' "$cfg" | head -n 1)"
    if [ -z "$expect" ]; then
      result=NOEXP; failures=$((failures + 1))
    elif [ "$rc" != 0 ] && grep -Eq "$expect" "$log"; then
      result=bites
    else
      result=MISSED; failures=$((failures + 1))
    fi
  fi
  printf '%-28s %-6s %12s %6s %9ss\n' "$name" "$result" "${distinct:--}" "${depth:--}" "$((end - start))"
  if [ "$result" != pass ] && [ "$result" != bites ]; then
    echo "  see $log" >&2
  fi
}

for cfg in "$here"/*.cfg; do run "$cfg" 1; done
for cfg in "$here"/broken/*.cfg; do run "$cfg" 0; done

if [ "$failures" -ne 0 ]; then
  echo "formal: $failures config(s) did not meet expectations" >&2
  exit 1
fi
echo "formal: all configs met expectations"
