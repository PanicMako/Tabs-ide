// Entry for the browser bundle of the shared @relay parser. Built by gen-command.mjs.
import {
  describeRelayIntent,
  formatRelayDue,
  parseRelayCommand,
} from "../../../tabs-app/packages/shared/src/relayCommand";

(globalThis as { RelayCommand?: unknown }).RelayCommand = {
  parseRelayCommand,
  describeRelayIntent,
  formatRelayDue,
};
