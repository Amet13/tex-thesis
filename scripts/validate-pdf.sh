#!/usr/bin/env bash
# Validate a compiled PDF for structural integrity and expected content.
# Usage: bash scripts/validate-pdf.sh <path-to-pdf>

set -euo pipefail

pdf="${1:?Usage: validate-pdf.sh <path-to-pdf>}"
name="$(basename "$pdf")"
errors=0

# --- Check file exists and is non-empty ---
if [ ! -s "$pdf" ]; then
    echo "FAIL [$name]: file missing or empty"
    exit 1
fi

# --- Check structural validity ---
if command -v qpdf >/dev/null 2>&1; then
    if ! qpdf --check "$pdf" >/dev/null 2>&1; then
        echo "FAIL [$name]: qpdf structural check failed"
        errors=$((errors + 1))
    fi
fi

# --- Check page count ---
if command -v pdfinfo >/dev/null 2>&1; then
    pages=$(pdfinfo "$pdf" | awk '/^Pages:/{print $2}')
    if [ "$pages" -lt 3 ]; then
        echo "FAIL [$name]: only $pages page(s) — expected at least 3"
        errors=$((errors + 1))
    fi
fi

# --- Check for text content (not an empty/blank PDF) ---
if command -v pdftotext >/dev/null 2>&1; then
    text_length=$(pdftotext "$pdf" - 2>/dev/null | wc -c)
    if [ "$text_length" -lt 100 ]; then
        echo "FAIL [$name]: extracted text is too short ($text_length chars)"
        errors=$((errors + 1))
    fi
fi

if [ "$errors" -gt 0 ]; then
    echo "FAIL [$name]: $errors check(s) failed"
    exit 1
fi

size=$(du -h "$pdf" | cut -f1)
echo "PASS [$name]: ${pages:-?} pages, ${size}"
