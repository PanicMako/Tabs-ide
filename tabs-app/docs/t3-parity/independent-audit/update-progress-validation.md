# Update progress renderer

Batch292: Complete72-line source and101-line test reviewed.11 tests passed128ms/exit0. Stage labels, redraw throttling, redirected plain text, terminal width and final newline covered. Output tests use mocked streams/time. Real updater/download lifecycle remains separate; negative or nonfinite input is not validated here, callers must supply valid byte counts. No production changes.
