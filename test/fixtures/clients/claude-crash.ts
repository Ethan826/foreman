// A Claude run whose leader is ended by a signal before any result: the
// opening events recorded by live test L1, then nothing.
import { killedBy, type ClientScript } from "./fake-client.ts"

/** The recorded-shape start of a run, ended by SIGKILL. */
export const claudeCrash: ClientScript = {
  lines: [
    '{"subtype": "init", "type": "system", "claude_code_version": "2.1.328", "model": "claude-opus-5-5"}',
    '{"type": "assistant"}',
  ],
  exit: killedBy("SIGKILL"),
}
