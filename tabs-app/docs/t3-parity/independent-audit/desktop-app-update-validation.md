# Desktop app update broker

Batch327: Complete231-line source and246-line tests read. Availability mode+controlFD, in-flight guard, subscribe-before-send, request-ID filtering, deduplicated progress and prepare token traced. Preparation20-minute deadline; commit failed-report wait2-minute deadline. Commit send is uninterruptible and occurs before its report timeout starts; actual control-channel write deadline remains receiver-dependent. Interrupt during report consumption requests cancellation; earlier send failures do not use that cancellation path. No confirmed blocker assigned.

Tests use fake telemetry receiver and cold iterable report stream. The retained failure test provides latest:none and repeats the entire stream, so it does not validate the actual retained-latest path. It does exercise commit failure mapping. Tests do not exercise actual desktop installer, backend restart, timeout passage or callback onHandoffAccepted. No production desktop launched.
