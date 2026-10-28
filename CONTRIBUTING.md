# Contributing

Contributions that improve practical examples, documentation and evidence-review workflows are welcome.

Please keep claims evidence-accurate. Do not make certification, approval, compliance, safety, insurance or guarantee claims about ECZ-ID, a machine, agent, MCP server, API, supplier or counterparty unless a cited authoritative source specifically supports that claim.

Never commit secrets, private keys, customer confidential information or private evidence.

## Public-copy gate

CI runs `python scripts/check_public_copy.py` and its self-tests (`python -m unittest discover -s scripts -p "test_*.py"`). The gate checks encoding, prohibited claim phrases, the link allowlist, legacy routes, hard-coded recurring prices, credential-shaped values and the register CSV contract. Run both commands locally before opening a pull request. Changing a rule means changing the gate and its tests in the same pull request, where reviewers can see it.
