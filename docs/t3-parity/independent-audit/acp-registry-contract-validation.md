# ACP registry contract review — batch204

Pinned HEAD bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete new source (347 lines) and tests (180 lines) read, including recovered middle provider configuration schemas. Existing batch199 contracts validation: 56 files, 824 tests passed.

Registry URL/agent identity, search/install/uninstall, native session import/delete, provider configuration, probe metadata and operation errors reviewed. Configurable provider list limits and write-only header separation are declared in the contracts; live installation/authentication behavior is not established by this review.

The three probe rejection fixtures for 33 auth methods, invalid auth type and 257 models omit required configOptions. They can throw because that field is missing, so their passing assertions do not independently prove the intended restrictions. The source declares those restrictions. The valid probe fixture includes configOptions, and the oversized operation-error auth fixture does not share this omission. This is a coverage weakness, not an established production failure.

No production changes or additional redundant suite runs. Full audit remains incomplete.
