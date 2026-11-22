# Windows code signing, step by step

**Why:** the Windows installer (`Tabs-<version>-x64.exe`) is only signed when all seven `AZURE_*`
secrets exist in the GitHub repo. Without them the release workflow logs
`Windows signing disabled…` and ships an unsigned installer, which Windows SmartScreen and Defender
treat as suspicious ("virus detected", "Windows protected your PC"). Signing is the real fix. The
build is already wired for it (`.github/workflows/release.yml`,
`tabs-app/scripts/build-desktop-artifact.ts`); you only create the Azure side and add the secrets.

**Names:** Microsoft renamed *Trusted Signing* to **Artifact Signing**. The portal and docs now say
Artifact Signing. Our secrets keep the old `AZURE_TRUSTED_SIGNING_*` names; that is fine.

**Time:** the account takes minutes. Identity validation is the slow part: Microsoft says **1 to 30
business days**. Nothing can be signed until it is `Completed`.

Official references: [Quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) ·
[Assign roles](https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles)

---

## Step 0. Check you are eligible

Public Trust certificates (the kind that avoid SmartScreen warnings) are available to:

- **Individuals** located in the **United States or Canada** only.
- **Organizations** in the US, Canada, EU, UK, Australia, New Zealand, Japan, South Korea,
  Singapore, Switzerland, Norway and Israel.

If you are an individual anywhere else, you cannot use this service. Use the fallback at the end.

## Step 1. Azure subscription

1. Go to <https://portal.azure.com/> and sign in. No account? Create one at
   <https://azure.microsoft.com/free/>.
2. Search **Subscriptions** in the top search box and make sure you have one that is *Active*.

If you are validating as an **individual**, the subscription's billing account must have
**Account Type = Individual**, and its legal name and address must exactly match your government
ID. Fix this *before* Step 5 (the quickstart links "Manage billing accounts").

## Step 2. Register the resource provider (once)

1. In the portal search for **Subscriptions** and open your subscription.
2. Left menu, under **Settings**, click **Resource providers**.
3. Click **Microsoft.CodeSigning**, then the **…** menu, then **Register**.
4. Wait until its status says **Registered**.

## Step 3. Give yourself the roles you need

Open your subscription, then **Access control (IAM)**, **Add**, **Add role assignment**
([how](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal)),
and assign **to yourself**:

- **Contributor** (to create the account and profile; you may already have it as Owner).
- **Artifact Signing Identity Verifier** (needed for identity validation; it also needs **Reader**
  on the subscription). If the **New identity** button is greyed out later, this is why.

## Step 4. Create the Artifact Signing account

1. In the portal search for **Artifact Signing Accounts** and open it.
2. Click **Create**.
3. **Subscription:** pick yours. **Resource group:** **Create new**, name it (e.g. `tabs-signing`).
4. **Account name:** 3 to 24 letters or numbers, globally unique, starts with a letter,
   must not start with "one" (e.g. `tabssigning`). Write it down.
5. **Region:** pick one from the table below. Write down its endpoint.
6. **Pricing:** choose a tier, **Review + Create**, then **Create**, then **Go to resource**.

| Region | Endpoint |
| --- | --- |
| East US | `https://eus.codesigning.azure.net` |
| West US | `https://wus.codesigning.azure.net` |
| West US 2 | `https://wus2.codesigning.azure.net` |
| West US 3 | `https://wus3.codesigning.azure.net` |
| Central US | `https://cus.codesigning.azure.net` |
| North Central US | `https://ncus.codesigning.azure.net` |
| South Central US | `https://scus.codesigning.azure.net` |
| West Central US | `https://wcus.codesigning.azure.net` |
| West Europe | `https://weu.codesigning.azure.net` |
| North Europe | `https://neu.codesigning.azure.net` |
| Poland Central | `https://plc.codesigning.azure.net` |
| Switzerland North | `https://swn.codesigning.azure.net` |
| Japan East | `https://jpe.codesigning.azure.net` |
| Korea Central | `https://krc.codesigning.azure.net` |
| Brazil South | `https://brs.codesigning.azure.net` |

## Step 5. Identity validation (the slow one)

In your account, click **Identity validations** (Overview, or under **Objects**).

