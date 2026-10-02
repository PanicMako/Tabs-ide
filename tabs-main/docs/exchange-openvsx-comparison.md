# Open VSX reference and Tabs Exchange decisions

Inspected reference: `eclipse-openvsx/openvsx` at
`2d40f0e529ee0dffb3ee09924f2557ad8d02d1d8`.
The checkout lives in ignored `.repos/openvsx-reference/`, detached at that revision.
It is research-only: no upstream source is incorporated into Tabs and no upstream
license is changed. This is not an exhaustive security audit.

| Concern            | Open VSX                                                   | Tabs decision                                                                           |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Runtime and SDK    | VS Code supplies the extension runtime                     | Tabs supplies its own isolated full-workspace runtime and `@tabs/extension-api`         |
| Package            | VSIX                                                       | Native deterministic `.tabsext`; no gallery-protocol compatibility claim                |
| Publishing         | Browser upload and ovsx CLI against the registry           | Browser and standalone CLI feed the same immutable package review service               |
| Identity           | GitHub account, namespaces and membership                  | Existing GitHub sessions, namespace ownership and scoped expiring tokens                |
| Verification       | Namespace ownership separate from membership               | No verification badge on namespace creation; ownership proof required                   |
| Review             | Scanning and registry policy                               | Every version needs manual exact-digest approval plus scans and signed publication      |
| Deployment         | Separate registry, database, storage and search            | Static Astro website; container API/worker; PostgreSQL; S3-compatible immutable objects |
| Compatible clients | VS Code-compatible editors                                 | Documented native v1 API, separately provisioned TUF roots; Tabs forks permitted        |
| Access             | Hosted service policies differ from self-hosted deployment | Free publishing, download and client use; operator still pays hosting costs             |

Primary references:

- [Repository](https://github.com/eclipse-openvsx/openvsx/tree/2d40f0e529ee0dffb3ee09924f2557ad8d02d1d8)
- [Publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions)
- [Namespace access](https://github.com/eclipse-openvsx/openvsx/wiki/Namespace-Access)
- [Deployment](https://github.com/eclipse-openvsx/openvsx/wiki/Deploying-Open-VSX)
- [Service FAQ](https://managed.open-vsx.org/faqs/)

No npm publication, deployment, branch merge, or public-submission enablement is
authorized by this implementation. Closed-source tools and disclosed externally
billed services are permitted; Tabs has no marketplace checkout. Federation,
ratings, browser execution, privileged background brokers and OIDC publishing
remain later work.
