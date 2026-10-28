# ECZ-ID MSP / MSSP Machine Trust Toolkit

![ECZ-ID MSP Machine Trust Toolkit customer-estate visual](https://raw.githubusercontent.com/EcoCitizenz-Ltd/.github/main/assets/repository-visuals/eczid-msp-machine-trust-toolkit.jpg)

## Know which machines can act across your customers' environments.

MSPs and MSSPs already manage users, endpoints, identities and applications.

The next estate also includes MCP servers, AI agents, plugins, APIs, service workloads, IoT devices, SDK integrations and the machine identities they use.

This repository gives you a practical starting point for discovering those surfaces, recording what each customer authorised separately from what each machine can technically reach, deciding what deserves deeper review, and moving the right client estates into a repeatable Machine Trust service.

It is designed to work alongside your RMM, PSA, IAM, OAuth and security controls, not to replace them.

## Start with the client-estate question, not the product

### Start here: run the free Machine Trust Check

Seventeen questions. No signup. The answers are evaluated in your browser and are not transmitted.

[**Run the free Machine Trust Check ->**](https://msp.ecocitizenz.com/trust-check?utm_source=github&utm_medium=repository&utm_campaign=msp-machine-trust&utm_content=hero-check)

### If the check finds gaps: the fixed-scope Baseline

If the check shows that machine actors, customer authority, delegated access or evidence are difficult to account for consistently, the bounded next step is the fixed-scope **£395 Client-Estate Machine Trust Baseline**.

The Baseline maps representative machine/action paths, customer authority, operating surfaces and evidence, then identifies which client estates should enter recurring Machine Trust.

[Review the £395 Client-Estate Machine Trust Baseline ->](https://msp.ecocitizenz.com/audit?utm_source=github&utm_medium=repository&utm_campaign=msp-machine-trust&utm_content=hero-baseline)

Checkout for the Baseline runs on TrustOps. Payment is never verification: paying for the Baseline or for any tier starts intake or a commercial record, and it does not create, change or prove any ECZ-ID record.

---

## Keeping client estates current

The Baseline creates the starting record. Recurring Machine Trust for MSPs tiers keep the selected client estates current through customer authority, operator delegation, lifecycle state, Attention Required, client evidence and independent re-check. Some of these elements, including Attention Required, Evidence Packs and customer proof views, are delivered by an EcoCitizenz operator today.

Your MSP keeps the customer relationship and the service wrapper.

Current tiers and prices are published only on TrustOps, and this repository does not copy them: [recurring Machine Trust for MSPs tiers](https://trustops.ecocitizenz.com/start#solution-msp).

---

## Customer machine-trust discovery checklist

For each customer, ask the questions below. The names in brackets are the register columns that record each answer.

### MCP

- Which MCP servers are configured? (`machine_kind` = `mcp`, `machine_identifier`)
- Who operates them? (`machine_operator_organisation`, `msp_operator_organisation`, `accountable_operator_role`)
- Which tools are exposed? (`action_class`)
- Which environments can they reach? (`technical_access_reference`)
- What changed recently? (`change_detected`)

### AI agents

- Which agents are deployed or under evaluation? (`machine_kind` = `agent`, `machine_identifier`)
- Which tools and MCP servers can they access? (`technical_access_reference`, `action_class`)
- Which external systems can they reach? (`technical_access_reference`)
- Which delegated authorities and credentials are involved? (`customer_authority_reference`, `operator_delegation_reference`, `technical_access_reference`; record where a credential is held, never the credential)

### APIs

- Which critical APIs are machine-consumed? (`machine_kind` = `api`, `machine_identifier`)
- Who operates them? (`machine_operator_organisation`)
- How are identity and authorization established? (`technical_access_reference` for what the platform permits, `customer_authority_reference` for what the customer authorised)
- Where can current evidence be reviewed? (`evidence_reference`, `resolver_recheck_link`)

### Evidence

- Is there a current owner? (`customer_owner_role`, `accountable_operator_role`)
- Has the customer confirmed the authority? (`customer_confirmation_state`)
- Is there a review date? (`last_reviewed`, `review_due`, `currentness_state`)
- Is there a change baseline? (`change_detected`; use `no_baseline` when none exists)
- Is there a revocation or incident route? (`revocation_route`, `lifecycle_state`)
- Can evidence be independently re-checked? (`evidence_reference`, `receipt_reference`, `resolver_recheck_link`)

---

## Customer machine-trust register

The canonical column list is the header row of [`templates/customer-machine-trust-register.csv`](templates/customer-machine-trust-register.csv). The table below documents the same columns in the same order, and CI fails if the two drift apart.

**Customer authority is not technical access.** Record three things separately:

1. What the customer authorised (`customer_authority_reference`).
2. What your MSP, as the accountable operator, delegated to the machine within that authority (`operator_delegation_reference`).
3. What a platform technically permits, such as an admin role, an OAuth consent or an API scope (`technical_access_reference`).

A platform permission is not the customer's authority. A row your MSP fills in is MSP-declared. Set `customer_confirmation_state` to `confirmed` only when the referenced confirmation came from the customer.

<!-- register-columns:start -->
| Column | Records | Values |
|---|---|---|
| `customer_organisation` | The customer organisation the machine acts for. | Free text |
| `customer_owner_role` | The customer role that owns the authority decision. Record a role, not a named person. | Free text |
| `msp_operator_organisation` | The MSP or MSSP accountable for the machine in this customer estate. | Free text |
| `accountable_operator_role` | The role inside the MSP that answers for the machine. | Free text |
| `machine_kind` | The kind of machine actor. | `agent`, `mcp`, `plugin`, `api`, `service-workload`, `iot`, `sdk` |
| `machine_identifier` | The identifier the machine carries in the system it runs in. | Free text |
| `machine_operator_organisation` | The organisation that runs the machine: the MSP, the customer or a vendor. | Free text |
| `action_class` | The most consequential action the machine can take. | `READ`, `WRITE`, `HIGH-IMPACT-ADMIN` |
| `customer_authority_reference` | Customer authority: a pointer to what the customer authorised, such as a scope decision, contract clause or change record. Leave empty if none exists. | Reference |
| `operator_delegation_reference` | Operator delegation: a pointer to what the MSP delegated to the machine within that authority. | Reference |
| `technical_access_reference` | Technical access: a pointer to what the platform permits. Never the credential, token or key itself. | Reference |
| `customer_confirmation_state` | Whether the customer has confirmed the authority record. Only the customer can make it `confirmed`. | `not_requested`, `requested`, `confirmed`, `declined`, `expired` |
| `evidence_reference` | A pointer to evidence that can be re-checked. | Reference |
| `lifecycle_state` | The current state of the machine's authority. | `active`, `suspended`, `revoked`, `superseded`, `expired` |
| `revocation_route` | A pointer to how the authority is withdrawn and how an incident is raised. | Reference |
| `last_reviewed` | The date of the last review. | `YYYY-MM-DD` |
| `review_due` | The date the next review is due. | `YYYY-MM-DD` |
| `currentness_state` | Whether the row is still current: `stale` once `review_due` has passed or a change is detected. | `current`, `stale`, `unknown` |
| `change_detected` | Change against the recorded baseline since the last review. | `no_change`, `changed`, `no_baseline`, `unknown` |
| `receipt_reference` | A pointer to a receipt recorded for a change or confirmation, where one exists. | Reference |
| `resolver_recheck_link` | The public Resolver page for the record, where an ECZ-ID record exists (`/p/<ECZ-ID>` on resolver.ecocitizenz.org). | URL or empty |
| `next_action` | The single next action for this row. | Free text |
<!-- register-columns:end -->

### Safe use of the template

- The example rows are synthetic. Delete them before you use the template.
- Record pointers to where consents, credentials and evidence are held. Never put a credential, token, key or private customer evidence in the register.
- Record roles rather than named individuals, to keep personal data out of the register.
- Values pasted from MCP manifests, tool metadata or tickets can start with `=`, `+`, `-` or `@`. A spreadsheet may run such a value as a formula. Prefix it with an apostrophe (`'`) or rewrite it.
- Keep one header row and end the file with a newline, so appended rows stay aligned.

---

## Free technical tools for the estate

The commercial journey above does not replace technical inspection. Use the free tools below where they fit the client environment.

### MCP Trust

Local-first MCP inspection and change visibility.

[Install MCP Trust Free](https://marketplace.visualstudio.com/items?itemName=ecocitizenz.eczid-mcp-trust)

[Explore MCP Trust](https://developers.ecocitizenz.com/mcp-trust?utm_source=github&utm_medium=repository&utm_campaign=msp-machine-trust&utm_content=mcp)

### Agent Trust

Local agent authority and capability visibility.

[Install Agent Trust Free](https://marketplace.visualstudio.com/items?itemName=ecocitizenz.eczid-ai-agents)

[Explore Agent Trust](https://developers.ecocitizenz.com/agent-trust?utm_source=github&utm_medium=repository&utm_campaign=msp-machine-trust&utm_content=agent)

### GitHub checks

Use ECZ-ID MCP & Agent Check for supported committed MCP and agent configuration and pull-request findings.

[Install the free MCP & Agent Check GitHub App](https://github.com/marketplace/ecz-id-mcp-agent-check)

### Trust preflight

Use the free MCP & AI Agent Trust Preflight as a practical review aid before deeper assessment.

[Download the free Trust Preflight](https://developers.ecocitizenz.com/downloads/eczid-mcp-agent-trust-preflight.pdf?utm_source=github&utm_medium=repository&utm_campaign=msp-machine-trust&utm_content=preflight)

---

## GitHub-native managed-service layer

For customers using GitHub, combine:

- **ECZ-ID MCP & Agent Check** for supported committed MCP/agent configuration and change review ([GitHub Marketplace listing](https://github.com/marketplace/ecz-id-mcp-agent-check)).
- **ECZ-ID Agent Trust** for specialist supported agent identity/evidence review ([GitHub Marketplace listing](https://github.com/marketplace/ecz-id-agent-trust)).
- **ECZ-ID MCP Verifier** for repeatable public Resolver-posture checks where a parent ECZ-ID is available ([repository](https://github.com/Ecocitizenz/ecz-id-mcp-verifier)).

These tools can support a managed review workflow without turning a GitHub result into a universal trust verdict.

---

## For automation and agents

Scripts and agents can use these public surfaces today:

- **Public Resolver.** Each ECZ-ID record has a human-readable page at `/p/` plus the ECZ-ID on resolver.ecocitizenz.org, for example [ECZ-GB-RBS1NW](https://resolver.ecocitizenz.org/p/ECZ-GB-RBS1NW). Read the record's current state there rather than caching it.
- **Free Machine Trust Check.** The check at https://msp.ecocitizenz.com/trust-check runs in the browser and does not transmit answers, so there is no submission API.
- **TrustOps start routes.** Commercial journeys begin under https://trustops.ecocitizenz.com/start. For example, the Baseline order review is https://trustops.ecocitizenz.com/start/review?intent=mcp_service_audit&context=msp. A start route opens a review step for a person. It does not complete a purchase.

Machine Capability routes, meaning programmatic offer discovery, next-action routing and purchase routes for agents, are not yet public. Do not depend on any ECZ-ID or TrustOps endpoint that is not listed above. This section will change when those routes are released.

---

## Public operator identity record

**ECZ-ID public identity record: ECZ-GB-RBS1NW (EcoCitizenz Ltd)**

[View the current public record on the ECZ-ID Resolver](https://resolver.ecocitizenz.org/p/ECZ-GB-RBS1NW)

This public record identifies the operator. It is not, by itself, proof of control over any domain, app, repository or tool linked from this repository.

Use ECZ-ID evidence as one input into your own customer policy and service decisions. ECZ-ID does not turn a repository result, machine actor or third party into a universal safety or approval verdict.
