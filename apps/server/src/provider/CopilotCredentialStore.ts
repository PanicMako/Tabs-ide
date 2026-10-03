import { deleteProviderSecret, getProviderSecret, setProviderSecret } from "./ProviderSecretStore";

export function getCopilotToken(): Promise<string | null> {
  return getProviderSecret("copilot.github-token");
}

export async function setCopilotToken(token: string): Promise<void> {
  await setProviderSecret("copilot.github-token", token);
}

export async function deleteCopilotToken(): Promise<void> {
  await deleteProviderSecret("copilot.github-token");
}