### If you are an organization
1. Select **Organization**, **New Identity**, **Public**.
2. Fill in: **Organization Name** (legal name), **Website url**, **Primary Email** (a monitored
   personal mailbox on the company's domain; the verification link expires in 7 days),
   **Secondary Email** (different, same domain), **Business Identifier**, address, and the
   **First/Last Name** of the person who will do the ID check (must match their ID exactly).
3. Optional: **Certificate subject preview**. Then **Create**.
4. Status goes **In Progress**. When it becomes **Action Required**, do the ID check below.
   Watch your email for requests for more documents (documents must be issued in the last 12
   months and not expire within 2 months; you get three upload attempts).

### If you are an individual
1. Select **Organization** then change the dropdown to **Individual**, click **New Identity**,
   **Public**.
2. The fields fill from your billing account. Check **First/Last Name** match your ID, and use the
   same email as your Microsoft login. **Create**.
3. When status becomes **Action Required**, do the ID check below.

### The ID check (both)
1. Click your name in the list to open the blade, then the link under
   **"Please complete your verification here"**.
2. Sign in with the request's email. Click **Get verified here through our trusted ID-verifiers**
   (AU10TIX), then **Let's Begin**, enter your email, enter the PIN you receive, enter your phone
   number, **Start**.
3. Scan the QR code with your phone camera and follow the steps with a government photo ID
   (passport, driver's license, national ID).
4. When asked, open **Microsoft Authenticator**, scan the next QR code, tap **Add** for the
   Verified ID, then scan the final QR code, choose **Verifiable Credential** and **Share**.
5. The browser shows **Verification Successful**. The portal can take a few minutes to say
   **Completed**.

Wait for the status to be **Completed** before continuing.

## Step 6. Create the certificate profile

1. In your account, open **Certificate profiles** (Overview, or under **Objects**).
2. **Create**, then **Public Trust**.
3. **Certificate Profile Name:** 5 to 100 letters/numbers (e.g. `tabs-public`). Write it down.
4. **Program Type:** leave **None**.
5. **Verified CN and O:** choose your completed identity validation.
6. Look at **Certificate Subject Preview**. The **CN** shown there is your **publisher name**.
   Copy it exactly; you need it in Step 9.
7. Click **Create**.

## Step 7. Create the app the CI will sign as (service principal)

1. Open <https://entra.microsoft.com/>, then **App registrations**, **New registration**
   ([docs](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)).
2. Name it `tabs-release-signing`, leave the defaults, **Register**.
3. On its **Overview** page copy **Application (client) ID** and **Directory (tenant) ID**.
4. Left menu **Certificates & secrets**, **Client secrets**, **New client secret**, give it a name
   and an expiry, **Add**.
5. **Copy the secret's *Value* now.** It is shown once. (Not the "Secret ID".)

## Step 8. Allow that app to sign

1. In the portal open your **Artifact Signing account**, then **Access control (IAM)**.
2. **Add**, **Add role assignment**.
3. Role: **Artifact Signing Certificate Profile Signer**. Next.
4. **Members**, **Select members**, search `tabs-release-signing`, select it, **Review + assign**.

## Step 9. The seven values

| GitHub secret | Where the value comes from |
| --- | --- |
| `AZURE_TENANT_ID` | Step 7: Directory (tenant) ID |
| `AZURE_CLIENT_ID` | Step 7: Application (client) ID |
| `AZURE_CLIENT_SECRET` | Step 7: the client secret **Value** |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | Step 4: your region's endpoint URL |
| `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME` | Step 4: the account name |
| `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME` | Step 6: the profile name |
| `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME` | Step 6: the **CN** from Certificate Subject Preview, exactly |

## Step 10. Add them to GitHub

Open <https://github.com/PanicMako/Tabs-ide/settings/secrets/actions>, click **New repository
secret**, and add all seven, one at a time (name, then value, **Add secret**).

Or from a terminal (it prompts for each value):

```bash
gh secret set AZURE_TENANT_ID -R PanicMako/Tabs-ide
```

## Step 11. Release and verify

1. Cut a release as usual. In the run's logs
   (<https://github.com/PanicMako/Tabs-ide/actions>) the Windows job must **not** say
   `Windows signing disabled`.
2. On a Windows PC: right-click the downloaded `.exe`, **Properties**, **Digital Signatures**. Your
   publisher should be listed with a valid timestamp. Or in PowerShell:

```powershell
Get-AuthenticodeSignature .\Tabs-<version>-x64.exe | Format-List Status, SignerCertificate
```

`Status` should be `Valid`.

## Step 12. Expect a short reputation period

A signed installer from a brand-new publisher can still show a SmartScreen prompt until enough
people have installed it. To speed this up and to clear any Defender false positive on builds
already published, submit the file at <https://www.microsoft.com/en-us/wdsi/filesubmission> as
**Software developer**, and report it to any other vendor VirusTotal shows flagging it.

---

## If something goes wrong

- **"New identity" is greyed out:** you are missing **Artifact Signing Identity Verifier** (Step 3).
- **Individual validation fails or the country is not offered:** Step 0 and the billing-account
  note in Step 1. The name and address must match the ID exactly.
- **Signing fails in CI with a permissions error:** the app lacks **Artifact Signing Certificate
  Profile Signer** on the account (Step 8), or `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME` does not match
  the certificate CN exactly.
- **Not eligible at all** (an individual outside the US and Canada): buy a standard Organization
  Validated code-signing certificate from a commercial certificate authority instead. That needs
  changes to the build (`CSC_LINK` and `CSC_KEY_PASSWORD` rather than Azure); ask and I will wire it.

## Rotating the client secret

Client secrets expire. Before then create a new one (Step 7, parts 4 and 5), update
`AZURE_CLIENT_SECRET`, then delete the old one. Never commit any of these values.
