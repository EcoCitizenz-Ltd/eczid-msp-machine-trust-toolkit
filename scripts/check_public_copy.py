"""Public-copy quality gate for the ECZ-ID MSP Machine Trust Toolkit.

Usage: python scripts/check_public_copy.py [--root PATH]

Every failure starts with the id of the rule that produced it:

  encoding            text files are valid UTF-8 with no mojibake markers
  claims              no prohibited claim phrases in public copy
  url-host            every http(s) URL uses https and an allowlisted host
  legacy-route        no legacy MSP surface and no non-canonical Resolver path
  price               no recurring price figures; the one-off GBP 395 Baseline
                      figure is the only price allowed
  credential          no credential-shaped values in any file, whatever its
                      extension, and no key-material files (.pem, .key, id_rsa,
                      .env and similar)
  email               email addresses only at ecocitizenz.com or example domains
  register            the register CSV matches its documented contract
  register-synthetic  the register template holds only synthetic example rows
  readme              README keeps one primary CTA and its required caveats

The two gate sources, scripts/check_public_copy.py and
scripts/test_check_public_copy.py, hold rule definitions and fixtures, so they
are exempt from the claims, price, url-host and legacy-route rules. Like every
other file they are still checked for encoding, credentials and email
addresses.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import html
import io
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

# --------------------------------------------------------------------------
# Scope
# --------------------------------------------------------------------------

# Files with these extensions must be valid UTF-8 and get every content rule.
# Every other file is still scanned for credentials (and, when it decodes as
# UTF-8, for email addresses).
TEXT_EXTS = {".md", ".txt", ".json", ".yml", ".yaml", ".csv", ".html", ".js", ".ts", ".py"}
PROSE_EXTS = {".md", ".txt", ".csv", ".html"}
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv"}
GATE_SOURCES = {"scripts/check_public_copy.py", "scripts/test_check_public_copy.py"}

README_PATH = Path("README.md")
REGISTER_PATH = Path("templates/customer-machine-trust-register.csv")

# --------------------------------------------------------------------------
# Rule data
# --------------------------------------------------------------------------

MOJIBAKE_MARKERS = ["\u00c3", "\u00c2", "\u00e2\u20ac", "\u00ef\u00bf\u00bd", "\ufffd"]

# Matched case-insensitively as whole phrases; a space or hyphen in a phrase
# matches any run of spaces or hyphens.
PROHIBITED_CLAIMS = (
    "certified safe",
    "certified secure",
    "guaranteed safe",
    "guaranteed secure",
    "guaranteed compliant",
    "guaranteed compliance",
    "fully compliant",
    "100% secure",
    "insured",
    "insurable",
    "Microsoft certified",
    "certified by Microsoft",
    "Microsoft endorsed",
    "endorsed by Microsoft",
    "approved by ECZ-ID",
    "ECZ-ID approved",
    "ECZ-ID certified",
    "ECZ-ID verified",
    "court-defensible",
)

# URL allowlist. The base list is ecocitizenz.com and its subdomains,
# resolver.ecocitizenz.org, the GitHub organisation EcoCitizenz-Ltd and the
# example domains. Each other entry exists only because README links it:
#   - the GitHub owner "Ecocitizenz", for the ECZ-ID MCP Verifier repository;
#   - GitHub Marketplace listings whose slug starts with "ecz-id-";
#   - VS Marketplace items published by "ecocitizenz.";
#   - raw GitHub content under EcoCitizenz-Ltd, for the README image.
# Do not add an entry unless README links it, and remove an entry when README
# stops linking it.
EXAMPLE_HOSTS = ("example.com", "example.org")
GITHUB_OWNERS = {"ecocitizenz-ltd", "ecocitizenz"}
GITHUB_MARKETPLACE_PREFIX = "ecz-id-"
VS_MARKETPLACE_PUBLISHER = "ecocitizenz."

LEGACY_ROUTES = (
    (re.compile(r"mcp\.ecocitizenz\.com/msp(?![\w-])", re.I),
     "legacy MSP surface; link https://msp.ecocitizenz.com instead"),
    (re.compile(r"resolver\.ecocitizenz\.org/passport(?![\w-])", re.I),
     "non-canonical Resolver path; use /p/<ECZ-ID>"),
)
RESOLVER_HOST = "resolver.ecocitizenz.org"
RESOLVER_RECORD_PATH = re.compile(r"/p/ECZ-[A-Z]{2}-[A-Z0-9]+/?")
RESOLVER_RECORD_URL = re.compile(r"https://resolver\.ecocitizenz\.org/p/ECZ-[A-Z]{2}-[A-Z0-9]+")

# Prices live in TrustOps. The only figure public copy may carry is the
# one-off GBP Baseline price that the MSP site also publishes. The allowlist
# holds (currency, amount) pairs, so the same amount in another currency fails.
ALLOWED_ONE_OFF_PRICES = {("GBP", "395")}
SYMBOL_CURRENCY = {"\u00a3": "GBP", "$": "USD", "\u20ac": "EUR", "\u00a5": "JPY"}
_CODES = r"GBP|USD|EUR|AUD|CAD|NZD|CHF|JPY"
_AMOUNT = r"\d[\d,]*(?:\.\d+)?"
PRICE_RE = re.compile(
    r"(?:(?P<sym>[\u00a3$\u20ac\u00a5])|\b(?P<code1>" + _CODES + r"))\s*(?P<amt1>" + _AMOUNT + r")"
    r"|(?P<amt2>" + _AMOUNT + r")\s*(?P<code2>" + _CODES + r")\b",
    re.I,
)
WELL_FORMED_AMOUNT = re.compile(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?")
AMOUNT_MULTIPLIER = re.compile(r"\s*(?:k|m|mn|bn|million|billion|thousand)\b", re.I)

# A recurring qualifier anywhere in the rest of the clause after the figure.
_UNITS = (r"(?:month|mo|mth|year|yr|annum|week|wk|quarter|qtr|day|client|customer|tenant"
          r"|seat|user|endpoint|device|machine|estate|site|licen[cs]e)s?")
_VAT = r"(?:(?:\+|plus|ex|exc|excl|inc|incl)\.?\s*)?VAT"
RECURRING_AFTER = re.compile(
    # Directly after the figure, optionally after a VAT note:
    # "/month", "/m", "/client/month", "pm", "p.a.".
    r"^[\s()]*(?:" + _VAT + r"[\s()]*)?"
    r"(?:/\s*(?:[a-z]+\s*/\s*)?(?:m|y|a|q|" + _UNITS + r")\b|p\.?\s?[ma]\b\.?)"
    # Anywhere in the clause: "per month", "every calendar month",
    # "each managed client", "a year", "monthly", "pcm".
    r"|\b(?:per|every|each)\s+(?:[a-z]+\s+)?" + _UNITS + r"\b"
    r"|\ban?\s+(?:month|year|week|quarter)\b"
    r"|\b(?:monthly|annually|annual|yearly|quarterly|weekly|pcm)\b",
    re.I,
)
RECURRING_BEFORE = re.compile(
    r"(?:monthly|per\s+month|annual(?:ly)?|yearly|subscription|recurring)\W+(?:\w+\W+){0,3}$",
    re.I,
)
# A clause ends at ; ! ? or a full stop followed by a space or the end.
SENTENCE_END = re.compile(r"[;!?]|\.(?=\s|\Z)")
# A Markdown line that starts a new block, so the clause above it has ended.
BLOCK_START = re.compile(r"[ \t\r]*(?:$|#{1,6}(?:\s|$)|>|\||[*+-](?:\s|$)|\d+[.)](?:\s|$))")
_TAG_RE = re.compile(r"<[^<>\n]*>")
_EMPHASIS_RE = re.compile(r"[*_`~\\]")

CREDENTIAL_PATTERNS = (
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("secret key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}")),
    ("assigned secret", re.compile(
        r"\b(?:password|passwd|pwd|secret|client_secret|api[_-]?key|access[_-]?token|token)"
        r"\s*[:=]\s*['\"]?[^\s'\",]{6,}",
        re.I,
    )),
)
KEY_FILE_SUFFIXES = {".pem", ".key", ".p8", ".p12", ".pfx", ".ppk", ".jks", ".keystore", ".env"}
KEY_FILE_NAMES = re.compile(
    r"id_(?:rsa|dsa|ecdsa|ed25519)(?:[._-].*)?"
    r"|\.env(?:\.(?!(?:example|sample|template)$).+)?",
    re.I,
)

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b")
ALLOWED_EMAIL_DOMAINS = {"ecocitizenz.com", *EXAMPLE_HOSTS}

URL_RE = re.compile(r"\bhttps?://[^\s<>\"'`()\[\]{}|\\^]+", re.I)
URL_TRAILING = ".,;:!?*_~"

# The register contract. README documents these columns, in this order,
# between the register-columns markers.
REGISTER_COLUMNS = (
    "customer_organisation",
    "customer_owner_role",
    "msp_operator_organisation",
    "accountable_operator_role",
    "machine_kind",
    "machine_identifier",
    "machine_operator_organisation",
    "action_class",
    "customer_authority_reference",
    "operator_delegation_reference",
    "technical_access_reference",
    "customer_confirmation_state",
    "customer_confirmation_reference",
    "evidence_reference",
    "lifecycle_state",
    "revocation_route",
    "last_reviewed",
    "review_due",
    "currentness_state",
    "change_detected",
    "receipt_reference",
    "resolver_recheck_link",
    "next_action",
)
CONTROLLED_VALUES = {
    "machine_kind": {"agent", "mcp", "plugin", "api", "service-workload", "iot", "sdk"},
    "action_class": {"READ", "WRITE", "HIGH-IMPACT-ADMIN"},
    "customer_confirmation_state": {"not_requested", "requested", "confirmed", "declined", "expired"},
    "lifecycle_state": {"active", "suspended", "revoked", "superseded", "expired"},
    "currentness_state": {"current", "stale", "unknown"},
    "change_detected": {"no_change", "changed", "no_baseline", "unknown"},
}
DATE_COLUMNS = ("last_reviewed", "review_due")
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
# Confirmation states in which the customer has responded, so a pointer to the
# customer's own confirmation artefact can exist.
CUSTOMER_RESPONSE_STATES = {"confirmed", "declined", "expired"}
# MSP-authored pointers that can never stand in for the customer's confirmation.
MSP_AUTHORED_REFERENCES = ("customer_authority_reference", "operator_delegation_reference",
                           "technical_access_reference")

# Synthetic-example contract for the shipped template rows.
SYNTHETIC_PREFIXES = {
    "customer_organisation": "Example ",
    "msp_operator_organisation": "Example ",
    "machine_operator_organisation": "Example ",
    "machine_identifier": "example-",
    "customer_authority_reference": "EXAMPLE-",
    "operator_delegation_reference": "EXAMPLE-",
    "technical_access_reference": "EXAMPLE-",
    "customer_confirmation_reference": "EXAMPLE-",
    "evidence_reference": "EXAMPLE-",
    "revocation_route": "EXAMPLE-",
    "receipt_reference": "EXAMPLE-",
}

README_COLUMNS_START = "<!-- register-columns:start -->"
README_COLUMNS_END = "<!-- register-columns:end -->"
README_BOLD_CTA = re.compile(r"\[\*\*[^\]]*\*\*\]\(([^)\s]+)\)")
README_PRIMARY_CTA = ("msp.ecocitizenz.com", "/trust-check")
README_REQUIRED = (
    ("https://msp.ecocitizenz.com/trust-check", "the free Machine Trust Check link"),
    ("https://msp.ecocitizenz.com/audit", "the Baseline link"),
    ("https://resolver.ecocitizenz.org/p/ECZ-GB-RBS1NW", "the canonical operator Resolver link"),
    ("Payment is never verification", "the payment-is-not-verification sentence"),
    ("not, by itself, proof of control", "the Resolver binding caveat"),
    ("are not yet public", "the caveat that machine Capability routes are not yet public"),
    ("templates/customer-machine-trust-register.csv", "the link to the register CSV"),
    ("Keep one register per customer", "the one-register-per-customer warning"),
)

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _line(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def _phrase_pattern(phrase: str) -> re.Pattern[str]:
    words = [re.escape(w) for w in re.split(r"[\s-]+", phrase) if w]
    return re.compile(r"(?<!\w)" + r"[\s-]+".join(words) + r"(?!\w)", re.I)


CLAIM_PATTERNS = tuple((phrase, _phrase_pattern(phrase)) for phrase in PROHIBITED_CLAIMS)


def iter_files(root: Path):
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if path.is_file():
            yield rel, path


def is_gate_source(rel: Path) -> bool:
    return rel.as_posix() in GATE_SOURCES


def key_file_problem(rel: Path) -> str | None:
    name = rel.name
    if name.lower().endswith(".pub"):
        return None
    if rel.suffix.lower() in KEY_FILE_SUFFIXES or KEY_FILE_NAMES.fullmatch(name):
        return f"key-material file name {name!r}"
    return None


def extract_urls(text: str):
    for match in URL_RE.finditer(text):
        url = match.group(0).rstrip(URL_TRAILING)
        yield match.start(), url


def url_host_problem(url: str) -> str | None:
    """Return why a URL is not allowed, or None if it is allowed."""
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        return "unparseable URL"
    if parts.scheme.lower() != "https":
        return "URL must use https"
    segments = [s for s in parts.path.split("/") if s]
    first = segments[0].lower() if segments else ""
    if host == "ecocitizenz.com" or host.endswith(".ecocitizenz.com"):
        return None
    if host == RESOLVER_HOST:
        return None
    if any(host == h or host.endswith("." + h) for h in EXAMPLE_HOSTS):
        return None
    if host == "github.com":
        if first in GITHUB_OWNERS:
            return None
        if first == "marketplace" and len(segments) > 1 and segments[1].lower().startswith(GITHUB_MARKETPLACE_PREFIX):
            return None
    if host == "raw.githubusercontent.com" and first == "ecocitizenz-ltd":
        return None
    if host == "marketplace.visualstudio.com" and parts.path == "/items":
        item = parse_qs(parts.query).get("itemName", [""])[0].lower()
        if item.startswith(VS_MARKETPLACE_PUBLISHER):
            return None
    return f"host {host or '(none)'} is not on the allowlist"


def _normalise_price_line(line: str) -> str:
    """Return the line as a reader sees it rendered, for the price rule.

    HTML entities are decoded, compatibility characters (full-width symbols
    and digits, non-breaking spaces) are folded, invisible format characters
    are dropped, and HTML tags and Markdown emphasis are removed. The result
    never contains a newline, so line numbers are preserved.
    """
    line = html.unescape(line)
    line = unicodedata.normalize("NFKC", line)
    line = "".join(ch for ch in line if unicodedata.category(ch) != "Cf")
    line = _TAG_RE.sub(" ", line)
    line = _EMPHASIS_RE.sub("", line)
    return re.sub(r"[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]", " ", line)


def _clause_after(norm: str, pos: int, raw_lines: list[str], csv_file: bool) -> str:
    """Return the text from pos to the end of its clause.

    A clause ends at a sentence break, or at a line break unless the next line
    continues the same Markdown paragraph (a soft wrap). Headings and table
    rows always end at the line break, and so does every CSV row.
    """
    end_match = SENTENCE_END.search(norm, pos)
    end = end_match.start() if end_match else len(norm)
    search_from = pos
    while True:
        newline = norm.find("\n", search_from, end)
        if newline == -1:
            break
        line_no = norm.count("\n", 0, newline)  # 0-based index of the current line
        current = raw_lines[line_no].lstrip()
        following = raw_lines[line_no + 1] if line_no + 1 < len(raw_lines) else ""
        if csv_file or current.startswith(("#", "|")) or BLOCK_START.match(following):
            end = newline
            break
        search_from = newline + 1
    return norm[pos:end]


def _canonical_amount(raw: str) -> str:
    if not WELL_FORMED_AMOUNT.fullmatch(raw):
        return raw
    amount = raw.replace(",", "")
    if "." in amount:
        amount = amount.rstrip("0").rstrip(".")
    return amount


# --------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------


def check_encoding(rel: Path, path: Path, failures: list[str]) -> str | None:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        failures.append(f"[encoding] {rel.as_posix()}: invalid UTF-8")
        return None
    for marker in MOJIBAKE_MARKERS:
        if marker in text:
            failures.append(f"[encoding] {rel.as_posix()}: suspicious encoding sequence {marker!r}")
    return text


def check_prices(rel: Path, text: str, failures: list[str]) -> None:
    name = rel.as_posix()
    raw_lines = text.split("\n")
    norm = "\n".join(_normalise_price_line(line) for line in raw_lines)
    csv_file = rel.suffix.lower() == ".csv"
    for m in PRICE_RE.finditer(norm):
        symbol = m.group("sym")
        currency = SYMBOL_CURRENCY[symbol] if symbol else (m.group("code1") or m.group("code2")).upper()
        amount = _canonical_amount(m.group("amt1") or m.group("amt2"))
        after = URL_RE.sub(" ", _clause_after(norm, m.end(), raw_lines, csv_file))
        before = URL_RE.sub(" ", norm[norm.rfind("\n", 0, m.start()) + 1:m.start()])[-60:]
        figure = m.group(0)
        where = f"{name}:{_line(norm, m.start())}"
        if RECURRING_AFTER.search(after) or RECURRING_BEFORE.search(before):
            failures.append(f"[price] {where}: recurring price figure {figure!r}; recurring prices live in TrustOps")
        elif (currency, amount) not in ALLOWED_ONE_OFF_PRICES or AMOUNT_MULTIPLIER.match(norm, m.end()):
            failures.append(
                f"[price] {where}: price figure {figure!r} is not on the one-off allowlist;"
                " prices live in TrustOps"
            )


def check_secrets(rel: Path, text: str, failures: list[str], emails: bool = True) -> None:
    name = rel.as_posix()
    for label, pattern in CREDENTIAL_PATTERNS:
        for m in pattern.finditer(text):
            failures.append(f"[credential] {name}:{_line(text, m.start())}: {label}")
    if not emails:
        return
    for m in EMAIL_RE.finditer(text):
        domain = m.group(1).lower()
        if domain not in ALLOWED_EMAIL_DOMAINS:
            failures.append(f"[email] {name}:{_line(text, m.start())}: address at {domain} is not allowed")


def check_content(rel: Path, text: str, failures: list[str]) -> None:
    name = rel.as_posix()
    prose = rel.suffix.lower() in PROSE_EXTS

    if prose:
        for phrase, pattern in CLAIM_PATTERNS:
            for m in pattern.finditer(text):
                failures.append(f"[claims] {name}:{_line(text, m.start())}: prohibited claim phrase {phrase!r}")

    for start, url in extract_urls(text):
        problem = url_host_problem(url)
        if problem:
            failures.append(f"[url-host] {name}:{_line(text, start)}: {problem}: {url}")
            continue
        parts = urlsplit(url)
        if (parts.hostname or "").lower() == RESOLVER_HOST and parts.path not in ("", "/") \
                and not RESOLVER_RECORD_PATH.fullmatch(parts.path):
            failures.append(f"[legacy-route] {name}:{_line(text, start)}: Resolver links must use /p/<ECZ-ID>: {url}")

    for pattern, why in LEGACY_ROUTES:
        for m in pattern.finditer(text):
            failures.append(f"[legacy-route] {name}:{_line(text, m.start())}: {why}: {m.group(0)!r}")

    if prose:
        check_prices(rel, text, failures)

    check_secrets(rel, text, failures)


def check_file(rel: Path, path: Path, failures: list[str]) -> None:
    problem = key_file_problem(rel)
    if problem:
        failures.append(f"[credential] {rel.as_posix()}: {problem}; never commit key material")
    if rel.suffix.lower() in TEXT_EXTS:
        text = check_encoding(rel, path, failures)
        if text is None:
            return
        if is_gate_source(rel):
            check_secrets(rel, text, failures)
        else:
            check_content(rel, text, failures)
        return
    # Any other file: scan it for secrets whatever its extension. Bytes that
    # are not UTF-8 are read as Latin-1 so a credential cannot hide behind one
    # invalid byte; email addresses are only checked in real text.
    data = path.read_bytes()
    try:
        check_secrets(rel, data.decode("utf-8"), failures)
    except UnicodeDecodeError:
        check_secrets(rel, data.decode("latin-1"), failures, emails=False)


def readme_documented_columns(readme: str) -> tuple[list[str], dict[str, set[str]]] | None:
    if README_COLUMNS_START not in readme or README_COLUMNS_END not in readme:
        return None
    block = readme.split(README_COLUMNS_START, 1)[1].split(README_COLUMNS_END, 1)[0]
    names: list[str] = []
    values: dict[str, set[str]] = {}
    for line in block.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        m = re.fullmatch(r"`([a-z0-9_]+)`", cells[0]) if cells else None
        if not m:
            continue
        names.append(m.group(1))
        values[m.group(1)] = set(re.findall(r"`([^`]+)`", cells[-1])) if len(cells) > 2 else set()
    return names, values


def check_register_row(where: str, record: dict[str, str], failures: list[str]) -> None:
    """Cross-field rules that keep a row's authority claims consistent."""
    state = record.get("customer_confirmation_state", "")
    confirmation = record.get("customer_confirmation_reference", "")
    if state == "confirmed":
        if not record.get("customer_authority_reference", ""):
            failures.append(f"[register] {where}: confirmed needs a customer_authority_reference")
        if not confirmation:
            failures.append(
                f"[register] {where}: confirmed needs a customer_confirmation_reference"
                " pointing at the customer's own confirmation"
            )
    if confirmation and state not in CUSTOMER_RESPONSE_STATES:
        failures.append(
            f"[register] {where}: customer_confirmation_reference must be empty while"
            f" customer_confirmation_state is {state or 'empty'!r}"
        )
    for column in MSP_AUTHORED_REFERENCES:
        if confirmation and confirmation == record.get(column, ""):
            failures.append(
                f"[register] {where}: customer_confirmation_reference repeats {column};"
                " an MSP-authored pointer is not the customer's confirmation"
            )
    if state in {"declined", "expired"} and record.get("lifecycle_state", "") == "active":
        failures.append(f"[register] {where}: lifecycle_state cannot be active while customer_confirmation_state is {state!r}")


