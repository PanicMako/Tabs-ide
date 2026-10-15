# VCS contract — batch236

Complete287line current source/full modified hunks reviewed. New rate-limited classification maps to generic API-rate-limit detail, and optional retryable true is emitted only when explicitly recognized at process boundary. Factory retains stderr length/truncation metadata without retaining stderr content. Existing contracts824 and previously reviewed VcsProcess tests reused.

Selected process classifier recognizes API/secondary rate-limit and429 strings; selected process retry gate requires exit-error.retryable true. Classification by itself does not assert every rate limit is retryable. Full process source/tests already reviewed earlier; no repeat native execution needed for this wire addition. Hosted rate-limit runtime unverified. No production changes.
