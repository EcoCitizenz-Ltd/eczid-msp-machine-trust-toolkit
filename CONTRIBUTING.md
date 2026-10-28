# Contributing

Contributions that improve practical examples, documentation and evidence-review workflows are welcome.

Please keep claims evidence-accurate. Do not make certification, approval, compliance, safety, insurance or guarantee claims about ECZ-ID, a machine, agent, MCP server, API, supplier or counterparty unless a cited authoritative source specifically supports that claim.

Never commit secrets, private keys, customer confidential information or private evidence.

## Public-copy gate

CI runs `python scripts/check_public_copy.py` and its self-tests (`python -m unittest discover -s scripts -p "test_*.py"`). The gate checks encoding, prohibited claim phrases, the link allowlist, legacy routes, hard-coded prices, email addresses and the register CSV contract. It scans every file for credential-shaped values, whatever its extension, including Python files and files with no extension, and it fails on key-material file names such as `*.pem`, `*.key`, `id_rsa` and `.env`. The scan matches common credential shapes only. It does not replace your own secret scanning. Run both commands locally before opening a pull request. Changing a rule means changing the gate and its tests in the same pull request, where reviewers can see it.