def check_register(root: Path, failures: list[str]) -> None:
    name = REGISTER_PATH.as_posix()
    path = root / REGISTER_PATH
    if not path.is_file():
        failures.append(f"[register] {name}: missing")
        return
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return  # already reported by the encoding rule
    if not text.endswith("\n"):
        failures.append(f"[register] {name}: file must end with a newline")
    rows = list(csv.reader(io.StringIO(text, newline="")))
    if not rows:
        failures.append(f"[register] {name}: empty")
        return

    header = rows[0]
    if tuple(header) != REGISTER_COLUMNS:
        missing = [c for c in REGISTER_COLUMNS if c not in header]
        extra = [c for c in header if c not in REGISTER_COLUMNS]
        failures.append(
            f"[register] {name}:1: header does not equal the documented column list"
            f" (missing={missing}, unexpected={extra}, order must match README)"
        )

    customers: set[str] = set()
    for row_no, row in enumerate(rows, start=1):
        for col_no, cell in enumerate(row):
            column = header[col_no] if col_no < len(header) else f"column {col_no + 1}"
            if cell.startswith(FORMULA_PREFIXES) or cell.lstrip(" ").startswith(FORMULA_PREFIXES):
                failures.append(f"[register] {name}:{row_no}: {column} starts with a spreadsheet formula character")
            if any(ch in cell for ch in "\r\n\t"):
                failures.append(f"[register] {name}:{row_no}: {column} contains a control character")
        if row_no == 1:
            continue
        if len(row) != len(header):
            failures.append(f"[register] {name}:{row_no}: has {len(row)} cells, header has {len(header)}")
            continue
        record = dict(zip(header, row))
        if record.get("customer_organisation", ""):
            customers.add(record["customer_organisation"])
        for column, allowed in CONTROLLED_VALUES.items():
            value = record.get(column, "")
            if value and value not in allowed:
                failures.append(f"[register] {name}:{row_no}: {column} value {value!r} is not one of {sorted(allowed)}")
        for column in DATE_COLUMNS:
            value = record.get(column, "")
            if value:
                try:
                    ok = bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)) and datetime.date.fromisoformat(value)
                except ValueError:
                    ok = False
                if not ok:
                    failures.append(f"[register] {name}:{row_no}: {column} must be YYYY-MM-DD, got {value!r}")
        link = record.get("resolver_recheck_link", "")
        if link and not RESOLVER_RECORD_URL.fullmatch(link):
            failures.append(f"[register] {name}:{row_no}: resolver_recheck_link must be https://resolver.ecocitizenz.org/p/<ECZ-ID>")
        check_register_row(f"{name}:{row_no}", record, failures)
        for column, prefix in SYNTHETIC_PREFIXES.items():
            value = record.get(column, "")
            if value and not value.startswith(prefix):
                failures.append(
                    f"[register-synthetic] {name}:{row_no}: {column} {value!r} must start with {prefix!r};"
                    " template rows must be obviously synthetic"
                )
    if len(customers) > 1:
        failures.append(
            f"[register] {name}: template rows name {len(customers)} customers {sorted(customers)};"
            " keep one register per customer"
        )

    readme_path = root / README_PATH
    if not readme_path.is_file():
        failures.append(f"[register] {README_PATH.as_posix()}: missing, cannot compare documented columns")
        return
    documented = readme_documented_columns(readme_path.read_text(encoding="utf-8", errors="replace"))
    if documented is None:
        failures.append(f"[register] {README_PATH.as_posix()}: register-columns markers not found")
        return
    names, values = documented
    if tuple(names) != REGISTER_COLUMNS:
        failures.append(
            f"[register] {README_PATH.as_posix()}: documented register columns do not match {name}"
            f" (documented={names})"
        )
    for column, allowed in CONTROLLED_VALUES.items():
        if column in values and values[column] != allowed:
            failures.append(
                f"[register] {README_PATH.as_posix()}: documented values for {column}"
                f" {sorted(values[column])} do not match the contract {sorted(allowed)}"
            )


