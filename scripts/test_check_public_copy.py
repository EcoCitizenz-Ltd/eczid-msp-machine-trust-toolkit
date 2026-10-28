"""Self-tests for scripts/check_public_copy.py (stdlib unittest only).

Run from the repository root:
    python -m unittest discover -s scripts -p "test_*.py"

Each test copies the repository into a temporary directory, proves the copy
passes, introduces exactly one violation and asserts that the expected rule
reports it. Non-ASCII fixture characters are built with chr() so this file
stays plain ASCII.
"""

from __future__ import annotations

import contextlib
import csv
import io
import shutil
import tempfile
import unittest
from pathlib import Path

import check_public_copy as gate

REPO_ROOT = Path(__file__).resolve().parent.parent
POUND = chr(0xA3)


def _ignore(_dir, names):
    return [n for n in names if n in gate.SKIP_DIRS]


class RepositoryTest(unittest.TestCase):
    def test_repository_passes(self):
        self.assertEqual(gate.run_checks(REPO_ROOT), [])

    def test_main_reports_pass(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(gate.main(["--root", str(REPO_ROOT)]), 0)
        self.assertIn("PUBLIC COPY QUALITY GATE: PASS", out.getvalue())

    def test_main_reports_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(gate.main(["--root", tmp]), 1)
            self.assertIn("PUBLIC COPY QUALITY GATE: FAIL", out.getvalue())


class FixtureTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "repo"
        shutil.copytree(REPO_ROOT, self.root, ignore=_ignore)
        self.assertEqual(gate.run_checks(self.root), [], "fixture copy must start clean")

    def tearDown(self):
        self._tmp.cleanup()

    # -- helpers ----------------------------------------------------------

    def read(self, rel: str) -> str:
        with open(self.root / rel, encoding="utf-8", newline="") as fh:
            return fh.read()

    def write(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)

    def append(self, rel: str, text: str) -> None:
        self.write(rel, self.read(rel) + "\n" + text + "\n")

    def replace(self, rel: str, old: str, new: str) -> None:
        text = self.read(rel)
        self.assertIn(old, text)
        self.write(rel, text.replace(old, new, 1))

    def register_rows(self) -> list[list[str]]:
        return list(csv.reader(io.StringIO(self.read(gate.REGISTER_PATH.as_posix()), newline="")))

    def write_register(self, rows: list[list[str]]) -> None:
        buf = io.StringIO()
        csv.writer(buf, lineterminator="\n").writerows(rows)
        self.write(gate.REGISTER_PATH.as_posix(), buf.getvalue())

    def set_cell(self, row: int, column: str, value: str) -> None:
        rows = self.register_rows()
        rows[row][rows[0].index(column)] = value
        self.write_register(rows)

    def assert_rule(self, rule: str, contains: str = "") -> list[str]:
        failures = gate.run_checks(self.root)
        self.assertTrue(any(f.startswith(f"[{rule}]") and contains in f for f in failures),
                        f"expected a [{rule}] failure containing {contains!r}, got {failures}")
        return failures

    def assert_no_rule(self, rule: str) -> None:
        failures = gate.run_checks(self.root)
        self.assertFalse(any(f.startswith(f"[{rule}]") for f in failures), failures)

    def assert_clean(self) -> None:
        self.assertEqual(gate.run_checks(self.root), [])

    # -- encoding ---------------------------------------------------------

    def test_encoding_mojibake(self):
        self.append("README.md", "Caf" + chr(0xC3) + chr(0xA9))
        self.assert_rule("encoding")

    def test_encoding_invalid_utf8(self):
        (self.root / "notes.txt").write_bytes(b"bad \xff\xfe bytes")
        self.assert_rule("encoding")

    # -- claims -----------------------------------------------------------

    def test_each_prohibited_claim(self):
        original = self.read("README.md")
        for phrase in gate.PROHIBITED_CLAIMS:
            with self.subTest(phrase=phrase):
                self.write("README.md", original + "\nThis service is " + phrase.upper() + ".\n")
                self.assert_rule("claims")

    def test_claim_with_hyphen_or_space_variant(self):
        self.append("README.md", "Evidence that is court defensible.")
        self.assert_rule("claims")

    def test_claims_checked_in_csv_and_other_markdown(self):
        self.set_cell(1, "next_action", "Tell the customer the agent is certified safe")
        self.assert_rule("claims")

    def test_claims_do_not_match_inside_other_words(self):
        self.append("SUPPORT.md", "Uninsured losses are out of scope.")
        self.assert_no_rule("claims")

    def test_gate_sources_are_exempt_only_from_copy_rules(self):
        # The two named gate sources may hold off-allowlist URLs as fixtures.
        line = "\n# fixture: https://attacker.net/x\n"
        for rel in sorted(gate.GATE_SOURCES):
            with self.subTest(rel=rel):
                saved = self.read(rel)
                self.write(rel, saved + line)
                self.assert_clean()
                self.write(rel, saved)

    def test_other_scripts_are_not_gate_sources(self):
        self.write("scripts/extra_rule.py", "# see https://attacker.net/x\n")
        self.assert_rule("url-host", "scripts/extra_rule.py")
        self.assertFalse(gate.is_gate_source(Path("scripts/extra_rule.py")))
        self.assertFalse(gate.is_gate_source(Path("tools/scripts/check_public_copy.py")))

    # -- url-host ---------------------------------------------------------

    def test_url_hosts_rejected(self):
        bad = [
            "https://evil.example.net/page",
            "http://msp.ecocitizenz.com/trust-check",
            "https://ecocitizenz.com.attacker.net/",
            "https://attacker.net/?next=ecocitizenz.com",
            "https://ecocitizenz.com" + "@attacker.net/",
            "https://github.com/someone-else/repo",
            "https://github.com/marketplace/another-app",
            "https://raw.githubusercontent.com/someone-else/repo/main/x.png",
            "https://marketplace.visualstudio.com/items?itemName=other.extension",
            "https://ecocitizenz.org/",
        ]
        original = self.read("README.md")
        for url in bad:
            with self.subTest(url=url):
                self.write("README.md", original + f"\n[link]({url})\n")
                self.assert_rule("url-host")

    def test_url_hosts_allowed(self):
        self.append("README.md", " ".join([
            "https://www.ecocitizenz.com/",
            "https://api.ecocitizenz.com/",
            "https://developers.ecocitizenz.com/x",
            "https://example.com/a",
            "https://docs.example.org/b",
            "https://github.com/EcoCitizenz-Ltd/eczid-msp-machine-trust-toolkit",
        ]))
        self.assert_no_rule("url-host")

    # -- legacy-route -----------------------------------------------------

    def test_legacy_msp_surface(self):
        for text in ("https://mcp.ecocitizenz.com/msp", "see mcp.ecocitizenz.com/msp?x=1"):
            with self.subTest(text=text):
                self.write("SUPPORT.md", self.read("SUPPORT.md") + "\n" + text + "\n")
                self.assert_rule("legacy-route")

    def test_mcp_site_root_is_not_legacy(self):
        self.append("SUPPORT.md", "https://mcp.ecocitizenz.com/")
        self.assert_no_rule("legacy-route")

    def test_non_canonical_resolver_path(self):
        for text in ("https://resolver.ecocitizenz.org/passport/ECZ-GB-RBS1NW",
                     "https://resolver.ecocitizenz.org/record/ECZ-GB-RBS1NW"):
            with self.subTest(text=text):
                self.write("SUPPORT.md", self.read("SUPPORT.md") + "\n" + text + "\n")
                self.assert_rule("legacy-route")

    # -- price ------------------------------------------------------------

    def test_recurring_and_unlisted_prices(self):
        original = self.read("README.md")
        for text in (POUND + "249 per month",
                     POUND + "395/month",
                     "GBP 649 monthly",
                     "1,499 GBP a month",
                     "a monthly subscription of " + POUND + "395",
                     POUND + "2,500"):
            with self.subTest(text=text):
                self.write("README.md", original + "\nTier price: " + text + "\n")
                self.assert_rule("price")

    def test_price_rule_bypasses_are_caught(self):
        original = self.read("README.md")
        for text in (
            # space between the symbol or code and the amount
            POUND + " 249 per month",
            POUND + " 249",
            "GBP  649",
            # HTML entities, full-width and invisible characters, inline markup
            "&pound;249 per month",
            "&#163;249",
            "&#xa3;249",
            "&euro;395",
            chr(0xFFE1) + "249",
            POUND + chr(0x200B) + "249",
            POUND + "**249** per month",
            POUND + "<b>249</b>",
            # recurring qualifiers that are not directly after the figure
            POUND + "395 + VAT per month",
            POUND + "395 (ex VAT) pcm",
            POUND + "395 + VAT pm",
            POUND + "395 every month",
            POUND + "395 each managed client",
            POUND + "395 for each client, billed monthly",
            POUND + "395 a year",
            POUND + "395/client/month",
            POUND + "395/m",
            POUND + "395 p.a.",
            # the allowlisted amount in another currency or scale
            "$395",
            chr(0x20AC) + "395",
            "395 USD",
            "USD 395",
            POUND + "395k",
            POUND + "39,5",
        ):
            with self.subTest(text=text):
                self.write("README.md", original + "\nTier price: " + text + "\n")
                self.assert_rule("price")

    def test_price_qualifier_on_soft_wrapped_line(self):
        self.append("README.md", "The tier costs " + POUND + "395\nper month after the Baseline.")
        self.assert_rule("price", "README.md:")

    def test_price_qualifier_in_same_table_row(self):
        self.append("README.md", "| Tier | Price | Billing |\n|---|---|---|\n| Growth | " + POUND + "395 | per month |")
        self.assert_rule("price")

    def test_price_checked_in_csv_rows(self):
        self.set_cell(1, "next_action", "Quote " + POUND + "395 per client per month")
        self.assert_rule("price", gate.REGISTER_PATH.as_posix())

    def test_one_off_baseline_price_allowed(self):
        for text in ("The fixed-scope " + POUND + "395 Baseline.",
                     "The fixed-scope **" + POUND + "395 Client-Estate Machine Trust Baseline**.",
                     "The Baseline costs &pound;395.00 once.",
                     "The " + POUND + "395 Baseline is one-off. Recurring tiers are monthly and live on TrustOps.",
                     "## The " + POUND + "395 Baseline\nMonthly tiers live on TrustOps.",
                     "The " + POUND + "395 Baseline\n- monthly tiers live on TrustOps",
                     "| Offer | Price |\n|---|---|\n| Baseline | " + POUND + "395 |\n| Tiers | monthly, on TrustOps |",
                     "[Review the " + POUND + "395 Baseline ->](https://msp.ecocitizenz.com/audit?x=/m/month)"):
            with self.subTest(text=text):
                saved = self.read("README.md")
                self.append("README.md", text)
                self.assert_no_rule("price")
                self.write("README.md", saved)

    # -- credential -------------------------------------------------------

    def test_credentials(self):
        original = self.read("README.md")
        for text in ("api_key" + " = abcd1234efgh5678",
                     "-----BEGIN RSA " + "PRIVATE KEY-----",
                     "AKIA" + "ABCDEFGHIJKLMNOP",
                     "ghp_" + "a" * 36):
            with self.subTest(text=text):
                self.write("README.md", original + "\n" + text + "\n")
                self.assert_rule("credential")

    def test_credentials_in_python_files(self):
        aws = "AKIA" + "ABCDEFGHIJKLMNOP"
        for rel, text in (("tools/leak.py", 'AWS = "' + aws + '"\n'),
                          ("examples/mcp_client.py", 'GITHUB_TOKEN = "' + "ghp_" + "a" * 36 + '"\n'),
                          ("scripts/helper.py", "pass" + "word = 'hunter2hunter2'\n")):
            with self.subTest(rel=rel):
                self.write(rel, text)
                self.assert_rule("credential", rel)
                (self.root / rel).unlink()

    def test_gate_sources_are_scanned_for_credentials_and_email(self):
        aws = "AKIA" + "ABCDEFGHIJKLMNOP"
        for rel in sorted(gate.GATE_SOURCES):
            with self.subTest(rel=rel):
                saved = self.read(rel)
                self.write(rel, saved + "\n# " + aws + "\n# owner" + "@realcompany.co.uk\n")
                self.assert_rule("credential", rel)
                self.assert_rule("email", rel)
                self.write(rel, saved)

    def test_credentials_in_files_with_unlisted_or_no_extension(self):
        token = "ghp_" + "a" * 36
        for rel in ("templates/.env.example", "deploy.sh", "config/app.toml", "Dockerfile",
                    ".github/scripts/run.ps1", "settings.ini"):
            with self.subTest(rel=rel):
                self.write(rel, "KEY=" + token + "\n")
                self.assert_rule("credential", rel)
                (self.root / rel).unlink()

    def test_credentials_in_binary_files(self):
        rel = "assets/logo.png"
        (self.root / "assets").mkdir()
        (self.root / rel).write_bytes(b"\x89PNG\r\n\x1a\n\xff\xfe")
        self.assert_clean()  # binary files are not UTF-8 and need not be
        (self.root / rel).write_bytes(b"\x89PNG\xff " + ("AKIA" + "ABCDEFGHIJKLMNOP").encode())
        self.assert_rule("credential", rel)

    def test_key_material_file_names(self):
        for rel in ("certs/server.pem", "secrets/prod.key", "deploy/id_rsa", "id_ed25519",
                    ".env", "templates/.env.local", "prod.env", "certs/client.pfx"):
            with self.subTest(rel=rel):
                self.write(rel, "placeholder\n")
                self.assert_rule("credential", "key-material file name")
                (self.root / rel).unlink()

    def test_safe_key_adjacent_file_names(self):
        for rel in ("templates/.env.example", "deploy/id_rsa.pub", "docs/keys.md"):
            with self.subTest(rel=rel):
                self.write(rel, "placeholder\n")
                self.assert_clean()
                (self.root / rel).unlink()

    # -- email ------------------------------------------------------------

    def test_email_domains(self):
        self.append("SUPPORT.md", "Contact jane.doe" + "@realcompany.co.uk")
        self.assert_rule("email")

    def test_example_email_allowed(self):
        self.append("SUPPORT.md", "Example: owner@example.org")
        self.assert_no_rule("email")

    # -- register ---------------------------------------------------------

    def test_register_header_must_match(self):
        rows = self.register_rows()
        rows[0][0] = "customer"
        self.write_register(rows)
        self.assert_rule("register")

    def test_register_header_order_must_match(self):
        rows = self.register_rows()
        rows = [[r[1], r[0], *r[2:]] for r in rows]
        self.write_register(rows)
        self.assert_rule("register")

    def test_register_formula_injection(self):
        for prefix in gate.FORMULA_PREFIXES:
            with self.subTest(prefix=repr(prefix)):
                saved = self.register_rows()
                self.set_cell(1, "next_action", prefix + "HYPERLINK(1)")
                self.assert_rule("register")
                self.write_register(saved)

    def test_register_formula_after_leading_space(self):
        self.set_cell(2, "machine_identifier", " =cmd")
        self.assert_rule("register")

    def test_register_row_width(self):
        rows = self.register_rows()
        rows[1].append("extra")
        self.write_register(rows)
        self.assert_rule("register")

    def test_register_controlled_values(self):
        for column in gate.CONTROLLED_VALUES:
            with self.subTest(column=column):
                saved = self.register_rows()
                self.set_cell(1, column, "not-a-valid-value")
                self.assert_rule("register")
                self.write_register(saved)

    def test_register_dates(self):
        self.set_cell(1, "review_due", "01/01/2027")
        self.assert_rule("register")

    def test_register_resolver_link(self):
        self.set_cell(1, "resolver_recheck_link", "https://msp.ecocitizenz.com/trust-check")
        self.assert_rule("register")

    def test_register_final_newline(self):
        text = self.read(gate.REGISTER_PATH.as_posix())
        self.write(gate.REGISTER_PATH.as_posix(), text.rstrip("\n"))
        self.assert_rule("register")

    def test_readme_columns_must_match_csv(self):
        self.replace("README.md", "| `review_due` |", "| `review_date` |")
        self.assert_rule("register")

    def test_readme_columns_markers_required(self):
        self.replace("README.md", gate.README_COLUMNS_START, "")
        self.assert_rule("register")

    def test_readme_documented_values_must_match(self):
        self.replace("README.md", "`iot`, `sdk`", "`iot`, `sdk`, `robot`")
        self.assert_rule("register")

    # -- register invariants ----------------------------------------------

    def row_index(self, state: str) -> int:
        rows = self.register_rows()
        column = rows[0].index("customer_confirmation_state")
        return next(i for i, r in enumerate(rows) if i and r[column] == state)

    def test_register_confirmed_needs_customer_authority_and_confirmation(self):
        row = self.row_index("confirmed")
        for column in ("customer_authority_reference", "customer_confirmation_reference"):
            with self.subTest(column=column):
                saved = self.register_rows()
                self.set_cell(row, column, "")
                self.assert_rule("register", "confirmed needs a " + column)
                self.write_register(saved)

    def test_register_rejects_unbacked_confirmed_row(self):
        # The row from the review: confirmed and active with nothing behind it.
        rows = self.register_rows()
        record = dict(zip(rows[0], rows[1]))
        record.update(customer_authority_reference="", operator_delegation_reference="EXAMPLE-DELEG-0009",
                      customer_confirmation_state="confirmed", customer_confirmation_reference="",
                      receipt_reference="", lifecycle_state="active", action_class="HIGH-IMPACT-ADMIN")
        rows.append([record[c] for c in rows[0]])
        self.write_register(rows)
        self.assert_rule("register", "confirmed needs a customer_authority_reference")
        self.assert_rule("register", "confirmed needs a customer_confirmation_reference")

    def test_register_confirmation_cannot_repeat_an_msp_pointer(self):
        row = self.row_index("confirmed")
        rows = self.register_rows()
        for column in gate.MSP_AUTHORED_REFERENCES:
            with self.subTest(column=column):
                saved = self.register_rows()
                self.set_cell(row, "customer_confirmation_reference", rows[row][rows[0].index(column)])
                self.assert_rule("register", "repeats " + column)
                self.write_register(saved)

    def test_register_confirmation_reference_needs_a_customer_response(self):
        for state in ("not_requested", "requested"):
            with self.subTest(state=state):
                saved = self.register_rows()
                self.set_cell(self.row_index(state), "customer_confirmation_reference", "EXAMPLE-CUSTCONF-9")
                self.assert_rule("register", "must be empty while customer_confirmation_state is " + repr(state))
                self.write_register(saved)

    def test_register_declined_or_expired_cannot_stay_active(self):
        row = self.row_index("expired")
        for state in ("declined", "expired"):
            with self.subTest(state=state):
                saved = self.register_rows()
                self.set_cell(row, "customer_confirmation_state", state)
                self.set_cell(row, "lifecycle_state", "active")
                self.assert_rule("register", "lifecycle_state cannot be active")
                self.write_register(saved)

    def test_register_template_holds_one_customer(self):
        self.set_cell(2, "customer_organisation", "Example Customer B")
        self.assert_rule("register", "keep one register per customer")

    # -- register-synthetic -----------------------------------------------

    def test_register_rows_must_be_synthetic(self):
        for column, value in (("customer_organisation", "Acme Holdings"),
                              ("machine_identifier", "prod-billing-agent"),
                              ("technical_access_reference", "ROLE-ASSIGNMENT-9")):
            with self.subTest(column=column):
                saved = self.register_rows()
                self.set_cell(1, column, value)
                self.assert_rule("register-synthetic")
                self.write_register(saved)

    # -- readme -----------------------------------------------------------

    def test_readme_single_primary_cta(self):
        self.append("README.md", "[**Buy now ->**](https://msp.ecocitizenz.com/audit)")
        self.assert_rule("readme")

    def test_readme_primary_cta_is_free_check(self):
        self.replace("README.md", "[**Run the free Machine Trust Check ->**](https://msp.ecocitizenz.com/trust-check",
                     "[**Run the free Machine Trust Check ->**](https://msp.ecocitizenz.com/audit")
        self.assert_rule("readme")

    def test_readme_required_caveats(self):
        original = self.read("README.md")
        for needle, _what in gate.README_REQUIRED:
            with self.subTest(needle=needle):
                self.write("README.md", original.replace(needle, "REMOVED"))
                self.assert_rule("readme")


if __name__ == "__main__":
    unittest.main()
