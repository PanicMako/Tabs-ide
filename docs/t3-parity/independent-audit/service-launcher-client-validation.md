# Service launcher client

Batch311: Full253-line source and138-line tests reviewed;4 fake IPC tests passed232ms/exit0. Startup checks decoded protocol/context, exact child version and connected IPC. Exchange attaches message/disconnect listeners, catches send errors, cleans listeners on settle/interruption and imposes30-second timeout. prepareTrial matches committed updateId. requestUpdate matches reply type only; concurrent calls could consume same response absent higher-layer serialization, not reproduced or classified as defect here. SelfUpdate315 consumer traced.

Tests cover acceptance/rejection, pending commit and contradictory context. They do not prove parent durable commit, real IPC, disconnect, timeout, listener cleanup or repeated/concurrent lifecycle. Title claiming durable commit is supported only by fake committed message. No launcher/update executed.