def check_readme(root: Path, failures: list[str]) -> None:
    name = README_PATH.as_posix()
    path = root / README_PATH
    if not path.is_file():
        failures.append(f"[readme] {name}: missing")
        return
    text = path.read_text(encoding="utf-8", errors="replace")
    ctas = list(README_BOLD_CTA.finditer(text))
    if len(ctas) != 1:
        failures.append(f"[readme] {name}: expected exactly one bold primary CTA, found {len(ctas)}")
    for m in ctas:
        parts = urlsplit(m.group(1))
        if ((parts.hostname or "").lower(), parts.path) != README_PRIMARY_CTA:
            failures.append(f"[readme] {name}:{_line(text, m.start())}: the bold primary CTA must be the free Machine Trust Check")
    for needle, what in README_REQUIRED:
        if needle not in text:
            failures.append(f"[readme] {name}: missing {what} ({needle!r})")


def run_checks(root: Path) -> list[str]:
    root = Path(root)
    failures: list[str] = []
    for rel, path in iter_files(root):
        check_file(rel, path, failures)
    check_register(root, failures)
    check_readme(root, failures)
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent,
                        help="repository root (default: the parent of scripts/)")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="backslashreplace")
    failures = run_checks(args.root)
    if failures:
        print("PUBLIC COPY QUALITY GATE: FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("PUBLIC COPY QUALITY GATE: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
