# DeepSeek Harness, OpenRouter, and local Git writing

Assessed on 26 October 2026. The integration targets the published `@deepseek-ai/dsh@0.2.1-rc.2`; upstream source was inspected separately at the current master revision. The harness is an upstream developer preview, not a stability guarantee.

## What runs where

- Git commit drafts, PR titles/descriptions, and diff summaries use a downloaded Ollama model on the server's computer. The personal Source Control setting defaults to `qwen3:1.7b`. This path does not require or fall back to OpenRouter.
- Agent sessions use the harness selected in Providers > OpenRouter: DeepSeek Harness or the existing OpenCode integration. Pi remains a separate existing provider integration.
- DeepSeek Harness's `llm-pi-ai` plugin is its model transport plugin. Using that plugin does not mean that the full Pi coding-agent harness is running underneath DeepSeek.
- OpenRouter supplies the account's tool-capable models, with their exact IDs and context/output limits. It does not execute local tools itself.

## Integration boundary

Tabs launches the upstream `dsh acp` profile over stdio through the existing ACP adapter. Tabs does not fork or change the upstream agent loop. It writes a credential-free JSON/YAML overlay selecting the upstream OpenRouter provider plugin and the account model catalog. The saved key is resolved server-side and supplied through the child environment, not command arguments, prompts, or config files.

Each provider instance has an isolated DeepSeek home under the Tabs state directory. DeepSeek and OpenCode continuation identities are distinct; switching harnesses never tries to load one harness's native session in the other. ACP owns native session creation, model changes, resume, cancellation, and request-permission messages. Tabs retains the upstream workspace-write/ask boundary; plan interactions start read-only. DeepSeek telemetry is disabled for this integration.

Install with `npm install -g @deepseek-ai/dsh@0.2.1-rc.2` on Node.js 24.9 or newer, then configure the executable in Providers > OpenRouter. On the development machine, the exact release is installed in the user's local Tabs harness directory and exposed as `~/.local/bin/dsh`.

## Git draft quality

Commit drafting uses a commit-specific prompt rather than extracting a sentence from a code-review summary. It prefers staged changes and otherwise reads tracked edits. It never stages or commits files. Conventional Commits drafts use a constrained subject schema; existing automatic Git actions retain explicitly configured writing styles.

PR drafting reads the selected base/head comparison, commit subjects, and repository PR template. It explains the change and its practical effect, avoids file inventories, and does not claim tests passed. Since the generation input has no test-execution evidence, testing/verification sections are explicitly marked Not run. Users can edit the draft before publishing. Edits made during generation are preserved.

Large patches are sampled across components rather than allowing the first large file to monopolize the model context. A small local model still cannot fully understand a large repository from a partial diff; review generated text before publishing. Generation does not publish a PR or comment.

## Harness options considered

| Option                | Fit for Tabs                                                                                      | Tradeoff                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| DeepSeek Harness      | Selected by the user; ACP and plugin-based OpenRouter transport fit the existing adapter boundary | Developer preview; compatibility checks are needed on version updates                                             |
| Pi                    | Already integrated; SDK/RPC suited to custom interfaces and a small core                          | Capabilities and workflow need explicit configuration; compactness alone does not establish better output quality |
| OpenCode              | Already integrated; SDK/server APIs and provider support                                          | Current Tabs OpenRouter path targets OpenCode 1.x, so 2.x requires a separate migration                           |
| Goose                 | Extensible agent with provider/MCP support                                                        | Would add another runtime and lifecycle surface without a demonstrated requirement                                |
| LangChain Deep Agents | Suitable for building custom long-running workflows                                               | Larger integration effort than reusing ACP; unnecessary for the current request                                   |

Community discussions are useful leads, not controlled performance evidence. Reports praise DeepSeek's plugin flexibility and Pi's minimalism, but do not establish a universally best harness. Test the same model, tasks, tool permissions, context, cost, and failure recovery when making comparisons.

## Future UI design guidance: research only

A harness can guide design work by supplying a curated reference library, design briefs, spacing/type/color constraints, component templates, browser tools, and an iterative screenshot-review loop. This is feasible without changing the model weights or forking DeepSeek: upstream instructions/skills, plugins, and MCP provide the relevant extension seams.

Spatial reasoning and visual judgment still depend on the chosen model. An image-capable model plus actual rendered screenshots can inspect alignment, density, contrast, hierarchy, and responsive behavior; a text-only model cannot directly see those screenshots. The harness makes those observations and verification steps available and repeatable. It cannot guarantee aesthetic quality merely through a longer prompt.

A later implementation should keep references separate from commands, ask for a brief before choosing a direction, render the result at several viewport sizes, and compare against the selected references. A reference pack should encode design principles rather than blindly copying a studio's assets or page. No design-specialist plugins, custom prompts, or modified agent loops were added in this change.

## Evidence and references

- [DeepSeek Harness README and preview status](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek ACP protocol and integration contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md)
- [DeepSeek multi-provider plugin, OpenRouter routes, and credential references](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md)
- [DeepSeek default workspace/approval configuration](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/cordis.patch.yml)
- [Pi provider documentation](https://pi.dev/docs/latest/providers) and [RPC interface](https://pi.dev/docs/latest/rpc)
- [OpenCode provider documentation](https://opencode.ai/docs/providers/) and [SDK](https://opencode.ai/docs/sdk/)
- [Goose source and supported integrations](https://github.com/aaif-goose/goose)
- [LangChain Deep Agents](https://www.langchain.com/deep-agents)
- [GitHub guidance on reviewable pull requests](https://docs.github.com/en/pull-requests/concepts/helping-others-review-your-changes)
- [Conventional Commits specification](https://www.conventionalcommits.org/en/v1.0.0/)
- [Ollama Qwen3 0.6B: roughly 523 MB download](https://ollama.com/library/qwen3:0.6b)
- Community anecdotes: [DeepSeek experience discussion](https://www.reddit.com/r/DeepSeek/comments/1wth5fw/anyone_has_experience_with_the_new_deepseek/) and [Pi/OpenCode comparison discussion](https://www.reddit.com/r/PiCodingAgent/comments/1urimd4/has_anyone_here_tried_pi_compared_to_opencode/)

## Validation notes

The installed upstream release passed a real ACP initialization, session/new, OpenRouter model configuration, session/close, and clean shutdown with a fake credential and no paid model request. Tabs' actual adapter also created and unloaded a native thread against that release. A real local Qwen3:1.7b PR draft completed in about 2-3 seconds on the development machine with the small test diff; this is an observation, not a general performance guarantee. Live OpenRouter inference remains subject to the selected model's availability and account limits.
